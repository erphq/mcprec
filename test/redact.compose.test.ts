import { describe, it, expect } from "vitest";
import {
  redactDeep,
  redactValues,
  DEFAULT_REDACT_PATTERNS,
  DEFAULT_REDACT_VALUE_PATTERNS,
} from "../src/redact.js";

const TEST_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TEST_PEM =
  "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";

// Canonical composition from the README:
//   redactValues(redactDeep(msg, keyPatterns), valuePatterns)
function redactAll(v: unknown): unknown {
  return redactValues(
    redactDeep(v, DEFAULT_REDACT_PATTERNS),
    DEFAULT_REDACT_VALUE_PATTERNS,
  );
}

describe("redactDeep + redactValues composition", () => {
  it("redacts a key-matched field and a value-matched field in the same object", () => {
    const msg = { github_token: "ghp_plain", cert: TEST_PEM, q: "normal" };
    expect(redactAll(msg)).toEqual({
      github_token: "<REDACTED>",
      cert: "<REDACTED>",
      q: "normal",
    });
  });

  it("catches a JWT under a non-sensitive key via value-content pass", () => {
    // 'data' does not match any key pattern, but the JWT value is caught.
    const msg = { data: TEST_JWT, safe: "ok" };
    expect(redactAll(msg)).toEqual({ data: "<REDACTED>", safe: "ok" });
  });

  it("does not double-redact: '<REDACTED>' does not re-trigger value patterns", () => {
    // After key-name pass, github_token becomes "<REDACTED>" (a plain string).
    // The JWT value-content pattern must not match that placeholder.
    const msg = { github_token: TEST_JWT };
    expect(redactAll(msg)).toEqual({ github_token: "<REDACTED>" });
  });

  it("handles a realistic MCP tools/call frame", () => {
    const frame = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search_issues",
        arguments: { q: "is:open", api_key: "sk-live-abc123" },
      },
    };
    expect(redactAll(frame)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search_issues",
        arguments: { q: "is:open", api_key: "<REDACTED>" },
      },
    });
  });

  it("passes null through both layers unchanged", () => {
    expect(redactAll(null)).toBeNull();
  });

  it("passes undefined through both layers unchanged", () => {
    expect(redactAll(undefined)).toBeUndefined();
  });

  it("handles a null params field inside an object", () => {
    const msg = { jsonrpc: "2.0", id: 1, method: "ping", params: null };
    expect(redactAll(msg)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: null,
    });
  });

  it("redacts both types inside an array of frames", () => {
    const frames = [
      { authorization: "Bearer abc" },
      { bearer_data: TEST_JWT },
    ];
    expect(redactAll(frames)).toEqual([
      { authorization: "<REDACTED>" },
      { bearer_data: "<REDACTED>" },
    ]);
  });

  it("catches a PEM block under a non-sensitive key", () => {
    const msg = { pubkey: TEST_PEM, owner: "alice" };
    expect(redactAll(msg)).toEqual({
      pubkey: "<REDACTED>",
      owner: "alice",
    });
  });

  it("leaves non-sensitive MCP messages unchanged", () => {
    const msg = {
      jsonrpc: "2.0",
      id: 2,
      method: "list_tools",
      params: { cursor: null },
    };
    expect(redactAll(msg)).toEqual(msg);
  });

  it("redacts deeply nested credentials found by both passes", () => {
    const msg = {
      config: {
        headers: { authorization: "Bearer tok" },
        identity: { cert: TEST_PEM },
      },
    };
    expect(redactAll(msg)).toEqual({
      config: {
        headers: { authorization: "<REDACTED>" },
        identity: { cert: "<REDACTED>" },
      },
    });
  });
});
