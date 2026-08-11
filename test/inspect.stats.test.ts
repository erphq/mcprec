import { describe, it, expect } from "vitest";
import { transcriptStats } from "../src/inspect.js";
import type { Frame, JsonRpcMessage } from "../src/types.js";

function req(id: number, method: string, t = 0, params?: unknown): Frame {
  return {
    t,
    dir: "→",
    msg: {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    } as JsonRpcMessage,
  };
}

function res(id: number, result: unknown, t = 0.1): Frame {
  return {
    t,
    dir: "←",
    msg: { jsonrpc: "2.0", id, result } as JsonRpcMessage,
  };
}

function notif(method: string, t = 0): Frame {
  return {
    t,
    dir: "→",
    msg: { jsonrpc: "2.0", method } as JsonRpcMessage,
  };
}

describe("transcriptStats", () => {
  it("returns zero stats for an empty transcript", () => {
    expect(transcriptStats([])).toEqual({
      frameCount: 0,
      pairCount: 0,
      durationSeconds: 0,
      methods: {},
    });
  });

  it("counts frameCount for all frames including responses", () => {
    const frames = [req(1, "ping", 0), res(1, "pong", 0.1)];
    expect(transcriptStats(frames).frameCount).toBe(2);
  });

  it("counts pairCount only for matched request/response pairs", () => {
    const frames = [req(1, "ping", 0), res(1, "pong", 0.1)];
    expect(transcriptStats(frames).pairCount).toBe(1);
  });

  it("returns pairCount of 0 when no responses are present", () => {
    const frames = [req(1, "ping", 0), req(2, "pong", 0.05)];
    expect(transcriptStats(frames).pairCount).toBe(0);
  });

  it("computes durationSeconds as last.t minus first.t", () => {
    const frames = [req(1, "a", 0.5), res(1, "A", 1.25)];
    expect(transcriptStats(frames).durationSeconds).toBeCloseTo(0.75);
  });

  it("returns durationSeconds of 0 for a single-frame transcript", () => {
    expect(transcriptStats([req(1, "ping", 3.0)]).durationSeconds).toBe(0);
  });

  it("counts each outgoing method call", () => {
    const frames = [
      req(1, "initialize", 0.0),
      res(1, {}, 0.01),
      req(2, "tools/list", 0.02),
      res(2, [], 0.03),
    ];
    const { methods } = transcriptStats(frames);
    expect(methods["initialize"]).toBe(1);
    expect(methods["tools/list"]).toBe(1);
  });

  it("accumulates counts for repeated method calls", () => {
    const frames = [
      req(1, "tools/list", 0.0),
      res(1, [], 0.01),
      req(2, "tools/list", 0.02),
      res(2, [], 0.03),
      req(3, "tools/list", 0.04),
      res(3, [], 0.05),
    ];
    expect(transcriptStats(frames).methods["tools/list"]).toBe(3);
  });

  it("groups tools/call frames by tool name", () => {
    const frames = [
      req(1, "tools/call", 0.0, { name: "search_issues" }),
      res(1, {}, 0.1),
      req(2, "tools/call", 0.2, { name: "search_issues" }),
      res(2, {}, 0.3),
      req(3, "tools/call", 0.4, { name: "create_comment" }),
      res(3, {}, 0.5),
    ];
    const { methods } = transcriptStats(frames);
    expect(methods["tools/call[search_issues]"]).toBe(2);
    expect(methods["tools/call[create_comment]"]).toBe(1);
    expect(methods["tools/call"]).toBeUndefined();
  });

  it("keeps tools/call as-is when params.name is missing", () => {
    const frames = [
      req(1, "tools/call", 0.0, { arguments: { q: "foo" } }),
      res(1, {}, 0.1),
    ];
    expect(transcriptStats(frames).methods["tools/call"]).toBe(1);
  });

  it("does not count incoming response frames as method calls", () => {
    const frames = [req(1, "ping", 0), res(1, "pong", 0.1)];
    const { methods } = transcriptStats(frames);
    expect(Object.keys(methods)).toEqual(["ping"]);
  });

  it("counts outgoing notification frames (they have a method but no id)", () => {
    const frames = [
      notif("notifications/initialized", 0),
      req(1, "tools/list", 0.01),
      res(1, [], 0.02),
    ];
    const { methods } = transcriptStats(frames);
    expect(methods["notifications/initialized"]).toBe(1);
    expect(methods["tools/list"]).toBe(1);
  });

  it("handles a full typical session", () => {
    const frames = [
      req(1, "initialize", 0.0),
      res(1, { capabilities: {} }, 0.01),
      req(2, "tools/list", 0.02),
      res(2, [], 0.03),
      req(3, "tools/call", 0.04, { name: "search_issues" }),
      res(3, { content: [] }, 0.89),
      req(4, "tools/call", 0.90, { name: "search_issues" }),
      res(4, { content: [] }, 1.75),
    ];
    const stats = transcriptStats(frames);
    expect(stats.frameCount).toBe(8);
    expect(stats.pairCount).toBe(4);
    expect(stats.durationSeconds).toBeCloseTo(1.75);
    expect(stats.methods["initialize"]).toBe(1);
    expect(stats.methods["tools/list"]).toBe(1);
    expect(stats.methods["tools/call[search_issues]"]).toBe(2);
  });
});
