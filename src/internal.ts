import { initializeCharacter } from "./utils/Character";
import { NFAFragment, NFAOptions, NFAState, createNFAState } from "./nfa";
const Character = initializeCharacter({});

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
export type RegexNodeModifiers = { negated: boolean; caseInsensitive: boolean };

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

  public abstract getMatches(
    restString: string,
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[];

  public abstract toNFA(options: NFAOptions): NFAFragment;

  public getCharacterTest(options: NFAOptions): ((ch: string) => boolean) | null {
    return null;
  }

  public clearTokenType(): void {
    this.emit = null;
  }

  public clearTransformer(): void {
    this.transformer = null;
  }

  public replaceVariables(_replacer: (name: string) => RegexNode<TokenType>): RegexNode<TokenType> {
    return this;
  }
}

class RegexConcatenationNode<TokenType> extends RegexNode<TokenType> {
  public constructor(public readonly nodes: RegexNode<TokenType>[]) {
    super();
  }

  public toString(): String {
    let ret = "";
    for (let i = 0; i < this.nodes.length; i++) {
      ret += this.nodes[i].toString();
    }
    return ret;
  }

  public getMatches(
    restString: string,
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[] {
    let caches: string[] = [""];

    for (const node of this.nodes) {
      let nextCaches: string[] = [];

      for (const cache of caches) {
        const rest = restString.slice(cache.length);
        const nextMatches = node.getMatches(rest, environment, modifiers);
        nextCaches.push(...nextMatches.map((m) => cache + m));
      }

      caches = nextCaches;
    }

    return caches;
  }

  public toNFA(options: NFAOptions): NFAFragment {
    const fragments = this.nodes.map((n) => n.toNFA(options));
    for (let i = 0; i < fragments.length - 1; i++) {
      fragments[i].accept.epsilon.push(fragments[i + 1].start);
    }
    return { start: fragments[0].start, accept: fragments[fragments.length - 1].accept };
  }

  public replaceVariables(replacer: (name: string) => RegexNode<TokenType>): RegexNode<TokenType> {
    const newNodes = this.nodes.map((n) => n.replaceVariables(replacer));
    if (newNodes.length > 1) return new RegexConcatenationNode(newNodes);
    return newNodes[0];
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

  public getMatches(
    restString: string,
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[] {
    let matches: string[] = [];
    for (const node of this.nodes) matches.push(...node.getMatches(restString, environment, modifiers));
    return matches;
  }

  public toNFA(options: NFAOptions): NFAFragment {
    const fragments = this.nodes.map((n) => n.toNFA(options));
    const start = createNFAState();
    const accept = createNFAState();
    for (const f of fragments) {
      start.epsilon.push(f.start);
      f.accept.epsilon.push(accept);
    }
    return { start, accept };
  }

  public replaceVariables(replacer: (name: string) => RegexNode<TokenType>): RegexNode<TokenType> {
    const newNodes = this.nodes.map((n) => n.replaceVariables(replacer));
    return new RegexEitherNode(newNodes);
  }
}

class RegexLiteralNode<TokenType> extends RegexNode<TokenType> {
  public constructor(public readonly ch: string) {
    super();
  }

  public toString(): string {
    return "" + this.ch;
  }

  // TODO: modify this code to handle case insensitive literals and whatnot
  public getMatches(
    restString: string,
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[] {
    const getStr = (str: string) => (modifiers.caseInsensitive ? str.toLowerCase() : str);

    if (restString.length === 0) return [];

    const matches: string[] = [];
    const ch = restString.charAt(0);

    if (modifiers.negated === false && getStr(ch) === getStr(this.ch)) matches.push(ch);
    else if (modifiers.negated === true && getStr(ch) !== getStr(this.ch)) matches.push(ch);

    return matches;
  }

  public toNFA(options: NFAOptions): NFAFragment {
    const start = createNFAState();
    const accept = createNFAState();
    if (options.caseInsensitive) {
      const lower = this.ch.toLowerCase();
      const upper = this.ch.toUpperCase();
      start.transitions.push({
        key: "ci:char:" + this.ch,
        test: (ch: string) => ch === lower || ch === upper,
        target: accept,
      });
    } else {
      start.transitions.push({
        key: "char:" + this.ch,
        test: (ch: string) => ch === this.ch,
        target: accept,
      });
    }
    return { start, accept };
  }

  public getCharacterTest(options: NFAOptions): (ch: string) => boolean {
    if (options.caseInsensitive) {
      const lower = this.ch.toLowerCase();
      const upper = this.ch.toUpperCase();
      return (ch: string) => ch === lower || ch === upper;
    }
    return (ch: string) => ch === this.ch;
  }
}

export class RegexIntrinsicNode<TokenType> extends RegexNode<TokenType> {
  public constructor(
    public readonly intrinsicName: string,
    public readonly calculator: (ch: string, negated: boolean) => boolean
  ) {
    super();
  }

  public toString(): string {
    return "<" + this.intrinsicName + ">";
  }

  public getMatches(
    restString: string,
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[] {
    const matches: string[] = [];

    let ch = restString.charAt(0);
    if (modifiers.caseInsensitive) ch = ch.toLowerCase();

    const result = this.calculator(ch, modifiers.negated);

    if (modifiers.negated === false && result) matches.push(ch);
    else if (modifiers.negated === true && !result) matches.push(ch);

    return matches;
  }

  public toNFA(options: NFAOptions): NFAFragment {
    const start = createNFAState();
    const accept = createNFAState();
    if (options.caseInsensitive) {
      start.transitions.push({
        key: "ci:intrinsic:" + this.intrinsicName,
        test: (ch: string) => this.calculator(ch.toLowerCase(), false),
        target: accept,
      });
    } else {
      start.transitions.push({
        key: "intrinsic:" + this.intrinsicName,
        test: (ch: string) => this.calculator(ch, false),
        target: accept,
      });
    }
    return { start, accept };
  }

  public getCharacterTest(options: NFAOptions): (ch: string) => boolean {
    if (options.caseInsensitive) {
      return (ch: string) => this.calculator(ch.toLowerCase(), false);
    }
    return (ch: string) => this.calculator(ch, false);
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

  public getMatches(
    restString: string,
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[] {
    if (!environment.has(this.variableName)) return [];

    const rootNode = environment.get(this.variableName);
    return rootNode!.getMatches(restString, environment, modifiers);
  }

  public toNFA(_options: NFAOptions): NFAFragment {
    throw new Error("Variable '" + this.variableName + "' must be resolved before NFA construction");
  }

  public replaceVariables(replacer: (name: string) => RegexNode<TokenType>): RegexNode<TokenType> {
    return replacer(this.variableName);
  }
}

class RegexCharClassNode<TokenType> extends RegexNode<TokenType> {
  private ranges: [string, string][] = [];
  private singles: string[] = [];

  public constructor(public readonly content: string) {
    super();
    this.parseContent();
  }

  private parseContent() {
    const chars = this.content;
    for (let i = 0; i < chars.length; i++) {
      if (i + 2 < chars.length && chars.charAt(i + 1) === "-") {
        this.ranges.push([chars.charAt(i), chars.charAt(i + 2)]);
        i += 2;
      } else {
        this.singles.push(chars.charAt(i));
      }
    }
  }

  public test(ch: string): boolean {
    for (const s of this.singles) {
      if (ch === s) return true;
    }
    for (const [lo, hi] of this.ranges) {
      if (ch >= lo && ch <= hi) return true;
    }
    return false;
  }

  public toString(): string {
    return "[" + this.content + "]";
  }

  public getMatches(
    restString: string,
    _environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[] {
    if (restString.length === 0) return [];
    const ch = restString.charAt(0);
    const testCh = modifiers.caseInsensitive ? ch.toLowerCase() : ch;
    const matches: string[] = [];
    if (modifiers.negated === false && this.test(testCh)) matches.push(ch);
    else if (modifiers.negated === true && !this.test(testCh)) matches.push(ch);
    return matches;
  }

  public toNFA(options: NFAOptions): NFAFragment {
    const start = createNFAState();
    const accept = createNFAState();
    if (options.caseInsensitive) {
      start.transitions.push({
        key: "ci:class:" + this.content,
        test: (ch: string) => this.test(ch.toLowerCase()),
        target: accept,
      });
    } else {
      start.transitions.push({
        key: "class:" + this.content,
        test: (ch: string) => this.test(ch),
        target: accept,
      });
    }
    return { start, accept };
  }

  public getCharacterTest(options: NFAOptions): (ch: string) => boolean {
    if (options.caseInsensitive) {
      return (ch: string) => this.test(ch.toLowerCase());
    }
    return (ch: string) => this.test(ch);
  }
}

enum RegexGroupingNodeModifiers {
  NONE,
  NONE_OR_MORE,
  ONE_OR_MORE,
  OPTIONAL,
  NEGATION,
  CASE_INSENSITIVE,
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
          : this.modifier === RegexGroupingNodeModifiers.OPTIONAL
            ? "?"
            : this.modifier === RegexGroupingNodeModifiers.CASE_INSENSITIVE
              ? "^"
              : "")
    );
  }

  public _getMatches(
    restString: string,
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[] {
    const initialMatches: string[] = this.internalNode.getMatches(restString, environment, modifiers);

    if (initialMatches.length === 0) {
      if (
        this.modifier === RegexGroupingNodeModifiers.NONE_OR_MORE ||
        this.modifier === RegexGroupingNodeModifiers.OPTIONAL
      )
        initialMatches.push("");
      return initialMatches;
    } else if (
      this.modifier === RegexGroupingNodeModifiers.NONE ||
      this.modifier === RegexGroupingNodeModifiers.OPTIONAL
    )
      return initialMatches;

    let matches = initialMatches;

    // handle matching for NONE_OR_MORE or ONE_OR_MORE
    while (true) {
      const nextMatches: string[] = [];

      for (const match of matches) {
        const rest: string = restString.slice(match.length);
        if (rest.length === 0) continue;

        const nextMatch = this.internalNode.getMatches(rest, environment, modifiers);
        nextMatches.push(...nextMatch.map((m) => match + m));
      }

      if (nextMatches.length === 0) break;

      matches = nextMatches;
    }

    return matches;
  }

  public getMatches(
    restString: string,
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[] {
    if (this.modifier === RegexGroupingNodeModifiers.NEGATION)
      return this.internalNode.getMatches(restString, environment, { ...modifiers, negated: true });

    if (this.modifier === RegexGroupingNodeModifiers.CASE_INSENSITIVE)
      return this.internalNode.getMatches(restString, environment, { ...modifiers, caseInsensitive: true });

    return this._getMatches(restString, environment, modifiers);
  }

  public toNFA(options: NFAOptions): NFAFragment {
    if (this.modifier === RegexGroupingNodeModifiers.NEGATION) {
      const test = this.internalNode.getCharacterTest(options);
      if (test === null) {
        throw new Error("Negation can only be applied to single-character patterns");
      }
      const start = createNFAState();
      const accept = createNFAState();
      start.transitions.push({
        key: "neg:" + this.internalNode.toString(),
        test: (ch: string) => !test(ch),
        target: accept,
      });
      return { start, accept };
    }

    if (this.modifier === RegexGroupingNodeModifiers.CASE_INSENSITIVE) {
      return this.internalNode.toNFA({ ...options, caseInsensitive: true });
    }

    const inner = this.internalNode.toNFA(options);

    if (this.modifier === RegexGroupingNodeModifiers.NONE_OR_MORE) {
      const start = createNFAState();
      const accept = createNFAState();
      start.epsilon.push(inner.start);
      start.epsilon.push(accept);
      inner.accept.epsilon.push(inner.start);
      inner.accept.epsilon.push(accept);
      return { start, accept };
    }

    if (this.modifier === RegexGroupingNodeModifiers.ONE_OR_MORE) {
      const start = createNFAState();
      const accept = createNFAState();
      start.epsilon.push(inner.start);
      inner.accept.epsilon.push(inner.start);
      inner.accept.epsilon.push(accept);
      return { start, accept };
    }

    if (this.modifier === RegexGroupingNodeModifiers.OPTIONAL) {
      const start = createNFAState();
      const accept = createNFAState();
      start.epsilon.push(inner.start);
      start.epsilon.push(accept);
      inner.accept.epsilon.push(accept);
      return { start, accept };
    }

    return inner;
  }

  public replaceVariables(replacer: (name: string) => RegexNode<TokenType>): RegexNode<TokenType> {
    const newInternal = this.internalNode.replaceVariables(replacer);
    return new RegexGroupingNode(newInternal, this.modifier);
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

        const nextTokenType = this.tokens[this.currentTokenIndex]?.type;
        let modifier = RegexGroupingNodeModifiers.NONE;
        if (nextTokenType === RegexTokenType.ASTERISK) {
          modifier = RegexGroupingNodeModifiers.NONE_OR_MORE;
          this.currentTokenIndex++;
        } else if (nextTokenType === RegexTokenType.PLUS) {
          modifier = RegexGroupingNodeModifiers.ONE_OR_MORE;
          this.currentTokenIndex++;
        } else if (nextTokenType === RegexTokenType.QUESTION) {
          modifier = RegexGroupingNodeModifiers.OPTIONAL;
          this.currentTokenIndex++;
        } else if (nextTokenType === RegexTokenType.EXCLAMATION) {
          modifier = RegexGroupingNodeModifiers.NEGATION;
          this.currentTokenIndex++;
        } else if (nextTokenType === RegexTokenType.CARAT) {
          modifier = RegexGroupingNodeModifiers.CASE_INSENSITIVE;
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

      case RegexTokenType.CHAR_CLASS: {
        this.currentTokenIndex++;
        return new RegexCharClassNode(currentToken.value);
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
  EXCLAMATION,
  PLUS,
  QUESTION,
  CARAT,
  VARIABLE,
  LPAREN,
  RPAREN,
  CHAR_CLASS,
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
      } else if (currentCharacter === "!") {
        this.tokens.push(new RegexToken(RegexTokenType.EXCLAMATION, currentCharacter));
        this.index++;
      } else if (currentCharacter === "?") {
        this.tokens.push(new RegexToken(RegexTokenType.QUESTION, currentCharacter));
        this.index++;
      } else if (currentCharacter === "(") {
        this.tokens.push(new RegexToken(RegexTokenType.LPAREN, currentCharacter));
        this.index++;
      } else if (currentCharacter === ")") {
        this.tokens.push(new RegexToken(RegexTokenType.RPAREN, currentCharacter));
        this.index++;
      } else if (currentCharacter === "^") {
        this.tokens.push(new RegexToken(RegexTokenType.CARAT, currentCharacter));
        this.index++;
      } else if (currentCharacter === "[") {
        this.index++; // skip [
        let classContent = "";
        while (this.index < this.expression.length && this.expression.charAt(this.index) !== "]") {
          classContent += this.expression.charAt(this.index);
          this.index++;
        }
        this.index++; // skip ]
        this.tokens.push(new RegexToken(RegexTokenType.CHAR_CLASS, classContent));
      } else if (currentCharacter === "$") {
        if (
          (this.expression.length > this.index + 1 && this.expression.charAt(this.index + 1) != "{") ||
          this.expression.length === this.index + 2
        ) {
          // capture whatever the next character is as is
          this.tokens.push(new RegexToken(RegexTokenType.LITERAL, this.expression.charAt(this.index + 1)));
          this.index += 2;
        } else if (this.isNextPipeOrEof(this.index + 2)) {
          this.tokens.push(new RegexToken(RegexTokenType.LITERAL, "}"));
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

  private isNextPipeOrEof(start: number): boolean {
    for (let i = start + 1; i < this.expression.length; i++) {
      const ch = this.expression.charAt(i);
      if (ch === "|") return true;
      if (ch === "}") return false;
    }

    return true;
  }
}
