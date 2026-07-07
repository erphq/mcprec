import { describe, it, expect } from "vitest";
import { parseTranscript } from "../src/replay.js";
import type { Frame } from "../src/types.js";

const frameA: Frame = {
  t: 0.0,
  dir: "→",
  msg: { jsonrpc: "2.0", id: 1, method: "initialize" },
};
const frameB: Frame = {
  t: 0.012,
  dir: "←",
  msg: { jsonrpc: "2.0", id: 1, result: { capabilities: {} } },
};

describe("parseTranscript", () => {
  it("returns empty array for empty string", () => {
    expect(parseTranscript("")).toEqual([]);
  });

  it("returns empty array for whitespace-only content", () => {
    expect(parseTranscript("   \n  \n")).toEqual([]);
  });

  it("parses a single frame", () => {
    expect(parseTranscript(JSON.stringify(frameA))).toEqual([frameA]);
  });

  it("parses multiple frames separated by newlines", () => {
    const content = [JSON.stringify(frameA), JSON.stringify(frameB)].join("\n");
    const result = parseTranscript(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(frameA);
    expect(result[1]).toEqual(frameB);
  });

  it("does not create an extra frame for a trailing newline", () => {
    const content = JSON.stringify(frameA) + "\n";
    expect(parseTranscript(content)).toHaveLength(1);
  });

  it("handles Windows CRLF line endings", () => {
    const content = [JSON.stringify(frameA), JSON.stringify(frameB)].join(
      "\r\n",
    );
    const result = parseTranscript(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(frameA);
    expect(result[1]).toEqual(frameB);
  });

  it("skips blank lines in the middle of the content", () => {
    const content = [
      JSON.stringify(frameA),
      "",
      "   ",
      JSON.stringify(frameB),
    ].join("\n");
    const result = parseTranscript(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(frameA);
    expect(result[1]).toEqual(frameB);
  });

  it("preserves fractional timestamps", () => {
    const frame: Frame = {
      t: 1.234,
      dir: "→",
      msg: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    };
    const result = parseTranscript(JSON.stringify(frame));
    expect(result[0]!.t).toBe(1.234);
  });

  it("preserves direction for both outgoing and incoming frames", () => {
    const content = [JSON.stringify(frameA), JSON.stringify(frameB)].join("\n");
    const result = parseTranscript(content);
    expect(result[0]!.dir).toBe("→");
    expect(result[1]!.dir).toBe("←");
  });
});
