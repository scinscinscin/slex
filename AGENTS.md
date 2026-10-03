# AGENTS.md

TypeScript lexer generator library (`@scinorandex/slex`). Lexer rules are written in a small regex-like DSL that the library itself lexes, parses, and evaluates at runtime. No runtime dependencies.

## Commands

- `yarn build` — typecheck + compile `src/` to `dist/` (tsc via `tsconfig.build.json`). This is the main verification command.
- `yarn watch` — build in watch mode.
- Verify changes with `yarn build` plus running the examples.
- Run examples with `tsx` (not part of the build): `tsx examples/basic.ts`, `tsx examples/sql.ts`.

## Layout

- `src/index.ts` — public API only: `Slex` (rule generator), `RegexEngine` (scanner), `Token`, `ColumnAndRow`, `TokenResult`.
- `src/internal.ts` — DSL tokenization (`RegexLexer`), parsing (`RegexParser`), and matching node classes (`RegexNode` hierarchy). Internal despite living in `src/`.
- `src/utils/Character.ts` — Unicode character class checks.
- `examples/` — runnable demo lexers (LoL-flavored language, SQL keywords).
