import { RegexSyntaxError } from "./errors";
import { initializeCharacter } from "./utils/Character";

const Character = initializeCharacter({});

export type StringTransformer = (lexeme: string) => string;

/** Case insensitivity and negation, propagated while matching a node. */
export interface RegexNodeModifiers {
  caseInsensitive: boolean;
  negated: boolean;
}

/** `{ min, max }` repetition bounds, where `max: Infinity` means unbounded. */
export interface Quantifier {
  min: number;
  max: number;
}

export const EXACTLY_ONCE: Quantifier = { min: 1, max: 1 };
export const ZERO_OR_MORE: Quantifier = { min: 0, max: Infinity };
export const ONE_OR_MORE: Quantifier = { min: 1, max: Infinity };
export const OPTIONAL: Quantifier = { min: 0, max: 1 };

/** Answers "can this node start with `ch`?", used to skip rules quickly. */
export type CharacterFilter = (ch: string) => boolean;

const NO_MATCHES: number[] = [];
const ONE_CHARACTER = [1];

/**
 * Collects match lengths without duplicates. Small collections stay as plain
 * arrays, which is both faster and cheaper than a Set for the common case of a
 * handful of alternatives.
 */
class Lengths {
  private values: number[] = [];
  private seen: Set<number> | null = null;

  public add(value: number): boolean {
    if (this.seen !== null) {
      if (this.seen.has(value)) return false;
      this.seen.add(value);
    } else {
      if (this.values.includes(value)) return false;
      if (this.values.length >= 24) {
        this.seen = new Set(this.values);
        this.seen.add(value);
      }
    }

    this.values.push(value);
    return true;
  }

  public get empty(): boolean {
    return this.values.length === 0;
  }

  public toArray(): number[] {
    return this.values;
  }
}

function mod(current: RegexNodeModifiers, caseInsensitive: boolean, negated: boolean): RegexNodeModifiers {
  if (current.caseInsensitive === caseInsensitive && current.negated === negated) return current;
  return { caseInsensitive, negated };
}

/**
 * Holds the input and the rule environment of one engine and memoizes node
 * results, which keeps patterns such as `(a|b)*c` from turning into exponential
 * backtracking.
 *
 * Results only depend on the node, the position and the modifiers, so they are
 * reused for every rule that reaches the same position while scanning a token.
 */
export class MatchSession<TokenType> {
  /** Node and position are folded into a single integer key. */
  private memo = new Map<number, number[]>();
  private readonly stride: number;

  public constructor(
    public readonly input: string,
    public readonly environment: Map<string, RegexNode<TokenType>>
  ) {
    this.stride = (input.length + 1) * 4;
  }

  /**
   * Drops memoized results. Called once per token, which keeps the cache small
   * enough to stay in the CPU cache.
   */
  public reset(): void {
    if (this.memo.size > 0) this.memo.clear();
  }

  public lengths(node: RegexNode<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    if (!node.cacheable || !node.memoizable) return node.matchLengths(this, start, modifiers);

    const key = node.id * this.stride + start * 4 + (modifiers.caseInsensitive ? 2 : 0) + (modifiers.negated ? 1 : 0);

    const cached = this.memo.get(key);
    if (cached !== undefined) return cached;

    const matches = node.matchLengths(this, start, modifiers);
    this.memo.set(key, matches);
    return matches;
  }

  /** The longest match of `node` at `start`, or `-1` when it does not match. */
  public longest(node: RegexNode<TokenType>, start: number, modifiers: RegexNodeModifiers): number {
    let longest = -1;

    for (const length of this.lengths(node, start, modifiers)) if (length > longest) longest = length;

    return longest;
  }
}

let nextNodeId = 0;

export abstract class RegexNode<TokenType> {
  /** Stable identifier used to fold nodes into memo keys. */
  public readonly id: number = nextNodeId++;

  /**
   * Single character matchers are cheap enough to recompute, so only the
   * composite nodes are memoized.
   */
  public readonly cacheable: boolean = true;

  /**
   * Set by the rule set validation. Nodes without a repetition inside them are
   * matched in constant time, so memoizing them costs more than it saves.
   */
  public memoizable: boolean = true;

  private emit: TokenType | null = null;
  private transformer: StringTransformer | null = null;
  private caseInsensitiveByOption = false;

  public getTokenType(): TokenType | null {
    return this.emit;
  }

  public setTokenType(emit: TokenType): void {
    this.emit = emit;
  }

  public getTransformer(): StringTransformer | null {
    return this.transformer;
  }

  public setTransformer(transformer: StringTransformer): void {
    this.transformer = transformer;
  }

  /** Set by `addRule(..., { caseInsensitive: true })`. */
  public isCaseInsensitive(): boolean {
    return this.caseInsensitiveByOption;
  }

  public setCaseInsensitive(caseInsensitive: boolean): void {
    this.caseInsensitiveByOption = caseInsensitive;
  }

  public abstract toString(): string;

  /** Direct children, used for traversal during validation. */
  public abstract children(): readonly RegexNode<TokenType>[];

  /**
   * Every length this node can match at `start`, relative to `start`.
   * Returning an empty array means "no match".
   */
  public abstract matchLengths(
    session: MatchSession<TokenType>,
    start: number,
    modifiers: RegexNodeModifiers
  ): number[];

  /** True when this node can match the empty string. */
  public abstract isNullable(environment: Map<string, RegexNode<TokenType>>, visiting?: Set<string>): boolean;

  /** True when this node matches exactly one character. */
  public abstract isSingleCharacter(environment: Map<string, RegexNode<TokenType>>): boolean;

  /**
   * An over approximation of the characters this node can start with, or `null`
   * when that cannot be determined cheaply.
   */
  public abstract firstCharacters(
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): CharacterFilter | null;

  /** Whether this node accepts the single character `ch`. */
  public matchesCharacter(
    environment: Map<string, RegexNode<TokenType>>,
    ch: string,
    modifiers: RegexNodeModifiers
  ): boolean {
    return false;
  }

  /**
   * Every prefix of `restString` this node matches. Kept for backwards
   * compatibility; the engine uses {@link MatchSession.lengths} instead.
   */
  public getMatches(
    restString: string,
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): string[] {
    const session = new MatchSession(restString, environment);
    return this.matchLengths(session, 0, modifiers).map((length) => restString.slice(0, length));
  }
}

class RegexLiteralNode<TokenType> extends RegexNode<TokenType> {
  public constructor(public readonly ch: string) {
    super();
  }

  public override readonly cacheable = false;

  public toString(): string {
    return /^[A-Za-z0-9]$/.test(this.ch) ? this.ch : "\\" + this.ch;
  }

  public children(): readonly RegexNode<TokenType>[] {
    return [];
  }

  public matchLengths(session: MatchSession<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    if (start >= session.input.length) return NO_MATCHES;

    const actual = session.input.charAt(start);
    const equal = modifiers.caseInsensitive ? actual.toLowerCase() === this.ch.toLowerCase() : actual === this.ch;

    if (modifiers.negated) return equal ? NO_MATCHES : ONE_CHARACTER;
    return equal ? ONE_CHARACTER : NO_MATCHES;
  }

  public isNullable(): boolean {
    return false;
  }

  public isSingleCharacter(): boolean {
    return true;
  }

  public matchesCharacter(
    _environment: Map<string, RegexNode<TokenType>>,
    ch: string,
    modifiers: RegexNodeModifiers
  ): boolean {
    if (ch.length !== 1) return false;

    const equal = modifiers.caseInsensitive ? ch.toLowerCase() === this.ch.toLowerCase() : ch === this.ch;

    return modifiers.negated ? !equal : equal;
  }

  public firstCharacters(
    _environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): CharacterFilter {
    const expected = modifiers.caseInsensitive ? this.ch.toLowerCase() : this.ch;

    const isEqual = modifiers.caseInsensitive
      ? (ch: string) => ch.toLowerCase() === expected
      : (ch: string) => ch === expected;

    return modifiers.negated ? (ch) => !isEqual(ch) : isEqual;
  }
}

export class RegexIntrinsicNode<TokenType> extends RegexNode<TokenType> {
  public constructor(
    public readonly intrinsicName: string,
    public readonly calculator: (ch: string) => boolean
  ) {
    super();
  }

  public override readonly cacheable = false;

  public toString(): string {
    return "<" + this.intrinsicName + ">";
  }

  public children(): readonly RegexNode<TokenType>[] {
    return [];
  }

  public matchLengths(session: MatchSession<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    if (start >= session.input.length) return NO_MATCHES;

    const positive = this.calculator(session.input.charAt(start));
    const matched = modifiers.negated ? !positive : positive;

    return matched ? ONE_CHARACTER : NO_MATCHES;
  }

  public isNullable(): boolean {
    return false;
  }

  public isSingleCharacter(): boolean {
    return true;
  }

  public matchesCharacter(
    _environment: Map<string, RegexNode<TokenType>>,
    ch: string,
    modifiers: RegexNodeModifiers
  ): boolean {
    if (ch.length !== 1) return false;

    const positive = this.calculator(ch);
    return modifiers.negated ? !positive : positive;
  }

  public firstCharacters(
    _environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): CharacterFilter {
    return modifiers.negated ? (ch) => !this.calculator(ch) : (ch) => this.calculator(ch);
  }
}

/** The `.` construct: any character except a line break. */
export class RegexAnyNode<TokenType> extends RegexNode<TokenType> {
  public override readonly cacheable = false;

  public toString(): string {
    return ".";
  }

  public children(): readonly RegexNode<TokenType>[] {
    return [];
  }

  public matchLengths(session: MatchSession<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    if (start >= session.input.length) return NO_MATCHES;

    const isLineBreak = Character.isLineBreak(session.input.charAt(start));
    const matched = modifiers.negated ? isLineBreak : !isLineBreak;

    return matched ? ONE_CHARACTER : NO_MATCHES;
  }

  public isNullable(): boolean {
    return false;
  }

  public isSingleCharacter(): boolean {
    return true;
  }

  public matchesCharacter(
    _environment: Map<string, RegexNode<TokenType>>,
    ch: string,
    modifiers: RegexNodeModifiers
  ): boolean {
    if (ch.length !== 1) return false;

    const isLineBreak = Character.isLineBreak(ch);
    return modifiers.negated ? isLineBreak : !isLineBreak;
  }

  public firstCharacters(
    _environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): CharacterFilter {
    return modifiers.negated ? (ch) => Character.isLineBreak(ch) : (ch) => !Character.isLineBreak(ch);
  }
}

function inRange(item: { from: string; to: string }, ch: string): boolean {
  if (ch.length === 0) return false;

  const code = ch.codePointAt(0)!;
  return code >= item.from.codePointAt(0)! && code <= item.to.codePointAt(0)!;
}

export type ClassItem =
  { kind: "character"; ch: string } | { kind: "range"; from: string; to: string } | { kind: "variable"; name: string };

/** The `[a-z0-9]` construct. */
export class RegexClassNode<TokenType> extends RegexNode<TokenType> {
  public override readonly cacheable = false;

  public constructor(
    public readonly items: readonly ClassItem[],
    public readonly negated: boolean,
    public readonly caseInsensitive: boolean
  ) {
    super();
  }

  public toString(): string {
    const items = this.items
      .map((item) => {
        if (item.kind === "character") return /^[A-Za-z0-9_]$/.test(item.ch) ? item.ch : "\\" + item.ch;
        if (item.kind === "range") return item.from + "-" + item.to;
        return "${" + item.name + "}";
      })
      .join("");

    return "[" + (this.negated ? "^" : "") + items + "]" + (this.caseInsensitive ? "^" : "");
  }

  public children(): readonly RegexNode<TokenType>[] {
    return [];
  }

  public test(environment: Map<string, RegexNode<TokenType>>, ch: string, modifiers: RegexNodeModifiers): boolean {
    let found = false;

    for (const item of this.items) {
      if (item.kind === "character") {
        const equal = modifiers.caseInsensitive ? ch.toLowerCase() === item.ch.toLowerCase() : ch === item.ch;
        if (equal) found = true;
      } else if (item.kind === "range") {
        if (inRange(item, ch)) found = true;
        else if (modifiers.caseInsensitive && (inRange(item, ch.toLowerCase()) || inRange(item, ch.toUpperCase())))
          found = true;
      } else {
        const target = environment.get(item.name);
        if (target !== undefined && target.matchesCharacter(environment, ch, modifiers)) found = true;
      }

      if (found) break;
    }

    return this.negated ? !found : found;
  }

  public matchLengths(session: MatchSession<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    if (start >= session.input.length) return NO_MATCHES;

    return this.matchesCharacter(session.environment, session.input.charAt(start), modifiers)
      ? ONE_CHARACTER
      : NO_MATCHES;
  }

  public isNullable(): boolean {
    return false;
  }

  public isSingleCharacter(): boolean {
    return true;
  }

  public matchesCharacter(
    environment: Map<string, RegexNode<TokenType>>,
    ch: string,
    modifiers: RegexNodeModifiers
  ): boolean {
    if (ch.length !== 1) return false;

    const matched = this.test(environment, ch, {
      caseInsensitive: modifiers.caseInsensitive || this.caseInsensitive,
      negated: false,
    });

    return modifiers.negated ? !matched : matched;
  }

  public firstCharacters(
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): CharacterFilter | null {
    const inner: RegexNodeModifiers = {
      caseInsensitive: modifiers.caseInsensitive || this.caseInsensitive,
      negated: false,
    };

    return modifiers.negated ? (ch) => !this.test(environment, ch, inner) : (ch) => this.test(environment, ch, inner);
  }
}

export class RegexConcatenationNode<TokenType> extends RegexNode<TokenType> {
  public constructor(public readonly nodes: RegexNode<TokenType>[]) {
    super();
  }

  public toString(): string {
    return this.nodes.map((node) => node.toString()).join("");
  }

  public children(): readonly RegexNode<TokenType>[] {
    return this.nodes;
  }

  public matchLengths(session: MatchSession<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    if (this.nodes.length === 1) return session.lengths(this.nodes[0], start, modifiers);

    let consumed: number[] = [0];

    for (const node of this.nodes) {
      const next = new Lengths();

      for (const length of consumed) {
        for (const match of session.lengths(node, start + length, modifiers)) next.add(length + match);
      }

      if (next.empty) return NO_MATCHES;
      consumed = next.toArray();
    }

    return consumed;
  }

  public isNullable(environment: Map<string, RegexNode<TokenType>>, visiting?: Set<string>): boolean {
    return this.nodes.every((node) => node.isNullable(environment, visiting));
  }

  public isSingleCharacter(environment: Map<string, RegexNode<TokenType>>): boolean {
    return this.nodes.length === 1 && this.nodes[0].isSingleCharacter(environment);
  }

  public firstCharacters(
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): CharacterFilter | null {
    const filters: CharacterFilter[] = [];

    for (const node of this.nodes) {
      const filter = node.firstCharacters(environment, modifiers);

      // An unknown filter means "could be anything", so the whole concatenation
      // can start with any character.
      if (filter === null) return null;

      filters.push(filter);
      if (!node.isNullable(environment)) break;
    }

    return orFilters(filters);
  }
}

export class RegexEitherNode<TokenType> extends RegexNode<TokenType> {
  public constructor(public readonly nodes: RegexNode<TokenType>[]) {
    super();
  }

  public toString(): string {
    return this.nodes.map((node) => node.toString()).join("|");
  }

  public children(): readonly RegexNode<TokenType>[] {
    return this.nodes;
  }

  public matchLengths(session: MatchSession<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    if (this.nodes.length === 1) return session.lengths(this.nodes[0], start, modifiers);

    const matches = new Lengths();

    for (const node of this.nodes) for (const length of session.lengths(node, start, modifiers)) matches.add(length);

    return matches.toArray();
  }

  public isNullable(environment: Map<string, RegexNode<TokenType>>, visiting?: Set<string>): boolean {
    return this.nodes.some((node) => node.isNullable(environment, visiting));
  }

  public isSingleCharacter(environment: Map<string, RegexNode<TokenType>>): boolean {
    return this.nodes.every((node) => node.isSingleCharacter(environment));
  }

  public matchesCharacter(
    environment: Map<string, RegexNode<TokenType>>,
    ch: string,
    modifiers: RegexNodeModifiers
  ): boolean {
    return this.nodes.some((node) => node.matchesCharacter(environment, ch, modifiers));
  }

  public firstCharacters(
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): CharacterFilter | null {
    const filters: CharacterFilter[] = [];

    for (const node of this.nodes) {
      const filter = node.firstCharacters(environment, modifiers);
      if (filter === null) return null;

      filters.push(filter);
    }

    return orFilters(filters);
  }
}

export class RegexVariableNode<TokenType> extends RegexNode<TokenType> {
  public constructor(public readonly variableName: string) {
    super();
  }

  public toString(): string {
    return "${" + this.variableName + "}";
  }

  public children(): readonly RegexNode<TokenType>[] {
    return [];
  }

  public matchLengths(session: MatchSession<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    const root = session.environment.get(this.variableName);
    if (root === undefined) return NO_MATCHES;

    return session.lengths(root, start, modifiers);
  }

  public isNullable(environment: Map<string, RegexNode<TokenType>>, visiting: Set<string> = new Set()): boolean {
    const root = environment.get(this.variableName);
    if (root === undefined) return false;
    if (visiting.has(this.variableName)) return false;

    const next = new Set(visiting);
    next.add(this.variableName);
    return root.isNullable(environment, next);
  }

  public isSingleCharacter(environment: Map<string, RegexNode<TokenType>>): boolean {
    const root = environment.get(this.variableName);
    return root !== undefined && root.isSingleCharacter(environment);
  }

  public firstCharacters(
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): CharacterFilter | null {
    const root = environment.get(this.variableName);
    if (root === undefined) return null;

    return root.firstCharacters(environment, modifiers);
  }

  public matchesCharacter(
    environment: Map<string, RegexNode<TokenType>>,
    ch: string,
    modifiers: RegexNodeModifiers
  ): boolean {
    const root = environment.get(this.variableName);
    return root !== undefined && root.matchesCharacter(environment, ch, modifiers);
  }
}

/**
 * A group, optionally negated with `!`, optionally case insensitive with `^`,
 * and optionally repeated with `*`, `+`, `?` or `{n,m}`.
 */
export class RegexGroupingNode<TokenType> extends RegexNode<TokenType> {
  public constructor(
    public readonly internalNode: RegexNode<TokenType>,
    public readonly quantifier: Quantifier = EXACTLY_ONCE,
    public readonly caseInsensitive: boolean = false,
    public readonly negated: boolean = false
  ) {
    super();
  }

  public toString(): string {
    const { min, max } = this.quantifier;

    let suffix = "";
    if (min === 0 && max === 1) suffix = "?";
    else if (min === 0 && max === Infinity) suffix = "*";
    else if (min === 1 && max === Infinity) suffix = "+";
    else if (min !== 1 || max !== 1) suffix = "{" + min + (max === Infinity ? "," : max === min ? "" : "," + max) + "}";

    const body = this.internalNode.toString();
    const grouped = this.internalNode instanceof RegexGroupingNode || suffix === "" ? "(" + body + ")" : body;

    return grouped + (this.caseInsensitive ? "^" : "") + suffix + (this.negated ? "!" : "");
  }

  public children(): readonly RegexNode<TokenType>[] {
    return [this.internalNode];
  }

  public matchLengths(session: MatchSession<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    const { min, max } = this.quantifier;
    const inner = mod(modifiers, modifiers.caseInsensitive || this.caseInsensitive, modifiers.negated || this.negated);

    // A group without a repetition only forwards its modifiers.
    if (min === 1 && max === 1) return session.lengths(this.internalNode, start, inner);

    if (this.deterministic) return this.matchDeterministic(session, start, inner);

    const results: number[] = [];
    // Every offset is discovered once and expanded once, which keeps the search
    // linear in the length of the input instead of exponential.
    const discovered = new Set<number>([0]);

    // Two buffers are swapped on every round so that scanning a long token does
    // not allocate once per character.
    let frontier: number[] = [0];
    let next: number[] = [];

    if (min === 0) results.push(0);

    let repetitions = 0;

    while (repetitions < max) {
      next.length = 0;

      for (const length of frontier) {
        for (const match of session.lengths(this.internalNode, start + length, inner)) {
          const total = length + match;
          if (discovered.has(total)) continue;

          discovered.add(total);
          next.push(total);
          if (repetitions + 1 >= min) results.push(total);
        }
      }

      if (next.length === 0) break;

      const previous = frontier;
      frontier = next;
      next = previous;
      repetitions++;
    }

    return results;
  }

  /**
   * Set during validation. When the group always consumes the same amount of
   * characters per repetition, matching it is a plain loop.
   */
  public deterministic = false;

  /** Matches a repetition whose inner node has at most one match per position. */
  private matchDeterministic(session: MatchSession<TokenType>, start: number, modifiers: RegexNodeModifiers): number[] {
    const { min, max } = this.quantifier;
    const results: number[] = [];

    if (min === 0) results.push(0);

    let offset = 0;
    let repetitions = 0;

    while (repetitions < max) {
      const matches = session.lengths(this.internalNode, start + offset, modifiers);
      const step = matches.length === 0 ? 0 : matches[0];

      // An empty match cannot make progress, and matches[0] === 0 is the only
      // way that happens for a deterministic node.
      if (step === 0) break;

      offset += step;
      repetitions++;
      if (repetitions >= min) results.push(offset);
    }

    return results;
  }

  public isNullable(environment: Map<string, RegexNode<TokenType>>, visiting?: Set<string>): boolean {
    if (this.quantifier.min === 0) return true;

    return this.internalNode.isNullable(environment, visiting);
  }

  public isSingleCharacter(environment: Map<string, RegexNode<TokenType>>): boolean {
    if (this.quantifier.min !== 1 || this.quantifier.max !== 1) return false;

    return this.internalNode.isSingleCharacter(environment);
  }

  public firstCharacters(
    environment: Map<string, RegexNode<TokenType>>,
    modifiers: RegexNodeModifiers
  ): CharacterFilter | null {
    if (this.quantifier.min === 0) return null;

    return this.internalNode.firstCharacters(
      environment,
      mod(modifiers, modifiers.caseInsensitive || this.caseInsensitive, modifiers.negated || this.negated)
    );
  }

  public matchesCharacter(
    environment: Map<string, RegexNode<TokenType>>,
    ch: string,
    modifiers: RegexNodeModifiers
  ): boolean {
    if (this.quantifier.min !== 1 || this.quantifier.max !== 1) return false;

    return this.internalNode.matchesCharacter(
      environment,
      ch,
      mod(modifiers, modifiers.caseInsensitive || this.caseInsensitive, modifiers.negated || this.negated)
    );
  }
}

function orFilters(filters: CharacterFilter[]): CharacterFilter | null {
  if (filters.length === 0) return null;
  if (filters.length === 1) return filters[0];

  return (ch) => filters.some((filter) => filter(ch));
}

/**
 * True when `node` can match more than one length at a position, or can match
 * the empty string. Both make matching ambiguous, so the nodes around them are
 * the ones that need memoization and backtracking bookkeeping.
 */
export function isAmbiguous<TokenType>(
  node: RegexNode<TokenType>,
  environment: Map<string, RegexNode<TokenType>>,
  visiting: Set<string> = new Set()
): boolean {
  if (node instanceof RegexGroupingNode) {
    if (node.quantifier.min !== 1 || node.quantifier.max !== 1) return true;
  }

  if (node instanceof RegexVariableNode) {
    if (visiting.has(node.variableName)) return false;

    const target = environment.get(node.variableName);
    if (target === undefined) return false;

    const next = new Set(visiting);
    next.add(node.variableName);
    if (isAmbiguous(target, environment, next)) return true;
  }

  if (node instanceof RegexEitherNode) {
    let ambiguous = 0;
    let nullable = 0;

    for (const child of node.children()) {
      if (child.isNullable(environment)) nullable++;
      if (isAmbiguous(child, environment, visiting)) ambiguous++;
    }

    return nullable > 0 || ambiguous > 1;
  }

  return node.children().some((child) => isAmbiguous(child, environment, visiting));
}

/**
 * True when matching `node` at a position can only ever produce one length, and
 * never zero. Such nodes are scanned with a plain loop instead of the general
 * search, which is what most rules are made of.
 */
export function isDeterministic<TokenType>(
  node: RegexNode<TokenType>,
  environment: Map<string, RegexNode<TokenType>>,
  visiting: Set<string> = new Set()
): boolean {
  if (node instanceof RegexGroupingNode) {
    if (node.quantifier.min !== 1 || node.quantifier.max !== 1) return false;
  }

  if (node instanceof RegexVariableNode) {
    if (visiting.has(node.variableName)) return false;

    const target = environment.get(node.variableName);
    if (target === undefined) return false;

    const next = new Set(visiting);
    next.add(node.variableName);
    return isDeterministic(target, environment, next);
  }

  return node.children().every((child) => isDeterministic(child, environment, visiting));
}

/** Calls `visit` for `node` and every node below it. */
export function walkNodes<TokenType>(node: RegexNode<TokenType>, visit: (node: RegexNode<TokenType>) => void): void {
  visit(node);
  for (const child of node.children()) walkNodes(child, visit);
}

/** Every rule name referenced by `node`. */
export function collectVariables<TokenType>(node: RegexNode<TokenType>): string[] {
  const names: string[] = [];

  walkNodes(node, (current) => {
    if (current instanceof RegexVariableNode && !names.includes(current.variableName)) {
      names.push(current.variableName);
    }
  });

  return names;
}

enum RegexTokenType {
  LITERAL,
  PIPE,
  ASTERISK,
  EXCLAMATION,
  PLUS,
  CARAT,
  VARIABLE,
  LPAREN,
  RPAREN,
  QUESTION,
  DOT,
  LBRACE,
  RBRACE,
  LBRACKET,
  RBRACKET,
}

const TOKEN_NAMES: { [key: number]: string } = {
  [RegexTokenType.LITERAL]: "a literal",
  [RegexTokenType.PIPE]: "'|'",
  [RegexTokenType.ASTERISK]: "'*'",
  [RegexTokenType.EXCLAMATION]: "'!'",
  [RegexTokenType.PLUS]: "'+'",
  [RegexTokenType.CARAT]: "'^'",
  [RegexTokenType.VARIABLE]: "a variable reference",
  [RegexTokenType.LPAREN]: "'('",
  [RegexTokenType.RPAREN]: "')'",
  [RegexTokenType.QUESTION]: "'?'",
  [RegexTokenType.DOT]: "'.'",
  [RegexTokenType.LBRACE]: "'{'",
  [RegexTokenType.RBRACE]: "'}'",
  [RegexTokenType.LBRACKET]: "'['",
  [RegexTokenType.RBRACKET]: "']'",
};

/** Characters that keep their meaning inside a character class. */
const CLASS_LITERALS: { [key: number]: string } = {
  [RegexTokenType.ASTERISK]: "*",
  [RegexTokenType.PLUS]: "+",
  [RegexTokenType.QUESTION]: "?",
  [RegexTokenType.EXCLAMATION]: "!",
  [RegexTokenType.PIPE]: "|",
  [RegexTokenType.LPAREN]: "(",
  [RegexTokenType.RPAREN]: ")",
  [RegexTokenType.LBRACE]: "{",
  [RegexTokenType.RBRACE]: "}",
  [RegexTokenType.CARAT]: "^",
  [RegexTokenType.DOT]: ".",
};

function classLiteral(token: RegexToken): string | undefined {
  return token.type === RegexTokenType.LITERAL ? token.value : CLASS_LITERALS[token.type];
}

class RegexToken {
  public constructor(
    public readonly type: RegexTokenType,
    public readonly value: string,
    public readonly index: number
  ) {}

  public toString(): string {
    return "Type: " + (TOKEN_NAMES[this.type] ?? this.type) + ". Value: " + this.value;
  }
}

/**
 * Characters that always mean themselves. Everything else has to be escaped
 * with `$` or `\` so that typos are reported instead of silently changing the
 * meaning of a rule.
 */
const BARE_LITERALS = "_-,";

const OPERATORS: { [character: string]: RegexTokenType } = {
  "|": RegexTokenType.PIPE,
  "*": RegexTokenType.ASTERISK,
  "+": RegexTokenType.PLUS,
  "?": RegexTokenType.QUESTION,
  "!": RegexTokenType.EXCLAMATION,
  "^": RegexTokenType.CARAT,
  "(": RegexTokenType.LPAREN,
  ")": RegexTokenType.RPAREN,
  "{": RegexTokenType.LBRACE,
  "}": RegexTokenType.RBRACE,
  "[": RegexTokenType.LBRACKET,
  "]": RegexTokenType.RBRACKET,
  ".": RegexTokenType.DOT,
};

const ESCAPES: { [character: string]: string } = {
  n: "\n",
  t: "\t",
  r: "\r",
  f: "\f",
  v: "\v",
  0: "\0",
  "\\": "\\",
  $: "$",
  "{": "{",
  "}": "}",
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "|": "|",
  "*": "*",
  "+": "+",
  "?": "?",
  "^": "^",
  "!": "!",
  ".": ".",
  "-": "-",
  _: "_",
  " ": " ",
};

const VARIABLE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * Turns a rule expression into tokens.
 *
 * Two escape syntaxes are supported: the historical `$x` form (where `$`
 * escapes whatever follows it) and backslash escapes (`\n`, `\\`, `\[`).
 */
export class RegexLexer {
  public tokens: RegexToken[] = [];
  public index = 0;

  public constructor(
    public readonly expression: string,
    public readonly ruleName?: string
  ) {}

  public lex(): RegexToken[] {
    while (this.index < this.expression.length) {
      const ch = this.expression.charAt(this.index);

      if (ch === "$") this.readDollarEscape();
      else if (ch === "\\") this.readBackslashEscape();
      else if (BARE_LITERALS.includes(ch) || Character.isAlphabetic(ch) || Character.isDigit(ch)) {
        this.push(RegexTokenType.LITERAL, ch);
        this.index++;
      } else if (OPERATORS[ch] !== undefined) {
        this.push(OPERATORS[ch], ch);
        this.index++;
      } else if (Character.isWhitespace(ch)) this.index++;
      else
        this.error(
          `unexpected character ${JSON.stringify(ch)} (write "$${ch}" or "\\${ch}" to match it literally)`,
          this.index
        );
    }

    return this.tokens;
  }

  private push(type: RegexTokenType, value: string, index: number = this.index): void {
    this.tokens.push(new RegexToken(type, value, index));
  }

  private error(message: string, index: number): never {
    throw new RegexSyntaxError(message, this.expression, index, this.ruleName);
  }

  /** `$x` matches `x` literally, `$` at the end of the expression matches `{`. */
  private readDollarEscape(): void {
    const start = this.index;
    const next = this.expression.charAt(start + 1);

    if (next === "") this.error("dangling '$' at the end of the expression (write '$$' for a literal '$')", start);

    if (next === "{") {
      // "${" on its own is the historical way to match a literal "{".
      if (this.expression.length === start + 2) {
        this.push(RegexTokenType.LITERAL, "{", start);
        this.index = start + 2;
        return;
      }

      let cursor = start + 2;
      let name = "";

      while (cursor < this.expression.length && this.expression.charAt(cursor) !== "}") {
        name += this.expression.charAt(cursor);
        cursor++;
      }

      if (cursor >= this.expression.length)
        this.error(`unterminated variable reference, expected '}' to close '${name}'`, start);

      if (!VARIABLE_NAME.test(name)) this.error(`"${name}" is not a valid rule name`, start + 2);

      this.push(RegexTokenType.VARIABLE, name, start);
      this.index = cursor + 1;
      return;
    }

    this.push(RegexTokenType.LITERAL, next, start);
    this.index = start + 2;
  }

  private readBackslashEscape(): void {
    const start = this.index;
    const next = this.expression.charAt(start + 1);

    if (next === "") this.error("dangling '\\' at the end of the expression", start);

    // Backslash escapes: \n and friends, plus any punctuation character, which
    // simply stands for itself (\{ is a literal brace, \[ a literal bracket).
    const resolved = ESCAPES[next];
    if (resolved === undefined && (Character.isAlphabetic(next) || Character.isDigit(next)))
      this.error(`unknown escape sequence '\\${next}'`, start);

    this.push(RegexTokenType.LITERAL, resolved ?? next, start);
    this.index = start + 2;
  }
}

export class RegexParser<TokenType> {
  public currentTokenIndex = 0;

  public constructor(
    public readonly tokens: RegexToken[],
    public readonly ruleName?: string,
    public readonly expression: string = ""
  ) {}

  public parse(): RegexNode<TokenType> {
    if (this.tokens.length === 0)
      throw new RegexSyntaxError("the expression is empty", this.expression, 0, this.ruleName);

    const node = this.parseAlternation();

    const trailing = this.peek();
    if (trailing !== undefined)
      this.error(`unexpected ${TOKEN_NAMES[trailing.type] ?? trailing.value}`, trailing.index);

    return node;
  }

  private peek(offset: number = 0): RegexToken | undefined {
    return this.tokens[this.currentTokenIndex + offset];
  }

  private error(message: string, index: number): never {
    throw new RegexSyntaxError(message, this.expression, index, this.ruleName);
  }

  private parseAlternation(): RegexNode<TokenType> {
    const alternatives = [this.parseConcatenation()];

    while (this.peek()?.type === RegexTokenType.PIPE) {
      this.currentTokenIndex++;
      alternatives.push(this.parseConcatenation());
    }

    return alternatives.length > 1 ? new RegexEitherNode(alternatives) : alternatives[0];
  }

  private parseConcatenation(): RegexNode<TokenType> {
    const nodes: RegexNode<TokenType>[] = [];

    while (this.currentTokenIndex < this.tokens.length) {
      const type = this.peek()!.type;
      if (type === RegexTokenType.PIPE || type === RegexTokenType.RPAREN) break;

      nodes.push(this.parseTerminal());
    }

    if (nodes.length === 0) {
      const token = this.peek();
      this.error(
        token === undefined
          ? "unexpected end of expression"
          : `expected an expression, found ${TOKEN_NAMES[token.type]}`,
        token === undefined ? this.expression.length : token.index
      );
    }

    return nodes.length > 1 ? new RegexConcatenationNode(nodes) : nodes[0];
  }

  private parseTerminal(): RegexNode<TokenType> {
    const token = this.peek()!;

    switch (token.type) {
      case RegexTokenType.LPAREN: {
        this.currentTokenIndex++;

        if (this.peek()?.type === RegexTokenType.RPAREN) this.error("empty groups are not allowed", token.index);

        const internalNode = this.parseAlternation();
        const closing = this.peek();
        if (closing?.type !== RegexTokenType.RPAREN)
          this.error(
            closing === undefined ? "unclosed '(' group" : `expected ')', found ${TOKEN_NAMES[closing.type]}`,
            closing === undefined ? this.expression.length : closing.index
          );

        this.currentTokenIndex++;
        return this.applyModifiers(internalNode);
      }

      case RegexTokenType.LBRACKET:
        return this.applyModifiers(this.parseCharacterClass());

      case RegexTokenType.DOT: {
        this.currentTokenIndex++;
        return this.applyModifiers(new RegexAnyNode<TokenType>());
      }

      case RegexTokenType.LITERAL: {
        this.currentTokenIndex++;
        return this.applyModifiers(new RegexLiteralNode<TokenType>(token.value));
      }

      case RegexTokenType.VARIABLE: {
        this.currentTokenIndex++;
        return this.applyModifiers(new RegexVariableNode<TokenType>(token.value));
      }

      default:
        this.error(`expected an expression, found ${TOKEN_NAMES[token.type] ?? token.value}`, token.index);
    }
  }

  /** Applies every stacked modifier: `?`, `*`, `+`, `^`, `!` and `{n,m}`. */
  private applyModifiers(node: RegexNode<TokenType>): RegexNode<TokenType> {
    let current = node;

    while (true) {
      const token = this.peek();
      if (token === undefined) break;

      switch (token.type) {
        case RegexTokenType.CARAT:
          this.currentTokenIndex++;
          current = new RegexGroupingNode(current, EXACTLY_ONCE, true, false);
          break;

        case RegexTokenType.ASTERISK:
          this.currentTokenIndex++;
          current = new RegexGroupingNode(current, ZERO_OR_MORE, false, false);
          break;

        case RegexTokenType.PLUS:
          this.currentTokenIndex++;
          current = new RegexGroupingNode(current, ONE_OR_MORE, false, false);
          break;

        case RegexTokenType.QUESTION:
          this.currentTokenIndex++;
          current = new RegexGroupingNode(current, OPTIONAL, false, false);
          break;

        case RegexTokenType.EXCLAMATION:
          this.currentTokenIndex++;
          current = new RegexGroupingNode(current, EXACTLY_ONCE, false, true);
          break;

        case RegexTokenType.LBRACE:
          current = new RegexGroupingNode(current, this.parseRepetition(), false, false);
          break;

        default:
          return current;
      }
    }

    return current;
  }

  private parseRepetition(): Quantifier {
    const open = this.peek()!;
    this.currentTokenIndex++;

    const min = this.parseCount();
    let max = min;

    if (this.peek()?.type === RegexTokenType.LITERAL && this.peek()!.value === ",") {
      this.currentTokenIndex++;
      max = this.parseCount() ?? Infinity;
    }

    const closing = this.peek();
    if (closing?.type !== RegexTokenType.RBRACE)
      this.error(
        closing === undefined
          ? "unclosed '{' repetition, expected '}'"
          : `expected '}', found ${TOKEN_NAMES[closing.type]}`,
        closing === undefined ? this.expression.length : closing.index
      );

    this.currentTokenIndex++;

    if (min === undefined && max === undefined)
      this.error("expected a repetition count, for example {2} or {2,4}", open.index);

    const minimum = min ?? 0;
    const maximum = max ?? minimum;

    if (minimum > maximum) this.error(`repetition bounds are inverted: {${minimum},${maximum}}`, open.index);

    return { min: minimum, max: maximum };
  }

  private parseCount(): number | undefined {
    let digits = "";

    while (this.peek()?.type === RegexTokenType.LITERAL && /^[0-9]$/.test(this.peek()!.value)) {
      digits += this.peek()!.value;
      this.currentTokenIndex++;
    }

    return digits.length === 0 ? undefined : parseInt(digits, 10);
  }

  private parseCharacterClass(): RegexClassNode<TokenType> {
    const open = this.peek()!;
    this.currentTokenIndex++;

    let negated = false;
    if (this.peek()?.type === RegexTokenType.CARAT) {
      negated = true;
      this.currentTokenIndex++;
    }

    const items: ClassItem[] = [];

    while (true) {
      const token = this.peek();
      if (token === undefined) this.error("unclosed character class, expected ']'", open.index);
      if (token.type === RegexTokenType.RBRACKET) {
        this.currentTokenIndex++;
        break;
      }

      if (token.type === RegexTokenType.VARIABLE) {
        this.currentTokenIndex++;
        items.push({ kind: "variable", name: token.value });
        continue;
      }

      // Inside a class the operator characters stand for themselves, so
      // "[+*-]" works the way it does in other regular expression dialects.
      const ch = token.type === RegexTokenType.LITERAL ? token.value : CLASS_LITERALS[token.type];
      if (ch === undefined) this.error(`unexpected ${TOKEN_NAMES[token.type]} inside a character class`, token.index);

      this.currentTokenIndex++;

      const dash = this.peek();
      const afterDash = this.peek(1);
      const afterDashCh = afterDash === undefined ? undefined : classLiteral(afterDash);

      if (
        dash !== undefined &&
        dash.value === "-" &&
        dash.type === RegexTokenType.LITERAL &&
        afterDashCh !== undefined &&
        ch.codePointAt(0)! <= afterDashCh.codePointAt(0)!
      ) {
        this.currentTokenIndex += 2;
        items.push({ kind: "range", from: ch, to: afterDashCh });
      } else items.push({ kind: "character", ch });
    }

    if (items.length === 0) this.error("empty character classes are not allowed", open.index);

    return new RegexClassNode<TokenType>(items, negated, false);
  }
}
