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

// diffTranscripts indexes each side with indexPairs, which keeps only
// the first ReplayPair that maps to a given (method, volatile-stripped-params)
// key. These tests cover that deduplication invariant and empty-transcript
// edge cases that are not exercised in diff.test.ts.

describe("diffTranscripts: empty transcripts", () => {
  it("both sides empty: all counts are zero", () => {
    const d = diffTranscripts([], []);
    expect(d.onlyInA).toEqual([]);
    expect(d.onlyInB).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(0);
  });

  it("A has pairs, B is empty: all A pairs go to onlyInA", () => {
    const pairs = [
      pair(1, "ping", {}, "pong"),
      pair(2, "list", { owner: "alice" }, []),
    ];
    const d = diffTranscripts(pairs, []);
    expect(d.onlyInA).toHaveLength(2);
    expect(d.onlyInB).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(0);
    expect(d.onlyInA.map((e) => e.method).sort()).toEqual(["list", "ping"]);
  });

  it("A is empty, B has pairs: all B pairs go to onlyInB", () => {
    const pairs = [
      pair(1, "ping", {}, "pong"),
      pair(2, "list", { owner: "alice" }, []),
    ];
    const d = diffTranscripts([], pairs);
    expect(d.onlyInB).toHaveLength(2);
    expect(d.onlyInA).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(0);
    expect(d.onlyInB.map((e) => e.method).sort()).toEqual(["list", "ping"]);
  });
});

describe("diffTranscripts: first-occurrence deduplication in A", () => {
  it("second duplicate in A is ignored when its response matches B", () => {
    // A records "search({q:'x'})" twice: first returns "v1", second "v2".
    // B records "search({q:'x'})" once returning "v2".
    // indexPairs keeps only the first A entry (response "v1").
    // "v1" != "v2" → changed, not unchanged.
    const aFirst = pair(1, "search", { q: "x" }, "v1");
    const aSecond = pair(2, "search", { q: "x" }, "v2");
    const b = [pair(1, "search", { q: "x" }, "v2")];
    const d = diffTranscripts([aFirst, aSecond], b);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]?.method).toBe("search");
    expect(d.unchanged).toBe(0);
  });

  it("second duplicate in A is ignored when first matches B", () => {
    // A records "ping" twice; first returns "pong", second "PONG".
    // B records "ping" returning "pong" (matches first).
    const aFirst = pair(1, "ping", {}, "pong");
    const aSecond = pair(2, "ping", {}, "PONG");
    const b = [pair(1, "ping", {}, "pong")];
    const d = diffTranscripts([aFirst, aSecond], b);
    expect(d.unchanged).toBe(1);
    expect(d.changed).toHaveLength(0);
  });

  it("three duplicates in A: only the first slot is compared", () => {
    const a = [
      pair(1, "fetch", { id: 7 }, "r1"),
      pair(2, "fetch", { id: 7 }, "r2"),
      pair(3, "fetch", { id: 7 }, "r3"),
    ];
    const b = [pair(1, "fetch", { id: 7 }, "r1")];
    const d = diffTranscripts(a, b);
    expect(d.unchanged).toBe(1);
    expect(d.changed).toHaveLength(0);
  });
});

describe("diffTranscripts: first-occurrence deduplication in B", () => {
  it("second duplicate in B is ignored; first occurrence compared against A", () => {
    // B records "tools/list" twice: first returns [], second returns ["x"].
    // A records "tools/list" once returning [].
    // indexPairs for B keeps the first entry (response []).
    // [] == [] → unchanged.
    const a = [pair(1, "tools/list", {}, [])];
    const bFirst = pair(1, "tools/list", {}, []);
    const bSecond = pair(2, "tools/list", {}, ["x"]);
    const d = diffTranscripts(a, [bFirst, bSecond]);
    expect(d.unchanged).toBe(1);
    expect(d.changed).toHaveLength(0);
  });
});

describe("diffTranscripts: deduplication interacts with volatile key stripping", () => {
  it("same non-volatile params with different timestamps collide to one slot", () => {
    // A has two calls: both are "list({q:'y'})" but with different timestamps.
    // requestKey strips volatile keys, so both map to the same slot.
    // Only the first (result "first") is retained.
    // B has one call with a third timestamp and result "first".
    const aFirst = pair(1, "list", { q: "y", timestamp: 100 }, "first");
    const aSecond = pair(2, "list", { q: "y", timestamp: 200 }, "second");
    const b = [pair(1, "list", { q: "y", timestamp: 999 }, "first")];
    const d = diffTranscripts([aFirst, aSecond], b);
    expect(d.unchanged).toBe(1);
    expect(d.changed).toHaveLength(0);
  });

  it("same non-volatile params with different requestIds collide to one slot", () => {
    const aFirst = pair(1, "get", { id: 5, requestId: "req-a" }, "alpha");
    const aSecond = pair(2, "get", { id: 5, requestId: "req-b" }, "beta");
    const b = [pair(1, "get", { id: 5, requestId: "req-c" }, "alpha")];
    const d = diffTranscripts([aFirst, aSecond], b);
    expect(d.unchanged).toBe(1);
    expect(d.changed).toHaveLength(0);
  });
});
