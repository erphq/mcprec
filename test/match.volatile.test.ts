import { describe, it, expect } from "vitest";
import { exactMatch, normalizedMatch } from "../src/match.js";
import type { JsonRpcRequest } from "../src/types.js";

const req = (id: number, method: string, params?: unknown): JsonRpcRequest => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

// normalizedMatch strips every key in VOLATILE_KEYS from params before comparing.
// This suite tests each volatile key individually and common combinations,
// verifying that non-volatile lookalikes are NOT stripped.

describe("normalizedMatch: volatile key stripping", () => {
  it("strips 'timestamp' so differing values still match", () => {
    const a = req(1, "x", { q: "search", timestamp: 1000 });
    const b = req(2, "x", { q: "search", timestamp: 9999 });
    expect(exactMatch(a, b)).toBe(false);
    expect(normalizedMatch(a, b)).toBe(true);
  });

  it("strips 'ts' so differing values still match", () => {
    const a = req(1, "x", { q: "search", ts: 1000 });
    const b = req(2, "x", { q: "search", ts: 9999 });
    expect(exactMatch(a, b)).toBe(false);
    expect(normalizedMatch(a, b)).toBe(true);
  });

  it("strips 'createdAt' so differing values still match", () => {
    const a = req(1, "list_issues", { state: "open", createdAt: "2026-01-01" });
    const b = req(2, "list_issues", { state: "open", createdAt: "2026-06-15" });
    expect(exactMatch(a, b)).toBe(false);
    expect(normalizedMatch(a, b)).toBe(true);
  });

  it("strips 'updatedAt' so differing values still match", () => {
    const a = req(1, "search", { q: "foo", updatedAt: "2026-01-01T00:00:00Z" });
    const b = req(2, "search", { q: "foo", updatedAt: "2026-07-20T12:00:00Z" });
    expect(exactMatch(a, b)).toBe(false);
    expect(normalizedMatch(a, b)).toBe(true);
  });

  it("strips 'requestId' so differing values still match", () => {
    const a = req(1, "tools/call", { name: "search", requestId: "req-aaa" });
    const b = req(2, "tools/call", { name: "search", requestId: "req-bbb" });
    expect(exactMatch(a, b)).toBe(false);
    expect(normalizedMatch(a, b)).toBe(true);
  });

  it("strips 'traceId' so differing values still match", () => {
    const a = req(1, "ping", { traceId: "trace-111" });
    const b = req(2, "ping", { traceId: "trace-999" });
    expect(exactMatch(a, b)).toBe(false);
    expect(normalizedMatch(a, b)).toBe(true);
  });

  it("strips multiple volatile keys simultaneously", () => {
    const a = req(1, "list", {
      owner: "alice",
      ts: 100,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      requestId: "r-aaa",
      traceId: "t-111",
    });
    const b = req(2, "list", {
      owner: "alice",
      ts: 999,
      createdAt: "2027-01-01",
      updatedAt: "2027-01-02",
      requestId: "r-zzz",
      traceId: "t-999",
    });
    expect(exactMatch(a, b)).toBe(false);
    expect(normalizedMatch(a, b)).toBe(true);
  });

  it("still differs on non-volatile params after stripping volatile ones", () => {
    const a = req(1, "search", { q: "foo", ts: 100 });
    const b = req(2, "search", { q: "bar", ts: 999 });
    expect(normalizedMatch(a, b)).toBe(false);
  });

  it("strips volatile keys nested inside an object", () => {
    const a = req(1, "event", { meta: { createdAt: "2026-01-01", label: "v1" } });
    const b = req(2, "event", { meta: { createdAt: "2027-06-15", label: "v1" } });
    expect(exactMatch(a, b)).toBe(false);
    expect(normalizedMatch(a, b)).toBe(true);
  });

  it("strips volatile keys from objects inside arrays", () => {
    const a = req(1, "batch", {
      items: [{ id: "a", updatedAt: "2026-01-01" }, { id: "b", updatedAt: "2026-01-02" }],
    });
    const b = req(2, "batch", {
      items: [{ id: "a", updatedAt: "2027-07-01" }, { id: "b", updatedAt: "2027-07-02" }],
    });
    expect(exactMatch(a, b)).toBe(false);
    expect(normalizedMatch(a, b)).toBe(true);
  });

  it("does not strip near-miss keys like 'created' or 'time'", () => {
    const a = req(1, "x", { created: "2026-01-01", time: 100 });
    const b = req(2, "x", { created: "2027-01-01", time: 999 });
    expect(normalizedMatch(a, b)).toBe(false);
  });

  it("does not strip 'reqId' (case-sensitive, not in VOLATILE_KEYS)", () => {
    const a = req(1, "x", { reqId: "old" });
    const b = req(2, "x", { reqId: "new" });
    expect(normalizedMatch(a, b)).toBe(false);
  });

  it("still matches when volatile-only params make the requests trivially equal after stripping", () => {
    const a = req(1, "ping", { traceId: "t1", requestId: "r1" });
    const b = req(2, "ping", { traceId: "t9", requestId: "r9" });
    expect(normalizedMatch(a, b)).toBe(true);
  });
});
