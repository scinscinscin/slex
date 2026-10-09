import { CommonEngine, Slex, Token as SlexToken } from "../src/";
import { execute } from "./_common";

// prettier-ignore
export enum TokenType {
  IDENTIFIER, 
  
  PLUS, MINUS, STAR, SLASH, PERCENT, TILDE,
  PIPE, AMPERSAND, CARET, L_SHIFT, R_SHIFT, DOUBLE_PIPE,
  EQUALS, NOT_EQUALS, LESS_THAN, GREATER_THAN, LESS_THAN_OR_EQUALS, GREATER_THAN_OR_EQUALS,
  
  L_PAREN, R_PAREN, L_BRACKET, R_BRACKET, L_BRACE, R_BRACE,
  COMMA, SEMICOLON, DOT, COLON,
  
  NUMBER_LITERAL, STRING_LITERAL, TRUE, FALSE, NULL, UNKNOWN,
  
  SELECT, FROM, WHERE, AS,
  AND, OR, NOT, IS, LIKE, BETWEEN, EXISTS,

  EOF
}

export type TokenMetadata = {};
export type Token = SlexToken<TokenType, TokenMetadata>;

export const lexerGenerator = new Slex<TokenType, TokenMetadata>({
  EOF_TYPE: TokenType.EOF,
  isHigherPrecedence: ({ current, next }) => current === TokenType.IDENTIFIER,
});

lexerGenerator.addRule("plus", "$+", TokenType.PLUS);
lexerGenerator.addRule("minus", "$-", TokenType.MINUS);
lexerGenerator.addRule("star", "$*", TokenType.STAR);
lexerGenerator.addRule("forward_slash", "$/", TokenType.SLASH);
lexerGenerator.addRule("percent", "$%", TokenType.PERCENT);
lexerGenerator.addRule("tilde", "$~", TokenType.TILDE);

lexerGenerator.addRule("pipe", "$|", TokenType.PIPE);
lexerGenerator.addRule("ampersand", "$&", TokenType.AMPERSAND);
lexerGenerator.addRule("caret", "$^", TokenType.CARET);
lexerGenerator.addRule("l_shift", "$<$<", TokenType.L_SHIFT);
lexerGenerator.addRule("r_shift", "$>$>", TokenType.R_SHIFT);
lexerGenerator.addRule("double_pipe", "$|$|", TokenType.DOUBLE_PIPE);

lexerGenerator.addRule("equals", "$=", TokenType.EQUALS);
lexerGenerator.addRule("not_equals", "$<$>", TokenType.NOT_EQUALS);
lexerGenerator.addRule("less_than", "$<", TokenType.LESS_THAN);
lexerGenerator.addRule("greater_than", "$>", TokenType.GREATER_THAN);
lexerGenerator.addRule("less_than_or_equals", "$<$=", TokenType.LESS_THAN_OR_EQUALS);
lexerGenerator.addRule("greater_than_or_equals", "$>$=", TokenType.GREATER_THAN_OR_EQUALS);

lexerGenerator.addRule("l_paren", "$(", TokenType.L_PAREN);
lexerGenerator.addRule("r_paren", "$)", TokenType.R_PAREN);
lexerGenerator.addRule("l_bracket", "$[", TokenType.L_BRACKET);
lexerGenerator.addRule("r_bracket", "$]", TokenType.R_BRACKET);
lexerGenerator.addRule("l_brace", "${", TokenType.L_BRACE);
lexerGenerator.addRule("r_brace", "$}", TokenType.R_BRACE);
lexerGenerator.addRule("comma", "$,", TokenType.COMMA);
lexerGenerator.addRule("semicolon", "$;", TokenType.SEMICOLON);
lexerGenerator.addRule("dot", "$.", TokenType.DOT);
lexerGenerator.addRule("colon", "$:", TokenType.COLON);

lexerGenerator.addRule("lowercase", "a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z");
lexerGenerator.addRule("uppercase", "A|B|C|D|E|F|G|H|I|J|K|L|M|N|O|P|Q|R|S|T|U|V|W|X|Y|Z");
lexerGenerator.addRule("letter", "${lowercase}|${uppercase}");
lexerGenerator.addRule(
  "symbols",
  "$ | $! | $@ | $# | $$ | $% | $^ | $& | $* | $( | $) | ${ | $[ | $} | $] | $; | $: | $< | $, | $. | $> | $? | $/ | $` | $~ | $- | $_ | $+ | $= | $|"
);
lexerGenerator.addRule("escape_character", "$\\ | $\n | $\t | $\r | $\\$\" | $\\$'");
lexerGenerator.addRule("digit", "0|1|2|3|4|5|6|7|8|9");
lexerGenerator.addRule("character", "${letter}|${digit}|${symbols}|${escape_character}");
lexerGenerator.addRule("identifier", "((${letter}|$_)(${letter}|${digit}|$_)*)^", TokenType.IDENTIFIER);

lexerGenerator.addRule("float_number", "(${digit})+$.(${digit})+");
lexerGenerator.addRule("decimal_number", "(${digit})+");
lexerGenerator.addRule("number_literal", "${float_number}|${decimal_number}", TokenType.NUMBER_LITERAL);
lexerGenerator.addRule(
  "string_literal",
  "$\"(${character} | $')*$\" | $'(${character} | $\")*$'",
  TokenType.STRING_LITERAL,
  (str) => str.substring(1, str.length - 1).replaceAll("\\n", "\n")
);

lexerGenerator.addRule("true", "(true)^", TokenType.TRUE);
lexerGenerator.addRule("false", "(false)^", TokenType.FALSE);
lexerGenerator.addRule("null", "(null)^", TokenType.NULL);
lexerGenerator.addRule("unknown", "(unknown)^", TokenType.UNKNOWN);

lexerGenerator.addRule("select", "(select)^", TokenType.SELECT);
lexerGenerator.addRule("from", "(from)^", TokenType.FROM);
lexerGenerator.addRule("where", "(where)^", TokenType.WHERE);
lexerGenerator.addRule("as", "(as)^", TokenType.AS);
lexerGenerator.addRule("and", "(and)^", TokenType.AND);
lexerGenerator.addRule("or", "(or)^", TokenType.OR);
lexerGenerator.addRule("not", "(not)^", TokenType.NOT);
lexerGenerator.addRule("is", "(is)^", TokenType.IS);
lexerGenerator.addRule("like", "(like)^", TokenType.LIKE);
lexerGenerator.addRule("between", "(between)^", TokenType.BETWEEN);
lexerGenerator.addRule("exists", "(exists)^", TokenType.EXISTS);

const test = "SELECT * from users;";
const lexer = lexerGenerator.generate(test, () => ({}));
const compiledLexer = lexerGenerator.compile().generate(test, () => ({}));
execute<TokenType, TokenMetadata>(lexer, compiledLexer, TokenType);
