import { describe, expect, it } from "vitest";
import { Slex } from "../src/index";

/**
 * These are not benchmarks, they only make sure that obvious performance traps
 * (a rule set that is re-parsed per token, quadratic position lookups, missing
 * first character dispatch) show up as a failing test.
 */

enum TokenType {
  KEYWORD,
  IDENTIFIER,
  NUMBER,
  WHITESPACE,
  EOF_TYPE,
}

function buildGrammar(): Slex<TokenType, {}> {
  const generator = new Slex<TokenType, {}>({
    EOF_TYPE: TokenType.EOF_TYPE,
    isHigherPrecedence: ({ current }) => current === TokenType.IDENTIFIER,
  });

  generator.addRule("letter", "${__letter}");
  generator.addRule("digit", "${__decimal_digit}");
  generator.addRule("underscore", "$_");

  // A realistic rule set has dozens of rules, most of which cannot match the
  // character at hand.
  for (let i = 0; i < 40; i++) generator.addRule(`keyword_${i}`, `keyword${i}`, TokenType.KEYWORD);

  generator.addRule("float", "(${__decimal_digit})+$.(${__decimal_digit})+", TokenType.NUMBER);
  generator.addRule("decimal", "(${__decimal_digit})+", TokenType.NUMBER);
  generator.addRule("identifier", "(${__letter}|$_)(${__letter}|${__decimal_digit}|$_)*", TokenType.IDENTIFIER);
  generator.addRule("space", "$ ", TokenType.WHITESPACE);

  return generator;
}

const generator = buildGrammar();
const source = Array.from({ length: 500 }, (_, i) => `keyword${i % 40} value_${i} 12.5 identifier${i}`).join("\n");

describe("performance", () => {
  it("scans a large input quickly", () => {
    const started = performance.now();
    const tokens = generator.tokenize(source);
    const elapsed = performance.now() - started;

    expect(tokens.length).toBeGreaterThan(2000);
    expect(tokens.at(-1)!.type).toBe(TokenType.EOF_TYPE);

    // A generous budget: this is about catching accidental slowdowns, not about
    // measuring anything. The benchmark in bench/lex.bench.ts is for that.
    expect(elapsed).toBeLessThan(2000);
  });

  it("scales roughly linearly with the size of the input", () => {
    const time = (text: string) => {
      const started = performance.now();
      generator.tokenize(text);
      return performance.now() - started;
    };

    // Warm the caches up first.
    time(source);
    time(source);

    const small = Array.from({ length: 100 }, (_, i) => `keyword${i % 40} value_${i}`).join("\n");
    const large = `${small}\n${small}\n${small}\n${small}`;

    const smallTime = time(small) + 1;
    const largeTime = time(large) + 1;

    // Four times the input should not cost anywhere near sixteen times the time.
    expect(largeTime / smallTime).toBeLessThan(10);
  });

  it("does not re-parse rules for every token", () => {
    const started = performance.now();

    for (let i = 0; i < 20; i++) generator.tokenize("keyword1 value_2 12.5 identifier3");

    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("handles very long single tokens", () => {
    const identifier = "a".repeat(50_000);
    const tokens = generator.tokenize(identifier);

    expect(tokens).toHaveLength(2);
    expect(tokens[0].lexeme).toBe(identifier);
  });

  it("scans long runs of digits and identifiers", () => {
    const digits = "1234567890".repeat(2000);
    const tokens = generator.tokenize(digits);

    expect(tokens[0].lexeme).toBe(digits);
    expect(tokens[0].type).toBe(TokenType.NUMBER);
  });
});
describe("first character dispatch", () => {
  it("still tries rules that start with an optional group", () => {
    // The optional sign makes the set of possible first characters unknown, so
    // the rule has to be tried even though the other branch starts with a digit.
    const lexer = new Slex<TokenType, {}>({ EOF_TYPE: TokenType.EOF_TYPE, isHigherPrecedence: () => false });

    lexer.addRule("sign", "[+-]");
    lexer.addRule("integer", "[0-9]{1,10}");
    lexer.addRule("fraction", "[.][0-9]+");
    lexer.addRule("number", "${sign}?(${integer}${fraction}?)|${integer}", TokenType.NUMBER);

    expect(lexer.tokenize("-1.5 12 +3").map((token) => token.lexeme)).toEqual(["-1.5", "12", "+3", ""]);
  });

  it("still tries rules whose first alternative starts with an empty group", () => {
    const lexer = new Slex<TokenType, {}>({ EOF_TYPE: TokenType.EOF_TYPE, isHigherPrecedence: () => false });

    lexer.addRule("sign", "[-+]");
    lexer.addRule("digit", "[0-9]");
    lexer.addRule("maybe_sign", "${sign}?${digit}", TokenType.NUMBER);

    expect(lexer.tokenize("-4 +5").map((token) => token.lexeme)).toEqual(["-4", "+5", ""]);
  });

  it("skips rules that cannot match the character", () => {
    const generator = buildGrammar();
    const engine = generator.generate("keyword1", () => ({}));

    // Only the keyword rule can match "k".
    expect(engine.getNextToken().lexeme).toBe("keyword1");
  });
});
