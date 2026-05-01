import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { lineFrames } from "./transport.js";
import { redactDeep } from "./redact.js";
import type { Frame, JsonRpcMessage } from "./types.js";

export interface RecordOptions {
  command: string[];
  out: string;
  redact?: string[];
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn `command`, pipe stdio to/from this process, and append every
 * JSON-RPC frame in both directions to `out` as JSONL.
 *
 * Resolves when the child exits.
 */
export async function record(opts: RecordOptions): Promise<void> {
  const [cmd, ...args] = opts.command;
  if (!cmd) throw new Error("mcprec: command is empty");

  const file = createWriteStream(opts.out, { flags: "w", encoding: "utf8" });
  const start = Date.now();
  const redact = opts.redact ?? [];

  const append = (frame: Frame): void => {
    file.write(JSON.stringify(frame) + "\n");
  };

  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "inherit"],
    env: opts.env ?? process.env,
  });

  // stdin (from agent) → child stdin, capture as → frames
  const fromAgent = (async () => {
    for await (const line of lineFrames(process.stdin)) {
      passthroughIn(line, child.stdin, append, start, redact);
    }
    child.stdin.end();
  })();

  // child stdout → process.stdout (to agent), capture as ← frames
  const toAgent = (async () => {
    for await (const line of lineFrames(child.stdout)) {
      passthroughOut(line, append, start, redact);
    }
  })();

  return new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", () => {
      Promise.allSettled([fromAgent, toAgent]).then(() => {
        file.end(() => resolve());
      });
    });
  });
}

function passthroughIn(
  line: string,
  childStdin: NodeJS.WritableStream,
  append: (f: Frame) => void,
  start: number,
  redact: string[],
): void {
  childStdin.write(line + "\n");
  try {
    const msg = JSON.parse(line) as JsonRpcMessage;
    const safe = redact.length > 0 ? (redactDeep(msg, redact) as JsonRpcMessage) : msg;
    append({ t: (Date.now() - start) / 1000, dir: "→", msg: safe });
  } catch {
    // not JSON - passed through, not recorded
  }
}

function passthroughOut(
  line: string,
  append: (f: Frame) => void,
  start: number,
  redact: string[],
): void {
  process.stdout.write(line + "\n");
  try {
    const msg = JSON.parse(line) as JsonRpcMessage;
    const safe = redact.length > 0 ? (redactDeep(msg, redact) as JsonRpcMessage) : msg;
    append({ t: (Date.now() - start) / 1000, dir: "←", msg: safe });
  } catch {
    // not JSON - passed through, not recorded
  }
}
