import { describe, expect, it } from "vitest";
import { RuleSpec, lexemes, makeEngine, tryFirstToken } from "./helpers/makeEngine";

/** A rule for every letter, used as filler between more specific rules. */
const letters: RuleSpec = ["letters", "[a-z]+"];

describe("optional", () => {
  it("matches with and without the group", () => {
    expect(lexemes([["ab", "ab?"], letters], "ab a")).toEqual(["ab", "a", ""]);
  });

  it("works on literals", () => {
    expect(lexemes([["maybe_x", "a(x)?"], letters], "ax a")).toEqual(["ax", "a", ""]);
  });

  it("can be followed by another literal", () => {
    const rules: RuleSpec[] = [["optional_x", "x?b"]];

    expect(lexemes(rules, "xb")).toEqual(["xb", ""]);
    expect(lexemes(rules, "b")).toEqual(["b", ""]);
    expect(tryFirstToken(rules, "a").success).toBe(false);
  });

  it("can be stacked with other modifiers", () => {
    const rules: RuleSpec[] = [
      ["upper", "([a-z])^"],
      ["not_letter", "[^a-zA-Z]"],
    ];

    expect(lexemes(rules, "A")).toEqual(["A", ""]);
  });
});

describe("bounded repetition", () => {
  it("matches exactly n times", () => {
    expect(lexemes([["ab", "(ab){2}"]], "abab")).toEqual(["abab", ""]);
    expect(tryFirstToken([["ab", "(ab){2}"]], "ab").success).toBe(false);
  });

  it("matches between n and m times", () => {
    expect(lexemes([["x", "(a){2,4}"], letters], "a aa aaa aaaa")).toEqual(["a", "aa", "aaa", "aaaa", ""]);
  });

  it("matches at least n times", () => {
    expect(lexemes([["x", "(a){2,}"], letters], "a aa aaaa")).toEqual(["a", "aa", "aaaa", ""]);
  });

  it("treats a missing lower bound as zero", () => {
    expect(lexemes([["x", "(a){,3}b"], letters], "b ab aab aaab")).toEqual(["b", "ab", "aab", "aaab", ""]);
  });

  it("works without a group", () => {
    expect(lexemes([["x", "a{3}"], letters], "a aa aaa")).toEqual(["a", "aa", "aaa", ""]);
  });

  it("requires the lower bound to be reached", () => {
    expect(tryFirstToken([["x", "(a){2,3}"]], "a").success).toBe(false);
    expect(tryFirstToken([["x", "(a){2,3}"]], "aa").success).toBe(true);
  });

  it("gives characters back when the rest of the rule needs them", () => {
    // The inner repetition is greedy, but the closing "*/" only matches when the
    // repetition gives the final "/" back.
    const comment = "$/" + "$*" + "([^\\/]*)" + "$*" + "$/";

    expect(lexemes([["comment", comment]], "/*aaa*/")).toEqual(["/*aaa*/", ""]);
    expect(lexemes([["comment", comment], letters], "/*a*/ b")).toEqual(["/*a*/", "b", ""]);
  });
});

describe("stacked modifiers", () => {
  it("applies a quantifier to a case insensitive group", () => {
    const rules: RuleSpec[] = [
      ["word", "([a-z])^+"],
      ["not_letter", "[^a-zA-Z]"],
    ];

    expect(lexemes(rules, "aBc")).toEqual(["aBc", ""]);
  });

  it("applies case insensitivity to a variable reference", () => {
    const rules: RuleSpec[] = [
      ["letter", "[a-z]"],
      ["any_case", "${letter}^"],
    ];

    expect(lexemes(rules, "aB")).toEqual(["a", "B", ""]);
  });

  it("supports case insensitive rules through the addRule option", () => {
    const generator = makeEngine([]);
    generator.addRule("select", "select", 1, undefined, { caseInsensitive: true });
    generator.addRule("identifier", "[a-z]+", 1);

    expect(generator.tokenize("SELECT select selection").map((token) => token.lexeme)).toEqual([
      "SELECT",
      "select",
      "selection",
      "",
    ]);
  });

  it("applies several modifiers in sequence", () => {
    expect(lexemes([["pairs", "(ab)+?" + "b"], letters], "ababb")).toEqual(["ababb", ""]);
  });
});

describe("negation", () => {
  it("matches any single character except the one in the group", () => {
    expect(lexemes([["not_a", "(a)!"], letters], "b b a")).toEqual(["b", "b", "a", ""]);
  });

  it("keeps working inside repetitions", () => {
    // "not a" matches every character, so the repetition swallows the space too.
    expect(lexemes([["until_a", "((a)!)+"], letters], "bb ab")).toEqual(["bb ", "ab", ""]);
  });

  it("combines with case insensitivity", () => {
    // Case insensitivity applies before negation, so "A" still counts as "a".
    const rules: RuleSpec[] = [
      ["not_a_ci", "(a)^!"],
      ["a_ci", "(a)^"],
    ];

    expect(lexemes(rules, "bA")).toEqual(["b", "A", ""]);
  });

  it("warns when it is applied to more than a single character", () => {
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args[0] as string);

    try {
      makeEngine([["weird", "(ab)!"]]);
    } finally {
      console.warn = warn;
    }

    expect(warnings.join("\n")).toContain("does not match exactly one character");
  });
});

describe("alternation", () => {
  it("prefers the longest alternative", () => {
    expect(lexemes([["kw", "if|ifdef"], letters], "ifdef if")).toEqual(["ifdef", "if", ""]);
  });

  it("combines alternation with repetition", () => {
    expect(lexemes([["digits", "((1|2|3))+"]], "123321")).toEqual(["123321", ""]);
  });

  it("matches all alternatives", () => {
    expect(lexemes([["digit", "0|1|2"], letters], "012")).toEqual(["0", "1", "2", ""]);
  });
});

describe("ambiguous repetitions", () => {
  it("does not blow up on nested repetitions", () => {
    const input = "a".repeat(400);
    const rules: RuleSpec[] = [["word", "((a|a)*)a"]];

    expect(lexemes(rules, input)).toEqual([input, ""]);
  });

  it("matches ambiguous alternatives once", () => {
    expect(lexemes([["word", "((aa|a)+)"]], "aaaa")).toEqual(["aaaa", ""]);
  });
});

describe("ambiguous groups inside repetitions", () => {
  it("matches a group that can match several lengths per position", () => {
    const rules: RuleSpec[] = [["word", "(x((a*)|(a)))+"]];

    expect(lexemes(rules, "xaa x")).toEqual(["xaa", "x", ""]);
  });

  it("prefers the longest alternative of an ambiguous group", () => {
    const rules: RuleSpec[] = [["word", "(x((aa)|(a)))+"]];

    expect(lexemes(rules, "xaa")).toEqual(["xaa", ""]);
  });
});
