import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { findMatch, isRequest } from "./match.js";
import { loadTranscript, pairFrames } from "./replay.js";
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  ReplayPair,
  UserMatcher,
} from "./types.js";

export interface HttpReplayOptions {
  file: string;
  port?: number;
  /** URL path to serve the MCP endpoint on. Default `/mcp`. */
  path?: string;
  /** Bind address. Default `127.0.0.1` (localhost only). */
  host?: string;
  userMatcher?: UserMatcher;
  /** Hook called when an incoming request matches no recorded pair. */
  onMismatch?: (request: JsonRpcRequest) => void;
}

export interface HttpReplayHandle {
  /** The actual port the server is listening on (useful when port=0). */
  port: number;
  /** Stop the server and release the port. */
  close: () => Promise<void>;
}

const DEFAULT_PATH = "/mcp";

/**
 * Start an HTTP server that replays a recorded transcript. Single
 * JSON-RPC request → single JSON response. Streaming/SSE responses
 * are not in v0.4 — they ship in v0.4.1.
 *
 * The server is bound to localhost by default. Pass `host` to bind
 * elsewhere.
 */
export async function replayHttp(
  opts: HttpReplayOptions,
): Promise<HttpReplayHandle> {
  const frames = await loadTranscript(opts.file);
  const pairs = pairFrames(frames);
  const path = opts.path ?? DEFAULT_PATH;
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 0;

  const server = createServer((req, res) => {
    handleRequest(req, res, pairs, path, opts).catch((err) => {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(`mcprec replay-http: ${(err as Error).message}\n`);
    });
  });

  const actualPort = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve(addr.port);
      } else {
        reject(new Error("mcprec replay-http: server.address() did not return an object"));
      }
    });
  });

  return {
    port: actualPort,
    close: () => closeServer(server),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pairs: ReplayPair[],
  path: string,
  opts: HttpReplayOptions,
): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("ok\n");
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("allow", "POST, GET");
    res.end();
    return;
  }
  if (req.url !== path) {
    res.statusCode = 404;
    res.end();
    return;
  }

  const body = await readBody(req);
  let parsed: JsonRpcMessage;
  try {
    parsed = JSON.parse(body) as JsonRpcMessage;
  } catch {
    writeJson(res, 400, {
      jsonrpc: "2.0",
      error: { code: -32700, message: "parse error" },
    });
    return;
  }

  if (!isRequest(parsed)) {
    writeJson(res, 400, {
      jsonrpc: "2.0",
      error: { code: -32600, message: "expected a JSON-RPC request" },
    });
    return;
  }

  const reqAsReq = parsed as JsonRpcRequest;
  const m = findMatch(parsed, pairs, { userMatcher: opts.userMatcher });
  if (m === null) {
    opts.onMismatch?.(reqAsReq);
    writeJson(res, 200, {
      jsonrpc: "2.0",
      id: reqAsReq.id,
      error: {
        code: -32603,
        message: `mcprec: no recorded response for method='${reqAsReq.method}'`,
      },
    });
    return;
  }

  const pair = pairs[m.idx];
  if (!pair) {
    writeJson(res, 500, {
      jsonrpc: "2.0",
      id: reqAsReq.id,
      error: { code: -32603, message: "internal: pair index out of range" },
    });
    return;
  }
  const resp = { ...(pair.response as object), id: reqAsReq.id };
  writeJson(res, 200, resp);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
