import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayHttp, type HttpReplayHandle } from "../src/http.js";

/**
 * Build a transcript where the `tools/call` request is followed by
 * THREE response frames: two progress notifications and a final
 * response. That's the SSE shape the HTTP transport should detect.
 */
function writeStreamingFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcprec-sse-"));
  const file = join(dir, "fixture.jsonl");
  const lines = [
    JSON.stringify({
      t: 0,
      dir: "→",
      msg: { jsonrpc: "2.0", id: 1, method: "ping" },
    }),
    JSON.stringify({
      t: 0.01,
      dir: "←",
      msg: { jsonrpc: "2.0", id: 1, result: "pong" },
    }),
    JSON.stringify({
      t: 0.02,
      dir: "→",
      msg: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "long_op" },
      },
    }),
    // First progress notification
    JSON.stringify({
      t: 0.05,
      dir: "←",
      msg: { jsonrpc: "2.0", method: "progress", params: { pct: 25 } },
    }),
    // Second progress notification
    JSON.stringify({
      t: 0.10,
      dir: "←",
      msg: { jsonrpc: "2.0", method: "progress", params: { pct: 75 } },
    }),
    // Final response (matches the request id)
    JSON.stringify({
      t: 0.15,
      dir: "←",
      msg: {
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "done" }] },
      },
    }),
  ];
  writeFileSync(file, lines.join("\n"));
  return file;
}

async function readSseEvents(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: string[] = [];
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = block
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice("data: ".length));
      if (dataLines.length > 0) events.push(dataLines.join("\n"));
    }
  }
  return events;
}

describe("replayHttp - SSE streaming (v0.4.1)", () => {
  let handle: HttpReplayHandle;
  let baseUrl: string;

  beforeAll(async () => {
    const file = writeStreamingFixture();
    handle = await replayHttp({ file, port: 0 });
    baseUrl = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle.close();
  });

  it("streaming-mode auto: single response → application/json", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 100, method: "ping" }),
    });
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("pong");
  });

  it("streaming-mode auto: multiple responses → text/event-stream", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "long_op" },
      }),
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("cache-control")).toMatch(/no-cache/);
    const events = await readSseEvents(res);
    expect(events).toHaveLength(3);
    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[0]?.method).toBe("progress");
    expect(parsed[1]?.method).toBe("progress");
    expect(parsed[2]?.id).toBe(7); // patched to incoming id
    expect(parsed[2]?.result).toBeTruthy();
  });

  it("streaming-mode off: always JSON, last frame wins", async () => {
    const file = writeStreamingFixture();
    const h = await replayHttp({ file, port: 0, streaming: "off" });
    try {
      const res = await fetch(`http://127.0.0.1:${h.port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "long_op" },
        }),
      });
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      const body = (await res.json()) as { id: number; result: unknown };
      expect(body.id).toBe(9);
      expect(body.result).toBeTruthy();
    } finally {
      await h.close();
    }
  });
});
