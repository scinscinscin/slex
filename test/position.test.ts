import { describe, expect, it } from "vitest";
import { ColumnAndRow, Slex } from "../src/index";
import { LineMap } from "../src/Position";
import { makeEngine } from "./helpers/makeEngine";

describe("LineMap", () => {
  it("starts at the beginning of the input", () => {
    expect(new LineMap("abc").positionAt(0)).toEqual({ line: 1, column: 0 });
  });

  it("counts columns from the start of the line", () => {
    const map = new LineMap("ab\ncdef");

    expect(map.positionAt(0)).toEqual({ line: 1, column: 0 });
    expect(map.positionAt(2)).toEqual({ line: 1, column: 2 });
    expect(map.positionAt(3)).toEqual({ line: 2, column: 0 });
    expect(map.positionAt(6)).toEqual({ line: 2, column: 3 });
  });

  it("treats CRLF as a single line break", () => {
    const map = new LineMap("ab\r\ncd");

    expect(map.positionAt(4)).toEqual({ line: 2, column: 0 });
    expect(map.positionAt(5)).toEqual({ line: 2, column: 1 });
  });

  it("treats a lone carriage return as a line break", () => {
    expect(new LineMap("ab\rcd").positionAt(3)).toEqual({ line: 2, column: 0 });
  });

  it("clamps out of range indexes", () => {
    const map = new LineMap("ab");

    expect(map.positionAt(-5)).toEqual({ line: 1, column: 0 });
    expect(map.positionAt(99)).toEqual({ line: 1, column: 2 });
  });

  it("handles empty input", () => {
    expect(new LineMap("").positionAt(0)).toEqual({ line: 1, column: 0 });
    expect(new LineMap("").lineCount).toBe(1);
  });

  it("counts the lines of the source", () => {
    expect(new LineMap("a\nb\nc").lineCount).toBe(3);
    expect(new LineMap("a\nb\n").lineCount).toBe(3);
  });
});

describe("ColumnAndRow", () => {
  it("keeps one based lines and zero based columns", () => {
    const position = ColumnAndRow.calculate(4, "ab\ncde");

    expect(position.getActualRow()).toBe(2);
    expect(position.getActualColumn()).toBe(1);
  });

  it("no longer throws for indexes past the end of the input", () => {
    expect(() => ColumnAndRow.calculate(99, "ab")).not.toThrow();
    expect(ColumnAndRow.calculate(99, "ab").getActualColumn()).toBe(2);
  });

  it("no longer throws for an empty input", () => {
    expect(ColumnAndRow.calculate(0, "").getActualRow()).toBe(1);
  });
});

describe("token positions", () => {
  const generator = () => {
    const lexer = makeEngine([
      ["word", "[a-z]+"],
      ["number", "[0-9]+"],
    ]);

    return lexer;
  };

  it("reports the line, column and offset of every token", () => {
    const tokens = generator().tokenize("ab\n12  c");

    // Line breaks are whitespace, so they are skipped between tokens.
    expect(tokens.map((token) => [token.lexeme, token.line, token.column, token.offset])).toEqual([
      ["ab", 1, 0, 0],
      ["12", 2, 0, 3],
      ["c", 2, 4, 7],
      ["", 2, 5, 8],
    ]);
  });

  it("reports positions inside CRLF input", () => {
    const tokens = generator().tokenize("ab\r\ncd");

    expect(tokens.map((token) => [token.lexeme, token.line, token.column])).toEqual([
      ["ab", 1, 0],
      ["cd", 2, 0],
      ["", 2, 2],
    ]);
  });

  it("keeps positions correct after a transformer changes the lexeme", () => {
    const lexer = new Slex<string, string>({ EOF_TYPE: "EOF", isHigherPrecedence: () => false });

    lexer.addRule("word", "[a-z]+", "WORD", (lexeme) => lexeme.toUpperCase());

    const token = lexer.tokenize("a\nbc")[1];

    expect(token.lexeme).toBe("BC");
    expect(token.line).toBe(2);
    expect(token.column).toBe(0);
  });

  it("positions every token of a multi line input", () => {
    const lines = 50;
    const lexer = makeEngine([["word", "[a-z]+"]]);

    // Every line is four characters wide, so each token starts five characters
    // after the previous one.
    const source = Array.from({ length: lines }, (_, i) => String.fromCharCode(97 + (i % 26)).repeat(4)).join("\n");

    const tokens = lexer.tokenize(source);

    tokens.slice(0, lines).forEach((token, index) => {
      expect(token.line).toBe(index + 1);
      expect(token.column).toBe(0);
      expect(token.offset).toBe(index * 5);
    });

    expect(tokens.at(-1)).toMatchObject({ lexeme: "", line: lines, column: 4, offset: source.length });
  });
});
