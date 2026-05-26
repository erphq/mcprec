import { describe, it, expect } from "vitest";
import { formatDiff } from "../src/diff.js";
import type { TranscriptDiff } from "../src/diff.js";
import type { JsonRpcMessage } from "../src/types.js";

// Strip ANSI color codes so assertions do not depend on terminal color support.
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const EMPTY: TranscriptDiff = {
  onlyInA: [],
  onlyInB: [],
  changed: [],
  unchanged: 0,
};

const resp = (id: number, result: unknown): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id,
  result,
});

describe("formatDiff - identical transcripts", () => {
  it("reports identical with 1 pair (singular)", () => {
    const out = strip(formatDiff({ ...EMPTY, unchanged: 1 }));
    expect(out).toContain("identical");
    expect(out).toContain("1 pair");
  });

  it("uses plural 'pairs' for 0 unchanged", () => {
    const out = strip(formatDiff(EMPTY));
    expect(out).toContain("0 pairs");
  });

  it("uses plural 'pairs' for more than 1 unchanged", () => {
    const out = strip(formatDiff({ ...EMPTY, unchanged: 4 }));
    expect(out).toContain("4 pairs");
  });
});

describe("formatDiff - only-in-A", () => {
  it("shows the section header and method name", () => {
    const diff: TranscriptDiff = {
      ...EMPTY,
      onlyInA: [{ method: "tools/call", paramsCanonical: '{"name":"search"}' }],
    };
    const out = strip(formatDiff(diff));
    expect(out).toContain("Only in A");
    expect(out).toContain("tools/call");
  });

  it("shows the canonical params", () => {
    const diff: TranscriptDiff = {
      ...EMPTY,
      onlyInA: [{ method: "x", paramsCanonical: '{"q":"hello"}' }],
    };
    const out = strip(formatDiff(diff));
    expect(out).toContain('"q":"hello"');
  });

  it("uses custom label in section header", () => {
    const diff: TranscriptDiff = {
      ...EMPTY,
      onlyInA: [{ method: "x", paramsCanonical: "{}" }],
    };
    const out = strip(formatDiff(diff, "v1", "v2"));
    expect(out).toContain("Only in v1");
    expect(out).not.toContain("Only in A");
  });
});

describe("formatDiff - only-in-B", () => {
  it("shows the section header and method name", () => {
    const diff: TranscriptDiff = {
      ...EMPTY,
      onlyInB: [{ method: "resources/list", paramsCanonical: "{}" }],
    };
    const out = strip(formatDiff(diff));
    expect(out).toContain("Only in B");
    expect(out).toContain("resources/list");
  });

  it("uses custom label in section header", () => {
    const diff: TranscriptDiff = {
      ...EMPTY,
      onlyInB: [{ method: "x", paramsCanonical: "{}" }],
    };
    const out = strip(formatDiff(diff, "old", "new"));
    expect(out).toContain("Only in new");
    expect(out).not.toContain("Only in B");
  });
});

describe("formatDiff - changed responses", () => {
  const before = resp(1, { count: 1 });
  const after = resp(1, { count: 2 });

  it("shows the section header and method name", () => {
    const diff: TranscriptDiff = {
      ...EMPTY,
      changed: [{ method: "tools/call", paramsCanonical: "{}", before, after }],
    };
    const out = strip(formatDiff(diff));
    expect(out).toContain("Changed responses");
    expect(out).toContain("tools/call");
  });

  it("shows before and after response content", () => {
    const diff: TranscriptDiff = {
      ...EMPTY,
      changed: [{ method: "tools/call", paramsCanonical: "{}", before, after }],
    };
    const out = strip(formatDiff(diff));
    expect(out).toContain('"count":1');
    expect(out).toContain('"count":2');
  });
});

describe("formatDiff - summary line", () => {
  it("includes all four counts", () => {
    const diff: TranscriptDiff = {
      onlyInA: [{ method: "a", paramsCanonical: "{}" }],
      onlyInB: [{ method: "b", paramsCanonical: "{}" }],
      changed: [{ method: "c", paramsCanonical: "{}", before: resp(1, 1), after: resp(1, 2) }],
      unchanged: 5,
    };
    const out = strip(formatDiff(diff));
    expect(out).toContain("1 changed");
    expect(out).toContain("5 unchanged");
  });

  it("uses custom labels in summary line", () => {
    const diff: TranscriptDiff = {
      ...EMPTY,
      onlyInA: [{ method: "x", paramsCanonical: "{}" }],
    };
    const out = strip(formatDiff(diff, "alpha", "beta"));
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });
});

describe("formatDiff - truncation", () => {
  it("truncates paramsCanonical longer than 80 chars", () => {
    const long = "x".repeat(200);
    const diff: TranscriptDiff = {
      ...EMPTY,
      onlyInA: [{ method: "m", paramsCanonical: long }],
    };
    const out = strip(formatDiff(diff));
    expect(out).toContain("…");
  });

  it("does not truncate params within the 80-char limit", () => {
    const short = '{"q":"hello"}';
    const diff: TranscriptDiff = {
      ...EMPTY,
      onlyInA: [{ method: "m", paramsCanonical: short }],
    };
    const out = strip(formatDiff(diff));
    expect(out).toContain(short);
    expect(out).not.toContain("…");
  });
});
