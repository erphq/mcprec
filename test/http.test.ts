import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayHttp, type HttpReplayHandle } from "../src/http.js";

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcprec-http-"));
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
        params: { name: "greet", arguments: { name: "sd" } },
      },
    }),
    JSON.stringify({
      t: 0.03,
      dir: "←",
      msg: {
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "hi sd" }] },
      },
    }),
  ];
  writeFileSync(file, lines.join("\n"));
  return file;
}

describe("replayHttp", () => {
  let handle: HttpReplayHandle;
  let baseUrl: string;

  beforeAll(async () => {
    const file = writeFixture();
    handle = await replayHttp({ file, port: 0 });
    baseUrl = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle.close();
  });

  it("serves /health", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ok");
  });

  it("serves a recorded request and patches the id", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 999, method: "ping" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; result: string };
    expect(body.id).toBe(999);
    expect(body.result).toBe("pong");
  });

  it("matches with params", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "greet", arguments: { name: "sd" } },
      }),
    });
    const body = (await res.json()) as { id: number; result: { content: Array<{ text: string }> } };
    expect(body.id).toBe(7);
    expect(body.result.content[0]?.text).toBe("hi sd");
  });

  it("returns JSON-RPC error for unknown method", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "unknown" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; error: { code: number; message: string } };
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toContain("unknown");
  });

  it("returns 404 for the wrong path", async () => {
    const res = await fetch(`${baseUrl}/wrong-path`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 405 for non-POST on /mcp", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "PUT" });
    expect(res.status).toBe(405);
  });

  it("returns parse error for invalid JSON", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("rejects non-request payloads (e.g. notifications)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notify" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32600);
  });

  it("calls onMismatch callback when no match", async () => {
    const file = writeFixture();
    const seen: string[] = [];
    const h = await replayHttp({
      file,
      port: 0,
      onMismatch: (req) => seen.push(req.method),
    });
    try {
      await fetch(`http://127.0.0.1:${h.port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "missing" }),
      });
      expect(seen).toEqual(["missing"]);
    } finally {
      await h.close();
    }
  });

  it("respects custom path", async () => {
    const file = writeFixture();
    const h = await replayHttp({ file, port: 0, path: "/custom-mcp" });
    try {
      const res = await fetch(`http://127.0.0.1:${h.port}/custom-mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      expect(res.status).toBe(200);
      const otherRes = await fetch(`http://127.0.0.1:${h.port}/mcp`, {
        method: "POST",
        body: "{}",
      });
      expect(otherRes.status).toBe(404);
    } finally {
      await h.close();
    }
  });
});
