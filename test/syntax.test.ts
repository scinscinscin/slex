import { describe, expect, it } from "vitest";
import { lex, RuleSpec, tryFirstToken } from "./helpers/makeEngine";

describe("regex syntax: literal", () => {
  it("matches single character literals", () => {
    expect(lex([["dollar", "a$$b"]], `a$b`)).toEqual(["MATCH", "EOF"]);
  });

  it("matches non-alphanumeric characters escaped with $", () => {
    expect(lex([["tab", "c$\td"]], "c\td")).toEqual(["MATCH", "EOF"]);
  });
});

describe("regex syntax: concatenation", () => {
  it("concatenates multiple rules together", () => {
    expect(lex([["concat", "xy"]], `xy xy`)).toEqual(["MATCH", "MATCH", "EOF"]);
  });
});

describe("regex syntax: either", () => {
  it("matches any of the alternatives", () => {
    expect(lex([["either", "p|q"]], `p q p`)).toEqual(["MATCH", "MATCH", "MATCH", "EOF"]);
  });
});

describe("regex syntax: kleene star", () => {
  it("matches zero or more occurrences of the group", () => {
    expect(lex([["star", "w(${__letter})*"]], `w wxyz`)).toEqual(["MATCH", "MATCH", "EOF"]);
  });
});

describe("regex syntax: kleene plus", () => {
  it("matches one or more occurrences of the group", () => {
    expect(lex([["plus", "z(${__letter})+"]], `zq zz`)).toEqual(["MATCH", "MATCH", "EOF"]);
  });

  it("does not match when the group appears zero times", () => {
    expect(tryFirstToken([["plus", "z(${__letter})+"]], `z`).success).toBe(false);
  });
});

describe("regex syntax: negation", () => {
  const rules: RuleSpec[] = [["neg", "m($,)!ated"]];

  it("matches any single character except the negated one", () => {
    expect(lex(rules, `maated`)).toEqual(["MATCH", "EOF"]);
  });

  it("does not match when the negated character doesn't appear", () => {
    expect(tryFirstToken(rules, `mated`).success).toBe(false);
  });

  it("does not match when the negated character appears", () => {
    expect(tryFirstToken(rules, `m,ated`).success).toBe(false);
  });
});

describe("regex syntax: case insensitivity", () => {
  it("matches the group regardless of case", () => {
    expect(lex([["ci", "(((s)|e)^)*"]], `SE se Se sE`)).toEqual(["MATCH", "MATCH", "MATCH", "MATCH", "EOF"]);
  });
});

describe("regex syntax: grouping", () => {
  it("treats a group as a single rule", () => {
    expect(lex([["group", "((ab)|(ba))"]], `ab ba`)).toEqual(["MATCH", "MATCH", "EOF"]);
  });
});

describe("regex syntax: variable", () => {
  const rules: RuleSpec[] = [
    ["letter_pair", "(${__letter})(${__letter})", false],
    ["word", "(${letter_pair})(${letter_pair})"],
  ];

  it("references another regular definition", () => {
    expect(lex(rules, `abcd`)).toEqual(["MATCH", "EOF"]);
  });

  it("does not match input shorter than the referenced definitions", () => {
    expect(tryFirstToken(rules, `abc`).success).toBe(false);
  });
});
