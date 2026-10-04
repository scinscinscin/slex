import { Slex } from "../src/index";

// This example shows the parts of the syntax that keep rules short:
// character classes, repetition bounds, backslash escapes and the "." wildcard.
// String.raw keeps the expressions readable, since a backslash inside a regular
// expression would otherwise have to be escaped twice.

enum TokenType {
  L_CURLY_BRACE,
  R_CURLY_BRACE,
  L_BRACKET,
  R_BRACKET,
  COLON,
  COMMA,
  STRING_LITERAL,
  NUMBER_LITERAL,
  TRUE,
  FALSE,
  NULL,
  IDENTIFIER,
  EOF_TYPE,
}

const lexerGenerator = new Slex<TokenType, { sourcePath: string }>({
  EOF_TYPE: TokenType.EOF_TYPE,

  // Keywords only win when they match the whole word, which is what this
  // callback decides: the identifier loses to a keyword of the same length.
  isHigherPrecedence: ({ current }) => current === TokenType.IDENTIFIER,
});

lexerGenerator.addRule("l_curly_brace", String.raw`\{`, TokenType.L_CURLY_BRACE);
lexerGenerator.addRule("r_curly_brace", String.raw`\}`, TokenType.R_CURLY_BRACE);
lexerGenerator.addRule("l_bracket", String.raw`\[`, TokenType.L_BRACKET);
lexerGenerator.addRule("r_bracket", String.raw`\]`, TokenType.R_BRACKET);
lexerGenerator.addRule("colon", String.raw`\:`, TokenType.COLON);
lexerGenerator.addRule("comma", ",", TokenType.COMMA);

lexerGenerator.addRule(
  "string_literal",
  String.raw`\"([^\"\\]|\\.)*\"`,
  TokenType.STRING_LITERAL,
  (lexeme) => JSON.parse(lexeme) as string
);

lexerGenerator.addRule("sign", "[+-]");
lexerGenerator.addRule("integer", "[0-9]{1,10}");
lexerGenerator.addRule("fraction", String.raw`\.[0-9]+`);
lexerGenerator.addRule("exponent", "[eE][+-]?[0-9]+");
lexerGenerator.addRule(
  "number_literal",
  "${sign}?(${integer}${fraction}?${exponent}?)|${integer}",
  TokenType.NUMBER_LITERAL
);

// addKeyword writes a case insensitive rule, so both "TRUE" and "true" work.
lexerGenerator.addKeyword("true", "true", TokenType.TRUE);
lexerGenerator.addKeyword("false", "false", TokenType.FALSE);
lexerGenerator.addKeyword("null", "null", TokenType.NULL);

// Identifiers cannot start with a digit, and keywords lose against them.
lexerGenerator.addRule("identifier", "[A-Za-z_][A-Za-z0-9_]*", TokenType.IDENTIFIER);

const document = `{
  "name": "champion",
  "level": 12,
  "rating": 4.25,
  "offset": -1.5e3,
  "alive": TRUE,
  "retired": false,
  "note": null,
  "tags": ["support", "mid"],
  "skins": {
    "count": 3
  }
}`;

const lexer = lexerGenerator.generate(document, () => ({ sourcePath: "champion.json" }));
while (lexer.hasNextToken()) {
  const token = lexer.getNextToken();
  console.log(
    "Token: " +
      TokenType[token.type] +
      ". Lexeme: " +
      token.lexeme +
      ". Column: " +
      token.column +
      ". Line: " +
      token.line
  );
}
