import { Character } from "./utils/Character";

export class RegexEngineParsingResult {
  success: boolean;
  lexeme: string;
  from: string | null;

  public constructor(success: boolean, lexeme: string, from: string | null) {
    this.success = success;
    this.lexeme = lexeme;
    this.from = from;
  }

  public toString(): string {
    return this.success ? "From: " + this.from + ". Lexeme: " + this.lexeme : "No token found";
  }
}

export type StringTransformer = (input: string) => string;

export abstract class RegexNode<TokenType> {
  private emit: TokenType | null = null;
  private transformer: StringTransformer | null = null;

  public getTokenType(): TokenType | null {
    return this.emit;
  }

  public setTokenType(emit: TokenType) {
    this.emit = emit;
  }

  public getTransformer(): StringTransformer | null {
    return this.transformer;
  }

  public setTransformer(transformer: StringTransformer) {
    this.transformer = transformer;
  }

  public abstract toString(): String;

  public abstract getMatches(restString: string, environment: Map<string, RegexNode<TokenType>>): Array<string>;
}

class RegexConcatenationNode<TokenType> extends RegexNode<TokenType> {
  nodes: RegexNode<TokenType>[];

  public constructor(nodes: RegexNode<TokenType>[]) {
    super();
    this.nodes = nodes;
  }

  public toString(): String {
    let ret = "";
    for (let i = 0; i < this.nodes.length; i++) {
      ret += this.nodes[i].toString();
    }
    return ret;
  }

  public getMatches(restString: string, environment: Map<string, RegexNode<TokenType>>): string[] {
    let caches: string[] = [""];

    for (const node of this.nodes) {
      let nextCaches: string[] = [];

      for (const cache of caches) {
        const rest = restString.replace(cache, "");
        const nextMatches = node.getMatches(rest, environment);
        nextCaches.push(...nextMatches.map((m) => cache + m));
      }

      caches = nextCaches;
    }

    return caches;
  }
}

class RegexEitherNode<TokenType> extends RegexNode<TokenType> {
  nodes: RegexNode<TokenType>[];

  public constructor(nodes: RegexNode<TokenType>[]) {
    super();
    this.nodes = nodes;
  }

  public toString(): String {
    let ret = "";
    for (let i = 0; i < this.nodes.length; i++) {
      ret += this.nodes[i].toString();
      if (i != this.nodes.length - 1) ret += "|";
    }
    return ret;
  }

  public getMatches(restString: string, environment: Map<string, RegexNode<TokenType>>): string[] {
    let matches: string[] = [];
    for (const node of this.nodes) matches.push(...node.getMatches(restString, environment));
    return matches;
  }
}

class RegexLiteralNode<TokenType> extends RegexNode<TokenType> {
  ch: string;

  public constructor(ch: string) {
    super();
    this.ch = ch;
  }

  public toString(): string {
    return "" + this.ch;
  }

  public getMatches(restString: string, environment: Map<string, RegexNode<TokenType>>): string[] {
    if (restString.length === 0) return [];

    const matches: string[] = [];
    const starting = restString.charAt(0);
    if (starting === this.ch) matches.push("" + starting);
    return matches;
  }
}

class RegexVariableNode<TokenType> extends RegexNode<TokenType> {
  variableName: string;

  public constructor(variableName: string) {
    super();
    this.variableName = variableName;
  }

  public toString(): string {
    return "<" + this.variableName + ">";
  }

  public getMatches(restString: string, environment: Map<string, RegexNode<TokenType>>): string[] {
    if (!environment.has(this.variableName)) return [];

    const rootNode = environment.get(this.variableName);
    return rootNode!.getMatches(restString, environment);
  }
}

enum RegexGroupingNodeModifiers {
  NONE,
  NONE_OR_MORE,
  ONE_OR_MORE,
}

class RegexGroupingNode<TokenType> extends RegexNode<TokenType> {
  internalNode: RegexNode<TokenType>;
  modifier: RegexGroupingNodeModifiers;

  public constructor(
    internalNode: RegexNode<TokenType>,
    modifier: RegexGroupingNodeModifiers = RegexGroupingNodeModifiers.NONE
  ) {
    super();
    this.internalNode = internalNode;
    this.modifier = modifier;
  }

  public toString(): String {
    return (
      "(" +
      this.internalNode.toString() +
      ")" +
      (this.modifier === RegexGroupingNodeModifiers.ONE_OR_MORE
        ? "+"
        : this.modifier === RegexGroupingNodeModifiers.NONE_OR_MORE
        ? "*"
        : "")
    );
  }

  public getMatches(restString: string, environment: Map<string, RegexNode<TokenType>>): string[] {
    const initialMatches: string[] = this.internalNode.getMatches(restString, environment);

    if (initialMatches.length === 0) {
      if (this.modifier === RegexGroupingNodeModifiers.NONE_OR_MORE) initialMatches.push("");
      return initialMatches;
    } else if (this.modifier === RegexGroupingNodeModifiers.NONE) return initialMatches;

    let matches = initialMatches;

    // handle matching for NONE_OR_MORE or ONE_OR_MORE
    while (true) {
      const nextMatches: string[] = [];

      for (const match of matches) {
        const rest: string = restString.replace(match, "");
        if (rest.length === 0) continue;

        const nextMatch = this.internalNode.getMatches(rest, environment);
        nextMatches.push(...nextMatch.map((m) => match + m));
      }

      if (nextMatches.length === 0) break;

      matches = nextMatches;
    }

    return matches;
  }
}

export class RegexParser<TokenType> {
  tokens: RegexToken[];
  currentTokenIndex = 0;

  public constructor(tokens: RegexToken[]) {
    this.tokens = tokens;
  }

  parse(): RegexNode<TokenType> {
    // parse starting from the top
    const first: RegexNode<TokenType> = this.parseConcatenation();
    const possibles: RegexNode<TokenType>[] = [first];

    while (
      this.currentTokenIndex < this.tokens.length &&
      this.tokens[this.currentTokenIndex].type === RegexTokenType.PIPE
    ) {
      this.currentTokenIndex++; // consume the PIPE token
      const nextNode = this.parseConcatenation();
      possibles.push(nextNode);
    }

    if (possibles.length > 1) return new RegexEitherNode(possibles);
    else return first;
  }

  parseConcatenation(): RegexNode<TokenType> {
    const first = this.parseTerminal();
    const nodes: RegexNode<TokenType>[] = [first];

    while (
      this.currentTokenIndex < this.tokens.length &&
      this.tokens[this.currentTokenIndex].type != RegexTokenType.PIPE &&
      this.tokens[this.currentTokenIndex].type != RegexTokenType.RPAREN
    ) {
      const nextNode = this.parseTerminal();
      nodes.push(nextNode);
    }

    if (nodes.length > 1) return new RegexConcatenationNode(nodes);
    else return first;
  }

  parseTerminal(): RegexNode<TokenType> {
    const currentToken = this.tokens[this.currentTokenIndex];

    switch (currentToken.type) {
      case RegexTokenType.LPAREN: {
        this.currentTokenIndex++; // CONSUME L_PAREN
        const internalNode: RegexNode<TokenType> = this.parse();

        this.expect(RegexTokenType.RPAREN); // next token should be R_PAREN

        let modifier = RegexGroupingNodeModifiers.NONE;
        if (this.tokens[this.currentTokenIndex].type === RegexTokenType.ASTERISK) {
          modifier = RegexGroupingNodeModifiers.NONE_OR_MORE;
          this.currentTokenIndex++;
        } else if (this.tokens[this.currentTokenIndex].type === RegexTokenType.PLUS) {
          modifier = RegexGroupingNodeModifiers.ONE_OR_MORE;
          this.currentTokenIndex++;
        }

        return new RegexGroupingNode(internalNode, modifier);
      }

      case RegexTokenType.LITERAL: {
        this.currentTokenIndex++;
        return new RegexLiteralNode(currentToken.value.charAt(0));
      }

      case RegexTokenType.VARIABLE: {
        this.currentTokenIndex++;
        return new RegexVariableNode(currentToken.value);
      }

      default: {
        throw new Error("Was not able to parse the regex. Token: " + currentToken.toString());
      }
    }
  }

  expect(type: RegexTokenType) {
    const currentToken: RegexToken = this.tokens[this.currentTokenIndex];

    if (currentToken.type === type) {
      this.currentTokenIndex++;
    } else {
      throw new Error("Expected: " + type.toString() + ". Received: " + currentToken.toString());
    }
  }
}

enum RegexTokenType {
  LITERAL,
  PIPE,
  ASTERISK,
  PLUS,
  VARIABLE,
  LPAREN,
  RPAREN,
}

class RegexToken {
  type: RegexTokenType;
  value: string;

  constructor(type: RegexTokenType, value: string) {
    this.type = type;
    this.value = value;
  }

  public toString(): string {
    return "Type: " + this.type.toString() + ". Value: " + this.value;
  }
}

// This class takes a regular expression and breaks it up into tokens
export class RegexLexer {
  expression: string;
  tokens: RegexToken[] = [];
  index = 0;

  public constructor(expression: string) {
    this.expression = expression;
  }

  public lex(): RegexToken[] {
    while (this.index < this.expression.length) {
      const currentCharacter = this.expression.charAt(this.index);

      if (Character.isAlphabetic(currentCharacter) || Character.isDigit(currentCharacter)) {
        this.tokens.push(new RegexToken(RegexTokenType.LITERAL, currentCharacter));
        this.index++;
      } else if (currentCharacter === "|") {
        this.tokens.push(new RegexToken(RegexTokenType.PIPE, currentCharacter));
        this.index++;
      } else if (currentCharacter === "+") {
        this.tokens.push(new RegexToken(RegexTokenType.PLUS, currentCharacter));
        this.index++;
      } else if (currentCharacter === "*") {
        this.tokens.push(new RegexToken(RegexTokenType.ASTERISK, currentCharacter));
        this.index++;
      } else if (currentCharacter === "(") {
        this.tokens.push(new RegexToken(RegexTokenType.LPAREN, currentCharacter));
        this.index++;
      } else if (currentCharacter === ")") {
        this.tokens.push(new RegexToken(RegexTokenType.RPAREN, currentCharacter));
        this.index++;
      } else if (currentCharacter === "$") {
        if (
          (this.expression.length > this.index + 1 && this.expression.charAt(this.index + 1) != "{") ||
          this.expression.length === this.index + 2
        ) {
          // capture whatever the next character is as is
          this.tokens.push(new RegexToken(RegexTokenType.LITERAL, this.expression.charAt(this.index + 1)));
          this.index += 2;
        } else {
          // we have a regex variable so we need to handle until the matching }
          this.index += 2; // move index to the start of the variable
          let variableName = "";

          if (this.index === this.expression.length) {
            this.tokens.push(new RegexToken(RegexTokenType.LITERAL, "}"));
          } else {
            while (this.expression.length > this.index && this.expression.charAt(this.index) != "}") {
              variableName += this.expression.charAt(this.index);
              this.index++;
            }

            // consume the ending }
            this.tokens.push(new RegexToken(RegexTokenType.VARIABLE, variableName));
            this.index++;
          }
        }
      } else if (Character.isWhitespace(currentCharacter)) this.index++;
      else {
        console.log(
          "Was not able to handle ch: " +
            currentCharacter +
            " at index: " +
            this.index +
            " in expression: " +
            this.expression
        );
      }
    }

    return this.tokens;
  }
}
