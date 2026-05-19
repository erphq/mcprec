/**
 * Key-name patterns applied automatically on every `record` run.
 * Covers the most common bearer tokens, API keys, and auth headers.
 * Users may supply additional patterns via `RecordOptions.redact`;
 * these defaults are always merged in.
 */
export const DEFAULT_REDACT_PATTERNS: string[] = [
  "authorization",
  "*_token",
  "*_key",
  "*_secret",
];

/**
 * Value-content patterns applied automatically on every `record` run.
 * Any string value (at any depth) whose content matches one of these
 * patterns is replaced with `<REDACTED>` regardless of key name.
 *
 * Covers JWT bearer tokens (header starts with `eyJ`) and PEM blocks.
 */
export const DEFAULT_REDACT_VALUE_PATTERNS: RegExp[] = [
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /-----BEGIN [A-Z0-9 ]+-----/,
];

/**
 * Replace values whose keys match any of the given patterns with
 * `<REDACTED>`. Patterns may use `*` as a wildcard; matching is
 * case-insensitive.
 *
 * Examples:
 *   redactDeep({authorization: "Bearer x"}, ["authorization"])
 *     → {authorization: "<REDACTED>"}
 *   redactDeep({github_token: "abc"}, ["*_token"])
 *     → {github_token: "<REDACTED>"}
 */
export function redactDeep(value: unknown, patterns: string[]): unknown {
  if (patterns.length === 0) return value;
  return walk(value, patterns.map(toRegex));
}

function walk(v: unknown, regexes: RegExp[]): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((x) => walk(x, regexes));
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) {
      if (regexes.some((r) => r.test(k))) {
        out[k] = "<REDACTED>";
      } else {
        out[k] = walk(val, regexes);
      }
    }
    return out;
  }
  return v;
}

function toRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWild = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${withWild}$`, "i");
}

/**
 * Replace any string value (at any depth) that matches one of the
 * given regexes with `<REDACTED>`. Key names are not inspected; only
 * the content of string values is tested.
 *
 * Combine with `redactDeep` to get both key-name and value-content
 * redaction: `redactValues(redactDeep(msg, keyPatterns), valuePatterns)`.
 */
export function redactValues(value: unknown, patterns: RegExp[]): unknown {
  if (patterns.length === 0) return value;
  return walkValues(value, patterns);
}

function walkValues(v: unknown, patterns: RegExp[]): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((x) => walkValues(x, patterns));
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) {
      out[k] = walkValues(val, patterns);
    }
    return out;
  }
  if (typeof v === "string" && patterns.some((r) => r.test(v))) {
    return "<REDACTED>";
  }
  return v;
}
