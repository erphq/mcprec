import type {
  JsonRpcMessage,
  JsonRpcRequest,
  MatchStrategy,
  ReplayPair,
  UserMatcher,
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

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_KEY = /^(id|requestId|traceId|spanId|correlationId|sessionId)$/i;

/**
 * Stronger normalization than `stripVolatile`:
 *   - drops the same volatile keys as `stripVolatile`
 *   - replaces ISO 8601 timestamp values with `<TIMESTAMP>`
 *   - replaces UUID values with `<UUID>`
 *   - replaces values under id-shaped keys with `<ID>` regardless of type
 *
 * This is the layer that lets `replay` survive monotonic counters,
 * generated UUIDs, and clock-derived values that vary per run.
 */
function fuzzifyDeep(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(fuzzifyDeep);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) {
      if (VOLATILE_KEYS.has(k)) continue;
      if (ID_KEY.test(k)) {
        out[k] = "<ID>";
        continue;
      }
      out[k] = fuzzifyDeep(val);
    }
    return out;
  }
  if (typeof v === "string") {
    if (ISO_TIMESTAMP.test(v)) return "<TIMESTAMP>";
    if (UUID.test(v)) return "<UUID>";
  }
  return v;
}

export function fuzzyMatch(a: JsonRpcMessage, b: JsonRpcMessage): boolean {
  if (methodOf(a) !== methodOf(b)) return false;
  return (
    JSON.stringify(canonical(fuzzifyDeep(paramsOf(a)))) ===
    JSON.stringify(canonical(fuzzifyDeep(paramsOf(b))))
  );
}

/**
 * Stable key for a request based on `method` + normalized `params`.
 * Two requests share a key iff `normalizedMatch` would consider them
 * equivalent. Used by `diffTranscripts` to align pairs across two
 * recordings.
 */
export function requestKey(m: JsonRpcMessage): string {
  return `${methodOf(m) ?? "<no-method>"}::${JSON.stringify(
    canonical(stripVolatile(paramsOf(m))),
  )}`;
}

/**
 * Stable key for a response, using the same volatile-stripping +
 * canonicalization used by `requestKey`. Produces the comparison
 * payload `diffTranscripts` checks for drift.
 */
export function responseKey(m: JsonRpcMessage): string {
  const r = m as { result?: unknown; error?: unknown };
  if ("error" in m && r.error !== undefined) {
    return `error::${JSON.stringify(canonical(stripVolatile(r.error)))}`;
  }
  return `result::${JSON.stringify(canonical(stripVolatile(r.result)))}`;
}

export interface MatchResult {
  idx: number;
  strategy: MatchStrategy;
}

export interface FindMatchOptions {
  /** Optional user-supplied matcher; consulted before built-in tiers. */
  userMatcher?: UserMatcher;
}

export function findMatch(
  request: JsonRpcMessage,
  pairs: ReplayPair[],
  opts: FindMatchOptions = {},
): MatchResult | null {
  if (opts.userMatcher) {
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      if (p && opts.userMatcher(request, p)) {
        return { idx: i, strategy: "user" };
      }
    }
  }
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
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p && fuzzyMatch(request, p.request)) {
      return { idx: i, strategy: "fuzzy" };
    }
  }
  return null;
}
