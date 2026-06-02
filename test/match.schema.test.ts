import { describe, it, expect } from "vitest";
import { findMatch, schemaLooseMatch, fuzzyMatch } from "../src/match.js";
import type { JsonRpcRequest, ReplayPair } from "../src/types.js";

const req = (id: number, method: string, params?: unknown): JsonRpcRequest => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

const pair = (
  id: number,
  method: string,
  params: unknown,
  result: unknown,
): ReplayPair => ({
  request: req(id, method, params),
  response: { jsonrpc: "2.0", id, result },
});

describe("schemaLooseMatch", () => {
  it("matches when method and param keys are identical, values differ", () => {
    const a = req(1, "tools/call", { name: "search", args: { q: "foo" } });
    const b = req(2, "tools/call", { name: "lookup", args: { q: "bar" } });
    expect(schemaLooseMatch(a, b)).toBe(true);
  });

  it("matches when only deeply nested values differ", () => {
    const a = req(1, "list_repos", { owner: "alice", per_page: 10 });
    const b = req(2, "list_repos", { owner: "bob", per_page: 50 });
    expect(schemaLooseMatch(a, b)).toBe(true);
  });

  it("differs when method differs", () => {
    const a = req(1, "ping", { x: 1 });
    const b = req(1, "pong", { x: 1 });
    expect(schemaLooseMatch(a, b)).toBe(false);
  });

  it("differs when param key sets differ", () => {
    const a = req(1, "search", { q: "foo", limit: 10 });
    const b = req(2, "search", { query: "foo", limit: 10 });
    expect(schemaLooseMatch(a, b)).toBe(false);
  });

  it("differs when one side has more keys", () => {
    const a = req(1, "search", { q: "foo" });
    const b = req(2, "search", { q: "foo", limit: 10 });
    expect(schemaLooseMatch(a, b)).toBe(false);
  });

  it("matches when both params are absent", () => {
    expect(schemaLooseMatch(req(1, "initialize"), req(2, "initialize"))).toBe(
      true,
    );
  });

  it("differs when one side has no params and the other does", () => {
    const a = req(1, "initialize");
    const b = req(2, "initialize", { protocolVersion: "2024-11-05" });
    expect(schemaLooseMatch(a, b)).toBe(false);
  });

  it("matches when both params are empty objects", () => {
    const a = req(1, "ping", {});
    const b = req(2, "ping", {});
    expect(schemaLooseMatch(a, b)).toBe(true);
  });

  it("matches when both params are arrays regardless of contents", () => {
    const a = req(1, "batch", [1, 2, 3]);
    const b = req(2, "batch", ["x", "y"]);
    expect(schemaLooseMatch(a, b)).toBe(true);
  });

  it("differs when one side is an array and the other is an object", () => {
    const a = req(1, "call", [1, 2]);
    const b = req(2, "call", { a: 1 });
    expect(schemaLooseMatch(a, b)).toBe(false);
  });

  it("is not fooled by deeper key differences", () => {
    // Top-level keys are the same; nested objects differ in key shape.
    // schemaLooseMatch only checks top-level keys, so this still matches.
    const a = req(1, "update", { config: { color: "red" } });
    const b = req(2, "update", { config: { size: 10 } });
    expect(schemaLooseMatch(a, b)).toBe(true);
  });

  it("key order does not affect the result", () => {
    const a = req(1, "search", { b: 2, a: 1 });
    const b = req(2, "search", { a: 99, b: 0 });
    expect(schemaLooseMatch(a, b)).toBe(true);
  });
});

describe("findMatch fallthrough to schema-loose", () => {
  const pairs: ReplayPair[] = [
    pair(1, "exact_target", { x: 1 }, "EXACT"),
    pair(2, "fuzzy_target", { since: "2026-04-30T14:00:00Z" }, "FUZZY"),
    pair(3, "loose_target", { owner: "alice", repo: "one" }, "LOOSE"),
  ];

  it("uses schema-loose when exact and fuzzy both fail", () => {
    const incoming = req(99, "loose_target", { owner: "bob", repo: "two" });
    expect(fuzzyMatch(incoming, pairs[2]!.request)).toBe(false);
    const m = findMatch(incoming, pairs);
    expect(m?.idx).toBe(2);
    expect(m?.strategy).toBe("schema-loose");
  });

  it("prefers exact over schema-loose", () => {
    const m = findMatch(req(99, "exact_target", { x: 1 }), pairs);
    expect(m?.strategy).toBe("exact");
    expect(m?.idx).toBe(0);
  });

  it("prefers fuzzy over schema-loose", () => {
    const m = findMatch(
      req(99, "fuzzy_target", { since: "2099-01-01T00:00:00Z" }),
      pairs,
    );
    expect(m?.strategy).toBe("fuzzy");
    expect(m?.idx).toBe(1);
  });

  it("returns null when not even schema-loose matches", () => {
    const m = findMatch(req(99, "no_such_method", { x: 1 }), pairs);
    expect(m).toBeNull();
  });

  it("returns null when method matches but key set does not", () => {
    const m = findMatch(
      req(99, "loose_target", { owner: "alice" }),
      pairs,
    );
    expect(m).toBeNull();
  });
});
