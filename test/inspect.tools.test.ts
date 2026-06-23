import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectTranscript } from "../src/inspect.js";
import type { Frame } from "../src/types.js";

function frameLine(f: Frame): string {
  return JSON.stringify(f);
}

describe("inspectTranscript: tools/call breakdown by tool name", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcprec-inspect-tools-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, frames: Frame[]): string {
    const path = join(dir, name);
    writeFileSync(path, frames.map(frameLine).join("\n") + "\n", "utf8");
    return path;
  }

  it("shows tool name in brackets when tools/call has params.name", async () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search_issues", arguments: { q: "bug" } },
        },
      },
      { t: 0.1, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: {} } },
    ];
    const out = await inspectTranscript(write("one-tool.jsonl", frames));
    expect(out).toContain("tools/call[search_issues]: 1");
  });

  it("aggregates multiple calls to the same tool", async () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_issues" } },
      },
      { t: 0.1, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: {} } },
      {
        t: 0.2,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_issues" } },
      },
      { t: 0.3, dir: "←", msg: { jsonrpc: "2.0", id: 2, result: {} } },
      {
        t: 0.4,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_issue" } },
      },
      { t: 0.5, dir: "←", msg: { jsonrpc: "2.0", id: 3, result: {} } },
    ];
    const out = await inspectTranscript(write("multi-tool.jsonl", frames));
    expect(out).toContain("tools/call[search_issues]: 2");
    expect(out).toContain("tools/call[create_issue]: 1");
  });

  it("orders tool entries by call count descending", async () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "rare_tool" } },
      },
      {
        t: 0.1,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "common_tool" } },
      },
      {
        t: 0.2,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "common_tool" } },
      },
      {
        t: 0.3,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "common_tool" } },
      },
    ];
    const out = await inspectTranscript(write("order.jsonl", frames));
    const commonIdx = out.indexOf("tools/call[common_tool]");
    const rareIdx = out.indexOf("tools/call[rare_tool]");
    expect(commonIdx).toBeGreaterThan(-1);
    expect(rareIdx).toBeGreaterThan(-1);
    expect(commonIdx).toBeLessThan(rareIdx);
  });

  it("falls back to 'tools/call' when params.name is absent", async () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 1, method: "tools/call" },
      },
    ];
    const out = await inspectTranscript(write("no-name.jsonl", frames));
    expect(out).toContain("tools/call: 1");
    expect(out).not.toContain("tools/call[");
  });

  it("falls back to 'tools/call' when params.name is an empty string", async () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "" },
        },
      },
    ];
    const out = await inspectTranscript(write("empty-name.jsonl", frames));
    expect(out).toContain("tools/call: 1");
    expect(out).not.toContain("tools/call[");
  });

  it("mixes named and unnamed tools/call entries independently", async () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "my_tool" } },
      },
      {
        t: 0.1,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 2, method: "tools/call" },
      },
    ];
    const out = await inspectTranscript(write("mixed.jsonl", frames));
    expect(out).toContain("tools/call[my_tool]: 1");
    expect(out).toContain("tools/call: 1");
  });

  it("does not affect counts for non-tools/call methods", async () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      },
      {
        t: 0.1,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "do_thing" } },
      },
    ];
    const out = await inspectTranscript(write("mixed-methods.jsonl", frames));
    expect(out).toContain("tools/list: 1");
    expect(out).toContain("tools/call[do_thing]: 1");
  });
});
