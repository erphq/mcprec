import pc from "picocolors";
import { loadTranscript, pairFrames } from "./replay.js";
import type { Frame, JsonRpcRequest } from "./types.js";

export interface TranscriptStats {
  frameCount: number;
  pairCount: number;
  durationSeconds: number;
  methods: Record<string, number>;
}

/**
 * Return structured stats for a parsed transcript: frame and pair
 * counts, wall-clock duration, and a per-method call tally.
 *
 * tools/call frames are broken down by tool name, e.g.
 * "tools/call[search_issues]", matching the grouping used by
 * `inspectTranscript`.
 */
export function transcriptStats(frames: Frame[]): TranscriptStats {
  const pairs = pairFrames(frames);
  const first = frames[0]?.t ?? 0;
  const last = frames[frames.length - 1]?.t ?? 0;
  return {
    frameCount: frames.length,
    pairCount: pairs.length,
    durationSeconds: last - first,
    methods: Object.fromEntries(countMethods(frames)),
  };
}

export async function inspectTranscript(file: string): Promise<string> {
  const frames = await loadTranscript(file);
  const lines: string[] = [];
  for (const f of frames) {
    lines.push(formatFrame(f));
  }
  const pairs = pairFrames(frames);
  const methodCounts = countMethods(frames);
  const duration = sessionDuration(frames);
  lines.push("");
  lines.push(
    pc.dim(
      `${frames.length} frames · ${pairs.length} request/response pairs · ${duration}s`,
    ),
  );
  lines.push(pc.dim("methods:"));
  for (const [method, count] of methodCounts) {
    lines.push(pc.dim(`  ${method}: ${count}`));
  }
  return lines.join("\n");
}

function formatFrame(f: Frame): string {
  const t = f.t.toFixed(3).padStart(8);
  const dir = f.dir === "→" ? pc.cyan("→") : pc.green("←");
  const msg = f.msg as Partial<JsonRpcRequest> & { result?: unknown; error?: unknown };
  const idPart =
    msg.id !== undefined ? pc.dim(` id=${String(msg.id)}`) : "";
  if (msg.method) return `${t}s ${dir} ${pc.bold(msg.method)}${idPart}`;
  if (msg.error) return `${t}s ${dir} ${pc.red("error")}${idPart}`;
  return `${t}s ${dir} ${pc.dim("response")}${idPart}`;
}

function countMethods(frames: Frame[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const f of frames) {
    if (f.dir !== "→") continue;
    const msg = f.msg as { method?: string; params?: unknown };
    if (!msg.method) continue;
    let key = msg.method;
    if (msg.method === "tools/call") {
      const toolName = (msg.params as { name?: unknown } | undefined)?.name;
      if (typeof toolName === "string" && toolName) {
        key = `tools/call[${toolName}]`;
      }
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function sessionDuration(frames: Frame[]): string {
  if (frames.length === 0) return "0.000";
  const first = frames[0]!.t;
  const last = frames[frames.length - 1]!.t;
  return (last - first).toFixed(3);
}
