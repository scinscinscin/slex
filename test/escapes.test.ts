import { describe, expect, it } from "vitest";
import { LexerError } from "../src/index";
import { RuleSpec, lexemes, makeEngine } from "./helpers/makeEngine";

/** Covers every letter of the alphabet so filler text can be scanned too. */
const word: RuleSpec = ["word", "[a-zA-Z]+"];

function firstLexeme(rules: RuleSpec[], input: string, whitespaceCharacters?: string[]): string | null {
  const lexer = makeEngine(rules, whitespaceCharacters === undefined ? {} : { whitespaceCharacters }).generate(
    input,
    () => ({})
  );

  const result = lexer.tryGetNextToken();
  return result.success ? result.token.lexeme : null;
}

describe("dollar escapes", () => {
  it("matches punctuation after a dollar", () => {
    expect(lexemes([word, ["op", "$+"]], "a+b")).toEqual(["a", "+", "b", ""]);
  });

  it("matches a dollar with a doubled dollar", () => {
    expect(lexemes([word, ["dollar", "$$"]], "a$b")).toEqual(["a", "$", "b", ""]);
  });

  it("matches a brace when the expression is exactly a dollar and a brace", () => {
    expect(lexemes([["brace", "${"]], "{")).toEqual(["{", ""]);
  });

  it("matches control characters", () => {
    expect(lexemes([word, ["tab", "$\t"]], "a\tb", { whitespaceCharacters: [] })).toEqual(["a", "\t", "b", ""]);
  });

  it("ignores whitespace inside expressions", () => {
    expect(lexemes([["pair", "a b"]], "ab")).toEqual(["ab", ""]);
  });
});

describe("backslash escapes", () => {
  // Whitespace is skipped before matching, so these rule sets turn it off.
  const noWhitespace = { whitespaceCharacters: [] };

  it("supports the usual control characters", () => {
    expect(lexemes([word, ["newline", "\\n"]], "a\nb", noWhitespace)).toEqual(["a", "\n", "b", ""]);
    expect(lexemes([word, ["tab", "\\t"]], "a\tb", noWhitespace)).toEqual(["a", "\t", "b", ""]);
    expect(lexemes([word, ["cr", "\\r"]], "a\rb", noWhitespace)).toEqual(["a", "\r", "b", ""]);
    expect(lexemes([word, ["null", "\\0"]], "a\0b", noWhitespace)).toEqual(["a", "\0", "b", ""]);
  });

  it("supports escaping punctuation", () => {
    expect(lexemes([["brace", "\\{"]], "{")).toEqual(["{", ""]);
    expect(lexemes([["brace", "\\}"]], "}")).toEqual(["}", ""]);
    expect(lexemes([["bracket", "\\["]], "[")).toEqual(["[", ""]);
    expect(lexemes([["pipe", "\\|"]], "|")).toEqual(["|", ""]);
    expect(lexemes([["backslash", "\\\\"]], "\\")).toEqual(["\\", ""]);
    expect(lexemes([["hash", "\\#"]], "#")).toEqual(["#", ""]);
  });

  it("mixes both escape syntaxes", () => {
    expect(lexemes([["mixed", "$+\\t"]], "+\t")).toEqual(["+\t", ""]);
  });
});

describe("bare characters", () => {
  it("treats underscores as literals", () => {
    expect(lexemes([word, ["underscore", "_"]], "a_b")).toEqual(["a", "_", "b", ""]);
  });

  it("treats non ascii letters as literals", () => {
    expect(lexemes([word, ["accent", "é"]], "aéb")).toEqual(["a", "é", "b", ""]);
  });

  it("treats digits as literals", () => {
    expect(lexemes([word, ["digit", "7"]], "a7")).toEqual(["a", "7", ""]);
  });
});

describe("character classes", () => {
  it("matches a single character of the class", () => {
    const rules: RuleSpec[] = [
      ["vowel", "[aeiou]"],
      ["consonant", "[^aeiou]"],
    ];

    expect(lexemes(rules, "aeioux")).toEqual(["a", "e", "i", "o", "u", "x", ""]);
  });

  it("matches ranges", () => {
    const rules: RuleSpec[] = [
      ["lower", "[a-z]"],
      ["not_lower", "[^a-z]"],
    ];

    expect(lexemes(rules, "abzA")).toEqual(["a", "b", "z", "A", ""]);
  });

  it("matches several ranges and characters", () => {
    const rules: RuleSpec[] = [
      ["mixed", "[a-f0-9_-]"],
      ["other", "[^a-f0-9_-]"],
    ];

    expect(lexemes(rules, "c5_")).toEqual(["c", "5", "_", ""]);
  });

  it("matches negated classes", () => {
    const rules: RuleSpec[] = [
      ["not_vowel", "[^aeiou]"],
      ["vowel", "[aeiou]"],
    ];

    expect(lexemes(rules, "xbz")).toEqual(["x", "b", "z", ""]);
  });

  it("matches a dash inside a class", () => {
    expect(lexemes([["dash", "[-a]"]], "-a")).toEqual(["-", "a", ""]);
  });

  it("accepts character classes inside a class", () => {
    expect(lexemes([["word", "[${__letter}${__decimal_digit}_]"]], "a1_")).toEqual(["a", "1", "_", ""]);
  });

  it("accepts a dot inside a class", () => {
    expect(lexemes([word, ["any", "[.]"]], "a.b")).toEqual(["a", ".", "b", ""]);
  });

  it("can be repeated", () => {
    expect(lexemes([["word", "[a-zA-Z_][a-zA-Z0-9_]*"]], "a_1 Bc")).toEqual(["a_1", "Bc", ""]);
  });

  it("is case insensitive with the caret modifier", () => {
    expect(lexemes([["either", "[ab]^"]], "ABab")).toEqual(["A", "B", "a", "b", ""]);
  });
});

describe("any character", () => {
  it("matches everything except line breaks", () => {
    expect(lexemes([["dot", "."]], "a b", { whitespaceCharacters: [] })).toEqual(["a", " ", "b", ""]);
  });

  it("does not match line breaks", () => {
    // Nothing else matches a newline here, so scanning has to fail.
    expect(() => lexemes([["dot", "."]], "a\nb", { whitespaceCharacters: [] })).toThrow(LexerError);
  });

  it("matches digits and punctuation", () => {
    expect(lexemes([["dot", "."]], "1$")).toEqual(["1", "$", ""]);
  });
});

describe("built in character classes", () => {
  const cases: [name: string, matching: string, notMatching: string][] = [
    ["__decimal_digit", "7", "a"],
    ["__hex_digit", "f", "g"],
    ["__octal_digit", "7", "8"],
    ["__binary_digit", "1", "2"],
    ["__letter", "z", "1"],
    ["__uppercase_letter", "Z", "z"],
    ["__lowercase_letter", "z", "Z"],
    ["__number", "٣", "a"],
    ["__mark", "́", "a"],
    ["__symbols", "+", "a"],
    ["__punctuation", ".", "a"],
    ["__separator", " ", "a"],
    ["__identifier_start", "_", "1"],
    ["__identifier_part", "1", "-"],
  ];

  for (const [name, matching, notMatching] of cases) {
    it(`${name} matches ${JSON.stringify(matching)} but not ${JSON.stringify(notMatching)}`, () => {
      expect(firstLexeme([["test", "${" + name + "}"]], matching)).toBe(matching);
      expect(firstLexeme([["test", "${" + name + "}"]], notMatching)).toBe(null);
    });
  }

  it("__control_character matches control characters", () => {
    // Whitespace is skipped before matching, so it has to be turned off here.
    expect(firstLexeme([["test", "${__control_character}"]], "\t", [])).toBe("\t");
    expect(firstLexeme([["test", "${__control_character}"]], "a", [])).toBe(null);
  });

  it("__line_break matches line breaks", () => {
    expect(firstLexeme([["test", "${__line_break}"]], "\n", [" "])).toBe("\n");
    expect(firstLexeme([["test", "${__line_break}"]], "a", [" "])).toBe(null);
  });

  it("__whitespace matches the configured whitespace characters", () => {
    // Whitespace is skipped before a token starts, so it can only be observed
    // once something else has already been matched.
    const rules: RuleSpec[] = [
      ["letter", "[ab]"],
      ["space", "x${__whitespace}"],
    ];

    expect(lexemes(rules, "ax\tb")).toEqual(["a", "x\t", "b", ""]);
  });

  it("__any matches any character", () => {
    expect(firstLexeme([["test", "${__any}"]], "a")).toBe("a");
    expect(firstLexeme([["test", "${__any}"]], "\n", [])).toBe("\n");
  });

  it("respects custom whitespace characters", () => {
    // "~" is whitespace for this lexer, so it is skipped and the scanner only
    // ever sees the end of the input.
    expect(firstLexeme([["test", "${__whitespace}"]], "~", ["~"])).toBe("");

    // The class follows the configured set, so it only matches "~" here.
    expect(firstLexeme([["test", "x${__whitespace}"]], "x~", ["~"])).toBe("x~");
    expect(firstLexeme([["test", "x${__whitespace}"]], "x ", ["~"])).toBe(null);
  });

  it("keeps character classes working when case insensitivity is applied", () => {
    const rules: RuleSpec[] = [
      ["upper", "(${__uppercase_letter})^"],
      ["lower", "(${__lowercase_letter})"],
    ];

    expect(lexemes(rules, "ABc")).toEqual(["A", "B", "c", ""]);

    const letters: RuleSpec[] = [
      ["letters", "(${__letter})^"],
      ["other", "[^a-zA-Z]"],
    ];
    expect(lexemes(letters, "aBc")).toEqual(["a", "B", "c", ""]);
  });
});
