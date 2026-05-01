import { describe, it, expect } from "vitest";
import { pairFrames, loadTranscript } from "../src/replay.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Frame } from "../src/types.js";

describe("pairFrames", () => {
  it("pairs request with response by id", () => {
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "init" } },
      { t: 0.1, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: {} } },
      {
        t: 0.2,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 2, method: "list", params: {} },
      },
      {
        t: 0.3,
        dir: "←",
        msg: { jsonrpc: "2.0", id: 2, result: { items: [] } },
      },
    ];
    const pairs = pairFrames(frames);
    expect(pairs.length).toBe(2);
    expect((pairs[0]?.request as { method: string }).method).toBe("init");
    expect((pairs[1]?.request as { method: string }).method).toBe("list");
  });

  it("ignores notifications", () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: { jsonrpc: "2.0", method: "notify" } as never,
      },
      { t: 0.001, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "ping" } },
      { t: 0.002, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: "pong" } },
    ];
    expect(pairFrames(frames).length).toBe(1);
  });

  it("tolerates out-of-order responses", () => {
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "a" } },
      { t: 0.1, dir: "→", msg: { jsonrpc: "2.0", id: 2, method: "b" } },
      { t: 0.2, dir: "←", msg: { jsonrpc: "2.0", id: 2, result: "B" } },
      { t: 0.3, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: "A" } },
    ];
    const pairs = pairFrames(frames);
    expect(pairs.length).toBe(2);
    expect((pairs[0]?.response as { result: string }).result).toBe("A");
    expect((pairs[1]?.response as { result: string }).result).toBe("B");
  });
});

describe("loadTranscript", () => {
  it("parses JSONL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcprec-"));
    const file = join(dir, "fixture.jsonl");
    const lines = [
      JSON.stringify({
        t: 0,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 1, method: "ping" },
      }),
      JSON.stringify({
        t: 0.1,
        dir: "←",
        msg: { jsonrpc: "2.0", id: 1, result: "pong" },
      }),
      "",
      JSON.stringify({
        t: 0.2,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 2, method: "bye" },
      }),
    ];
    writeFileSync(file, lines.join("\n"));
    const frames = await loadTranscript(file);
    expect(frames.length).toBe(3);
    expect(frames[0]?.msg).toMatchObject({ method: "ping" });
  });
});
