import { CommonEngine, Token as SlexToken } from "../src";

export function execute<TokenType extends number, TokenMetadata>(
  lexer: CommonEngine<TokenType, TokenMetadata>,
  compiledLexer: CommonEngine<TokenType, TokenMetadata>,
  TokenType: { [key: number]: string }
) {
  type Token = SlexToken<TokenType, TokenMetadata>;
  function printToken(token: Token) {
    const tokenRepresentation = TokenType[token.type as unknown as number];
    console.log(`Token: ${tokenRepresentation}. Lexeme: ${token.lexeme}. Column: ${token.column}. Line: ${token.line}`);
  }

  function run(lexer: CommonEngine<TokenType, TokenMetadata>) {
    const ret = [] as Token[];
    while (lexer.hasNextToken()) {
      const t = lexer.getNextToken();
      printToken(t);
      ret.push(t);
    }
    return ret;
  }

  function time(lexer: CommonEngine<TokenType, TokenMetadata>) {
    console.log("=======================================================");
    const start = process.hrtime.bigint();
    const tokens = run(lexer);
    const end = process.hrtime.bigint();
    const diff = end - start;
    console.log(`Time taken: ${diff}ns`);
    return { tokens, diff };
  }

  function checkEquivalent(a: Token[], b: Token[]) {
    const diff = [] as { a: Token; b: Token }[];
    let equivalent = true;

    if (a.length !== b.length) equivalent = false;

    for (let i = 0; i < a.length; i++) {
      if (a[i].type !== b[i].type || a[i].lexeme !== b[i].lexeme) {
        diff.push({ a: a[i], b: b[i] });
        equivalent = false;
      }
    }

    return { equivalent, diff };
  }

  const regularLexerResults = time(lexer);
  const compiledLexerResults = time(compiledLexer);

  console.log("=======================================================");
  const check = checkEquivalent(regularLexerResults.tokens, compiledLexerResults.tokens);
  if (check.equivalent) console.log("Results are equivalent");
  else {
    console.log("Results are not equivalent");
    for (const { a, b } of check.diff) {
      printToken(a);
      printToken(b);
    }
  }

  const perfdiff = ((regularLexerResults.diff - compiledLexerResults.diff) * 100n) / regularLexerResults.diff;
  console.log(`Compiled has ${perfdiff}% improvement over regular lexer`);
}
