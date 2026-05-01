import pc from "picocolors";
import { loadTranscript, pairFrames } from "./replay.js";
import type { Frame, JsonRpcRequest } from "./types.js";

export async function inspectTranscript(file: string): Promise<string> {
  const frames = await loadTranscript(file);
  const lines: string[] = [];
  for (const f of frames) {
    lines.push(formatFrame(f));
  }
  const pairs = pairFrames(frames);
  const methodCounts = countMethods(frames);
  lines.push("");
  lines.push(
    pc.dim(`${frames.length} frames · ${pairs.length} request/response pairs`),
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
    const m = (f.msg as { method?: string }).method;
    if (!m) continue;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
