import { describe, expect, it } from "vitest";
import { Slex, SlexError } from "../src/index";
import { RegexLexer, RegexParser } from "../src/internal";
import { makeEngine } from "./helpers/makeEngine";

enum TokenType {
  MATCH,
  EOF,
}

describe("empty matching rules", () => {
  const nullable: [description: string, expression: string][] = [
    ["a rule that only repeats", "(${__letter})*"],
    ["an optional only rule", "(a)?"],
    ["a repetition that allows zero", "(a){0,3}"],
    ["a repetition without an upper bound starting at zero", "(a){,}"],
    ["an alternation with an empty branch", "(a|)"],
    ["an alternation with an empty branch", "((a)*)|b"],
    ["a nested repetition of an empty group", "((a)*)+"],
    ["an empty character class repetition", "([a])*"],
  ];

  for (const [description, expression] of nullable) {
    it(`rejects ${description}`, () => {
      expect(() => makeEngine([["rule", expression]])).toThrow(SlexError);
    });
  }

  it("rejects helper rules that can match empty too", () => {
    expect(() => makeEngine([["helper", "(a)*", false]])).toThrow(/can match the empty string/);
  });

  it("accepts rules that require at least one character", () => {
    expect(() =>
      makeEngine([
        ["letters", "(${__letter})+"],
        ["pair", "(${__letter})(${__letter})"],
        ["bounded", "a{2,4}"],
        ["clamped", "a{2,}"],
      ])
    ).not.toThrow();
  });

  it("never emits an empty token, even when an empty matching rule reaches the engine", () => {
    const warn = console.warn;
    console.warn = () => {};

    try {
      // strict: false lets the rule set through validation, which is the only
      // way to reach the engine with a rule that can match the empty string.
      const generator = makeEngine([], { strict: false });
      const parser = new RegexParser<TokenType>(new RegexLexer("(a)*").lex());
      const node = parser.parse();

      node.setTokenType(TokenType.MATCH);
      generator.environment.set("maybe", node);

      const lexer = generator.generate("aab", () => ({}));
      const lexemes: string[] = [];
      let guard = 0;

      while (lexer.hasNextToken() && guard++ < 10) {
        const result = lexer.tryGetNextToken();
        if (!result.success) break;
        lexemes.push(result.token.lexeme);
      }

      // "aa" is scanned, then the empty match at "b" is rejected instead of
      // looping forever.
      expect(lexemes).toEqual(["aa"]);
      expect(guard).toBeLessThan(10);
    } finally {
      console.warn = warn;
    }
  });
});

describe("unknown references", () => {
  it("rejects a reference to a rule that does not exist", () => {
    const generator = makeEngine([["rule", "${typo}"]]);

    expect(() => generator.generate("a")).toThrow(/references unknown rule "typo"/);
  });

  it("allows forward references", () => {
    const generator = makeEngine([
      ["uses_later", "${later}"],
      ["later", "a"],
    ]);

    expect(() => generator.generate("a")).not.toThrow();
  });
});

describe("reference cycles", () => {
  it("rejects a rule that references itself", () => {
    const generator = makeEngine([["recursive", "${recursive}"]]);

    expect(() => generator.generate("a")).toThrow(/reference cycle/);
  });

  it("rejects rules that reference each other", () => {
    const generator = makeEngine([
      ["first", "${second}"],
      ["second", "${first}"],
    ]);

    expect(() => generator.generate("a")).toThrow(/reference cycle: first -> second -> first/);
  });

  it("does not hang while validating a cycle", () => {
    const generator = makeEngine([
      ["a", "${b}"],
      ["b", "${c}"],
      ["c", "${a}"],
    ]);

    expect(() => generator.generate("a")).toThrow(SlexError);
  });
});

describe("duplicate rules", () => {
  it("rejects a second rule with the same name", () => {
    const generator = makeEngine([["word", "a"]]);

    expect(() => generator.addRule("word", "b")).toThrow(/already defined/);
  });

  it("allows overriding when the option is set", () => {
    const generator = makeEngine([["word", "a"]], { allowRuleOverride: true });

    expect(() => generator.addRule("word", "b", TokenType.MATCH)).not.toThrow();
    expect(generator.tokenize("b")[0].lexeme).toBe("b");
  });
});

describe("validate", () => {
  it("returns warnings without throwing", () => {
    const generator = makeEngine([["rule", "(ab)!"]]);
    const warnings = console.warn;
    console.warn = () => {};

    try {
      const issues = generator.validate();

      expect(issues).toHaveLength(1);
      expect(issues[0].level).toBe("warning");
      expect(issues[0].message).toContain("Negation only has an effect on single characters");
    } finally {
      console.warn = warnings;
    }
  });

  it("is memoized until a rule changes", () => {
    const generator = makeEngine([["rule", "a"]]);

    expect(generator.validate()).toEqual([]);

    generator.addRule("broken", "${typo}", TokenType.MATCH);
    expect(() => generator.validate()).toThrow(/references unknown rule "typo"/);
  });
});

describe("rule set management", () => {
  it("reports whether rules exist", () => {
    const generator = makeEngine([["word", "a"]]);

    expect(generator.hasRule("word")).toBe(true);
    expect(generator.hasRule("missing")).toBe(false);
    expect(generator.getRule("word")).toBeDefined();
    expect(generator.getRule("missing")).toBeUndefined();
  });

  it("removes rules", () => {
    const generator = makeEngine([["word", "a"]]);

    expect(generator.removeRule("word")).toBe(true);
    expect(generator.removeRule("word")).toBe(false);
  });

  it("describes every rule", () => {
    const generator = makeEngine([["word", "(ab)+"]]);

    expect(generator.describeRules()).toContain("word (emits): ab+");
  });

  it("clones without sharing the rule map", () => {
    const generator = makeEngine([["word", "a"]]);
    const copy = generator.clone();

    copy.addRule("other", "b");

    expect(generator.hasRule("other")).toBe(false);
    expect(copy.hasRule("word")).toBe(true);
  });

  it("snapshots the rules used by an engine", () => {
    const generator = makeEngine([["word", "a"]]);
    const lexer = generator.generate("a", () => ({}));

    generator.addRule("added_later", "b");

    expect(lexer.environment.has("added_later")).toBe(false);
  });
});

describe("helpers", () => {
  it("adds case insensitive keywords", () => {
    const generator = new Slex<string, {}>({
      EOF_TYPE: "EOF",
      isHigherPrecedence: ({ current }) => current === "IDENTIFIER",
    });

    generator.addKeyword("kw_select", "select", "SELECT");
    generator.addRule("identifier", "[a-zA-Z_][a-zA-Z0-9_]*", "IDENTIFIER");

    expect(generator.tokenize("SeLeCt selection").map((token) => token.type)).toEqual(["SELECT", "IDENTIFIER", "EOF"]);
  });

  it("escapes punctuation in keywords", () => {
    const generator = new Slex<string, {}>({ EOF_TYPE: "EOF", isHigherPrecedence: () => false });

    generator.addKeyword("end", "end;", "END");

    expect(generator.tokenize("end;").map((token) => token.lexeme)).toEqual(["end;", ""]);
  });

  it("rejects empty keywords", () => {
    const generator = new Slex<string, {}>({ EOF_TYPE: "EOF", isHigherPrecedence: () => false });

    expect(() => generator.addKeyword("empty", "", "EMPTY")).toThrow(/cannot be empty/);
  });

  it("adds rules whose tokens are never emitted", () => {
    const generator = new Slex<string, {}>({ EOF_TYPE: "EOF", isHigherPrecedence: () => false });

    generator.addIgnoredRule("comment", "\\/\\/([^\\n])*", "COMMENT");
    generator.addRule("word", "[a-z]+", "WORD");

    expect(generator.tokenize("a // hidden\nb").map((token) => token.lexeme)).toEqual(["a", "b", ""]);
  });
});

describe("describeRules", () => {
  it("renders every construct back into an expression", () => {
    const generator = makeEngine([
      ["literal", "ab"],
      ["class", "[a-z0-9_]"],
      ["negated", "[^ab]"],
      ["repeat", "(ab)+"],
      ["optional", "ab?"],
      ["bounded", "(a){2,4}"],
      ["any", "."],
      ["ci", "(abc)^"],
      ["negation", "(a)!"],
      ["reference", "${class}"],
    ]);

    const description = generator.describeRules();

    expect(description).toContain("class (emits): [a-z0-9_]");
    expect(description).toContain("negated (emits): [^ab]");
    expect(description).toContain("repeat (emits): ab+");
    expect(description).toContain("optional (emits): ab?");
    expect(description).toContain("bounded (emits): a{2,4}");
    expect(description).toContain("any (emits): .");
    expect(description).toContain("ci (emits): (abc)^");
    expect(description).toContain("negation (emits): (a)!");
    expect(description).toContain("reference (emits): ${class}");
  });
});
