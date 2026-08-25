import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectTranscript } from "../src/inspect.js";
import type { Frame } from "../src/types.js";

function frameLine(f: Frame): string {
  return JSON.stringify(f);
}

describe("inspectTranscript --filter", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcprec-filter-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, frames: Frame[]): string {
    const file = join(dir, name);
    writeFileSync(file, frames.map(frameLine).join("\n") + "\n", "utf8");
    return file;
  }

  const mixedFrames: Frame[] = [
    { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "tools/list" } },
    { t: 0.1, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: { tools: [] } } },
    { t: 0.2, dir: "→", msg: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_issues", arguments: { q: "is:open" } } } },
    { t: 0.9, dir: "←", msg: { jsonrpc: "2.0", id: 2, result: { content: [] } } },
    { t: 1.0, dir: "→", msg: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_file", arguments: { path: "README.md" } } } },
    { t: 1.2, dir: "←", msg: { jsonrpc: "2.0", id: 3, result: { content: "..." } } },
    { t: 1.3, dir: "→", msg: { jsonrpc: "2.0", id: 4, method: "ping" } },
    { t: 1.4, dir: "←", msg: { jsonrpc: "2.0", id: 4, result: {} } },
  ];

  it("shows only matching request frames and their responses when filter is set", async () => {
    const file = write("mixed.jsonl", mixedFrames);
    const out = await inspectTranscript(file, { filter: "tools/list" });

    // Should contain tools/list.
    expect(out).toContain("tools/list");
    // Should not show tools/call or ping frames in the timeline.
    const frameLines = out.split("\n").filter((l) => /^\s*\d+\.\d{3}s/.test(l));
    expect(frameLines.every((l) => !l.includes("tools/call") && !l.includes("ping"))).toBe(true);
    // Should have exactly 2 frame lines: the request and its response.
    expect(frameLines).toHaveLength(2);
  });

  it("matches tools/call frames by tool name substring", async () => {
    const file = write("mixed2.jsonl", mixedFrames);
    const out = await inspectTranscript(file, { filter: "tools/call[search_issues]" });

    const frameLines = out.split("\n").filter((l) => /^\s*\d+\.\d{3}s/.test(l));
    // 1 request + 1 response.
    expect(frameLines).toHaveLength(2);
    expect(out).toContain("tools/call");
    // The get_file call should not appear in the timeline frame lines.
    expect(frameLines.every((l) => !l.includes("get_file"))).toBe(true);
  });

  it("matches all tools/call frames when filtering by the base method name", async () => {
    const file = write("mixed3.jsonl", mixedFrames);
    const out = await inspectTranscript(file, { filter: "tools/call" });

    const frameLines = out.split("\n").filter((l) => /^\s*\d+\.\d{3}s/.test(l));
    // 2 calls, each with a response: 4 frame lines.
    expect(frameLines).toHaveLength(4);
    // ping and tools/list should not appear in timeline frame lines.
    expect(frameLines.every((l) => !l.includes("ping") && !l.includes("tools/list"))).toBe(true);
  });

  it("shows no frame lines when filter matches nothing", async () => {
    const file = write("nope.jsonl", mixedFrames);
    const out = await inspectTranscript(file, { filter: "nonexistent_method" });

    const frameLines = out.split("\n").filter((l) => /^\s*\d+\.\d{3}s/.test(l));
    expect(frameLines).toHaveLength(0);
    // Summary footer still reflects the full transcript.
    expect(out).toContain("8 frames");
  });

  it("still shows full transcript stats in the footer when filter is active", async () => {
    const file = write("stats.jsonl", mixedFrames);
    const out = await inspectTranscript(file, { filter: "ping" });

    // All 8 frames and 4 pairs reported in the footer.
    expect(out).toContain("8 frames");
    expect(out).toContain("4 request/response pairs");
    // Full method list still present.
    expect(out).toContain("tools/list: 1");
    expect(out).toContain("ping: 1");
  });

  it("includes a filter note in the footer when filter is active", async () => {
    const file = write("note.jsonl", mixedFrames);
    const out = await inspectTranscript(file, { filter: "ping" });

    expect(out).toContain("filter: ping");
  });

  it("shows all frames when no filter is supplied (backward-compatible)", async () => {
    const file = write("all.jsonl", mixedFrames);
    const out = await inspectTranscript(file);

    const frameLines = out.split("\n").filter((l) => /^\s*\d+\.\d{3}s/.test(l));
    expect(frameLines).toHaveLength(8);
    // No filter note in the footer.
    expect(out).not.toContain("filter:");
  });

  it("shows all frames when filter is an empty string", async () => {
    const file = write("empty-filter.jsonl", mixedFrames);
    const out = await inspectTranscript(file, { filter: "" });

    // An empty string is falsy: the filter is treated as absent.
    const frameLines = out.split("\n").filter((l) => /^\s*\d+\.\d{3}s/.test(l));
    expect(frameLines).toHaveLength(8);
    expect(out).not.toContain("filter:");
  });
});
