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
