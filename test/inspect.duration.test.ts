import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectTranscript } from "../src/inspect.js";
import type { Frame } from "../src/types.js";

function frameLine(f: Frame): string {
  return JSON.stringify(f);
}

describe("inspectTranscript: session duration in footer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcprec-inspect-dur-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, frames: Frame[]): string {
    const path = join(dir, name);
    writeFileSync(path, frames.map(frameLine).join("\n") + "\n", "utf8");
    return path;
  }

  it("shows the elapsed time from first to last frame in the footer", async () => {
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "initialize" } },
      { t: 1.234, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: {} } },
    ];
    const out = await inspectTranscript(write("dur.jsonl", frames));
    expect(out).toContain("1.234s");
  });

  it("shows 0.000s for an empty transcript", async () => {
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "", "utf8");
    const out = await inspectTranscript(path);
    expect(out).toContain("0.000s");
  });

  it("shows 0.000s for a single-frame transcript", async () => {
    const frames: Frame[] = [
      { t: 5.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "ping" } },
    ];
    const out = await inspectTranscript(write("single.jsonl", frames));
    expect(out).toContain("0.000s");
  });

  it("duration appears on the same footer line as frame count", async () => {
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "a" } },
      { t: 0.5, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: null } },
    ];
    const out = await inspectTranscript(write("line.jsonl", frames));
    const footerLine = out
      .split("\n")
      .find((l) => l.includes("frames") && l.includes("pairs"));
    expect(footerLine).toBeDefined();
    expect(footerLine).toContain("0.500s");
  });

  it("computes duration as last.t minus first.t, not absolute time", async () => {
    // Frames start at a large offset; the footer should show 2.500s, not 1000.x.
    const frames: Frame[] = [
      { t: 1000.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "x" } },
      { t: 1002.5, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: {} } },
    ];
    const out = await inspectTranscript(write("offset.jsonl", frames));
    expect(out).toContain("2.500s");
    const footerLine = out
      .split("\n")
      .find((l) => l.includes("frames") && l.includes("pairs"));
    expect(footerLine).toBeDefined();
    // The footer duration is relative, not the absolute timestamp of the first frame.
    expect(footerLine).not.toContain("1000.0");
  });
});
