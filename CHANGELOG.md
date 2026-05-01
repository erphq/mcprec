# Changelog

All notable changes to `mcprec` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-05-01

### Added
- Pluggable matcher API: `UserMatcher = (request, recorded) => boolean`.
  Consulted before the built-in tiers; first claim wins. Lets users
  encode protocol-specific equivalence rules the built-ins don't know
  about. New `MatchStrategy = "user"` arm.
- `release.yml` GitHub Actions workflow for npm publish on a GitHub
  Release.
- This `CHANGELOG.md`.

### Changed
- Bumped `vitest` to `^3` to clear a moderate dependabot alert
  (esbuild dev-server CVE through transitive deps). Tests pass on
  the new major.

## [0.4.2] - 2026-05-01

### Added
- HTTP record-mode proxy. `recordHttp({out, target, port, path, host,
  redact, fetch})` and `mcprec record-http --out f --target https://...`
  proxy a real MCP HTTP endpoint, capturing every JSON-RPC frame
  (JSON or SSE) into a JSONL transcript byte-compatible with stdio
  recording.
- SSE events are forwarded chunk-by-chunk to the client AND parsed
  into individual `←` frames in the transcript.
- Hop-by-hop headers (`host`, `connection`, `content-length`,
  `transfer-encoding`, `upgrade`, `keep-alive`) stripped on the way
  through.
- `redactDeep` wired into the capture path so secrets in headers /
  bodies don't leak.

## [0.4.1] - 2026-05-01

### Added
- SSE streaming for HTTP replay. `pairFramesStreamed()` collects all
  responses tied to a request (final + interleaved notifications).
  `replayHttp` auto-emits `text/event-stream` when the recorded pair
  has multiple frames.
- New `streaming: "auto" | "off"` option on `replayHttp`.
- `StreamedReplayPair` type exported.

## [0.4.0] - 2026-05-01

### Added
- HTTP transport replay. `replayHttp({file, port, host, path,
  userMatcher, onMismatch})` and `mcprec replay-http <file>` serve a
  recorded transcript over HTTP. Single JSON-RPC request → single
  JSON response.
- `/health` endpoint, 405 / 404 / -32700 / -32600 / -32603 error
  paths.

## [0.3.0] - 2026-05-01

### Added
- `mcprec diff <a> <b>` and `diffTranscripts(a, b)`: contract-drift
  detector. Surfaces methods that exist on only one side and
  `(method, params)` pairs whose responses diverge.
- `requestKey()` / `responseKey()` helpers exported.
- `text` + `json` output formats; non-zero exit on drift.

## [0.2.0] - 2026-04-30

### Added
- Fuzzy matcher tier for replay. Replaces ISO 8601 timestamp values
  with `<TIMESTAMP>`, UUIDs with `<UUID>`, and values under id-shaped
  keys (`id`, `requestId`, `traceId`, `spanId`, `correlationId`,
  `sessionId`) with `<ID>`. Lets replay survive monotonic counters
  and clock-derived values.
- `findMatch()` falls through `exact → normalized → fuzzy`.

## [0.1.0] - 2026-04-30

### Added
- Initial release. Stdio MCP record / replay / inspect.
- `mcprec record --out f -- <command...>`: spawn an MCP server,
  pipe stdio, capture every JSON-RPC frame as JSONL.
- `mcprec replay <file>`: serve a recorded transcript as a fake
  stdio MCP server. Layered exact → normalized matchers, patches
  the incoming id into the recorded response.
- `mcprec inspect <file>`: pretty-print a transcript timeline +
  per-method counts.
- `redactDeep`: wildcard key-pattern redaction for capture
  (`authorization`, `*_token`, etc.).
- 27 vitest tests, GitHub Actions CI.

[Unreleased]: https://github.com/erphq/mcprec/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/erphq/mcprec/releases/tag/v0.5.0
[0.4.2]: https://github.com/erphq/mcprec/releases/tag/v0.4.2
[0.4.1]: https://github.com/erphq/mcprec/releases/tag/v0.4.1
[0.4.0]: https://github.com/erphq/mcprec/releases/tag/v0.4.0
[0.3.0]: https://github.com/erphq/mcprec/releases/tag/v0.3.0
[0.2.0]: https://github.com/erphq/mcprec/releases/tag/v0.2.0
[0.1.0]: https://github.com/erphq/mcprec/releases/tag/v0.1.0
