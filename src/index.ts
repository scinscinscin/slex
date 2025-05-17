import { ColumnAndRow } from "./ColumnAndRow";
import { RegexEngineParsingResult, RegexLexer, RegexNode, RegexParser, StringTransformer } from "./internal";
import { Token } from "./Token";
import { Character } from "./utils/Character";

export interface SlexOptions<TokenType> {
  EOF_TYPE: TokenType;
  isHigherPrecedence: (options: { current: TokenType; next: TokenType }) => boolean;
}

export class Slex<TokenType, Metadata> {
  public environment: Map<string, RegexNode<TokenType>> = new Map();
  isHigherPrecedence: (options: { current: TokenType; next: TokenType }) => boolean;
  EOF_TYPE: TokenType;

  constructor(opts: SlexOptions<TokenType>) {
    this.EOF_TYPE = opts.EOF_TYPE;
    this.isHigherPrecedence = opts.isHigherPrecedence;
  }

  public addRule(name: string, expression: string, emit?: TokenType, transformer?: StringTransformer) {
    // need to lex the expression
    const lexer = new RegexLexer(expression);
    const tokens = lexer.lex();

    const parser = new RegexParser<TokenType>(tokens);
    const root = parser.parse();

    if (emit !== undefined) root.setTokenType(emit);
    if (transformer !== undefined) root.setTransformer(transformer);
    this.environment.set(name, root);
  }

  public generate(input: string, metadataGenerator: () => Metadata): RegexEngine<TokenType, Metadata> {
    return new RegexEngine<TokenType, Metadata>(
      this.environment,
      metadataGenerator,
      this.EOF_TYPE,
      this.isHigherPrecedence,
      input
    );
  }
}

class RegexEngine<TokenType, Metadata> {
  environment: Map<string, RegexNode<TokenType>> = new Map();
  input: string;
  currentCharacterIndex: number = 0;
  startCharacterIndex: number = 0;

  metadataGenerator: () => Metadata;
  isHigherPrecedence: (options: { current: TokenType; next: TokenType }) => boolean;
  EOF_TYPE: TokenType;

  public constructor(
    environment: Map<string, RegexNode<TokenType>>,
    metadataGenerator: () => Metadata,
    EOF_TYPE: TokenType,
    isHigherPrecedence: (options: { current: TokenType; next: TokenType }) => boolean,
    input: string
  ) {
    this.environment = environment;
    this.input = input;
    this.metadataGenerator = metadataGenerator;
    this.EOF_TYPE = EOF_TYPE;
    this.isHigherPrecedence = isHigherPrecedence;
  }

  private peek(): string {
    return this.currentCharacterIndex >= this.input.length ? "\0" : this.input.charAt(this.currentCharacterIndex);
  }

  // returns the character stored in currentCharacterIndex + 1
  private peekNext(): string {
    return this.currentCharacterIndex + 1 >= this.input.length
      ? "\0"
      : this.input.charAt(this.currentCharacterIndex + 1);
  }

  // eats all the comments
  // need to loop due to the possibility of chained comments like this one
  private ignoreComment(): boolean {
    if (this.currentCharacterIndex < this.input.length - 2 && this.peek() === "/") {
      if (this.peekNext() === "/") {
        this.currentCharacterIndex += 2;

        while (this.hasNextToken() && this.peek() != "\0" && this.peek() != "\n") {
          this.currentCharacterIndex++;
        }
        return true;
      } else if (this.peekNext() === "*") {
        this.currentCharacterIndex += 2;

        while (this.peek() != "*" || this.peekNext() != "/") {
          if (this.currentCharacterIndex >= this.input.length - 2) {
            throw new Error("Error: Unterminated multiline comment");
          }

          this.currentCharacterIndex++;
        }
        this.match("*");
        this.match("/");
        return true;
      }
    }
    return false;
  }

  // Just a boolean check for the next character
  private match(c: string): boolean {
    if (this.peek() != c) return false;
    this.currentCharacterIndex++;
    return true;
  }

  // skips over every piece of whitespace
  private ignoreWhitespace() {
    while (this.currentCharacterIndex < this.input.length + 1 && Character.isWhitespace(this.peek())) {
      this.currentCharacterIndex++;
    }
  }

  public peekNextToken() {
    while (true) {
      const save = this.currentCharacterIndex;
      const token = this.getNextToken();

      this.currentCharacterIndex = save;
      return token;
    }
  }

  public getNextToken() {
    do {
      this.ignoreWhitespace();
    } while (this.ignoreComment());

    this.startCharacterIndex = this.currentCharacterIndex;

    if (this.hasNextToken() === false)
      return new Token(
        this.EOF_TYPE,
        "",
        ColumnAndRow.calculate(this.startCharacterIndex, this.input),
        this.metadataGenerator()
      );

    let ret = new RegexEngineParsingResult(false, "", null);
    let retNode: RegexNode<TokenType> | null = null;

    for (const [ruleName, attemptNode] of this.environment.entries()) {
      if (attemptNode.getTokenType() === null) continue;

      const matches: string[] = attemptNode.getMatches(
        this.input.substring(this.currentCharacterIndex),
        this.environment
      );

      if (matches.length > 0) {
        let longest = "";

        for (const match of matches) if (match.length > longest.length) longest = match;
        if (
          !ret.success ||
          ret.lexeme.length < longest.length ||
          (ret.lexeme.length === longest.length &&
            retNode != null &&
            this.isHigherPrecedence({ current: retNode.getTokenType()!, next: attemptNode.getTokenType()! }))
        ) {
          ret = new RegexEngineParsingResult(true, longest, ruleName);
          retNode = attemptNode;
        }
      }
    }

    if (retNode != null && retNode.getTokenType() != null) {
      this.currentCharacterIndex += ret.lexeme.length;

      const transformer = retNode.getTransformer();
      const lexeme = transformer != null ? transformer(ret.lexeme) : ret.lexeme;

      const returnedToken = new Token<TokenType, Metadata>(
        retNode.getTokenType()!,
        lexeme,
        ColumnAndRow.calculate(this.startCharacterIndex, this.input),
        this.metadataGenerator()
      );

      return returnedToken;
    }

    const nextChar = this.input.charAt(this.startCharacterIndex);
    const position = ColumnAndRow.calculate(this.startCharacterIndex, this.input);

    this.currentCharacterIndex++;
    throw new Error(
      "Error: Unexpected character '" +
        nextChar +
        "' at Line: " +
        position.getActualRow() +
        ", Column: " +
        position.getActualColumn()
    );
  }

  public hasNextToken(): boolean {
    return this.currentCharacterIndex < this.input.length;
  }
}
