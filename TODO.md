# v0.2 TODO

## Fuzzy matcher tier

- [ ] Add `"fuzzy"` to the `MatchStrategy` union type in `src/types.ts`
- [ ] Remove the `as unknown as MatchStrategy` cast in `findMatch` (src/match.ts)
- [ ] Refine `normalizeTimestamps` — decide whether to recurse into nested objects or only replace top-level ISO strings
- [ ] Refine `dropMonotonicId` — handle batched JSON-RPC envelope ids if needed
- [ ] Fill in the TODO tests in `test/match.fuzzy.test.ts`
- [ ] Verify the fuzzy tier does not cause false-positive matches in existing tests
