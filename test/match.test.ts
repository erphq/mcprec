import { describe, it, expect } from "vitest";
import { exactMatch, normalizedMatch, findMatch, isRequest } from "../src/match.js";
import type { JsonRpcRequest, ReplayPair } from "../src/types.js";

const req = (id: number, method: string, params?: unknown): JsonRpcRequest => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

describe("isRequest", () => {
  it("accepts a request", () => {
    expect(isRequest(req(1, "ping"))).toBe(true);
  });
  it("rejects a notification", () => {
    expect(
      isRequest({ jsonrpc: "2.0", method: "notify" } as never),
    ).toBe(false);
  });
  it("rejects a response", () => {
    expect(
      isRequest({ jsonrpc: "2.0", id: 1, result: {} } as never),
    ).toBe(false);
  });
});

describe("exactMatch", () => {
  it("matches identical method+params", () => {
    expect(exactMatch(req(1, "ping", {}), req(99, "ping", {}))).toBe(true);
  });
  it("ignores id", () => {
    expect(exactMatch(req(1, "ping"), req(2, "ping"))).toBe(true);
  });
  it("differs on method", () => {
    expect(exactMatch(req(1, "ping"), req(1, "pong"))).toBe(false);
  });
  it("differs on params", () => {
    expect(
      exactMatch(req(1, "tools/call", { a: 1 }), req(1, "tools/call", { a: 2 })),
    ).toBe(false);
  });
  it("normalizes key order", () => {
    expect(
      exactMatch(req(1, "x", { a: 1, b: 2 }), req(1, "x", { b: 2, a: 1 })),
    ).toBe(true);
  });
});

describe("normalizedMatch", () => {
  it("strips timestamp from params", () => {
    expect(
      normalizedMatch(
        req(1, "x", { q: "foo", timestamp: 123 }),
        req(1, "x", { q: "foo", timestamp: 456 }),
      ),
    ).toBe(true);
  });
  it("keeps non-volatile params", () => {
    expect(
      normalizedMatch(req(1, "x", { q: "foo" }), req(1, "x", { q: "bar" })),
    ).toBe(false);
  });
});

describe("findMatch", () => {
  const pairs: ReplayPair[] = [
    { request: req(1, "a"), response: { jsonrpc: "2.0", id: 1, result: "A" } },
    {
      request: req(2, "b", { x: 1 }),
      response: { jsonrpc: "2.0", id: 2, result: "B" },
    },
    {
      request: req(3, "c", { ts: 100 }),
      response: { jsonrpc: "2.0", id: 3, result: "C" },
    },
  ];

  it("finds exact first", () => {
    const m = findMatch(req(99, "b", { x: 1 }), pairs);
    expect(m?.idx).toBe(1);
    expect(m?.strategy).toBe("exact");
  });

  it("falls back to normalized when ts differs", () => {
    const m = findMatch(req(99, "c", { ts: 999 }), pairs);
    expect(m?.idx).toBe(2);
    expect(m?.strategy).toBe("normalized");
  });

  it("returns null when no match", () => {
    expect(findMatch(req(1, "missing"), pairs)).toBeNull();
  });
});
