# Contributing to mcprec

Thanks for considering a contribution. mcprec records and replays MCP
server traffic; tests are fully hermetic and need no real MCP server.

## Quickstart

```sh
git clone https://github.com/erphq/mcprec
cd mcprec
npm install
npm run lint
npm run build
npm test
```

All four commands must pass before opening a PR.

## Project shape

- `src/record.ts` - stdio record-mode wrapper around a real MCP server.
- `src/replay.ts` - stdio replay-mode server that answers from a
  recorded transcript.
- `src/record_http.ts` / `src/http.ts` - HTTP record + replay (JSON +
  SSE).
- `src/transport.ts` - shared frame parsing.
- `src/match.ts` - matcher tiers (exact, fuzzy, user-supplied).
- `test/` - vitest tests; transcripts under `test/fixtures/`.

## Pluggable matcher

The most useful extension point is the `UserMatcher` interface:

```ts
type UserMatcher = (request: McpRequest, recorded: RecordedRequest) => boolean;
```

Pass one to `replay()` or `replayHttp()` to encode protocol-specific
equivalence rules the built-in tiers don't know about. Tests should
cover both the user-matcher path and the fall-through to built-in
tiers.

## Testing without a real MCP server

mcprec's tests record fixture transcripts in
`test/fixtures/<feature>.jsonl` and replay against them. To exercise a
new MCP method, add a fixture transcript instead of spinning up a
real server. Helpers in `test/helpers.ts` make this a one-liner.

## Conventions

- TypeScript strict mode is on. Don't disable it.
- No em dashes in code, comments, or docs.
- Commit messages: `feat(record-http): ...` / `feat(replay): ...`
  / `fix(...)` / `docs(...)`.
- Keep PRs focused. One transport, one matcher tier, or one fix per PR.

## Releasing

Maintainers tag releases on the GitHub UI; `release.yml` publishes to
npm with provenance.
