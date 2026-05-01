import { describe, it, expect } from "vitest";
import { redactDeep } from "../src/redact.js";

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
});
