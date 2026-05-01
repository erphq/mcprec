/**
 * Record-mode HTTP/SSE proxy.
 *
 * Stands up an HTTP server that forwards POST requests to a real
 * MCP server, transparently capturing every JSON-RPC frame in both
 * directions to a JSONL transcript. Supports both:
 *   - `application/json` (single request → single response): one →
 *     frame and one ← frame.
 *   - `text/event-stream`: forwards each SSE event to the client and
 *     writes each one as its own ← frame.
 *
 * The transcript produced here is byte-compatible with the one
 * produced by `mcprec record` (stdio mode), so the same `replay-http`
 * / `replay` / `inspect` / `diff` commands consume it without changes.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createWriteStream, type WriteStream } from "node:fs";
import { redactDeep } from "./redact.js";
import type { Frame, JsonRpcMessage } from "./types.js";

export interface RecordHttpOptions {
  /** Output transcript path. Overwritten on each run. */
  out: string;
  /** Target MCP HTTP endpoint. Requests are forwarded here. */
  target: string;
  port?: number;
  host?: string;
  /** URL path to listen on. Default `/mcp`. */
  path?: string;
  /** Optional fetch impl for tests. Defaults to global. */
  fetch?: typeof globalThis.fetch;
  /** Wildcard key patterns (`Authorization`, `*_token`, …) to redact in captured frames. */
  redact?: string[];
}

export interface RecordHttpHandle {
  port: number;
  /** Returns the count of frames captured so far. */
  framesCaptured: () => number;
  /** Stop the server and flush the transcript. */
  close: () => Promise<void>;
}

const DEFAULT_PATH = "/mcp";
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "keep-alive",
]);

export async function recordHttp(
  opts: RecordHttpOptions,
): Promise<RecordHttpHandle> {
  const file = createWriteStream(opts.out, { flags: "w", encoding: "utf8" });
  const start = Date.now();
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const path = opts.path ?? DEFAULT_PATH;
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 0;
  const redact = opts.redact ?? [];
  let captured = 0;

  const append = (dir: "→" | "←", msg: JsonRpcMessage): Promise<void> => {
    const safe =
      redact.length > 0 ? (redactDeep(msg, redact) as JsonRpcMessage) : msg;
    const frame: Frame = { t: (Date.now() - start) / 1000, dir, msg: safe };
    captured += 1;
    return new Promise<void>((resolve, reject) => {
      file.write(JSON.stringify(frame) + "\n", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  const server = createServer((req, res) => {
    handle(req, res, opts, fetchFn, path, append).catch((err) => {
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(`mcprec record-http: ${(err as Error).message}\n`);
    });
  });

  const actualPort = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("server.address() did not return an object"));
    });
  });

  return {
    port: actualPort,
    framesCaptured: () => captured,
    close: () => closeAll(server, file),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: RecordHttpOptions,
  fetchFn: typeof globalThis.fetch,
  path: string,
  append: (dir: "→" | "←", msg: JsonRpcMessage) => Promise<void>,
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
  try {
    const parsed = JSON.parse(body) as JsonRpcMessage;
    await append("→", parsed);
  } catch {
    // Forward anyway - let the target return its own parse error.
  }

  const targetRes = await fetchFn(opts.target, {
    method: "POST",
    headers: forwardHeaders(req.headers),
    body,
  });

  const ct = targetRes.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    await proxySse(res, targetRes, append);
  } else {
    await proxyJson(res, targetRes, append);
  }
}

async function proxyJson(
  res: ServerResponse,
  targetRes: Response,
  append: (dir: "→" | "←", msg: JsonRpcMessage) => Promise<void>,
): Promise<void> {
  const text = await targetRes.text();
  try {
    const msg = JSON.parse(text) as JsonRpcMessage;
    await append("←", msg);
  } catch {
    // Not JSON - passed through, not captured.
  }
  res.statusCode = targetRes.status;
  for (const [k, v] of targetRes.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) res.setHeader(k, v);
  }
  res.end(text);
}

async function proxySse(
  res: ServerResponse,
  targetRes: Response,
  append: (dir: "→" | "←", msg: JsonRpcMessage) => Promise<void>,
): Promise<void> {
  res.statusCode = targetRes.status;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");

  if (!targetRes.body) {
    res.end();
    return;
  }
  const reader = targetRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    res.write(chunk);
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = block
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice("data: ".length));
      if (dataLines.length === 0) continue;
      const text = dataLines.join("\n");
      try {
        await append("←", JSON.parse(text) as JsonRpcMessage);
      } catch {
        // Non-JSON SSE event - forwarded but not captured.
      }
    }
  }
  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function forwardHeaders(
  inbound: IncomingMessage["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inbound)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    if (Array.isArray(v)) out[k] = v.join(", ");
    else if (typeof v === "string") out[k] = v;
  }
  return out;
}

function closeAll(server: Server, file: WriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      file.end(() => resolve());
    });
  });
}
