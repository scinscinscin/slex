import { describe, expect, it, vi } from "vitest";
import { Slex } from "../src/index";
import { RuleSpec, TokenType, lexemes, makeEngine } from "./helpers/makeEngine";

const words: RuleSpec[] = [["word", "[a-z]+"]];

describe("token iteration", () => {
  it("emits an EOF token at the end of the input", () => {
    const tokens = makeEngine(words).tokenize("a b");

    expect(tokens.map((token) => token.lexeme)).toEqual(["a", "b", ""]);
    expect(tokens.at(-1)!.type).toBe(1);
  });

  it("can be iterated with a for of loop", () => {
    const found: string[] = [];

    for (const token of makeEngine(words).generate("a b", () => ({}))) found.push(token.lexeme);

    expect(found).toEqual(["a", "b", ""]);
  });

  it("reports when there is nothing left", () => {
    const lexer = makeEngine(words).generate("a", () => ({}));

    // The EOF token still has to be produced before scanning is over.
    expect(lexer.hasNextToken()).toBe(true);
    lexer.getNextToken();
    expect(lexer.hasNextToken()).toBe(true);
    lexer.getNextToken();
    expect(lexer.hasNextToken()).toBe(false);
  });

  it("throws from the iterator when scanning fails", () => {
    const lexer = makeEngine(words).generate("1", () => ({}));

    expect(() => [...lexer]).toThrow(/Unexpected character/);
  });

  it("does not advance after the end of the input", () => {
    const lexer = makeEngine(words).generate("a", () => ({}));

    lexer.getNextToken();
    lexer.getNextToken();
    expect(lexer.hasNextToken()).toBe(false);
  });
});

describe("peeking", () => {
  it("returns the next token without consuming it", () => {
    const lexer = makeEngine(words).generate("a b", () => ({}));
    const peeked = lexer.peekNextToken();

    expect(peeked.lexeme).toBe("a");
    expect(lexer.getNextToken().lexeme).toBe("a");
    expect(lexer.getNextToken().lexeme).toBe("b");
  });

  it("returns the same token when peeking twice", () => {
    const lexer = makeEngine(words).generate("a b", () => ({}));

    expect(lexer.peekNextToken()).toBe(lexer.peekNextToken());
  });

  it("reports failure without consuming anything", () => {
    const lexer = makeEngine(words).generate("1", () => ({}));
    const result = lexer.tryPeekNextToken();

    expect(result.success).toBe(false);
    expect(lexer.currentCharacterIndex).toBe(0);
  });

  it("peeks the EOF token", () => {
    const lexer = makeEngine(words).generate("", () => ({}));

    expect(lexer.peekNextToken().lexeme).toBe("");
  });
});

describe("whitespace", () => {
  it("skips whitespace between tokens", () => {
    expect(lexemes(words, "  a \n\t b  ")).toEqual(["a", "b", ""]);
  });

  it("skips custom whitespace", () => {
    const generator = makeEngine(
      [
        ["word", "[a-z]+"],
        ["tilde", "$~"],
      ],
      { whitespaceCharacters: ["~"] }
    );

    expect(generator.tokenize("a~b").map((token) => token.lexeme)).toEqual(["a", "b", ""]);
  });

  it("keeps line numbers correct while skipping whitespace", () => {
    const tokens = makeEngine(words).tokenize("\n\n   a\n  b");

    expect(tokens.map((token) => [token.lexeme, token.line, token.column])).toEqual([
      ["a", 3, 3],
      ["b", 4, 2],
      ["", 4, 3],
    ]);
  });
});

describe("ignored tokens", () => {
  enum Type {
    COMMENT,
    WORD,
    EOF_TYPE,
  }

  function makeCommentLexer(ignoreTokens: Type[]) {
    const generator = new Slex<Type, {}>({ EOF_TYPE: Type.EOF_TYPE, isHigherPrecedence: () => false, ignoreTokens });

    generator.addRule("comment", "\\/\\/([^\\n])*", Type.COMMENT);
    generator.addRule("word", "[a-z]+", Type.WORD);

    return generator;
  }

  it("scans them but never emits them", () => {
    const generator = makeCommentLexer([Type.COMMENT]);

    expect(generator.tokenize("a // hidden\nb").map((token) => token.lexeme)).toEqual(["a", "b", ""]);
  });

  it("emits them when they are not ignored", () => {
    const generator = makeCommentLexer([]);

    expect(generator.tokenize("a // hidden").map((token) => token.type)).toEqual([
      Type.WORD,
      Type.COMMENT,
      Type.EOF_TYPE,
    ]);
  });

  it("skips whitespace between ignored tokens", () => {
    const generator = new Slex<Type, {}>({
      EOF_TYPE: Type.EOF_TYPE,
      isHigherPrecedence: () => false,
      ignoreTokens: [Type.COMMENT],
    });

    generator.addRule("comment", "$#([^\\n])*", Type.COMMENT);
    generator.addRule("word", "[a-z]+", Type.WORD);

    expect(generator.tokenize("a # one\nb # two\nc").map((token) => token.lexeme)).toEqual(["a", "b", "c", ""]);
  });

  it("never ignores the EOF token", () => {
    const generator = makeCommentLexer([Type.COMMENT, Type.WORD, Type.EOF_TYPE]);

    expect(generator.tokenize("a // hidden\nb").map((token) => token.lexeme)).toEqual([""]);
  });

  it("registers ignored token types through addIgnoredRule", () => {
    const generator = new Slex<Type, {}>({ EOF_TYPE: Type.EOF_TYPE, isHigherPrecedence: () => false });

    generator.addIgnoredRule("comment", "\\#[^\\n]*", Type.COMMENT);
    generator.addRule("word", "[a-z]+", Type.WORD);

    expect(generator.tokenize("a # hidden\nb").map((token) => token.type)).toEqual([
      Type.WORD,
      Type.WORD,
      Type.EOF_TYPE,
    ]);
  });
});

describe("precedence", () => {
  it("breaks ties with isHigherPrecedence", () => {
    const build = (isHigherPrecedence: (options: { current: string; next: string }) => boolean) => {
      const generator = new Slex<string, {}>({ EOF_TYPE: "EOF", isHigherPrecedence });

      generator.addRule("keyword", "if", "KEYWORD");
      generator.addRule("identifier", "[a-z]+", "IDENTIFIER");

      return generator;
    };

    expect(build(() => false).tokenize("if")[0].type).toBe("KEYWORD");
    expect(build(({ current }) => current === "KEYWORD").tokenize("if")[0].type).toBe("IDENTIFIER");
  });

  it("prefers the longest match", () => {
    const rules: RuleSpec[] = [
      ["short", "if"],
      ["long", "ifdef"],
    ];

    expect(lexemes(rules, "ifdef if")).toEqual(["ifdef", "if", ""]);
  });
});

describe("transformers", () => {
  it("rewrites the lexeme before it is emitted", () => {
    const generator = makeEngine([]);
    generator.addRule("number", "[0-9]+", 1, (lexeme) => String(Number(lexeme)));

    expect(generator.tokenize("007 42").map((token) => token.lexeme)).toEqual(["7", "42", ""]);
  });

  it("keeps the original position", () => {
    const generator = makeEngine([]);
    generator.addRule("word", "[a-z]+", 1, (lexeme) => lexeme.toUpperCase());

    const token = generator.tokenize("a b")[1];
    expect(token.lexeme).toBe("B");
    expect(token.line).toBe(1);
    expect(token.column).toBe(2);
  });
});

describe("metadata", () => {
  it("receives the position of every token", () => {
    const tokens = makeEngine(words).tokenize("ab\ncd", (context) => context);

    expect(tokens.map((token) => token.metadata)).toEqual([
      { lexeme: "ab", line: 1, column: 0, offset: 0 },
      { lexeme: "cd", line: 2, column: 0, offset: 3 },
      { lexeme: "", line: 2, column: 2, offset: 5 },
    ]);
  });

  it("defaults to undefined when no generator is given", () => {
    expect(makeEngine(words).tokenize("a")[0].metadata).toBeUndefined();
  });

  it("is called once per token", () => {
    const generator = vi.fn(() => ({}));

    makeEngine(words).tokenize("a b c", generator);

    expect(generator).toHaveBeenCalledTimes(4);
  });
});

describe("error recovery", () => {
  it("skips a single character on 'skip'", () => {
    const generator = new Slex<string, {}>({
      EOF_TYPE: "EOF",
      isHigherPrecedence: () => false,
      onError: () => "skip",
    });

    generator.addRule("word", "[a-z]+", "WORD");

    expect(generator.tokenize("a@b#c").map((token) => token.lexeme)).toEqual(["a", "b", "c", ""]);
  });

  it("skips a number of characters", () => {
    const generator = new Slex<string, {}>({
      EOF_TYPE: "EOF",
      isHigherPrecedence: () => false,
      onError: () => 2,
    });

    generator.addRule("word", "[a-z]+", "WORD");

    expect(generator.tokenize("a12b").map((token) => token.lexeme)).toEqual(["a", "b", ""]);

    // The last jump can land past the end of the input.
    expect(generator.tokenize("a12345b").map((token) => token.lexeme)).toEqual(["a", ""]);
  });

  it("treats a non positive skip as no recovery", () => {
    const generator = new Slex<string, {}>({
      EOF_TYPE: "EOF",
      isHigherPrecedence: () => false,
      onError: () => 0,
    });

    generator.addRule("word", "[a-z]+", "WORD");

    expect(() => generator.tokenize("1a")).toThrow(/Unexpected character/);
  });

  it("receives the error and the engine", () => {
    const seen: string[] = [];
    const generator = new Slex<string, {}>({
      EOF_TYPE: "EOF",
      isHigherPrecedence: () => false,
      onError: ({ error, engine }) => {
        seen.push(error.character);
        expect(engine.hasNextToken()).toBe(true);
        return "skip";
      },
    });

    generator.addRule("word", "[a-z]+", "WORD");
    generator.tokenize("a#b");

    expect(seen).toEqual(["#"]);
  });

  it("collects every error with tryTokenize", () => {
    const { tokens, errors } = makeEngine(words).tryTokenize("a #1 b #2 c");

    expect(tokens.map((token) => token.lexeme)).toEqual(["a", "b", "c", ""]);
    expect(errors.map((error) => error.character)).toEqual(["#", "1", "#", "2"]);
  });

  it("stops when the handler returns stop", () => {
    const generator = new Slex<string, {}>({
      EOF_TYPE: "EOF",
      isHigherPrecedence: () => false,
      onError: () => "stop",
    });

    generator.addRule("word", "[a-z]+", "WORD");

    expect(() => generator.tokenize("a#b")).toThrow(/Unexpected character/);
  });
});

describe("rule set snapshots", () => {
  it("keeps working when rules are removed after generating", () => {
    const generator = makeEngine([["word", "[a-z]+"]]);
    const lexer = generator.generate("a", () => ({}));

    generator.removeRule("word");

    expect(lexer.getNextToken().lexeme).toBe("a");
  });

  it("does not see rules that were added after generating", () => {
    const generator = makeEngine([["word", "[a-z]+"]]);
    const lexer = generator.generate("a", () => ({}));

    generator.addRule("letter", "[a-z]", 1);

    expect(() => lexer.getNextToken()).not.toThrow();
    expect(lexer.environment.has("letter")).toBe(false);
  });
});
