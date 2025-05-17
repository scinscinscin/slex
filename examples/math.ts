import { Slex } from "../src/index.ts";

// prettier-ignore
enum TokenType {
  PLUS, MINUS, STAR, SLASH, NUMBER, EOF
}

type Metadata = {};

const lexerGenerator = new Slex<TokenType, Metadata>({
  EOF_TYPE: TokenType.EOF,
  isHigherPrecedence: ({ current, next }) => false,
});

lexerGenerator.addRule("plus", "$+", TokenType.PLUS);
lexerGenerator.addRule("minus", "$-", TokenType.MINUS);
lexerGenerator.addRule("star", "$*", TokenType.STAR);
lexerGenerator.addRule("forward_slash", "$/", TokenType.SLASH);
lexerGenerator.addRule("digit", "0|1|2|3|4|5|6|7|8|9");
lexerGenerator.addRule("float_number", "(${digit})+$.(${digit})+");
lexerGenerator.addRule("decimal_number", "(${digit})+");
lexerGenerator.addRule("number_literal", "${float_number}|${decimal_number}", TokenType.NUMBER);

const lexer = lexerGenerator.generate(`2.4 + 3.5 * 1 / 456.789`, () => ({}));

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
