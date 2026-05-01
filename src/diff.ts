import pc from "picocolors";
import { methodOf, requestKey, responseKey } from "./match.js";
import { loadTranscript, pairFrames } from "./replay.js";
import type { JsonRpcMessage, ReplayPair } from "./types.js";

export interface DiffEntry {
  method: string;
  /** Stringified canonical params for this entry. */
  paramsCanonical: string;
}

export interface ChangedEntry extends DiffEntry {
  before: JsonRpcMessage;
  after: JsonRpcMessage;
}

export interface TranscriptDiff {
  onlyInA: DiffEntry[];
  onlyInB: DiffEntry[];
  changed: ChangedEntry[];
  unchanged: number;
}

interface IndexedPair {
  pair: ReplayPair;
  paramsCanonical: string;
}

function indexPairs(pairs: ReplayPair[]): Map<string, IndexedPair> {
  const map = new Map<string, IndexedPair>();
  for (const pair of pairs) {
    const key = requestKey(pair.request);
    // Strip "method::" prefix so we have just the params canonical for output.
    const sep = key.indexOf("::");
    const paramsCanonical = sep >= 0 ? key.slice(sep + 2) : key;
    if (!map.has(key)) {
      map.set(key, { pair, paramsCanonical });
    }
  }
  return map;
}

/**
 * Compute a structural diff between two transcripts: which
 * (method, params) pairs only one side has, and which pairs both sides
 * have but with diverging responses (contract drift).
 */
export function diffTranscripts(
  aPairs: ReplayPair[],
  bPairs: ReplayPair[],
): TranscriptDiff {
  const aIndex = indexPairs(aPairs);
  const bIndex = indexPairs(bPairs);

  const onlyInA: DiffEntry[] = [];
  const onlyInB: DiffEntry[] = [];
  const changed: ChangedEntry[] = [];
  let unchanged = 0;

  for (const [key, a] of aIndex) {
    const b = bIndex.get(key);
    if (!b) {
      onlyInA.push({
        method: methodOf(a.pair.request) ?? "<no-method>",
        paramsCanonical: a.paramsCanonical,
      });
      continue;
    }
    if (responseKey(a.pair.response) === responseKey(b.pair.response)) {
      unchanged += 1;
    } else {
      changed.push({
        method: methodOf(a.pair.request) ?? "<no-method>",
        paramsCanonical: a.paramsCanonical,
        before: a.pair.response,
        after: b.pair.response,
      });
    }
  }
  for (const [key, b] of bIndex) {
    if (!aIndex.has(key)) {
      onlyInB.push({
        method: methodOf(b.pair.request) ?? "<no-method>",
        paramsCanonical: b.paramsCanonical,
      });
    }
  }

  return { onlyInA, onlyInB, changed, unchanged };
}

export async function diffTranscriptFiles(
  aPath: string,
  bPath: string,
): Promise<TranscriptDiff> {
  const [aFrames, bFrames] = await Promise.all([
    loadTranscript(aPath),
    loadTranscript(bPath),
  ]);
  return diffTranscripts(pairFrames(aFrames), pairFrames(bFrames));
}

export function formatDiff(diff: TranscriptDiff, aLabel = "A", bLabel = "B"): string {
  const lines: string[] = [];
  if (
    diff.onlyInA.length === 0 &&
    diff.onlyInB.length === 0 &&
    diff.changed.length === 0
  ) {
    return pc.green(`✓ identical (${diff.unchanged} pair${diff.unchanged === 1 ? "" : "s"})`);
  }

  if (diff.onlyInA.length > 0) {
    lines.push(pc.bold(pc.red(`Only in ${aLabel} (${diff.onlyInA.length}):`)));
    for (const e of diff.onlyInA) {
      lines.push(`  - ${pc.bold(e.method)} ${pc.dim(truncate(e.paramsCanonical, 80))}`);
    }
    lines.push("");
  }
  if (diff.onlyInB.length > 0) {
    lines.push(pc.bold(pc.green(`Only in ${bLabel} (${diff.onlyInB.length}):`)));
    for (const e of diff.onlyInB) {
      lines.push(`  + ${pc.bold(e.method)} ${pc.dim(truncate(e.paramsCanonical, 80))}`);
    }
    lines.push("");
  }
  if (diff.changed.length > 0) {
    lines.push(pc.bold(pc.yellow(`Changed responses (${diff.changed.length}):`)));
    for (const c of diff.changed) {
      lines.push(`  ~ ${pc.bold(c.method)} ${pc.dim(truncate(c.paramsCanonical, 80))}`);
      lines.push(pc.red(`      - ${truncate(JSON.stringify(c.before), 200)}`));
      lines.push(pc.green(`      + ${truncate(JSON.stringify(c.after), 200)}`));
    }
    lines.push("");
  }
  lines.push(
    pc.dim(
      `${diff.changed.length} changed, ${diff.onlyInA.length} only in ${aLabel}, ${diff.onlyInB.length} only in ${bLabel}, ${diff.unchanged} unchanged`,
    ),
  );
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
