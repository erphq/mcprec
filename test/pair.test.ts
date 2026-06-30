import { describe, it, expect } from "vitest";
import { pairFrames, pairFramesStreamed } from "../src/replay.js";
import type { Frame, JsonRpcMessage } from "../src/types.js";

function outFrame(id: number, method: string, params?: unknown): Frame {
  return {
    t: 0,
    dir: "→",
    msg: {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    } as JsonRpcMessage,
  };
}

function inFrame(id: number, result: unknown): Frame {
  return {
    t: 0.1,
    dir: "←",
    msg: { jsonrpc: "2.0", id, result } as JsonRpcMessage,
  };
}

function outNotif(method: string, params?: unknown): Frame {
  return {
    t: 0,
    dir: "→",
    msg: {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    } as JsonRpcMessage,
  };
}

function inNotif(method: string, params?: unknown): Frame {
  return {
    t: 0,
    dir: "←",
    msg: {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    } as JsonRpcMessage,
  };
}

describe("pairFrames", () => {
  it("returns empty for empty input", () => {
    expect(pairFrames([])).toEqual([]);
  });

  it("pairs a single request with its response", () => {
    const pairs = pairFrames([outFrame(1, "ping"), inFrame(1, "pong")]);
    expect(pairs).toHaveLength(1);
    expect((pairs[0]!.request as Record<string, unknown>)["method"]).toBe("ping");
    expect((pairs[0]!.response as Record<string, unknown>)["result"]).toBe("pong");
  });

  it("tolerates out-of-order responses", () => {
    const frames = [
      outFrame(1, "a"),
      outFrame(2, "b"),
      inFrame(2, "B"),
      inFrame(1, "A"),
    ];
    const pairs = pairFrames(frames);
    expect(pairs).toHaveLength(2);
    const a = pairs.find(
      (p) => (p.request as Record<string, unknown>)["method"] === "a",
    );
    const b = pairs.find(
      (p) => (p.request as Record<string, unknown>)["method"] === "b",
    );
    expect((a!.response as Record<string, unknown>)["result"]).toBe("A");
    expect((b!.response as Record<string, unknown>)["result"]).toBe("B");
  });

  it("omits a request that never received a response", () => {
    const frames = [
      outFrame(1, "ping"),
      outFrame(2, "no-resp"),
      inFrame(1, "pong"),
    ];
    const pairs = pairFrames(frames);
    expect(pairs).toHaveLength(1);
    expect((pairs[0]!.request as Record<string, unknown>)["method"]).toBe("ping");
  });

  it("returns empty when no responses exist", () => {
    const pairs = pairFrames([outFrame(1, "a"), outFrame(2, "b")]);
    expect(pairs).toHaveLength(0);
  });

  it("skips outgoing notification frames (no id)", () => {
    const frames = [
      outNotif("notifications/progress", { pct: 50 }),
      outFrame(1, "ping"),
      inFrame(1, "pong"),
    ];
    const pairs = pairFrames(frames);
    expect(pairs).toHaveLength(1);
    expect((pairs[0]!.request as Record<string, unknown>)["method"]).toBe("ping");
  });

  it("ignores an orphaned response with no matching request", () => {
    const frames = [inFrame(99, "orphan"), outFrame(1, "ping"), inFrame(1, "pong")];
    const pairs = pairFrames(frames);
    expect(pairs).toHaveLength(1);
    expect((pairs[0]!.request as Record<string, unknown>)["method"]).toBe("ping");
  });

  it("pairs multiple requests independently", () => {
    const frames = [
      outFrame(1, "initialize"),
      outFrame(2, "tools/list"),
      inFrame(2, []),
      inFrame(1, { capabilities: {} }),
    ];
    const pairs = pairFrames(frames);
    expect(pairs).toHaveLength(2);
  });
});

describe("pairFramesStreamed", () => {
  it("returns empty for empty input", () => {
    expect(pairFramesStreamed([])).toEqual([]);
  });

  it("single request with single response behaves like pairFrames", () => {
    const pairs = pairFramesStreamed([outFrame(1, "ping"), inFrame(1, "pong")]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.responses).toHaveLength(1);
    expect(
      (pairs[0]!.responses[0] as Record<string, unknown>)["result"],
    ).toBe("pong");
  });

  it("collects multiple id-matched responses for one SSE stream", () => {
    const frames = [
      outFrame(1, "stream"),
      inFrame(1, { chunk: 1 }),
      inFrame(1, { chunk: 2 }),
      inFrame(1, { done: true }),
    ];
    const pairs = pairFramesStreamed(frames);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.responses).toHaveLength(3);
  });

  it("includes interleaved server notifications in the response list", () => {
    const frames = [
      outFrame(1, "slow-call"),
      inNotif("notifications/progress", { pct: 50 }),
      inFrame(1, { result: "done" }),
    ];
    const pairs = pairFramesStreamed(frames);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.responses).toHaveLength(2);
  });

  it("stops collecting at the next outgoing request boundary", () => {
    const frames = [
      outFrame(1, "a"),
      inFrame(1, "A"),
      outFrame(2, "b"),
      inFrame(2, "B"),
    ];
    const pairs = pairFramesStreamed(frames);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]!.responses).toHaveLength(1);
    expect(pairs[1]!.responses).toHaveLength(1);
    expect(
      (pairs[1]!.responses[0] as Record<string, unknown>)["result"],
    ).toBe("B");
  });

  it("omits a request that received no responses", () => {
    expect(pairFramesStreamed([outFrame(1, "no-resp")])).toHaveLength(0);
  });

  it("skips outgoing notification frames", () => {
    const frames = [
      outNotif("progress"),
      outFrame(1, "ping"),
      inFrame(1, "pong"),
    ];
    const pairs = pairFramesStreamed(frames);
    expect(pairs).toHaveLength(1);
    expect(
      (pairs[0]!.request as Record<string, unknown>)["method"],
    ).toBe("ping");
  });
});
