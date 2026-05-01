import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { recordHttp, type RecordHttpHandle } from "../src/record_http.js";
import type { Frame } from "../src/types.js";

/** Minimal upstream MCP-shape server used as the target of the proxy. */
function startTarget(opts?: {
  jsonResponse?: unknown;
  sseEvents?: unknown[];
  status?: number;
}): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const status = opts?.status ?? 200;
      if (opts?.sseEvents) {
        res.statusCode = status;
        res.setHeader("content-type", "text/event-stream; charset=utf-8");
        res.setHeader("cache-control", "no-cache");
        for (const ev of opts.sseEvents) {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
        res.end();
      } else {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(opts?.jsonResponse ?? { jsonrpc: "2.0", id: 1, result: "ok" }));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, url: `http://127.0.0.1:${addr.port}/mcp` });
      }
    });
  });
}

function loadTranscript(file: string): Frame[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Frame);
}

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), "mcprec-record-")), "fixture.jsonl");
}

describe("recordHttp — JSON path", () => {
  let target: { server: Server; url: string };
  let handle: RecordHttpHandle;
  let out: string;

  beforeAll(async () => {
    target = await startTarget({
      jsonResponse: { jsonrpc: "2.0", id: 1, result: "pong" },
    });
    out = tmpFile();
    handle = await recordHttp({ out, target: target.url, port: 0 });
  });

  afterAll(async () => {
    await handle.close();
    await new Promise<void>((resolve) => target.server.close(() => resolve()));
  });

  it("captures one → and one ← frame for a JSON response", async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("pong");

    const frames = loadTranscript(out);
    expect(frames.length).toBe(2);
    expect(frames[0]?.dir).toBe("→");
    expect(frames[1]?.dir).toBe("←");
    expect((frames[0]?.msg as { method?: string }).method).toBe("ping");
    expect((frames[1]?.msg as { result?: string }).result).toBe("pong");
  });
});

describe("recordHttp — SSE path", () => {
  it("captures one → and N ← frames for an SSE response", async () => {
    const target = await startTarget({
      sseEvents: [
        { jsonrpc: "2.0", method: "progress", params: { pct: 25 } },
        { jsonrpc: "2.0", method: "progress", params: { pct: 75 } },
        { jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text: "ok" }] } },
      ],
    });
    const out = tmpFile();
    const h = await recordHttp({ out, target: target.url, port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${h.port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call" }),
      });
      // Drain the stream so the server can finish capturing.
      await res.text();
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    } finally {
      await h.close();
      await new Promise<void>((resolve) => target.server.close(() => resolve()));
    }
    const frames = loadTranscript(out);
    expect(frames).toHaveLength(4);
    expect(frames.filter((f) => f.dir === "→")).toHaveLength(1);
    expect(frames.filter((f) => f.dir === "←")).toHaveLength(3);
    expect((frames[3]?.msg as { result?: unknown }).result).toBeTruthy();
  });
});

describe("recordHttp — health + routing", () => {
  it("serves /health", async () => {
    const target = await startTarget();
    const out = tmpFile();
    const h = await recordHttp({ out, target: target.url, port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${h.port}/health`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("ok");
      expect(h.framesCaptured()).toBe(0);
    } finally {
      await h.close();
      await new Promise<void>((resolve) => target.server.close(() => resolve()));
    }
  });

  it("returns 404 for paths other than the configured one", async () => {
    const target = await startTarget();
    const out = tmpFile();
    const h = await recordHttp({ out, target: target.url, port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${h.port}/wrong`, {
        method: "POST",
        body: "{}",
      });
      expect(res.status).toBe(404);
    } finally {
      await h.close();
      await new Promise<void>((resolve) => target.server.close(() => resolve()));
    }
  });

  it("forwards the target's status on JSON errors", async () => {
    const target = await startTarget({
      status: 500,
      jsonResponse: { jsonrpc: "2.0", error: { code: -32603, message: "boom" } },
    });
    const out = tmpFile();
    const h = await recordHttp({ out, target: target.url, port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${h.port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "boom" }),
      });
      expect(res.status).toBe(500);
    } finally {
      await h.close();
      await new Promise<void>((resolve) => target.server.close(() => resolve()));
    }
  });
});
