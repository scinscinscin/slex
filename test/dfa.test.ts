import { describe, expect, it } from "vitest";
import { TokenType, RuleSpec, makeEngine, lex } from "./helpers/makeEngine";

function lexWithDFA(rules: RuleSpec[], input: string): string[] {
  const generator = makeEngine(rules);
  const compiled = generator.compile();
  const engine = compiled.generate(input, () => ({}));
  const names: string[] = [];

  while (engine.hasNextToken()) {
    const result = engine.tryGetNextToken();
    if (result.success) names.push(TokenType[result.token.type]);
    else names.push("ERROR");
  }
  return names;
}

function lexFull(rules: RuleSpec[], input: string) {
  const generator = makeEngine(rules);
  const treeEngine = generator.generate(input, () => ({}));
  const dfaEngine = generator.compile().generate(input, () => ({}));

  const treeTokens: { type: string; lexeme: string }[] = [];
  const dfaTokens: { type: string; lexeme: string }[] = [];

  while (treeEngine.hasNextToken()) {
    const result = treeEngine.tryGetNextToken();
    if (result.success) treeTokens.push({ type: TokenType[result.token.type], lexeme: result.token.lexeme });
    else treeTokens.push({ type: "ERROR", lexeme: result.reason });
  }

  while (dfaEngine.hasNextToken()) {
    const result = dfaEngine.tryGetNextToken();
    if (result.success) dfaTokens.push({ type: TokenType[result.token.type], lexeme: result.token.lexeme });
    else dfaTokens.push({ type: "ERROR", lexeme: result.reason });
  }

  return { treeTokens, dfaTokens };
}

describe("DFA differential tests", () => {
  it("matches simple literals", () => {
    const rules: RuleSpec[] = [
      ["a", "a"],
      ["b", "b"],
      ["c", "c"],
    ];
    expect(lexWithDFA(rules, "abc")).toEqual(lex(rules, "abc"));
  });

  it("matches concatenation", () => {
    const rules: RuleSpec[] = [
      ["hello", "hello"],
      ["world", "world"],
    ];
    expect(lexWithDFA(rules, "helloworld")).toEqual(lex(rules, "helloworld"));
  });

  it("matches alternation", () => {
    const rules: RuleSpec[] = [["cat_or_dog", "cat|dog"]];
    expect(lexWithDFA(rules, "catdog")).toEqual(lex(rules, "catdog"));
  });

  it("matches star quantifier", () => {
    const rules: RuleSpec[] = [
      ["a_star", "(a)*"],
      ["b", "b"],
    ];
    expect(lexWithDFA(rules, "aaab")).toEqual(lex(rules, "aaab"));
  });

  it("matches plus quantifier", () => {
    const rules: RuleSpec[] = [
      ["a_plus", "(a)+"],
      ["b", "b"],
    ];
    expect(lexWithDFA(rules, "aaab")).toEqual(lex(rules, "aaab"));
  });

  it("matches negation", () => {
    const rules: RuleSpec[] = [
      ["not_a", "($a)!"],
      ["a", "a"],
    ];
    expect(lexWithDFA(rules, "bbaa")).toEqual(lex(rules, "bbaa"));
  });

  it("matches case insensitive", () => {
    const rules: RuleSpec[] = [["hello_ci", "(hello)^"]];
    expect(lexWithDFA(rules, "HeLLo")).toEqual(lex(rules, "HeLLo"));
  });

  it("matches intrinsics", () => {
    const rules: RuleSpec[] = [
      ["digit", "${__decimal_digit}"],
      ["letter", "${__letter}"],
    ];
    expect(lexWithDFA(rules, "a1b2c3")).toEqual(lex(rules, "a1b2c3"));
  });

  it("matches variable references", () => {
    const rules: RuleSpec[] = [
      ["digit", "${__decimal_digit}", false],
      ["number", "(${__decimal_digit})+"],
    ];
    expect(lexWithDFA(rules, "123456")).toEqual(lex(rules, "123456"));
  });

  it("matches longest match", () => {
    const rules: RuleSpec[] = [
      ["a", "a"],
      ["aa", "aa"],
      ["aaa", "aaa"],
    ];
    expect(lexWithDFA(rules, "aaaaaa")).toEqual(lex(rules, "aaaaaa"));
  });

  it("matches with whitespace", () => {
    const rules: RuleSpec[] = [
      ["hello", "hello"],
      ["world", "world"],
    ];
    expect(lexWithDFA(rules, "hello world")).toEqual(lex(rules, "hello world"));
  });

  it("matches complex LoL-style lexer", () => {
    const rules: RuleSpec[] = [
      ["identifier", "(${__letter})((${__letter}|${__decimal_digit})*)"],
      ["number", "(${__decimal_digit})+"],
      ["plus", "$+"],
      ["minus", "$-"],
      ["star", "$*"],
      ["lparen", "$("],
      ["rparen", "$)"],
    ];
    const input = "let x hello + 42 (3 - 1)";
    expect(lexWithDFA(rules, input)).toEqual(lex(rules, input));
  });

  it("produces identical tokens including lexemes", () => {
    const rules: RuleSpec[] = [
      ["identifier", "(${__letter})((${__letter}|${__decimal_digit})*)"],
      ["number", "(${__decimal_digit})+"],
      ["plus", "$+"],
      ["minus", "$-"],
    ];
    const input = "abc123 + 456 - xyz";
    const { treeTokens, dfaTokens } = lexFull(rules, input);
    expect(dfaTokens).toEqual(treeTokens);
  });

  it("handles error cases identically", () => {
    const rules: RuleSpec[] = [
      ["a", "a"],
      ["b", "b"],
    ];
    const { treeTokens, dfaTokens } = lexFull(rules, "abc!");
    expect(dfaTokens).toEqual(treeTokens);
  });

  it("handles empty input", () => {
    const rules: RuleSpec[] = [["a", "a"]];
    expect(lexWithDFA(rules, "")).toEqual(lex(rules, ""));
  });

  it("matches nested groups", () => {
    const rules: RuleSpec[] = [["ab_or_cd", "((a)(b))|((c)(d))"]];
    expect(lexWithDFA(rules, "abcd")).toEqual(lex(rules, "abcd"));
  });

  it("matches star of alternation", () => {
    const rules: RuleSpec[] = [
      ["ab_star", "((a)|(b))*"],
      ["c", "c"],
    ];
    expect(lexWithDFA(rules, "ababc")).toEqual(lex(rules, "ababc"));
  });

  it("matches negation of intrinsic", () => {
    const rules: RuleSpec[] = [
      ["not_digit", "(${__decimal_digit})!"],
      ["digit", "${__decimal_digit}"],
    ];
    expect(lexWithDFA(rules, "a1b2c3")).toEqual(lex(rules, "a1b2c3"));
  });

  it("matches SQL-style lexer", () => {
    const rules: RuleSpec[] = [
      ["select", "(select)^"],
      ["from", "(from)^"],
      ["where", "(where)^"],
      ["identifier", "(${__letter})((${__letter}|${__decimal_digit})*)"],
      ["number", "(${__decimal_digit})+"],
      ["star", "$*"],
      ["comma", "$,"],
      ["lparen", "$("],
      ["rparen", "$)"],
    ];
    const input = "SELECT * FROM users WHERE id 1";
    expect(lexWithDFA(rules, input)).toEqual(lex(rules, input));
  });

  it("matches optional quantifier", () => {
    const rules: RuleSpec[] = [
      ["ab_optional", "(a)(b)?"],
      ["c", "c"],
    ];
    expect(lexWithDFA(rules, "abc")).toEqual(lex(rules, "abc"));
    expect(lexWithDFA(rules, "ac")).toEqual(lex(rules, "ac"));
  });

  it("matches optional of alternation", () => {
    const rules: RuleSpec[] = [
      ["x_or_y_optional", "((x)|(y))?"],
      ["z", "z"],
    ];
    expect(lexWithDFA(rules, "xz")).toEqual(lex(rules, "xz"));
    expect(lexWithDFA(rules, "yz")).toEqual(lex(rules, "yz"));
    expect(lexWithDFA(rules, "z")).toEqual(lex(rules, "z"));
  });

  it("matches character class range", () => {
    const rules: RuleSpec[] = [
      ["lower", "[a-z]"],
      ["upper", "[A-Z]"],
      ["digit", "[0-9]"],
    ];
    expect(lexWithDFA(rules, "aB1cD2")).toEqual(lex(rules, "aB1cD2"));
  });

  it("matches character class with mixed ranges", () => {
    const rules: RuleSpec[] = [["alnum", "[a-zA-Z0-9]"]];
    expect(lexWithDFA(rules, "abc123XYZ")).toEqual(lex(rules, "abc123XYZ"));
  });

  it("matches character class with singles", () => {
    const rules: RuleSpec[] = [
      ["special", "[abc]"],
      ["x", "x"],
    ];
    expect(lexWithDFA(rules, "abxc")).toEqual(lex(rules, "abxc"));
  });

  it("matches character class with quantifier", () => {
    const rules: RuleSpec[] = [
      ["lower_plus", "([a-z])+"],
      ["digit", "[0-9]"],
    ];
    expect(lexWithDFA(rules, "abc123def")).toEqual(lex(rules, "abc123def"));
  });

  it("matches word intrinsic", () => {
    const rules: RuleSpec[] = [["word", "(${__word})+"]];
    expect(lexWithDFA(rules, "hello_world123")).toEqual(lex(rules, "hello_world123"));
  });

  it("matches whitespace intrinsic", () => {
    const rules: RuleSpec[] = [
      ["ws", "(${__whitespace})+"],
      ["word", "(${__word})+"],
    ];
    expect(lexWithDFA(rules, "hello world")).toEqual(lex(rules, "hello world"));
  });

  it("compiled lexer is immutable - adding rules after compile has no effect", () => {
    const generator = makeEngine([["a", "a"]]);
    const compiled = generator.compile();
    generator.addRule("b", "b", TokenType.MATCH);

    const engine = compiled.generate("ab", () => ({}));
    const result = engine.tryGetNextToken();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.token.lexeme).toBe("a");
    }
  });
});
