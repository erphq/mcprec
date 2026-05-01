import type {
  JsonRpcMessage,
  JsonRpcRequest,
  MatchStrategy,
  ReplayPair,
} from "./types.js";

export function isRequest(m: JsonRpcMessage): m is JsonRpcRequest {
  return (
    typeof (m as { method?: unknown }).method === "string" &&
    "id" in m &&
    (m as { id?: unknown }).id !== undefined
  );
}

export function methodOf(m: JsonRpcMessage): string | undefined {
  const v = (m as { method?: unknown }).method;
  return typeof v === "string" ? v : undefined;
}

function paramsOf(m: JsonRpcMessage): unknown {
  return (m as { params?: unknown }).params;
}

function canonical(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = canonical(obj[k]);
    }
    return out;
  }
  return v;
}

const VOLATILE_KEYS = new Set([
  "timestamp",
  "ts",
  "createdAt",
  "updatedAt",
  "requestId",
  "traceId",
]);

function stripVolatile(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = stripVolatile(val);
    }
    return out;
  }
  return v;
}

export function exactMatch(a: JsonRpcMessage, b: JsonRpcMessage): boolean {
  if (methodOf(a) !== methodOf(b)) return false;
  return (
    JSON.stringify(canonical(paramsOf(a))) ===
    JSON.stringify(canonical(paramsOf(b)))
  );
}

export function normalizedMatch(
  a: JsonRpcMessage,
  b: JsonRpcMessage,
): boolean {
  if (methodOf(a) !== methodOf(b)) return false;
  return (
    JSON.stringify(canonical(stripVolatile(paramsOf(a)))) ===
    JSON.stringify(canonical(stripVolatile(paramsOf(b))))
  );
}

// ── Tier 3: fuzzy match ──────────────────────────────────────────────────────
//
// Drops monotonic numeric JSON-RPC ids and normalises ISO-8601 timestamps
// to a fixed sentinel before comparing params.
// TODO: add "fuzzy" to the MatchStrategy union in src/types.ts.

const ISO_TIMESTAMP_RE =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;

const TIMESTAMP_SENTINEL = "__TS__";

function normalizeTimestamps(v: unknown): unknown {
  // TODO: decide whether to recurse into nested objects or only replace
  //   ISO strings at the top-level string fields.
  if (typeof v === "string") {
    return v.replace(ISO_TIMESTAMP_RE, TIMESTAMP_SENTINEL);
  }
  if (Array.isArray(v)) return v.map(normalizeTimestamps);
  if (v !== null && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) {
      out[k] = normalizeTimestamps(val);
    }
    return out;
  }
  return v;
}

const NUMERIC_STRING_RE = /^\d+$/;

function dropMonotonicId(params: unknown): unknown {
  // Removes top-level "id" keys whose value is a plain integer or a
  // digit-only string — these are typically auto-incrementing request ids.
  // TODO: extend to handle batched JSON-RPC envelope ids if needed.
  if (params === null || params === undefined) return params;
  if (typeof params === "object" && !Array.isArray(params)) {
    const obj = params as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) {
      if (
        k === "id" &&
        (typeof val === "number" ||
          (typeof val === "string" && NUMERIC_STRING_RE.test(val)))
      ) {
        continue;
      }
      out[k] = val;
    }
    return out;
  }
  return params;
}

export function fuzzyMatch(a: JsonRpcMessage, b: JsonRpcMessage): boolean {
  if (methodOf(a) !== methodOf(b)) return false;
  const normalize = (m: JsonRpcMessage) =>
    canonical(
      normalizeTimestamps(dropMonotonicId(stripVolatile(paramsOf(m)))),
    );
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export interface MatchResult {
  idx: number;
  strategy: MatchStrategy;
}

export function findMatch(
  request: JsonRpcMessage,
  pairs: ReplayPair[],
): MatchResult | null {
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p && exactMatch(request, p.request)) {
      return { idx: i, strategy: "exact" };
    }
  }
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p && normalizedMatch(request, p.request)) {
      return { idx: i, strategy: "normalized" };
    }
  }
  // Tier 3: fuzzy — drop monotonic ids and normalise timestamps.
  // TODO: remove the cast once MatchStrategy includes "fuzzy" in types.ts.
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p && fuzzyMatch(request, p.request)) {
      return { idx: i, strategy: "fuzzy" as unknown as MatchStrategy };
    }
  }
  return null;
}
