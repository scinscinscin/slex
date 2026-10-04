import { describe, expect, it } from "vitest";
import { LexerError, RegexSyntaxError, Slex, SlexError } from "../src/index";
import { RuleSpec, makeEngine, tryFirstToken } from "./helpers/makeEngine";

describe("rule expression errors", () => {
  const invalid: [description: string, expression: string, expected: RegExp][] = [
    ["an empty expression", "", /the expression is empty/],
    ["a whitespace only expression", "   ", /the expression is empty/],
    ["a dangling dollar", "x$", /dangling '\$'/],
    ["an unterminated variable", "a${name", /unterminated variable reference/],
    ["an empty variable name", "a${}", /not a valid rule name/],
    ["an invalid variable name", "a${9lives}", /not a valid rule name/],
    ["an unbalanced group", "(ab", /unclosed '\(' group/],
    ["an unbalanced close", "ab)", /unexpected '\)'/],
    ["an empty group", "()", /empty groups are not allowed/],
    ["a leading pipe", "|ab", /expected an expression/],
    ["an unsupported character", "a#b", /unexpected character "#"/],
    ["an unknown escape", "a\\qb", /unknown escape sequence '\\q'/],
    ["a dangling backslash", "a\\", /dangling/],
    ["an inverted repetition", "(ab){3,1}", /repetition bounds are inverted/],
    ["an empty repetition", "(ab){}", /expected a repetition count/],
    ["an unclosed repetition", "(ab){2", /unclosed '\{' repetition/],
    ["an unclosed character class", "[a-z", /unclosed character class/],
    ["an empty character class", "[]", /empty character classes are not allowed/],
  ];

  for (const [description, expression, expected] of invalid) {
    it(`rejects ${description}`, () => {
      expect(() => makeEngine([["rule", expression]])).toThrow(expected);
    });
  }

  it("reports the rule name and the position inside the expression", () => {
    let thrown: unknown;

    try {
      makeEngine([["my_rule", "ab#"]]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RegexSyntaxError);

    const error = thrown as RegexSyntaxError;
    expect(error.name).toBe("RegexSyntaxError");
    expect(error.ruleName).toBe("my_rule");
    expect(error.index).toBe(2);
    expect(error.line).toBe(1);
    expect(error.column).toBe(2);
    expect(error.message).toContain("unexpected character");
  });

  it("points at the right line of a multi line expression", () => {
    let thrown: unknown;

    try {
      makeEngine([["multi", "abc\ndef#"]]);
    } catch (error) {
      thrown = error;
    }

    const error = thrown as RegexSyntaxError;
    expect(error.line).toBe(2);
    expect(error.column).toBe(3);
  });

  it("rejects invalid rule names", () => {
    expect(() => makeEngine([["1nvalid", "a"]])).toThrow(/not a valid rule name/);
    expect(() => makeEngine([["has space", "a"]])).toThrow(/not a valid rule name/);
  });
});

describe("scanning errors", () => {
  const rules: RuleSpec[] = [["letter", "(${__letter})+"]];

  it("keeps the historical failure message", () => {
    const result = tryFirstToken(rules, "1");

    expect(result.success).toBe(false);
    expect(result.success === false && result.reason).toBe("Unexpected character '1' at Line: 1, Column: 0");
    expect(result.success === false && result.line).toBe(1);
    expect(result.success === false && result.column).toBe(0);
  });

  it("exposes structured information about the failure", () => {
    const lexer = makeEngine(rules).generate("ab\ncd 1", () => ({}));

    lexer.getNextToken();
    lexer.getNextToken();
    const result = lexer.tryGetNextToken();

    expect(result.success).toBe(false);
    if (result.success) return;

    const error = result.error;
    expect(error).toBeInstanceOf(LexerError);
    expect(error.line).toBe(2);
    expect(error.column).toBe(3);
    expect(error.offset).toBe(6);
    expect(error.character).toBe("1");
    // The only rule matches letters, so nothing could have started here.
    expect(error.expected).toEqual([]);
    expect(error.snippet).toBe("cd 1\n   ^ (line 2)");
    expect(error.toContext().character).toBe("1");
  });

  it("lists every rule that could have started a token there", () => {
    const generator = new Slex<string, {}>({
      EOF_TYPE: "EOF",
      isHigherPrecedence: () => false,
    });

    generator.addRule("ab", "ab", "AB");
    generator.addRule("ac", "ac", "AC");
    generator.addRule("digit", "(${__decimal_digit})+", "DIGIT");

    const result = generator.generate("ax", () => ({})).tryGetNextToken();

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.expected).toEqual(["ab", "ac"]);
  });

  it("reports no expected rules when nothing can match the character", () => {
    const generator = new Slex<string, {}>({
      EOF_TYPE: "EOF",
      isHigherPrecedence: () => false,
    });

    generator.addRule("word", "(${__letter})+", "WORD");

    const result = generator.generate("!!", () => ({})).tryGetNextToken();

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.expected).toEqual([]);
  });

  it("throws a LexerError from getNextToken", () => {
    const lexer = makeEngine(rules).generate("1", () => ({}));

    expect(() => lexer.getNextToken()).toThrow(LexerError);
    expect(() => lexer.peekNextToken()).toThrow(LexerError);
  });

  it("does not advance past the character it could not scan", () => {
    const lexer = makeEngine(rules).generate("1", () => ({}));
    const before = lexer.currentCharacterIndex;

    lexer.tryGetNextToken();

    expect(lexer.currentCharacterIndex).toBe(before);
  });

  it("can skip characters to recover", () => {
    const lexer = makeEngine(rules).generate("a!b", () => ({}));
    const lexemes: string[] = [];

    while (lexer.hasNextToken()) {
      const result = lexer.tryGetNextToken();
      if (result.success) lexemes.push(result.token.lexeme);
      else lexer.skipCharacter(1);
    }

    expect(lexemes).toEqual(["a", "b", ""]);
  });
});

describe("strict mode", () => {
  it("throws for rule problems by default", () => {
    const generator = makeEngine([["broken", "${missing}"]]);

    expect(() => generator.generate("a")).toThrow(SlexError);
  });

  it("only warns when strict is disabled", () => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args[0]);

    try {
      const generator = makeEngine([["broken", "${missing}"]], { strict: false });
      expect(() => generator.generate("a")).not.toThrow();
    } finally {
      console.warn = warn;
    }

    expect(warnings.join("\n")).toContain('references unknown rule "missing"');
  });
});
