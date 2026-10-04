## Slex - Scin's Lexing Library

Slex turns regular expressions into a lexer. You describe your tokens as rules, and Slex scans an input
string into tokens, with positions, transformers and hooks for error recovery.

- No runtime dependencies
- Rules are plain strings, parsed at runtime, so a grammar is easy to read and to generate
- Longest match wins, with an explicit precedence callback for ties
- Rule sets are validated before scanning, so typos fail loudly instead of silently matching nothing
- Character classes, repetition bounds, case insensitivity and backslash escapes

## Getting started

```bash
npm install @scinorandex/slex
```

Enumerate the token types your language has, including an `EOF` token:

```ts
enum TokenType {
  PLUS,
  MINUS,
  STAR,
  NUMBER,
  IDENTIFIER,
  EOF,
}
```

Then create a lexer generator and add rules:

```ts
import { Slex } from "@scinorandex/slex";

// Metadata can be anything you want to attach to every token, like a source path.
type Metadata = { sourcePath: string };

const lexerGenerator = new Slex<TokenType, Metadata>({
  EOF_TYPE: TokenType.EOF,

  // Used to break ties when two rules match the same lexeme. See "Precedence".
  isHigherPrecedence: ({ current, next }) => false,
});

lexerGenerator.addRule("plus", "$+", TokenType.PLUS);
lexerGenerator.addRule("minus", "$-", TokenType.MINUS);
lexerGenerator.addRule("star", "$*", TokenType.STAR);
lexerGenerator.addRule("float_number", "(${__decimal_digit})+$.(${__decimal_digit})+");
lexerGenerator.addRule("decimal_number", "(${__decimal_digit})+");
lexerGenerator.addRule("number", "${float_number}|${decimal_number}", TokenType.NUMBER);
lexerGenerator.addRule("identifier", "[A-Za-z_][A-Za-z0-9_]*", TokenType.IDENTIFIER);
```

Finally, start lexing:

```ts
const lexer = lexerGenerator.generate(`2.4 + factorial * 3`, () => ({ sourcePath: "example" }));

for (const token of lexer) {
  console.log(TokenType[token.type] + ": " + token.lexeme + " (line " + token.line + ", column " + token.column + ")");
}
```

**Output:**

```
NUMBER: 2.4 (line 1, column 0)
PLUS: + (line 1, column 4)
IDENTIFIER: factorial (line 1, column 6)
STAR: * (line 1, column 16)
NUMBER: 3 (line 1, column 18)
EOF:  (line 1, column 19)
```

## Regular expression syntax

|     Construct      |                                     Action                                      |   Example    |
| :----------------: | :-----------------------------------------------------------------------------: | :----------: |
|   Concatenation    |                      Matches one construct after another.                       |     `ab`     |
|       Either       |                        Matches any of the alternatives.                         |    `a\|b`    |
|     Repetition     |                        Matches the group at least once.                         |    `(a)+`    |
|    Kleene-star     |                      Matches the group zero or more times.                      |    `(a)*`    |
|      Optional      |                       Matches the group zero or one time.                       |     `a?`     |
| Bounded repetition | Matches the group between `min` and `max` times, for example `{2}` or `{2,4}`.  |  `(a){2,4}`  |
|      Grouping      | Groups constructs so they are treated as a single unit, and so they can repeat. |    `(ab)`    |
|        Any         |                   Matches any character except a line break.                    |     `.`      |
|  Character class   | Matches one character of the class, with ranges, negation and built-in classes. | `[^a-z0-9_]` |
| Case insensitivity |             Makes the preceding construct match regardless of case.             |    `abc^`    |
|      Negation      | Makes the preceding group match any character except the one the group matches. |    `(a)!`    |
|      Literal       |                           Matches a single character.                           |  `a`, `$_`   |
|      Variable      |                     Matches another rule of the same name.                      |  `${name}`   |

Modifiers can be stacked, and they bind to the construct right before them: `(abc)^?` makes the group
optional and case insensitive, `abc^` only makes `c` case insensitive. Prefer grouping when in doubt.

### Escaping

Alphabetic characters and digits are always literals, so `abc123` needs no escaping. Everything else has
to be escaped, either with `$` or with a backslash:

| Written as | Matches   | Notes                                               |
| :--------- | :-------- | :-------------------------------------------------- |
| `$+`       | `+`       | `$` escapes the character right after it            |
| `$$`       | `$`       |                                                     |
| `${`       | `{`       | Only works when the expression is exactly `${`      |
| `$\t`      | a tab     | `$` takes the next character literally              |
| `\+`       | `+`       | Backslash escapes work the same way                 |
| `\n`       | a newline | `\n`, `\t`, `\r`, `\f`, `\v` and `\0` are supported |
| `\{`       | `{`       | Any punctuation can be escaped with a backslash     |
| `\\`       | `\`       |                                                     |

Inside a character class the operator characters stand for themselves, so `[+*-]`, `[-a]` and `[]` behave
like they do in other regular expression dialects. A literal `]` still needs an escape: `[\]]`.

Two rules that used to be needed for comments can now be written much more directly:

```ts
// before
lexerGenerator.addRule("comment", "$/\\/((${__letter})*!)*");

// now
lexerGenerator.addIgnoredRule("line_comment", "//([^\\n])*", TokenType.COMMENT);
```

### Character classes

```ts
lexerGenerator.addRule("letter", "[a-zA-Z]");
lexerGenerator.addRule("digit_or_underscore", "[0-9_]");
lexerGenerator.addRule("not_a_digit", "[^0-9]");
lexerGenerator.addRule("anything_but_digits", "[^${__decimal_digit}]");
```

Ranges follow code point order, and they respect case insensitivity, so `[a-z]^` also matches `A`. Case
insensitive classes use the `^` modifier: `[a-zA-Z0-9]^`.

### Built-in character classes

These are available as variables inside every rule set:

- `__decimal_digit`, `__hex_digit`, `__octal_digit`, `__binary_digit`
- `__letter` (Unicode `L`), `__uppercase_letter` (`Lu`), `__lowercase_letter` (`Ll`)
- `__number` (Unicode `N`), `__mark` (Unicode `M`), `__separator` (Unicode `Z`)
- `__symbols` (Unicode `P` and `S`), `__punctuation` (Unicode `P`), `__control_character` (`Cc`)
- `__whitespace`, `__line_break`
- `__identifier_start`, `__identifier_part`
- `__any`, which matches any character at all

`__whitespace` follows the `whitespaceCharacters` option, so it only matches what the scanner skips.

### Keywords

`addKeyword` writes a case insensitive rule, which is usually what you want for reserved words:

```ts
lexerGenerator.addKeyword("select", "select", TokenType.SELECT);
lexerGenerator.addKeyword("end", "end;", TokenType.END); // punctuation is escaped for you
```

## Precedence

At every position Slex asks every rule that can match and keeps the **longest** lexeme. When two rules
match the same length, `isHigherPrecedence` decides which one wins:

```ts
const lexerGenerator = new Slex<TokenType, Metadata>({
  EOF_TYPE: TokenType.EOF,

  // "if" and the identifier rule both match "if". Return true when `next`
  // (the rule being considered) should replace `current` (the current winner).
  isHigherPrecedence: ({ current }) => current === TokenType.IDENTIFIER,
});
```

Rules are tried in the order they were added, so the callback only has to handle ties.

## Validation

Rule sets are checked when `generate()` is called, and rules are checked when they are added. Everything
below throws a `SlexError` (or a `RegexSyntaxError` for malformed expressions):

- expressions that are empty or syntactically invalid, with the position of the problem
- rules that can match the empty string, which would make the scanner emit empty tokens forever
- references to rules that do not exist
- reference cycles, which used to overflow the stack
- duplicate rule names, unless `allowRuleOverride` is set
- escapes that do not exist, dangling `$` and dangling `\`

`validate()` returns the problems it found instead of throwing, so a language server can report them:

```ts
for (const issue of lexerGenerator.validate()) {
  console.log(issue.level, issue.rule, issue.message);
}
```

Pass `strict: false` to downgrade errors to warnings and keep an old grammar working while you fix it.

## Errors and recovery

`tryGetNextToken()` returns a result object instead of throwing, and `getNextToken()` throws a
`LexerError` that carries the position, the character, a snippet and the rules that could have matched
there:

```ts
const result = lexer.tryGetNextToken();

if (!result.success) {
  result.error.line; // 3
  result.error.column; // 12
  result.error.offset; // 41
  result.error.character; // "@"
  result.error.expected; // ["identifier", "keyword"]
  console.log(result.error.snippet);
  //   foo = @bar
  //             ^ (line 3)
}
```

To keep going after a bad character, provide an `onError` handler:

```ts
const lexerGenerator = new Slex<TokenType, Metadata>({
  EOF_TYPE: TokenType.EOF,
  isHigherPrecedence: () => false,

  // "stop" reports the error, "skip" drops one character, a number drops that many.
  onError: ({ error, engine }) => (error.line === 1 ? "skip" : "stop"),
});
```

`tryTokenize()` collects every token and every error in one pass:

```ts
const { tokens, errors } = lexerGenerator.tryTokenize(source);
```

`RegexEngine#skipCharacter(count)` moves the scanner forward by hand, which is useful when a parser wants
to resynchronize on the next token.

## Ignoring tokens

Comments and other tokens that should be scanned but never emitted can be listed in `ignoreTokens`, or
registered with `addIgnoredRule`:

```ts
lexerGenerator.addIgnoredRule("comment", "//([^\\n])*", TokenType.COMMENT);
```

The `EOF` token is never ignored, so scanning always terminates.

## Performance

`yarn bench` runs a small benchmark. Comparing 0.0.4 with the current version on the same machine, best
of five rounds:

| Case                                 |     0.0.4 |   Current |   Change |
| ------------------------------------ | --------: | --------: | -------: |
| 3 rules, dense input                 | 2.53 MB/s | 2.03 MB/s |     -20% |
| 45 rules, source like input          | 0.33 MB/s | 1.19 MB/s | **3.6x** |
| 45 rules, single 50k character token | 3.21 MB/s | 3.16 MB/s |      -2% |

The point of the rewrite is the middle row: real grammars have dozens of rules, and most of them cannot
match the character at hand. What changed:

- Rules that cannot match the current character are skipped without being matched at all
- Repetitions whose group matches a fixed amount of characters per step are scanned with a plain loop
- Only ambiguous nodes are memoized, which keeps patterns such as `((a|a)*)a` from backtracking
  exponentially without slowing down simple ones
- Matching works on offsets and numbers instead of copying strings
- Line and column lookups use a precomputed line map instead of splitting the input per token
- `peekNextToken()` caches its result, so peeking twice does not scan twice

A lexer with only a handful of rules is slightly slower than before, because the old implementation
could lean on cheap string slicing while the new one maintains index bookkeeping.

## API reference

### `Slex<TokenType, Metadata>`

**Constructor**

`new Slex<TokenType, Metadata>(options)` creates a lexer generator. `SlexOptions` has these properties:

- `EOF_TYPE: TokenType` - the token type emitted at the end of the input
- `isHigherPrecedence: (options: { current: TokenType; next: TokenType }) => boolean` - tie breaker for
  rules that match the same lexeme, returns true when `next` should win
- `whitespaceCharacters?: string[]` - characters skipped between tokens, defaults to space, tab, newline
  and carriage return
- `ignoreTokens?: TokenType[]` - token types that are scanned but never emitted
- `strict?: boolean` - when `false`, validation problems are logged instead of thrown, defaults to `true`
- `allowRuleOverride?: boolean` - when `true`, `addRule` may replace an existing rule, defaults to `false`
- `onError?: (context: { error: LexerError; engine: RegexEngine }) => "stop" | "skip" | number` - called
  whenever scanning fails

**Methods**

- `addRule(name, expression, emit?, transformer?, options?): RegexNode` - adds a rule. `emit` is the
  token type to produce, `transformer` rewrites the matched lexeme, `options.caseInsensitive` matches the
  rule regardless of case
- `addKeyword(name, word, emit, options?): RegexNode` - adds a case insensitive rule for a keyword
- `addIgnoredRule(name, expression, emit, transformer?, options?): RegexNode` - adds a rule whose token
  type is never emitted
- `validate(): ValidationIssue[]` - returns every problem found in the rule set, throwing when there is
  an error level problem
- `describeRules(): string` - every rule and its pattern, for debugging
- `hasRule(name)`, `getRule(name)`, `removeRule(name)` - manage the rule set
- `clone(): Slex` - a copy that shares options but not the rule map
- `generate(input, metadataGenerator?): RegexEngine` - validates the rule set and returns an engine. The
  rule set is snapshotted, so later `addRule` calls do not affect engines that already exist
- `tokenize(input, metadataGenerator?): Token[]` - every token, throwing on the first error
- `tryTokenize(input, metadataGenerator?): { tokens, errors }` - every token, skipping what it cannot scan

### `RegexEngine<TokenType, Metadata>`

- `hasNextToken(): boolean` - false once the EOF token has been produced
- `getNextToken(): Token` - the next token, consuming it, throwing a `LexerError` on failure
- `tryGetNextToken(): TokenResult` - the next token, consuming it, reporting failure in the result
- `peekNextToken(): Token` - the next token without consuming it, throwing a `LexerError` on failure
- `tryPeekNextToken(): TokenResult` - the next token without consuming it
- `tokens(): Generator<Token>` / `[Symbol.iterator]()` - iterate over the remaining tokens
- `skipCharacter(count = 1): void` - move the scanner forward without emitting anything
- `errors: LexerError[]` - every error encountered so far

### `Token<Type, Metadata>`

`type`, `lexeme`, `line` (one based), `column` (zero based), `offset` (absolute character index) and
`metadata`.

### `TokenResult<TokenType, Metadata>`

```ts
export type TokenResult<TokenType, Metadata> =
  | { success: true; token: Token<TokenType, Metadata> }
  | { success: false; reason: string; line: number; column: number; error: LexerError };
```

### Errors

- `SlexError` - base class for everything Slex throws
- `RegexSyntaxError` - a malformed rule expression, with `expression`, `index`, `line`, `column` and
  `ruleName`
- `LexerError` - a position that could not be scanned, with `line`, `column`, `offset`, `character`,
  `expected`, `snippet` and `toContext()`

## Examples

- [examples/basic.ts](./examples/basic.ts) - a toy language: keywords, operators, comments and
  precedence between keywords and identifiers
- [examples/sql.ts](./examples/sql.ts) - SQL, showing case insensitive keywords
- [examples/json.ts](./examples/json.ts) - JSON, showing character classes, repetition bounds, backslash
  escapes and keyword helpers
