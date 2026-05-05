import { describe, it, expect } from "vitest";
import { redactDeep, DEFAULT_REDACT_PATTERNS } from "../src/redact.js";

describe("redactDeep", () => {
  it("redacts top-level keys", () => {
    expect(
      redactDeep({ authorization: "Bearer x", q: "k" }, ["authorization"]),
    ).toEqual({ authorization: "<REDACTED>", q: "k" });
  });

  it("redacts nested keys", () => {
    expect(
      redactDeep({ headers: { authorization: "Bearer x" } }, ["authorization"]),
    ).toEqual({ headers: { authorization: "<REDACTED>" } });
  });

  it("redacts wildcard patterns", () => {
    expect(
      redactDeep({ github_token: "abc", openai_token: "def", q: "ok" }, [
        "*_token",
      ]),
    ).toEqual({
      github_token: "<REDACTED>",
      openai_token: "<REDACTED>",
      q: "ok",
    });
  });

  it("is case-insensitive", () => {
    expect(redactDeep({ Authorization: "x" }, ["authorization"])).toEqual({
      Authorization: "<REDACTED>",
    });
  });

  it("does nothing with empty patterns", () => {
    expect(redactDeep({ a: 1 }, [])).toEqual({ a: 1 });
  });

  it("redacts inside arrays", () => {
    expect(
      redactDeep([{ authorization: "Bearer x" }, { q: "ok" }], ["authorization"]),
    ).toEqual([{ authorization: "<REDACTED>" }, { q: "ok" }]);
  });
});

describe("DEFAULT_REDACT_PATTERNS", () => {
  it("includes authorization", () => {
    expect(DEFAULT_REDACT_PATTERNS).toContain("authorization");
  });

  it("includes *_token", () => {
    expect(DEFAULT_REDACT_PATTERNS).toContain("*_token");
  });

  it("includes *_key", () => {
    expect(DEFAULT_REDACT_PATTERNS).toContain("*_key");
  });

  it("includes *_secret", () => {
    expect(DEFAULT_REDACT_PATTERNS).toContain("*_secret");
  });

  it("redacts authorization header", () => {
    expect(
      redactDeep({ authorization: "Bearer ghp_abc123" }, DEFAULT_REDACT_PATTERNS),
    ).toEqual({ authorization: "<REDACTED>" });
  });

  it("redacts *_token keys", () => {
    expect(
      redactDeep({ github_token: "ghp_abc", openai_token: "sk-xyz", q: "ok" }, DEFAULT_REDACT_PATTERNS),
    ).toEqual({ github_token: "<REDACTED>", openai_token: "<REDACTED>", q: "ok" });
  });

  it("redacts *_key keys", () => {
    expect(
      redactDeep({ api_key: "sk-abc", name: "test" }, DEFAULT_REDACT_PATTERNS),
    ).toEqual({ api_key: "<REDACTED>", name: "test" });
  });

  it("redacts *_secret keys", () => {
    expect(
      redactDeep({ client_secret: "abc123", scope: "read" }, DEFAULT_REDACT_PATTERNS),
    ).toEqual({ client_secret: "<REDACTED>", scope: "read" });
  });

  it("redacts nested credential keys", () => {
    expect(
      redactDeep(
        { params: { arguments: { github_token: "ghp_abc", repo: "foo" } } },
        DEFAULT_REDACT_PATTERNS,
      ),
    ).toEqual({ params: { arguments: { github_token: "<REDACTED>", repo: "foo" } } });
  });

  it("leaves non-sensitive keys alone", () => {
    expect(
      redactDeep({ method: "tools/call", q: "hello" }, DEFAULT_REDACT_PATTERNS),
    ).toEqual({ method: "tools/call", q: "hello" });
  });
});
