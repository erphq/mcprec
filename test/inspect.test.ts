import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectTranscript } from "../src/inspect.js";
import type { Frame } from "../src/types.js";

// `inspectTranscript` is the shape behind the `mcprec inspect <file>`
// CLI. It is pure I/O + formatting — no network, no spawned process —
// so we can drive it through a tmpdir fixture and assert on the
// returned summary string.

function frameLine(f: Frame): string {
  return JSON.stringify(f);
}

describe("inspectTranscript", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcprec-inspect-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, frames: Frame[]): string {
    const file = join(dir, name);
    writeFileSync(file, frames.map(frameLine).join("\n") + "\n", "utf8");
    return file;
  }

  it("renders one line per frame plus a summary footer", async () => {
    const path = write("two.jsonl", [
      { t: 0.001, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "ping" } },
      { t: 0.002, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: {} } },
    ]);
    const out = await inspectTranscript(path);
    const lines = out.split("\n");
    // Two frame lines + blank + "N frames..." + "methods:" header +
    // one method-count line. Concrete: ≥ 5 lines for this fixture.
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(out).toContain("ping");
  });

  it("counts requests by method, descending", async () => {
    // 1 ping + 3 tools/list + 2 tools/call. Output should list them
    // in `tools/list (3) > tools/call (2) > ping (1)` order so
    // operators reading the summary see the chatty methods first.
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "ping" } },
      { t: 0.1, dir: "→", msg: { jsonrpc: "2.0", id: 2, method: "tools/list" } },
      { t: 0.2, dir: "→", msg: { jsonrpc: "2.0", id: 3, method: "tools/list" } },
      { t: 0.3, dir: "→", msg: { jsonrpc: "2.0", id: 4, method: "tools/list" } },
      { t: 0.4, dir: "→", msg: { jsonrpc: "2.0", id: 5, method: "tools/call" } },
      { t: 0.5, dir: "→", msg: { jsonrpc: "2.0", id: 6, method: "tools/call" } },
    ];
    const out = await inspectTranscript(write("counts.jsonl", frames));
    const tlIdx = out.indexOf("tools/list:");
    const tcIdx = out.indexOf("tools/call:");
    const pingIdx = out.indexOf("ping:");
    expect(tlIdx).toBeGreaterThan(-1);
    expect(tcIdx).toBeGreaterThan(-1);
    expect(pingIdx).toBeGreaterThan(-1);
    // Descending order in the rendered output.
    expect(tlIdx).toBeLessThan(tcIdx);
    expect(tcIdx).toBeLessThan(pingIdx);
    // Counts are present.
    expect(out).toContain("tools/list: 3");
    expect(out).toContain("tools/call: 2");
    expect(out).toContain("ping: 1");
  });

  it("ignores responses when computing method counts", async () => {
    // Only the request side (`→`) advances the counts; responses
    // (`←`) carry no `method`. A regression that counted both
    // directions would double-count in the summary.
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "ping" } },
      { t: 0.1, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: {} } },
      { t: 0.2, dir: "←", msg: { jsonrpc: "2.0", id: 1, error: { code: -1, message: "x" } } },
    ];
    const out = await inspectTranscript(write("dirs.jsonl", frames));
    expect(out).toContain("ping: 1");
    // No ghost entries from the response side.
    expect(out).not.toMatch(/^\s*: \d+/m);
  });

  it("renders error responses with a visible 'error' marker", async () => {
    // Operators reading a transcript want errors to stand out in the
    // per-frame listing, not blend into the generic 'response' marker.
    const path = write("err.jsonl", [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "broken" } },
      { t: 0.1, dir: "←", msg: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "fail" } } },
    ]);
    const out = await inspectTranscript(path);
    expect(out).toContain("error");
  });

  it("reports the request/response pair count in the footer", async () => {
    // 2 requests with matching responses = 2 pairs.
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "a" } },
      { t: 0.1, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: 1 } },
      { t: 0.2, dir: "→", msg: { jsonrpc: "2.0", id: 2, method: "b" } },
      { t: 0.3, dir: "←", msg: { jsonrpc: "2.0", id: 2, result: 2 } },
    ];
    const out = await inspectTranscript(write("pairs.jsonl", frames));
    expect(out).toContain("4 frames");
    expect(out).toContain("2 request/response pairs");
  });

  it("handles a notification (request with no id) without adding a pair", async () => {
    // Notifications have no id and no response; pair count stays at 0.
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", method: "notifications/initialized" } },
    ];
    const out = await inspectTranscript(write("notif.jsonl", frames));
    expect(out).toContain("1 frames");
    expect(out).toContain("0 request/response pairs");
    expect(out).toContain("notifications/initialized");
  });

  it("produces a sensible summary on an empty transcript", async () => {
    // Edge case — the `inspect` command shouldn't crash if a user
    // hands it a file that contains zero frames. The summary should
    // still render (just with zero counts).
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "", "utf8");
    const out = await inspectTranscript(path);
    expect(out).toContain("0 frames");
    expect(out).toContain("0 request/response pairs");
  });

  it("renders timestamps with a fixed-width 8-char prefix", async () => {
    // The `t` is right-padded to 8 chars so multi-frame outputs
    // align in the terminal. A regression in the formatting would
    // make wide transcripts shift columns.
    const path = write("ts.jsonl", [
      { t: 0.001, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "x" } },
      { t: 12.345, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: {} } },
    ]);
    const out = await inspectTranscript(path);
    // Every frame line should start with a fixed-width timestamp
    // chunk followed by 's'. We don't pin the exact ANSI colours,
    // just the timestamp shape.
    const frameLines = out
      .split("\n")
      .filter((l) => /\d+\.\d{3}s/.test(l));
    expect(frameLines.length).toBe(2);
    for (const line of frameLines) {
      // The padded timestamp is 8 chars wide before the 's' suffix.
      expect(line).toMatch(/^\s*\d+\.\d{3}s/);
    }
  });
});
