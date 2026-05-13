import { describe, it, expect } from "vitest";
import { requestKey, responseKey, methodOf } from "../src/match.js";
import type { JsonRpcMessage, JsonRpcRequest } from "../src/types.js";

const req = (id: number, method: string, params?: unknown): JsonRpcRequest => ({
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

const err = (
  id: number,
  code: number,
  message: string,
): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

// ---------------------------------------------------------------------------
// methodOf
// ---------------------------------------------------------------------------
describe("methodOf", () => {
  it("returns method for a request", () => {
    expect(methodOf(req(1, "tools/call"))).toBe("tools/call");
  });

  it("returns method for a notification (no id)", () => {
    const notification: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progress: 50 },
    };
    expect(methodOf(notification)).toBe("notifications/progress");
  });

  it("returns undefined for a response (no method)", () => {
    expect(methodOf(ok(1, "pong"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// requestKey
// ---------------------------------------------------------------------------
describe("requestKey", () => {
  it("includes the method in the key", () => {
    const key = requestKey(req(1, "tools/call", { name: "search" }));
    expect(key).toContain("tools/call");
  });

  it("is stable regardless of param key order", () => {
    const a = requestKey(req(1, "x", { a: 1, b: 2 }));
    const b = requestKey(req(2, "x", { b: 2, a: 1 }));
    expect(a).toBe(b);
  });

  it("is stable across different request ids", () => {
    expect(requestKey(req(1, "ping", {}))).toBe(
      requestKey(req(99, "ping", {})),
    );
  });

  it("differs for different methods", () => {
    expect(requestKey(req(1, "ping", {}))).not.toBe(
      requestKey(req(1, "pong", {})),
    );
  });

  it("differs for different non-volatile params", () => {
    expect(requestKey(req(1, "search", { q: "foo" }))).not.toBe(
      requestKey(req(1, "search", { q: "bar" })),
    );
  });

  it("is the same when only volatile keys differ (timestamp)", () => {
    const a = requestKey(req(1, "list", { q: "x", timestamp: 100 }));
    const b = requestKey(req(1, "list", { q: "x", timestamp: 999 }));
    expect(a).toBe(b);
  });

  it("is the same when only volatile keys differ (ts, requestId)", () => {
    const a = requestKey(req(1, "list", { ts: 1, requestId: "abc" }));
    const b = requestKey(req(1, "list", { ts: 2, requestId: "xyz" }));
    expect(a).toBe(b);
  });

  it("handles requests with no params", () => {
    const key = requestKey(req(1, "initialize"));
    expect(typeof key).toBe("string");
    expect(key).toContain("initialize");
  });

  it("uses '<no-method>' for messages without a method", () => {
    const response = ok(1, { capabilities: {} });
    const key = requestKey(response);
    expect(key).toContain("<no-method>");
  });
});

// ---------------------------------------------------------------------------
// responseKey
// ---------------------------------------------------------------------------
describe("responseKey", () => {
  it("produces the same key for identical results", () => {
    expect(responseKey(ok(1, { tools: ["a"] }))).toBe(
      responseKey(ok(2, { tools: ["a"] })),
    );
  });

  it("produces different keys for different results", () => {
    expect(responseKey(ok(1, { content: "old" }))).not.toBe(
      responseKey(ok(1, { content: "new" })),
    );
  });

  it("is stable regardless of result key order", () => {
    const a = responseKey(ok(1, { x: 1, y: 2 }));
    const b = responseKey(ok(2, { y: 2, x: 1 }));
    expect(a).toBe(b);
  });

  it("distinguishes a result from an error", () => {
    const resultKey = responseKey(ok(1, {}));
    const errorKey = responseKey(err(1, -32603, "internal error"));
    expect(resultKey).not.toBe(errorKey);
  });

  it("produces the same key for identical errors", () => {
    const a = responseKey(err(1, -32603, "internal error"));
    const b = responseKey(err(2, -32603, "internal error"));
    expect(a).toBe(b);
  });

  it("produces different keys for errors with different codes", () => {
    const a = responseKey(err(1, -32603, "internal error"));
    const b = responseKey(err(1, -32601, "method not found"));
    expect(a).not.toBe(b);
  });

  it("strips volatile keys from result when comparing", () => {
    const a = responseKey(ok(1, { data: "foo", timestamp: 100 }));
    const b = responseKey(ok(1, { data: "foo", timestamp: 999 }));
    expect(a).toBe(b);
  });

  it("handles null result", () => {
    const key = responseKey(ok(1, null));
    expect(typeof key).toBe("string");
  });
});
