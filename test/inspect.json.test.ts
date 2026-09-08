import { describe, it, expect } from "vitest";
import { transcriptStats } from "../src/inspect.js";
import type { Frame, JsonRpcMessage } from "../src/types.js";

function req(id: number, method: string, t = 0, params?: unknown): Frame {
  return {
    t,
    dir: "→",
    msg: {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    } as JsonRpcMessage,
  };
}

function res(id: number, result: unknown, t = 0.1): Frame {
  return {
    t,
    dir: "←",
    msg: { jsonrpc: "2.0", id, result } as JsonRpcMessage,
  };
}

describe("transcriptStats JSON output shape", () => {
  it("has exactly the expected top-level keys", () => {
    const stats = transcriptStats([]);
    expect(Object.keys(stats).sort()).toEqual([
      "durationSeconds",
      "frameCount",
      "methods",
      "pairCount",
    ]);
  });

  it("round-trips through JSON.parse(JSON.stringify()) without loss", () => {
    const frames = [
      req(1, "initialize", 0.0),
      res(1, { capabilities: {} }, 0.01),
      req(2, "tools/list", 0.02),
      res(2, [], 0.03),
      req(3, "tools/call", 0.04, { name: "search_issues" }),
      res(3, { content: [] }, 0.89),
    ];
    const stats = transcriptStats(frames);
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);
  });

  it("contains no undefined values (JSON.stringify would silently drop them)", () => {
    const frames = [req(1, "ping", 0), res(1, "pong", 0.1)];
    const stats = transcriptStats(frames);
    const before = JSON.stringify(stats);
    // If any value were undefined, JSON.parse would see fewer keys than stats
    const parsed = JSON.parse(before) as typeof stats;
    expect(Object.keys(parsed)).toEqual(Object.keys(stats));
  });

  it("durationSeconds is a finite number in all cases", () => {
    expect(Number.isFinite(transcriptStats([]).durationSeconds)).toBe(true);
    expect(
      Number.isFinite(
        transcriptStats([req(1, "a", 1.0), res(1, {}, 2.5)]).durationSeconds,
      ),
    ).toBe(true);
  });

  it("all method count values are positive integers", () => {
    const frames = [
      req(1, "initialize", 0),
      res(1, {}, 0.01),
      req(2, "tools/call", 0.02, { name: "search" }),
      res(2, {}, 0.03),
    ];
    const { methods } = transcriptStats(frames);
    for (const [, count] of Object.entries(methods)) {
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThan(0);
    }
  });

  it("methods object keys are ordered by count descending", () => {
    const frames = [
      req(1, "tools/call", 0.0, { name: "busy" }),
      res(1, {}, 0.1),
      req(2, "tools/call", 0.2, { name: "busy" }),
      res(2, {}, 0.3),
      req(3, "tools/call", 0.4, { name: "busy" }),
      res(3, {}, 0.5),
      req(4, "tools/call", 0.6, { name: "rare" }),
      res(4, {}, 0.7),
      req(5, "initialize", 0.8),
      res(5, {}, 0.9),
    ];
    const { methods } = transcriptStats(frames);
    const keys = Object.keys(methods);
    // "tools/call[busy]" (3) must appear before "tools/call[rare]" (1) and
    // "initialize" (1).
    expect(keys[0]).toBe("tools/call[busy]");
    expect(methods[keys[0]!]!).toBeGreaterThanOrEqual(
      methods[keys[1]!] ?? 0,
    );
  });

  it("tied-count methods all appear before methods with lower counts", () => {
    const frames = [
      req(1, "tools/list", 0.0),
      res(1, [], 0.01),
      req(2, "tools/list", 0.02),
      res(2, [], 0.03),
      req(3, "initialize", 0.04),
      res(3, {}, 0.05),
    ];
    const { methods } = transcriptStats(frames);
    const entries = Object.entries(methods) as [string, number][];
    for (let i = 0; i < entries.length - 1; i++) {
      expect(entries[i]![1]).toBeGreaterThanOrEqual(entries[i + 1]![1]);
    }
  });

  it("methods is an empty object for an empty transcript", () => {
    const { methods } = transcriptStats([]);
    expect(methods).toEqual({});
  });

  it("methods is an empty object when transcript has only response frames", () => {
    const frames = [res(1, "orphan", 0.5)];
    const { methods } = transcriptStats(frames);
    expect(methods).toEqual({});
  });
});
