import { ColumnAndRow } from "./ColumnAndRow";
import { LexerError, SlexError } from "./errors";
import {
  CharacterFilter,
  MatchSession,
  RegexGroupingNode,
  RegexIntrinsicNode,
  RegexLexer,
  RegexNode,
  RegexParser,
  StringTransformer,
  collectVariables,
  isAmbiguous,
  isDeterministic,
  walkNodes,
} from "./internal";
import { LineMap } from "./Position";
import { Token } from "./Token";
import { initializeCharacter } from "./utils/Character";

/** Built-in character classes available to every rule set. */
const INTRINSICS: [name: string, key: keyof ReturnType<typeof initializeCharacter>][] = [
  ["__decimal_digit", "isDigit"],
  ["__hex_digit", "isHexDigit"],
  ["__octal_digit", "isOctalDigit"],
  ["__binary_digit", "isBinaryDigit"],
  ["__letter", "isAlphabetic"],
  ["__uppercase_letter", "isAlphabeticUppercase"],
  ["__lowercase_letter", "isAlphabeticLowercase"],
  ["__number", "isNumber"],
  ["__mark", "isMark"],
  ["__symbols", "isSymbolic"],
  ["__punctuation", "isPunctuation"],
  ["__control_character", "isControl"],
  ["__separator", "isSeparator"],
  ["__whitespace", "isWhitespace"],
  ["__line_break", "isLineBreak"],
  ["__identifier_start", "isIdentifierStart"],
  ["__identifier_part", "isIdentifierPart"],
  ["__any", "isAny"],
];

/** What to do after the scanner failed to match a character. */
export type ErrorRecovery = "stop" | "skip" | number;

export interface SlexOptions<TokenType> {
  /** Token type emitted once the end of the input has been reached. */
  EOF_TYPE: TokenType;
  /**
   * Tie breaker used when two rules match the same lexeme. Returns true when
   * `next` should win over `current`.
   */
  isHigherPrecedence: (options: { current: TokenType; next: TokenType }) => boolean;
  /** Characters treated as whitespace between tokens. Defaults to space, tab, newline and carriage return. */
  whitespaceCharacters?: string[];
  /** Token types that are scanned but never emitted. */
  ignoreTokens?: TokenType[];
  /**
   * When `false`, problems found by {@link Slex.validate} are reported as
   * warnings instead of throwing. Defaults to `true`.
   */
  strict?: boolean;
  /** Allows `addRule` to replace an existing rule instead of throwing. Defaults to `false`. */
  allowRuleOverride?: boolean;
  /** Called whenever scanning fails, which makes error recovery possible. */
  onError?: (context: { error: LexerError; engine: RegexEngine<never, never> }) => ErrorRecovery;
}

export interface AddRuleOptions {
  /** Matches this rule regardless of case. Equivalent to wrapping the rule in `(...)^`. */
  caseInsensitive?: boolean;
}

/** A single problem found while validating the rule set. */
export interface ValidationIssue {
  level: "error" | "warning";
  /** The rule the problem belongs to, when it belongs to one. */
  rule?: string;
  message: string;
}

/** Information handed to the metadata generator for every token. */
export interface TokenContext {
  lexeme: string;
  line: number;
  column: number;
  offset: number;
}

export type MetadataGenerator<Metadata> = (context: TokenContext) => Metadata;

/** A rule that can start new tokens, prepared once per engine. */
interface CompiledRule<TokenType> {
  name: string;
  node: RegexNode<TokenType>;
  /** `null` when the rule can start with any character. */
  first: CharacterFilter | null;
}

const RULE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function escapeLiteral(character: string): string {
  return /^[A-Za-z0-9]$/.test(character) ? character : "\\" + character;
}

/** Used when the caller does not care about token metadata. */
function defaultMetadataGenerator<Metadata>(): MetadataGenerator<Metadata> {
  return (() => undefined) as unknown as MetadataGenerator<Metadata>;
}

function compileRules<TokenType>(environment: Map<string, RegexNode<TokenType>>): CompiledRule<TokenType>[] {
  const rules: CompiledRule<TokenType>[] = [];

  for (const [name, node] of environment) {
    if (node.getTokenType() === null) continue;

    rules.push({
      name,
      node,
      first: node.firstCharacters(environment, {
        caseInsensitive: node.isCaseInsensitive(),
        negated: false,
      }),
    });
  }

  return rules;
}

export class Slex<TokenType, Metadata> {
  public environment: Map<string, RegexNode<TokenType>> = new Map();
  /** Token types registered through {@link Slex.addIgnoredRule}. */
  public ignoredTokens = new Set<TokenType>();
  public readonly Character: ReturnType<typeof initializeCharacter>;

  private validationCache: ValidationIssue[] | null = null;

  public constructor(public readonly options: SlexOptions<TokenType>) {
    const character = initializeCharacter({ whitespace: this.options.whitespaceCharacters });
    this.Character = character;

    for (const [name, key] of INTRINSICS) {
      this.environment.set(name, new RegexIntrinsicNode<TokenType>(name, character[key]));
    }
  }

  /**
   * Adds a rule to the rule set.
   *
   * @param name the name other rules can reference with `${name}`
   * @param expression the regular expression describing the token
   * @param emit the token type emitted when the expression matches
   * @param transformer applied to the matched lexeme before it is emitted
   * @param options extra settings for this rule
   */
  public addRule(
    name: string,
    expression: string,
    emit?: TokenType,
    transformer?: StringTransformer,
    options: AddRuleOptions = {}
  ): RegexNode<TokenType> {
    if (!RULE_NAME.test(name)) throw new SlexError(`"${name}" is not a valid rule name.`);

    if (this.environment.has(name) && this.options.allowRuleOverride !== true)
      throw new SlexError(
        `A rule named "${name}" is already defined. Pass { allowRuleOverride: true } to Slex to replace it.`
      );

    const lexer = new RegexLexer(expression, name);
    const parser = new RegexParser<TokenType>(lexer.lex(), name, expression);
    const root = parser.parse();

    if (emit !== undefined) root.setTokenType(emit);
    if (transformer !== undefined) root.setTransformer(transformer);
    root.setCaseInsensitive(options.caseInsensitive === true);

    // A rule that can match the empty string makes the scanner emit empty tokens
    // forever, so it is rejected before it reaches the rule set.
    if (root.isNullable(this.environment))
      throw new SlexError(
        `Rule "${name}" can match the empty string, which would make the scanner loop forever. ` +
          `Use '+' or a literal instead of '*', or require at least one character.`
      );

    this.environment.set(name, root);
    this.validationCache = null;

    for (const issue of this.warningsFor(name, root))
      if (this.options.strict !== false) console.warn(`[slex] ${issue.message}`);

    return root;
  }

  /** Adds a case insensitive rule for a keyword, for example `select`. */
  public addKeyword(name: string, word: string, emit: TokenType, options: AddRuleOptions = {}): RegexNode<TokenType> {
    if (word.length === 0) throw new SlexError(`Keyword "${name}" cannot be empty.`);

    // The group makes the "^" modifier apply to the whole keyword instead of
    // only the character right before it.
    const expression = "(" + [...word].map(escapeLiteral).join("") + ")^";
    return this.addRule(name, expression, emit, undefined, options);
  }

  /** Adds a rule whose token type is scanned but never emitted. */
  public addIgnoredRule(
    name: string,
    expression: string,
    emit: TokenType,
    transformer?: StringTransformer,
    options: AddRuleOptions = {}
  ): RegexNode<TokenType> {
    const node = this.addRule(name, expression, emit, transformer, options);
    this.ignoredTokens.add(emit);
    return node;
  }

  public hasRule(name: string): boolean {
    return this.environment.has(name);
  }

  public getRule(name: string): RegexNode<TokenType> | undefined {
    return this.environment.get(name);
  }

  public removeRule(name: string): boolean {
    this.validationCache = null;
    return this.environment.delete(name);
  }

  /** Every rule and its pattern, useful when debugging a rule set. */
  public describeRules(): string {
    const lines: string[] = [];

    for (const [name, node] of this.environment) {
      const emits = node.getTokenType() === null ? "" : " (emits)";
      lines.push(`${name}${emits}: ${node.toString()}`);
    }

    return lines.join("\n");
  }

  /** A shallow copy of this generator, sharing the same rules and options. */
  public clone(): Slex<TokenType, Metadata> {
    const copy = new Slex<TokenType, Metadata>(this.options);
    copy.environment = new Map(this.environment);
    copy.ignoredTokens = new Set(this.ignoredTokens);
    return copy;
  }

  /**
   * Checks the whole rule set and throws when a problem is found. Problems are
   * logged instead of thrown when the `strict` option is disabled.
   *
   * Rules may reference rules that are defined later, so this runs from
   * {@link Slex.generate} and not from {@link Slex.addRule}.
   */
  public validate(): ValidationIssue[] {
    if (this.validationCache !== null) return this.validationCache;

    const issues: ValidationIssue[] = [];

    for (const [name, node] of this.environment) {
      for (const variable of collectVariables(node)) {
        if (!this.environment.has(variable))
          issues.push({
            level: "error",
            rule: name,
            message: `Rule "${name}" references unknown rule "${variable}".`,
          });
      }

      if (node.isNullable(this.environment))
        issues.push({
          level: "error",
          rule: name,
          message: `Rule "${name}" can match the empty string, which would make the scanner loop forever.`,
        });

      issues.push(...this.warningsFor(name, node));
    }

    for (const cycle of this.findReferenceCycles())
      issues.push({
        level: "error",
        rule: cycle[0],
        message: `Rule "${cycle[0]}" takes part in a reference cycle: ${cycle.join(" -> ")}.`,
      });

    // Which nodes need memoization and which repetitions can be scanned with a
    // plain loop is decided once the whole rule set is known, since both depend
    // on what the referenced rules expand to.
    for (const node of this.environment.values()) {
      walkNodes(node, (current) => {
        current.memoizable = isAmbiguous(current, this.environment);

        if (current instanceof RegexGroupingNode && current.quantifier.min !== current.quantifier.max)
          current.deterministic = isDeterministic(current.internalNode, this.environment);
      });
    }

    const errors = issues.filter((issue) => issue.level === "error");

    if (errors.length > 0) {
      const summary = errors.map((issue) => `  - ${issue.message}`).join("\n");

      if (this.options.strict === false) {
        console.warn(`[slex] ${errors.length} rule problem(s) found:\n${summary}`);
      } else {
        throw new SlexError(`${errors.length} rule problem(s) found:\n${summary}`, { cause: issues });
      }
    }

    this.validationCache = issues;
    return issues;
  }

  /** Non fatal problems, such as a `!` applied to more than a single character. */
  private warningsFor(name: string, node: RegexNode<TokenType>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    walkNodes(node, (current) => {
      if (
        current instanceof RegexGroupingNode &&
        current.negated &&
        !current.internalNode.isSingleCharacter(this.environment)
      )
        issues.push({
          level: "warning",
          rule: name,
          message:
            `Rule "${name}" negates "${current.internalNode.toString()}", which does not match exactly one ` +
            `character. Negation only has an effect on single characters.`,
        });
    });

    return issues;
  }

  /** Rule names that reference themselves, directly or transitively. */
  private findReferenceCycles(): string[][] {
    const cycles: string[][] = [];
    const reported = new Set<string>();

    for (const start of this.environment.keys()) {
      const path: string[] = [];
      const onPath = new Set<string>();

      const walk = (name: string): void => {
        if (onPath.has(name)) {
          const cycle = path.slice(path.indexOf(name)).concat(name);
          const key = [...cycle].sort().join(",");
          if (!reported.has(key)) {
            reported.add(key);
            cycles.push(cycle);
          }
          return;
        }

        const node = this.environment.get(name);
        if (node === undefined) return;

        onPath.add(name);
        path.push(name);

        for (const variable of collectVariables(node)) if (this.environment.has(variable)) walk(variable);

        path.pop();
        onPath.delete(name);
      };

      walk(start);
    }

    return cycles;
  }

  /**
   * Creates an engine for `input`. The rule set is snapshotted, so rules added
   * afterwards do not affect engines that already exist.
   */
  public generate(
    input: string,
    metadataGenerator: MetadataGenerator<Metadata> = defaultMetadataGenerator()
  ): RegexEngine<TokenType, Metadata> {
    this.validate();

    let ignoreTokens: TokenType[] | undefined =
      this.options.ignoreTokens === undefined ? undefined : [...this.options.ignoreTokens];

    for (const token of this.ignoredTokens) {
      if (ignoreTokens === undefined) ignoreTokens = [];
      if (!ignoreTokens.includes(token)) ignoreTokens.push(token);
    }

    const options: SlexOptions<TokenType> =
      ignoreTokens === undefined ? this.options : { ...this.options, ignoreTokens };

    return new RegexEngine<TokenType, Metadata>(options, this.environment, metadataGenerator, input);
  }

  /** Scans `input` and returns every token, throwing on the first error. */
  public tokenize(
    input: string,
    metadataGenerator: MetadataGenerator<Metadata> = defaultMetadataGenerator()
  ): Token<TokenType, Metadata>[] {
    return [...this.generate(input, metadataGenerator).tokens()];
  }

  /** Scans `input`, skipping characters that cannot be scanned. */
  public tryTokenize(
    input: string,
    metadataGenerator: MetadataGenerator<Metadata> = defaultMetadataGenerator()
  ): { tokens: Token<TokenType, Metadata>[]; errors: LexerError[] } {
    const engine = this.generate(input, metadataGenerator);
    const tokens: Token<TokenType, Metadata>[] = [];

    while (engine.hasNextToken()) {
      const result = engine.tryGetNextToken();
      if (result.success) tokens.push(result.token);
      else engine.skipCharacter(1);
    }

    return { tokens, errors: engine.errors };
  }
}

export type TokenResult<TokenType, Metadata> =
  | { success: true; token: Token<TokenType, Metadata> }
  | { success: false; reason: string; line: number; column: number; error: LexerError };

export class RegexEngine<TokenType, Metadata> {
  public currentCharacterIndex: number = 0;
  public startCharacterIndex: number = 0;
  public Character: ReturnType<typeof initializeCharacter>;
  /** Every error encountered so far, in the order they were found. */
  public readonly errors: LexerError[] = [];

  public readonly environment: Map<string, RegexNode<TokenType>>;
  public readonly metadataGenerator: MetadataGenerator<Metadata>;

  private hasReturnedEOFToken = false;
  private peekedToken: Token<TokenType, Metadata> | null = null;
  private readonly lineMap: LineMap;
  private readonly rules: CompiledRule<TokenType>[];
  private readonly session: MatchSession<TokenType>;

  public constructor(
    public readonly options: SlexOptions<TokenType>,
    environment: Map<string, RegexNode<TokenType>>,
    metadataGenerator: MetadataGenerator<Metadata>,
    public readonly input: string
  ) {
    // Snapshot the rules so later addRule calls cannot change this engine.
    this.environment = new Map(environment);
    this.metadataGenerator = metadataGenerator;
    this.Character = initializeCharacter({ whitespace: this.options.whitespaceCharacters });
    this.lineMap = new LineMap(input);
    this.session = new MatchSession<TokenType>(input, this.environment);
    this.rules = compileRules(this.environment);
  }

  private peek(): string {
    return this.currentCharacterIndex >= this.input.length ? "\0" : this.input.charAt(this.currentCharacterIndex);
  }

  /** Skips over every piece of whitespace. */
  private ignoreWhitespace(): void {
    while (this.currentCharacterIndex < this.input.length && this.Character.isWhitespace(this.peek())) {
      this.currentCharacterIndex++;
    }
  }

  /**
   * Moves the scanner forward without emitting a token. Useful while recovering
   * from errors, for example to jump past the rest of a line.
   */
  public skipCharacter(count: number = 1): void {
    this.peekedToken = null;
    this.currentCharacterIndex = Math.min(
      this.input.length,
      this.currentCharacterIndex + Math.max(1, Math.floor(count))
    );
  }

  public peekNextToken(): Token<TokenType, Metadata> {
    const result = this.tryPeekNextToken();
    if (result.success === false) throw result.error;
    return result.token;
  }

  public tryPeekNextToken(): TokenResult<TokenType, Metadata> {
    if (this.peekedToken !== null) return { success: true, token: this.peekedToken };

    const index = this.currentCharacterIndex;
    const hasReturnedEOFToken = this.hasReturnedEOFToken;

    const result = this.tryGetNextToken();

    this.currentCharacterIndex = index;
    this.hasReturnedEOFToken = hasReturnedEOFToken;

    if (result.success) this.peekedToken = result.token;
    return result;
  }

  public getNextToken(): Token<TokenType, Metadata> {
    const result = this.tryGetNextToken();
    if (result.success === false) throw result.error;
    return result.token;
  }

  public tryGetNextToken(): TokenResult<TokenType, Metadata> {
    this.peekedToken = null;

    while (true) {
      this.ignoreWhitespace();
      const result = this.scan();

      // null means "scan again", which happens for recovered errors.
      if (result === null) continue;

      // The EOF token is never ignored, otherwise scanning could not end.
      if (
        result.success &&
        result.token.type !== this.options.EOF_TYPE &&
        this.options.ignoreTokens?.includes(result.token.type) === true
      )
        continue;

      return result;
    }
  }

  /** Scans every remaining token, throwing a {@link LexerError} on failure. */
  public *tokens(): Generator<Token<TokenType, Metadata>, void, undefined> {
    while (this.hasNextToken()) {
      const result = this.tryGetNextToken();
      if (result.success === false) throw result.error;

      yield result.token;
    }
  }

  public [Symbol.iterator](): Generator<Token<TokenType, Metadata>, void, undefined> {
    return this.tokens();
  }

  /**
   * Scans a single token. Returns `null` when the token must be skipped, which
   * happens for ignored token types and for recovered errors.
   */
  private scan(): TokenResult<TokenType, Metadata> | null {
    this.startCharacterIndex = this.currentCharacterIndex;

    if (this.currentCharacterIndex >= this.input.length) {
      const position = ColumnAndRow.fromIndex(this.startCharacterIndex, this.lineMap);
      const lexeme = "";

      const metadata = this.metadataGenerator({
        lexeme,
        line: position.getActualRow(),
        column: position.getActualColumn(),
        offset: this.startCharacterIndex,
      });

      this.hasReturnedEOFToken = true;
      return {
        success: true,
        token: new Token(this.options.EOF_TYPE, lexeme, position, metadata, this.startCharacterIndex),
      };
    }

    this.session.reset();

    const ch = this.input.charAt(this.currentCharacterIndex);
    let longestLength = 0;
    let matched: CompiledRule<TokenType> | null = null;

    for (const rule of this.rules) {
      if (rule.first !== null && !rule.first(ch)) continue;

      const length = this.session.longest(rule.node, this.currentCharacterIndex, {
        caseInsensitive: rule.node.isCaseInsensitive(),
        negated: false,
      });

      // A zero length match is never a valid token.
      if (length <= 0) continue;

      const currentType = matched === null ? null : matched.node.getTokenType();

      if (
        matched === null ||
        longestLength < length ||
        (longestLength === length &&
          currentType !== null &&
          this.options.isHigherPrecedence({ current: currentType, next: rule.node.getTokenType()! }))
      ) {
        matched = rule;
        longestLength = length;
      }
    }

    if (matched !== null) {
      this.currentCharacterIndex += longestLength;

      const position = ColumnAndRow.fromIndex(this.startCharacterIndex, this.lineMap);
      const transformer = matched.node.getTransformer();
      const longest = this.input.slice(this.startCharacterIndex, this.currentCharacterIndex);
      const lexeme = transformer === null ? longest : transformer(longest);
      const metadata = this.metadataGenerator({
        lexeme,
        line: position.getActualRow(),
        column: position.getActualColumn(),
        offset: this.startCharacterIndex,
      });

      return {
        success: true,
        token: new Token(matched.node.getTokenType()!, lexeme, position, metadata, this.startCharacterIndex),
      };
    }

    return this.fail(ch);
  }

  private fail(character: string): TokenResult<TokenType, Metadata> | null {
    const position = ColumnAndRow.fromIndex(this.startCharacterIndex, this.lineMap);
    const line = position.getActualRow();
    const column = position.getActualColumn();

    const error = new LexerError(
      "Unexpected character '" + character + "' at Line: " + line + ", Column: " + column,
      line,
      column,
      this.startCharacterIndex,
      character,
      this.expectedAt(character),
      this.input
    );

    this.errors.push(error);

    const handler = this.options.onError;
    if (handler !== undefined) {
      const recovery = handler({ error, engine: this as unknown as RegexEngine<never, never> });
      const skip = recovery === "skip" ? 1 : typeof recovery === "number" ? recovery : 0;

      if (skip > 0) {
        this.skipCharacter(skip);
        return null;
      }
    }

    return { success: false, reason: error.reason, line, column, error };
  }

  /** Names of the rules that are able to match `character`. */
  private expectedAt(character: string): string[] {
    return this.rules.filter((rule) => rule.first === null || rule.first(character)).map((rule) => rule.name);
  }

  public hasNextToken(): boolean {
    return this.hasReturnedEOFToken === false;
  }
}

export { Token, ColumnAndRow };
export { SlexError, RegexSyntaxError, LexerError } from "./errors";
export type { LexerErrorContext } from "./errors";
