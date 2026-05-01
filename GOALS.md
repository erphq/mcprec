# Goals

## North star
Make MCP tool tests fast, deterministic, and free. Be to MCP what
VCR/cassette is to HTTP libraries.

## v0 success criteria
- Record + replay against `@modelcontextprotocol/server-github`
- Replay matches by `(method, params)`; mismatch errors out
- Transcript is newline-delimited JSON, hand-editable
- `npm i -g mcprec` single binary

## v1 success criteria
- Used in `erphq/neo` test suite
- Used in `erphq/enterprise-skills` MCP server tests
- HTTP/SSE transport supported
- Secret redaction on record

## Architecture decisions
- TypeScript, Node 20+. Stdio piping via `node:child_process`.
- Transcript is JSONL, not protobuf — diff-friendliness > size.
- Replay matcher is layered: exact → fuzzy → user-supplied.

## Non-goals
- Building yet another MCP server framework
- Recording non-MCP protocols
- Encrypted transcripts (use FS perms / git-crypt)

## Out of scope (for now)
- WebSocket transport
- GUI/TUI for inspecting transcripts
