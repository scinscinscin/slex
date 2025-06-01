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
lexerGenerator.addRule("float_number", "(${__decimal_digit})+$.(${__decimal_digit})+");
lexerGenerator.addRule("decimal_number", "(${__decimal_digit})+");
lexerGenerator.addRule("number_literal", "${float_number}|${decimal_number}", TokenType.NUMBER);

const lexer = lexerGenerator.generate(`2.4 + 3.5 * 1 / 456.789`, () => ({}));

while (lexer.hasNextToken()) console.log(lexer.tryGetNextToken());
