# AGENTS.md

TypeScript lexer generator library (`@scinorandex/slex`). Lexer rules are written in a small regex-like DSL that the library itself lexes, parses, and evaluates at runtime. No runtime dependencies.

## Commands

- `yarn build` — typecheck + compile `src/` to `dist/` (tsc via `tsconfig.build.json`).
- `yarn watch` — build in watch mode.
- `yarn tc` — typecheck only.
- `yarn test` — run the vitest suite (10 files, one per area). `yarn test:watch` for watch mode, `yarn coverage` for coverage.
- `yarn bench` — run `bench/lex.bench.ts`, a dependency free throughput benchmark.

Verify a change with `yarn tc && yarn test && yarn build`, plus the examples if you touched the DSL or the engine.

## Layout

- `src/index.ts` — public API: `Slex` (rule generator, rule set validation), `RegexEngine` (scanner, first character dispatch, error recovery), `TokenResult`, the option and error types.
- `src/internal.ts` — DSL tokenization (`RegexLexer`), parsing (`RegexParser`) and the matching node classes (`RegexNode` hierarchy, `MatchSession`, `Lengths`). Internal despite living in `src/`.
- `src/errors.ts` — `SlexError`, `RegexSyntaxError`, `LexerError`.
- `src/Position.ts` — `LineMap`, which resolves offsets to line and column pairs.
- `src/ColumnAndRow.ts`, `src/Token.ts` — public position and token types.
- `src/utils/Character.ts` — memoized Unicode character class checks.
- `test/` — vitest suites: `syntax`, `escapes`, `repetition`, `errors`, `validation`, `engine`, `position`, `performance`, plus the `basic` and `sql` example lexers.
- `bench/lex.bench.ts` — throughput benchmark.
- `examples/` — runnable demo lexers (LoL-flavored language, SQL, JSON).

## How matching works

- Rules are parsed once, when `addRule` is called, into a node tree.
- `generate()` validates the whole rule set, snapshots it, and compiles each emitting rule together
  with a filter for the characters it can start with. `scan()` skips rules whose filter rejects the
  current character.
- `MatchSession` matches on offsets and returns lengths, memoizing only the nodes that
  `isAmbiguous()` reports as able to match more than one length at a position. Repetitions whose group
  is `isDeterministic()` are scanned with a plain loop instead of the general search.
- `validate()` is what decides both flags, so it must run before an engine is created, and the flags
  have to be recomputed whenever the rule set changes.
