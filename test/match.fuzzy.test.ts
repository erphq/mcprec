import { describe, it, expect } from "vitest";
import {
  exactMatch,
  findMatch,
  fuzzyMatch,
  normalizedMatch,
} from "../src/match.js";
import type { JsonRpcRequest, ReplayPair } from "../src/types.js";

const req = (id: number, method: string, params?: unknown): JsonRpcRequest => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

describe("fuzzyMatch", () => {
  it("matches across ISO timestamp values inside params", () => {
    const a = req(1, "list_events", { since: "2026-04-30T14:00:00Z" });
    const b = req(2, "list_events", { since: "2026-05-15T08:30:00.000Z" });
    expect(normalizedMatch(a, b)).toBe(false);
    expect(fuzzyMatch(a, b)).toBe(true);
  });

  it("matches across UUID values", () => {
    const a = req(1, "tools/call", {
      name: "lookup",
      args: { user: "550e8400-e29b-41d4-a716-446655440000" },
    });
    const b = req(2, "tools/call", {
      name: "lookup",
      args: { user: "11111111-2222-3333-4444-555555555555" },
    });
    expect(normalizedMatch(a, b)).toBe(false);
    expect(fuzzyMatch(a, b)).toBe(true);
  });

  it("matches across differing values under id-shaped keys", () => {
    const a = req(1, "open", { id: 12345, requestId: "abc" });
    const b = req(2, "open", { id: 99999, requestId: "xyz" });
    expect(fuzzyMatch(a, b)).toBe(true);
  });

  it("still differs on real param differences", () => {
    const a = req(1, "tools/call", { name: "search", args: { q: "foo" } });
    const b = req(1, "tools/call", { name: "search", args: { q: "bar" } });
    expect(fuzzyMatch(a, b)).toBe(false);
  });

  it("differs on method", () => {
    const a = req(1, "ping", {});
    const b = req(1, "pong", {});
    expect(fuzzyMatch(a, b)).toBe(false);
  });

  it("preserves non-id non-timestamp non-uuid strings", () => {
    const a = req(1, "echo", { text: "hello" });
    const b = req(2, "echo", { text: "world" });
    expect(fuzzyMatch(a, b)).toBe(false);
  });

  it("does not confuse a near-UUID for a UUID", () => {
    const a = req(1, "echo", { val: "550e8400-not-a-uuid" });
    const b = req(2, "echo", { val: "this-is-not-uuid-shaped" });
    expect(fuzzyMatch(a, b)).toBe(false);
  });

  it("handles ISO timestamps with timezone offset", () => {
    const a = req(1, "ping", { at: "2026-04-30T14:00:00+00:00" });
    const b = req(2, "ping", { at: "2026-05-01T09:30:15-07:00" });
    expect(fuzzyMatch(a, b)).toBe(true);
  });

  it("normalizes nested arrays of timestamps", () => {
    const a = req(1, "batch", {
      events: [{ t: "2026-04-30T14:00:00Z" }, { t: "2026-04-30T14:01:00Z" }],
    });
    const b = req(2, "batch", {
      events: [{ t: "2026-05-15T00:00:00Z" }, { t: "2026-05-15T00:01:00Z" }],
    });
    expect(fuzzyMatch(a, b)).toBe(true);
  });
});

describe("findMatch fall-through (exact → normalized → fuzzy)", () => {
  const pairs: ReplayPair[] = [
    {
      request: req(1, "exact_target", { x: 1 }),
      response: { jsonrpc: "2.0", id: 1, result: "EXACT" },
    },
    {
      request: req(2, "normalized_target", { x: 1, ts: 100 }),
      response: { jsonrpc: "2.0", id: 2, result: "NORMALIZED" },
    },
    {
      request: req(3, "fuzzy_target", { since: "2026-04-30T14:00:00Z" }),
      response: { jsonrpc: "2.0", id: 3, result: "FUZZY" },
    },
  ];

  it("prefers exact match", () => {
    expect(findMatch(req(99, "exact_target", { x: 1 }), pairs)).toEqual({
      idx: 0,
      strategy: "exact",
    });
  });

  it("falls through to normalized when timestamps key differs", () => {
    expect(
      findMatch(req(99, "normalized_target", { x: 1, ts: 999 }), pairs),
    ).toEqual({ idx: 1, strategy: "normalized" });
  });

  it("falls through to fuzzy when only timestamp values differ", () => {
    expect(
      findMatch(
        req(99, "fuzzy_target", { since: "2099-01-01T00:00:00Z" }),
        pairs,
      ),
    ).toEqual({ idx: 2, strategy: "fuzzy" });
  });

  it("returns null when no tier matches", () => {
    expect(findMatch(req(1, "no_such_method"), pairs)).toBeNull();
  });
});

describe("exactMatch unaffected by fuzzy logic", () => {
  it("still requires literal equality including timestamps", () => {
    const a = { jsonrpc: "2.0" as const, id: 1, method: "x", params: { t: "2026-04-30T14:00:00Z" } };
    const b = { jsonrpc: "2.0" as const, id: 2, method: "x", params: { t: "2099-01-01T00:00:00Z" } };
    expect(exactMatch(a, b)).toBe(false);
  });
});
