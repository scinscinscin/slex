import { Slex, TokenResult } from "../../src/index";

export enum TokenType {
  MATCH,
  EOF,
}

export type RuleSpec = [name: string, expr: string, emit?: boolean];

export function makeEngine(rules: RuleSpec[]) {
  const generator = new Slex<TokenType, {}>({
    EOF_TYPE: TokenType.EOF,
    isHigherPrecedence: () => false,
  });

  for (const [name, expr, emit] of rules) {
    if (emit === false) generator.addRule(name, expr);
    else generator.addRule(name, expr, TokenType.MATCH);
  }

  return generator;
}

export function lex(rules: RuleSpec[], input: string): string[] {
  const lexer = makeEngine(rules).generate(input, () => ({}));
  const names: string[] = [];
  while (lexer.hasNextToken()) {
    const token = lexer.getNextToken();
    names.push(TokenType[token.type]);
  }
  return names;
}

export function tryLex(rules: RuleSpec[], input: string): TokenResult<TokenType, {}>[] {
  const lexer = makeEngine(rules).generate(input, () => ({}));
  const names: TokenResult<TokenType, {}>[] = [];
  while (lexer.hasNextToken()) {
    const token = lexer.tryGetNextToken();
    names.push(token);
  }
  return names;
}

export function tryFirstToken(rules: RuleSpec[], input: string): TokenResult<TokenType, {}> {
  return makeEngine(rules)
    .generate(input, () => ({}))
    .tryGetNextToken();
}
