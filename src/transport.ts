import type { Readable } from "node:stream";

/**
 * Yield newline-delimited frames from a stream. Strips trailing \r and
 * skips empty lines. Yields the final partial line if the stream ends
 * without a trailing newline.
 */
export async function* lineFrames(stream: Readable): AsyncGenerator<string> {
  let buf = "";
  for await (const chunk of stream) {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line.trim()) yield line;
    }
  }
  const tail = buf.replace(/\r$/, "");
  if (tail.trim()) yield tail;
}
