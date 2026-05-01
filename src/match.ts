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
  return null;
}
