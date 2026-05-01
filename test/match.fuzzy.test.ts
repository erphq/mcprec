import { describe, it } from "vitest";

// TODO: fill in each test — see TODO.md for the full checklist.
// Mock data helpers will look something like:
//
//   const req = (method: string, params?: unknown) =>
//     ({ jsonrpc: "2.0", id: 1, method, params } as JsonRpcMessage);

describe("fuzzyMatch", () => {
  it.todo(
    "matches when only the JSON-RPC id differs (numeric monotonic ids)",
  );
  it.todo("matches when timestamps differ but structure is identical");
  it.todo("does not match when method names differ");
  it.todo(
    "does not match when params differ beyond id/timestamp fields",
  );
  it.todo("handles null params on both sides");
  it.todo("handles nested timestamps inside params objects");
});

describe("findMatch — fuzzy tier", () => {
  it.todo(
    "returns strategy=fuzzy when exact and normalized both fail but fuzzy hits",
  );
  it.todo("prefers exact over fuzzy when both would match");
  it.todo("prefers normalized over fuzzy when both would match");
  it.todo("returns null when no tier matches");
});
