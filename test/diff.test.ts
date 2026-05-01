import { describe, it, expect } from "vitest";
import { diffTranscripts } from "../src/diff.js";
import type { JsonRpcMessage, ReplayPair } from "../src/types.js";

const req = (id: number, method: string, params?: unknown): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

const ok = (id: number, result: unknown): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id,
  result,
});

const pair = (
  id: number,
  method: string,
  params: unknown,
  result: unknown,
): ReplayPair => ({
  request: req(id, method, params),
  response: ok(id, result),
});

describe("diffTranscripts", () => {
  it("identical transcripts → empty diff", () => {
    const pairs: ReplayPair[] = [
      pair(1, "ping", {}, "pong"),
      pair(2, "list", { x: 1 }, ["a", "b"]),
    ];
    const diff = diffTranscripts(pairs, pairs);
    expect(diff.onlyInA).toEqual([]);
    expect(diff.onlyInB).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toBe(2);
  });

  it("methods only in A", () => {
    const a = [pair(1, "ping", {}, "pong"), pair(2, "extra", {}, 1)];
    const b = [pair(1, "ping", {}, "pong")];
    const diff = diffTranscripts(a, b);
    expect(diff.onlyInA.map((e) => e.method)).toEqual(["extra"]);
    expect(diff.onlyInB).toEqual([]);
    expect(diff.unchanged).toBe(1);
  });

  it("methods only in B", () => {
    const a = [pair(1, "ping", {}, "pong")];
    const b = [pair(1, "ping", {}, "pong"), pair(2, "fresh", {}, 1)];
    const diff = diffTranscripts(a, b);
    expect(diff.onlyInB.map((e) => e.method)).toEqual(["fresh"]);
    expect(diff.unchanged).toBe(1);
  });

  it("detects response drift on identical (method, params)", () => {
    const a = [pair(1, "tools/call", { name: "search" }, { content: "old" })];
    const b = [pair(1, "tools/call", { name: "search" }, { content: "new" })];
    const diff = diffTranscripts(a, b);
    expect(diff.changed.length).toBe(1);
    expect(diff.changed[0]?.method).toBe("tools/call");
    expect(diff.unchanged).toBe(0);
  });

  it("ignores volatile keys (timestamp etc.) when keying pairs", () => {
    const a = [pair(1, "list", { q: "x", timestamp: 100 }, [1])];
    const b = [pair(1, "list", { q: "x", timestamp: 999 }, [1])];
    const diff = diffTranscripts(a, b);
    expect(diff.unchanged).toBe(1);
    expect(diff.changed).toEqual([]);
  });

  it("error responses are compared like result responses", () => {
    const errA: ReplayPair = {
      request: req(1, "x", {}),
      response: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "bad" },
      },
    };
    const errB: ReplayPair = {
      request: req(1, "x", {}),
      response: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "bad" },
      },
    };
    expect(diffTranscripts([errA], [errB]).unchanged).toBe(1);

    const errC: ReplayPair = {
      request: req(1, "x", {}),
      response: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "different" },
      },
    };
    expect(diffTranscripts([errA], [errC]).changed.length).toBe(1);
  });

  it("multiple changes accumulate", () => {
    const a = [
      pair(1, "a", {}, 1),
      pair(2, "b", {}, 2),
      pair(3, "c", {}, 3),
    ];
    const b = [
      pair(1, "a", {}, 1),
      pair(2, "b", {}, 99),
      pair(3, "c", {}, 99),
      pair(4, "d", {}, 4),
    ];
    const diff = diffTranscripts(a, b);
    expect(diff.changed.length).toBe(2);
    expect(diff.onlyInB.map((e) => e.method)).toEqual(["d"]);
    expect(diff.unchanged).toBe(1);
  });
});
