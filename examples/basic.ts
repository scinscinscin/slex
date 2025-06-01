import { Slex } from "../src/index.ts";

// prettier-ignore
enum TokenType {
    EOF,

    IMPORT,
    VARIABLE, CONSTANT,
    FUNCTION, OBJECT,

    RETURN,

    TRY, CATCH, THROW,
    IF, ELSE, ELIF,
    SWITCH, DEFAULT, CASE, SWITCH_BREAK, SWITCH_GOTO,

    FOR, OF, WHILE, LOOP_BREAK, LOOP_CONTINUE,
    IDENTIFIER,
    NUMBER_TYPE, BOOLEAN_TYPE, STRING_TYPE, VOID_TYPE,

    L_PAREN, R_PAREN, L_CURLY_BRACE, R_CURLY_BRACE, L_BRACE, R_BRACE,
    EQUALS, COMMA, MINUS_R_ANGLE_BAR, DOT, COLON, SEMICOLON,

    // LOGICAL AND BITWISE OPERATORS
    EXCLAMATION, DOUBLE_AMPERSAND, DOUBLE_PIPE, CARAT, AMPERSAND, PIPE,

    // RELATIONAL AND EQUALITY OPERATORS
    DOUBLE_EQUALS, EXCLAMATION_EQUALS, L_ANGLE_BAR, R_ANGLE_BAR, L_ANGLE_BAR_EQUALS, R_ANGLE_BAR_EQUALS,

    // SHIFTING OPERATORS
    DOUBLE_L_ANGLE_BAR, DOUBLE_R_ANGLE_BAR,

    // ARITHMETIC OPERATORS
    PLUS, MINUS, STAR, FORWARD_SLASH, PERCENT, DOUBLE_STAR,

    // INCREMENTATION OPERATOR
    DOUBLE_PLUS, DOUBLE_MINUS,

    STRING_LITERAL, NUMBER_LITERAL, BOOLEAN_LITERAL, NULL_LITERAL,

    SINGLE_LINE_COMMENT, MULTI_LINE_COMMENT
}

const lexerGenerator = new Slex<TokenType, { sourcePath: string }>({
  EOF_TYPE: TokenType.EOF,

  // The pattern for TokenType.IDENTIFIER matches keywords too. This line
  // specifies that keywords have higher precedence than identifiers.
  isHigherPrecedence: ({ current, next }) => current === TokenType.IDENTIFIER,

  // Specifies that SINGLE_LINE_COMMENT and MULTI_LINE_COMMENT tokens should be ignored.
  ignoreTokens: [TokenType.SINGLE_LINE_COMMENT, TokenType.MULTI_LINE_COMMENT],
});

// lex symbols
lexerGenerator.addRule("plus", "$+", TokenType.PLUS);
lexerGenerator.addRule("minus", "$-", TokenType.MINUS);
lexerGenerator.addRule("star", "$*", TokenType.STAR);
lexerGenerator.addRule("forward_slash", "$/", TokenType.FORWARD_SLASH);
lexerGenerator.addRule("percent", "$%", TokenType.PERCENT);
lexerGenerator.addRule("double_star", "$*$*", TokenType.DOUBLE_STAR);
lexerGenerator.addRule("double_plus", "$+$+", TokenType.DOUBLE_PLUS);
lexerGenerator.addRule("double_minus", "$-$-", TokenType.DOUBLE_MINUS);

lexerGenerator.addRule("double_l_angle_bar", "$>$>", TokenType.DOUBLE_L_ANGLE_BAR);
lexerGenerator.addRule("double_r_angle_bar", "$<$<", TokenType.DOUBLE_R_ANGLE_BAR);
lexerGenerator.addRule("pipe", "$|", TokenType.PIPE);
lexerGenerator.addRule("ampersand", "$&", TokenType.AMPERSAND);
lexerGenerator.addRule("carat", "$^", TokenType.CARAT);

lexerGenerator.addRule("l_angle_bar", "$<", TokenType.L_ANGLE_BAR);
lexerGenerator.addRule("l_angle_bar_equals", "$<$=", TokenType.L_ANGLE_BAR_EQUALS);
lexerGenerator.addRule("r_angle_bar", "$>", TokenType.R_ANGLE_BAR);
lexerGenerator.addRule("r_angle_bar_equals", "$>$=", TokenType.R_ANGLE_BAR_EQUALS);
lexerGenerator.addRule("exclamation_equals", "$!$=", TokenType.EXCLAMATION_EQUALS);
lexerGenerator.addRule("double_equals", "$=$=", TokenType.DOUBLE_EQUALS);

lexerGenerator.addRule("double_ampersand", "$&$&", TokenType.DOUBLE_AMPERSAND);
lexerGenerator.addRule("double_pipe", "$|$|", TokenType.DOUBLE_PIPE);
lexerGenerator.addRule("exclamation", "$!", TokenType.EXCLAMATION);

lexerGenerator.addRule("minus_r_angle_bar", "$-$>", TokenType.MINUS_R_ANGLE_BAR);
lexerGenerator.addRule("equals", "$=", TokenType.EQUALS);
lexerGenerator.addRule("comma", "$,", TokenType.COMMA);
lexerGenerator.addRule("dot", "$.", TokenType.DOT);
lexerGenerator.addRule("colon", "$:", TokenType.COLON);
lexerGenerator.addRule("semicolon", "$;", TokenType.SEMICOLON);

lexerGenerator.addRule("l_paren", "$(", TokenType.L_PAREN);
lexerGenerator.addRule("r_paren", "$)", TokenType.R_PAREN);
lexerGenerator.addRule("l_brace", "$[", TokenType.L_BRACE);
lexerGenerator.addRule("r_brace", "$]", TokenType.R_BRACE);
lexerGenerator.addRule("l_curly_brace", "${", TokenType.L_CURLY_BRACE);
lexerGenerator.addRule("r_curly_brace", "$}", TokenType.R_CURLY_BRACE);

lexerGenerator.addRule("character", "${__letter}|${__decimal_digit}|${__symbols}|${__control_character}");

lexerGenerator.addRule("float_number", "(${__decimal_digit})+$.(${di__decimal_digitgit})+");
lexerGenerator.addRule("decimal_number", "(${__decimal_digit})+");
lexerGenerator.addRule("octal_number", "0e(0|1|2|3|4|5|6|7)+");
lexerGenerator.addRule("hexadecimal_number", "0x(${__decimal_digit}|a|b|c|d|e|f|A|B|C|D|E|F)+");
lexerGenerator.addRule("binary_number", "0b(0|1)+");

// handle literal tokens
lexerGenerator.addRule(
  "string_literal",
  "$\"(${character} | $')*$\" | $'(${character} | $\")*$'",
  TokenType.STRING_LITERAL,
  (str) => str.substring(1, str.length - 1).replaceAll("\\n", "\n")
);
lexerGenerator.addRule(
  "number_literal",
  "${float_number}|${decimal_number}|${octal_number}|${binary_number}|${hexadecimal_number}",
  TokenType.NUMBER_LITERAL
);
lexerGenerator.addRule("boolean_literal", "faker|shaker", TokenType.BOOLEAN_LITERAL);
lexerGenerator.addRule("null_literal", "cooldown", TokenType.NULL_LITERAL);

// handle identifier and reserved words
lexerGenerator.addRule("item", "item", TokenType.VARIABLE);
lexerGenerator.addRule("rune", "rune", TokenType.CONSTANT);
lexerGenerator.addRule("skill", "skill", TokenType.FUNCTION);
lexerGenerator.addRule("steal", "steal", TokenType.IMPORT);
lexerGenerator.addRule("build", "build", TokenType.OBJECT);
lexerGenerator.addRule("canwin", "canwin", TokenType.IF);
lexerGenerator.addRule("remake", "remake", TokenType.ELIF);
lexerGenerator.addRule("lose", "lose", TokenType.ELSE);
lexerGenerator.addRule("channel", "channel", TokenType.SWITCH);
lexerGenerator.addRule("teleport", "teleport", TokenType.CASE);
lexerGenerator.addRule("recall", "recall", TokenType.DEFAULT);
lexerGenerator.addRule("flash", "flash", TokenType.SWITCH_GOTO);
lexerGenerator.addRule("cancel", "cancel", TokenType.SWITCH_BREAK);
lexerGenerator.addRule("wave", "wave", TokenType.WHILE);
lexerGenerator.addRule("cannon", "cannon", TokenType.FOR);
lexerGenerator.addRule("clear", "clear", TokenType.LOOP_BREAK);
lexerGenerator.addRule("next", "next", TokenType.LOOP_CONTINUE);
lexerGenerator.addRule("of", "of", TokenType.OF);
lexerGenerator.addRule("support", "support", TokenType.TRY);
lexerGenerator.addRule("carry", "carry", TokenType.CATCH);
lexerGenerator.addRule("feed", "feed", TokenType.THROW);
lexerGenerator.addRule("recast", "recast", TokenType.RETURN);

// handle type tokens
lexerGenerator.addRule("number_type", "stats", TokenType.NUMBER_TYPE);
lexerGenerator.addRule("boolean_type", "goat", TokenType.BOOLEAN_TYPE);
lexerGenerator.addRule("string_type", "message", TokenType.STRING_TYPE);
lexerGenerator.addRule("void_type", "passive", TokenType.VOID_TYPE);
lexerGenerator.addRule("identifier", "(${__letter}|$_)(${__letter}|${__decimal_digit}|$_)*", TokenType.IDENTIFIER);

// handle single and multi line comments
lexerGenerator.addRule("single_line_comment", "$/$/(($\n)!)*", TokenType.SINGLE_LINE_COMMENT);
lexerGenerator.addRule("multi_line_comment", "$/$*(($*)!|($*($/)!))*$*$/", TokenType.MULTI_LINE_COMMENT);

const stacktrace_example = `item factorial: skill (stats) -> stats = 
  skill (item n: stats): stats -> {
    canwin(n >= 2) recast n * factorial(n - 1);
    
    // only print the stack in the base case
    /**
     * This is an example multiline comment
     */
    dump_call_stack();
    recast 1;
  };

broadcast(factorial(5));
`;

const lexer = lexerGenerator.generate(stacktrace_example, () => ({ sourcePath: "stacktrace.example" }));

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
