import { describe, it, expect } from "vitest";
import { findMatch } from "../src/match.js";
import type {
  JsonRpcMessage,
  ReplayPair,
  UserMatcher,
} from "../src/types.js";

const req = (id: number, method: string, params?: unknown): JsonRpcMessage => ({
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

describe("findMatch with userMatcher", () => {
  const pairs: ReplayPair[] = [
    pair(1, "ping", {}, "pong"),
    pair(2, "search", { q: "alpha" }, ["a"]),
    pair(3, "search", { q: "beta" }, ["b"]),
  ];

  it("user matcher claims first qualifying pair", () => {
    const userMatcher: UserMatcher = (incoming, recorded) => {
      // pretend "search" with any query matches the first 'search' pair
      return (
        (incoming as { method?: string }).method === "search" &&
        (recorded.request as { method?: string }).method === "search"
      );
    };
    const m = findMatch(req(99, "search", { q: "anything" }), pairs, {
      userMatcher,
    });
    expect(m?.strategy).toBe("user");
    expect(m?.idx).toBe(1);
  });

  it("user matcher's false return falls through to built-ins", () => {
    const userMatcher: UserMatcher = () => false;
    const m = findMatch(req(99, "ping", {}), pairs, { userMatcher });
    expect(m?.strategy).toBe("exact");
    expect(m?.idx).toBe(0);
  });

  it("absent userMatcher behaves like before", () => {
    const m = findMatch(req(99, "ping", {}), pairs);
    expect(m?.strategy).toBe("exact");
  });

  it("user matcher still returns null when nothing qualifies", () => {
    const userMatcher: UserMatcher = () => false;
    const m = findMatch(req(99, "missing", {}), pairs, { userMatcher });
    expect(m).toBeNull();
  });

  it("user matcher takes precedence over exact", () => {
    // Even though exact would match pair 0, the user matcher claims pair 2.
    const userMatcher: UserMatcher = (_incoming, recorded) =>
      (recorded.request as { method?: string }).method === "search" &&
      JSON.stringify((recorded.request as { params?: unknown }).params).includes(
        "beta",
      );
    const m = findMatch(req(99, "ping", {}), pairs, { userMatcher });
    expect(m?.strategy).toBe("user");
    expect(m?.idx).toBe(2);
  });

  it("user matcher receives the actual ReplayPair, not just request", () => {
    const seen: ReplayPair[] = [];
    const userMatcher: UserMatcher = (_req, recorded) => {
      seen.push(recorded);
      return false;
    };
    findMatch(req(1, "x", {}), pairs, { userMatcher });
    expect(seen).toEqual(pairs);
  });
});
