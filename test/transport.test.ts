import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { lineFrames } from "../src/transport.js";

async function collect(input: string): Promise<string[]> {
  const stream = Readable.from([input]);
  const out: string[] = [];
  for await (const line of lineFrames(stream)) out.push(line);
  return out;
}

describe("lineFrames", () => {
  it("yields each newline-delimited line", async () => {
    expect(await collect("a\nb\nc\n")).toEqual(["a", "b", "c"]);
  });
  it("handles partial last line", async () => {
    expect(await collect("a\nb\nc")).toEqual(["a", "b", "c"]);
  });
  it("strips CR", async () => {
    expect(await collect("a\r\nb\r\n")).toEqual(["a", "b"]);
  });
  it("skips empty lines", async () => {
    expect(await collect("a\n\nb\n")).toEqual(["a", "b"]);
  });
  it("handles multi-chunk input", async () => {
    const parts = ["par", "tial\nlin", "e2\n"];
    const stream = Readable.from(parts);
    const out: string[] = [];
    for await (const line of lineFrames(stream)) out.push(line);
    expect(out).toEqual(["partial", "line2"]);
  });
});
