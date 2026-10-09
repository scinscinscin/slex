import { ColumnAndRow } from "./ColumnAndRow";
import {
  RegexEngineParsingResult,
  RegexIntrinsicNode,
  RegexLexer,
  RegexNode,
  RegexParser,
  StringTransformer,
} from "./internal";
import { Token } from "./Token";
import { initializeCharacter } from "./utils/Character";
import { DFA, DFAState, buildDFA, dfaTransition } from "./dfa";
import { resolveVariables } from "./resolve";
import { resetNFAStateId } from "./nfa";

export interface SlexOptions<TokenType> {
  EOF_TYPE: TokenType;
  isHigherPrecedence: (options: { current: TokenType; next: TokenType }) => boolean;
  whitespaceCharacters?: string[];
  ignoreTokens?: TokenType[];
}

export class Slex<TokenType, Metadata> {
  public environment: Map<string, RegexNode<TokenType>> = new Map();
  Character = initializeCharacter({});

  constructor(public readonly options: SlexOptions<TokenType>) {
    this.environment = new Map();

    this.environment.set(
      "__decimal_digit",
      new RegexIntrinsicNode<TokenType>("__decimal_digit", this.Character.isDigit)
    );

    this.environment.set("__letter", new RegexIntrinsicNode<TokenType>("__letter", this.Character.isAlphabetic));

    this.environment.set(
      "__uppercase_letter",
      new RegexIntrinsicNode<TokenType>("__uppercase_letter", this.Character.isAlphabeticUppercase)
    );

    this.environment.set(
      "__lowercase_letter",
      new RegexIntrinsicNode<TokenType>("__lowercase_letter", this.Character.isAlphabeticLowercase)
    );

    this.environment.set("__symbols", new RegexIntrinsicNode<TokenType>("__symbolic", this.Character.isSymbolic));

    this.environment.set(
      "__control_character",
      new RegexIntrinsicNode<TokenType>("__control_character", this.Character.isControl)
    );

    this.environment.set(
      "__word",
      new RegexIntrinsicNode<TokenType>(
        "__word",
        (ch) => this.Character.isAlphabetic(ch) || this.Character.isDigit(ch) || ch === "_"
      )
    );

    this.environment.set(
      "__whitespace",
      new RegexIntrinsicNode<TokenType>("__whitespace", this.Character.isWhitespace)
    );
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
    return new RegexEngine<TokenType, Metadata>(this.options, this.environment, metadataGenerator, input);
  }

  public compile(): CompiledLexer<TokenType, Metadata> {
    const ruleOrder: string[] = [];
    for (const [name, node] of this.environment) if (node.getTokenType() !== null) ruleOrder.push(name);
    resetNFAStateId();
    const resolved = resolveVariables(this.environment);

    const rulesForDFA = new Map<string, RegexNode<TokenType>>();
    for (const name of ruleOrder) rulesForDFA.set(name, resolved.get(name)!);

    const dfa = buildDFA(rulesForDFA, ruleOrder);

    const ruleMetadata = new Map<string, { tokenType: TokenType; transformer: StringTransformer | null }>();
    for (const name of ruleOrder) {
      const node = resolved.get(name)!;
      ruleMetadata.set(name, { tokenType: node.getTokenType()!, transformer: node.getTransformer() });
    }

    return new CompiledLexer<TokenType, Metadata>(this.options, dfa, ruleMetadata, ruleOrder);
  }
}

export interface CommonEngine<TokenType, Metadata> {
  hasNextToken(): boolean;
  getNextToken(): Token<TokenType, Metadata>;
  tryGetNextToken(): TokenResult<TokenType, Metadata>;
  tryPeekNextToken(): TokenResult<TokenType, Metadata>;
  peekNextToken(): Token<TokenType, Metadata>;
}

export type TokenResult<TokenType, Metadata> =
  | { success: true; token: Token<TokenType, Metadata> }
  | { success: false; reason: string; line: number; column: number };

export class RegexEngine<TokenType, Metadata> {
  currentCharacterIndex: number = 0;
  startCharacterIndex: number = 0;
  Character: ReturnType<typeof initializeCharacter>;

  public constructor(
    public readonly options: SlexOptions<TokenType>,
    public readonly environment: Map<string, RegexNode<TokenType>>,
    public readonly metadataGenerator: () => Metadata,
    public readonly input: string
  ) {
    this.Character = initializeCharacter({ whitespace: this.options.whitespaceCharacters });
  }

  private peek(): string {
    return this.currentCharacterIndex >= this.input.length ? "\0" : this.input.charAt(this.currentCharacterIndex);
  }

  // skips over every piece of whitespace
  private ignoreWhitespace() {
    while (this.currentCharacterIndex < this.input.length + 1 && this.Character.isWhitespace(this.peek())) {
      this.currentCharacterIndex++;
    }
  }

  public peekNextToken() {
    const result = this.tryPeekNextToken();
    if (result.success === false) throw new Error(result.reason);
    return result.token;
  }

  public tryPeekNextToken() {
    while (true) {
      const save = this.currentCharacterIndex;
      const save2 = this.hasReturnedEOFToken;

      const response = this.tryGetNextToken();

      this.currentCharacterIndex = save;
      this.hasReturnedEOFToken = save2;

      return response;
    }
  }

  public getNextToken(): Token<TokenType, Metadata> {
    const result = this.tryGetNextToken();
    if (result.success === false) throw new Error(result.reason);
    return result.token;
  }

  public tryGetNextToken(): TokenResult<TokenType, Metadata> {
    let ret: TokenResult<TokenType, Metadata> | null = null;

    do this.ignoreWhitespace();
    while ((ret = this.tryGetNextNonSkippedToken()) === null);

    return ret;
  }

  private tryGetNextNonSkippedToken() {
    let ret: TokenResult<TokenType, Metadata> | null = null;

    while ((ret = this._tryGetNextToken())) {
      if (ret.success === false) return ret;
      else if (this.options.ignoreTokens === undefined) return ret;
      else if (this.options.ignoreTokens.includes(ret.token.type)) return null;
      else break;
    }

    return ret;
  }

  private _tryGetNextToken(): TokenResult<TokenType, Metadata> {
    this.startCharacterIndex = this.currentCharacterIndex;

    if (this.currentCharacterIndex >= this.input.length) {
      const metadata = this.metadataGenerator();
      const position = ColumnAndRow.calculate(this.startCharacterIndex, this.input);

      this.hasReturnedEOFToken = true;
      return { success: true, token: new Token(this.options.EOF_TYPE, "", position, metadata) };
    }

    let ret = new RegexEngineParsingResult(false, "", null);
    let retNode: RegexNode<TokenType> | null = null;

    for (const [ruleName, attemptNode] of this.environment.entries()) {
      if (attemptNode.getTokenType() === null) continue;

      const matches: string[] = attemptNode.getMatches(
        this.input.substring(this.currentCharacterIndex),
        this.environment,
        { caseInsensitive: false, negated: false }
      );

      if (matches.length > 0) {
        let longest = "";

        for (const match of matches) if (match.length > longest.length) longest = match;
        if (
          !ret.success ||
          ret.lexeme.length < longest.length ||
          (ret.lexeme.length === longest.length &&
            retNode != null &&
            this.options.isHigherPrecedence({ current: retNode.getTokenType()!, next: attemptNode.getTokenType()! }))
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

      return { success: true, token: returnedToken };
    }

    const nextChar = this.input.charAt(this.startCharacterIndex);
    const position = ColumnAndRow.calculate(this.startCharacterIndex, this.input);

    this.currentCharacterIndex++;
    return {
      success: false,
      line: position.getActualRow(),
      column: position.getActualColumn(),
      reason:
        "Unexpected character '" +
        nextChar +
        "' at Line: " +
        position.getActualRow() +
        ", Column: " +
        position.getActualColumn(),
    };
  }

  private hasReturnedEOFToken = false;
  public hasNextToken(): boolean {
    return this.hasReturnedEOFToken == false;
  }
}

export class CompiledLexer<TokenType, Metadata> {
  public constructor(
    private readonly options: SlexOptions<TokenType>,
    private readonly dfa: DFA,
    private readonly ruleMetadata: Map<string, { tokenType: TokenType; transformer: StringTransformer | null }>,
    private readonly ruleOrder: string[]
  ) {}

  public generate(input: string, metadataGenerator: () => Metadata): DFAEngine<TokenType, Metadata> {
    return new DFAEngine<TokenType, Metadata>(
      this.options,
      this.dfa,
      this.ruleMetadata,
      this.ruleOrder,
      metadataGenerator,
      input
    );
  }
}

export class DFAEngine<TokenType, Metadata> {
  currentCharacterIndex: number = 0;
  startCharacterIndex: number = 0;
  Character: ReturnType<typeof initializeCharacter>;

  public constructor(
    public readonly options: SlexOptions<TokenType>,
    private readonly dfa: DFA,
    private readonly ruleMetadata: Map<string, { tokenType: TokenType; transformer: StringTransformer | null }>,
    private readonly ruleOrder: string[],
    public readonly metadataGenerator: () => Metadata,
    public readonly input: string
  ) {
    this.Character = initializeCharacter({ whitespace: this.options.whitespaceCharacters });
  }

  private peek(): string {
    return this.currentCharacterIndex >= this.input.length ? "\0" : this.input.charAt(this.currentCharacterIndex);
  }

  private ignoreWhitespace() {
    while (this.currentCharacterIndex < this.input.length + 1 && this.Character.isWhitespace(this.peek())) {
      this.currentCharacterIndex++;
    }
  }

  public peekNextToken() {
    const result = this.tryPeekNextToken();
    if (result.success === false) throw new Error(result.reason);
    return result.token;
  }

  public tryPeekNextToken() {
    const save = this.currentCharacterIndex;
    const save2 = this.hasReturnedEOFToken;

    const response = this.tryGetNextToken();

    this.currentCharacterIndex = save;
    this.hasReturnedEOFToken = save2;

    return response;
  }

  public getNextToken(): Token<TokenType, Metadata> {
    const result = this.tryGetNextToken();
    if (result.success === false) throw new Error(result.reason);
    return result.token;
  }

  public tryGetNextToken(): TokenResult<TokenType, Metadata> {
    let ret: TokenResult<TokenType, Metadata> | null = null;

    do this.ignoreWhitespace();
    while ((ret = this.tryGetNextNonSkippedToken()) === null);

    return ret;
  }

  private tryGetNextNonSkippedToken() {
    let ret: TokenResult<TokenType, Metadata> | null = null;

    while ((ret = this._tryGetNextToken())) {
      if (ret.success === false) return ret;
      else if (this.options.ignoreTokens === undefined) return ret;
      else if (this.options.ignoreTokens.includes(ret.token.type)) return null;
      else break;
    }

    return ret;
  }

  private _tryGetNextToken(): TokenResult<TokenType, Metadata> {
    this.startCharacterIndex = this.currentCharacterIndex;

    if (this.currentCharacterIndex >= this.input.length) {
      const metadata = this.metadataGenerator();
      const position = ColumnAndRow.calculate(this.startCharacterIndex, this.input);

      this.hasReturnedEOFToken = true;
      return { success: true, token: new Token(this.options.EOF_TYPE, "", position, metadata) };
    }

    let bestMatchLength = 0;
    let bestMatchRule: string | null = null;
    let currentState = this.dfa.start;

    for (let i = this.currentCharacterIndex; i < this.input.length; i++) {
      const ch = this.input.charAt(i);
      const nextState = dfaTransition(this.dfa.states[currentState], ch);
      if (nextState === null) break;

      currentState = nextState;
      const acceptRules = this.dfa.states[currentState].acceptRules;

      if (acceptRules.size > 0) {
        const matchLength = i - this.currentCharacterIndex + 1;
        if (matchLength > bestMatchLength) {
          bestMatchLength = matchLength;
          bestMatchRule = this.selectBestRule(acceptRules);
        }
      }
    }

    if (bestMatchRule !== null && bestMatchLength > 0) {
      this.currentCharacterIndex += bestMatchLength;

      const meta = this.ruleMetadata.get(bestMatchRule)!;
      const rawLexeme = this.input.substring(this.startCharacterIndex, this.startCharacterIndex + bestMatchLength);
      const lexeme = meta.transformer !== null ? meta.transformer(rawLexeme) : rawLexeme;

      const returnedToken = new Token<TokenType, Metadata>(
        meta.tokenType,
        lexeme,
        ColumnAndRow.calculate(this.startCharacterIndex, this.input),
        this.metadataGenerator()
      );

      return { success: true, token: returnedToken };
    }

    const nextChar = this.input.charAt(this.startCharacterIndex);
    const position = ColumnAndRow.calculate(this.startCharacterIndex, this.input);

    this.currentCharacterIndex++;
    return {
      success: false,
      line: position.getActualRow(),
      column: position.getActualColumn(),
      reason:
        "Unexpected character '" +
        nextChar +
        "' at Line: " +
        position.getActualRow() +
        ", Column: " +
        position.getActualColumn(),
    };
  }

  private selectBestRule(acceptRules: Map<string, number>): string {
    let bestRule: string | null = null;

    for (const rule of this.ruleOrder) {
      if (!acceptRules.has(rule)) continue;

      if (bestRule === null) {
        bestRule = rule;
        continue;
      } else {
        const current = this.ruleMetadata.get(bestRule)!.tokenType;
        const next = this.ruleMetadata.get(rule)!.tokenType;
        if (this.options.isHigherPrecedence({ current, next })) bestRule = rule;
      }
    }

    return bestRule!;
  }

  private hasReturnedEOFToken = false;
  public hasNextToken(): boolean {
    return this.hasReturnedEOFToken == false;
  }
}

export { Token, ColumnAndRow };
