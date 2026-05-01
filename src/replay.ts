import { readFile } from "node:fs/promises";
import { lineFrames } from "./transport.js";
import { findMatch, isRequest } from "./match.js";
import type {
  Frame,
  JsonRpcMessage,
  JsonRpcRequest,
  ReplayPair,
  StreamedReplayPair,
  UserMatcher,
} from "./types.js";

export async function loadTranscript(file: string): Promise<Frame[]> {
  const raw = await readFile(file, "utf8");
  const out: Frame[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as Frame);
  }
  return out;
}

/**
 * Pair every recorded → request with the next ← response that shares
 * its id. Notifications (no id) are skipped. Out-of-order responses
 * are tolerated.
 */
export function pairFrames(frames: Frame[]): ReplayPair[] {
  const pairs: ReplayPair[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f || f.dir !== "→" || !isRequest(f.msg)) continue;
    const id = (f.msg as JsonRpcRequest).id;
    for (let j = i + 1; j < frames.length; j++) {
      const g = frames[j];
      if (!g || g.dir !== "←") continue;
      const gid = (g.msg as { id?: unknown }).id;
      if (gid === id) {
        pairs.push({ request: f.msg, response: g.msg });
        break;
      }
    }
  }
  return pairs;
}

/**
 * Pair every recorded → request with EVERY ← frame between it and
 * the next → request, scoped to messages whose id matches the request
 * (and notifications, which have no id). Used by the HTTP transport
 * to recover SSE streams from the transcript.
 *
 * For non-streaming requests, the resulting `responses` has length 1
 * and behaves identically to `pairFrames`.
 */
export function pairFramesStreamed(frames: Frame[]): StreamedReplayPair[] {
  const pairs: StreamedReplayPair[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f || f.dir !== "→" || !isRequest(f.msg)) continue;
    const id = (f.msg as JsonRpcRequest).id;
    const responses: JsonRpcMessage[] = [];
    for (let j = i + 1; j < frames.length; j++) {
      const g = frames[j];
      if (!g) continue;
      if (g.dir === "→") break;
      if (g.dir !== "←") continue;
      const gid = (g.msg as { id?: unknown }).id;
      // Include direct responses (id matches) AND server-pushed
      // notifications interleaved in the same SSE stream (no id).
      if (gid === id || gid === undefined) {
        responses.push(g.msg);
      }
    }
    if (responses.length > 0) {
      pairs.push({ request: f.msg, responses });
    }
  }
  return pairs;
}

export interface ReplayOptions {
  file: string;
  onMismatch?: (request: JsonRpcRequest) => void;
  /**
   * User-supplied matcher. Consulted before the built-in tiers; if it
   * returns true for any pair, that pair wins (with strategy "user").
   * Useful for protocol-specific equivalence rules the built-in tiers
   * don't know about.
   */
  userMatcher?: UserMatcher;
}

/**
 * Read JSON-RPC requests from stdin, match each against the recorded
 * transcript, and write the recorded response (with the incoming id)
 * to stdout. Mismatches emit a JSON-RPC error response and an stderr
 * note.
 */
export async function replay(opts: ReplayOptions): Promise<void> {
  const frames = await loadTranscript(opts.file);
  const pairs = pairFrames(frames);

  for await (const line of lineFrames(process.stdin)) {
    let req: JsonRpcMessage;
    try {
      req = JSON.parse(line) as JsonRpcMessage;
    } catch {
      continue;
    }
    if (!isRequest(req)) continue;

    const reqAsReq = req as JsonRpcRequest;
    const m = findMatch(req, pairs, { userMatcher: opts.userMatcher });
    if (m === null) {
      opts.onMismatch?.(reqAsReq);
      const err = {
        jsonrpc: "2.0" as const,
        id: reqAsReq.id,
        error: {
          code: -32603,
          message: `mcprec: no recorded response for method='${reqAsReq.method}'`,
        },
      };
      process.stdout.write(JSON.stringify(err) + "\n");
      process.stderr.write(
        `mcprec: no match for method=${reqAsReq.method}\n`,
      );
      continue;
    }
    const pair = pairs[m.idx];
    if (!pair) continue;
    const resp = { ...(pair.response as object), id: reqAsReq.id };
    process.stdout.write(JSON.stringify(resp) + "\n");
  }
}
