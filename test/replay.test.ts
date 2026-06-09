import { describe, it, expect } from "vitest";
import { pairFrames, pairFramesStreamed, loadTranscript } from "../src/replay.js";
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

describe("pairFramesStreamed", () => {
  it("wraps a single response in a one-element responses array", () => {
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "ping" } },
      { t: 0.1, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: "pong" } },
    ];
    const pairs = pairFramesStreamed(frames);
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.responses).toHaveLength(1);
    expect((pairs[0]?.responses[0] as { result: string }).result).toBe("pong");
  });

  it("collects all response frames for a streaming request", () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "long_op" },
        },
      },
      {
        t: 0.05,
        dir: "←",
        msg: { jsonrpc: "2.0", method: "progress", params: { pct: 50 } },
      },
      {
        t: 0.10,
        dir: "←",
        msg: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "done" }] } },
      },
    ];
    const pairs = pairFramesStreamed(frames);
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.responses).toHaveLength(2);
    expect((pairs[0]?.responses[0] as { method: string }).method).toBe(
      "progress",
    );
    expect((pairs[0]?.responses[1] as { id: number }).id).toBe(1);
  });

  it("stops collecting responses at the next outbound request", () => {
    const frames: Frame[] = [
      { t: 0.0, dir: "→", msg: { jsonrpc: "2.0", id: 1, method: "a" } },
      { t: 0.1, dir: "←", msg: { jsonrpc: "2.0", id: 1, result: "A" } },
      { t: 0.2, dir: "→", msg: { jsonrpc: "2.0", id: 2, method: "b" } },
      { t: 0.3, dir: "←", msg: { jsonrpc: "2.0", id: 2, result: "B" } },
    ];
    const pairs = pairFramesStreamed(frames);
    expect(pairs.length).toBe(2);
    expect(pairs[0]?.responses).toHaveLength(1);
    expect((pairs[0]?.responses[0] as { result: string }).result).toBe("A");
    expect(pairs[1]?.responses).toHaveLength(1);
    expect((pairs[1]?.responses[0] as { result: string }).result).toBe("B");
  });

  it("excludes requests that received no responses", () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 1, method: "fire-and-forget" },
      },
      { t: 0.1, dir: "→", msg: { jsonrpc: "2.0", id: 2, method: "ping" } },
      { t: 0.2, dir: "←", msg: { jsonrpc: "2.0", id: 2, result: "pong" } },
    ];
    const pairs = pairFramesStreamed(frames);
    expect(pairs.length).toBe(1);
    expect(
      (pairs[0]?.request as { method: string }).method,
    ).toBe("ping");
  });

  it("includes server-pushed notifications (no id) in the response list", () => {
    const frames: Frame[] = [
      {
        t: 0.0,
        dir: "→",
        msg: { jsonrpc: "2.0", id: 5, method: "subscribe", params: {} },
      },
      {
        t: 0.1,
        dir: "←",
        msg: { jsonrpc: "2.0", method: "event", params: { n: 1 } },
      },
      {
        t: 0.2,
        dir: "←",
        msg: { jsonrpc: "2.0", method: "event", params: { n: 2 } },
      },
      {
        t: 0.3,
        dir: "←",
        msg: { jsonrpc: "2.0", id: 5, result: "ok" },
      },
    ];
    const pairs = pairFramesStreamed(frames);
    expect(pairs.length).toBe(1);
    expect(pairs[0]?.responses).toHaveLength(3);
    expect((pairs[0]?.responses[0] as { method: string }).method).toBe("event");
    expect((pairs[0]?.responses[1] as { method: string }).method).toBe("event");
    expect((pairs[0]?.responses[2] as { result: string }).result).toBe("ok");
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
