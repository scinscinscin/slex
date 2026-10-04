/** Renders a single line of `source` with a caret pointing at `column`. */
function renderSnippet(source: string, line: number, column: number): string {
  const start = source.lastIndexOf("\n", Math.max(0, column) - 1) + 1;
  let end = source.indexOf("\n", start);
  if (end === -1) end = source.length;
  const text = source.slice(start, end).replace(/\r$/, "");
  const caret = " ".repeat(Math.max(0, column - start)) + "^";
  return `${text}\n${caret} (line ${line})`;
}

/** Base class for every error thrown by slex. */
export class SlexError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);

    if (options !== undefined && "cause" in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** Thrown when a rule expression cannot be tokenized or parsed. */
export class RegexSyntaxError extends SlexError {
  public constructor(
    message: string,
    public readonly expression: string,
    public readonly index: number,
    public readonly ruleName?: string
  ) {
    super(
      `${ruleName === undefined ? "" : `Rule "${ruleName}" is invalid: `}${message}\n` +
        `  in expression: ${JSON.stringify(expression)}\n` +
        `  ${" ".repeat(Math.max(0, Math.min(index, expression.length)))}^`
    );
  }

  /** One based line of {@link index} inside the expression. */
  public get line(): number {
    let line = 1;
    for (let i = 0; i < this.index && i < this.expression.length; i++) {
      if (this.expression.charAt(i) === "\n") line++;
    }
    return line;
  }

  /** Zero based column of {@link index} inside the expression. */
  public get column(): number {
    const lastBreak = this.expression.lastIndexOf("\n", Math.max(0, this.index) - 1);
    return this.index - lastBreak - 1;
  }
}

/** Everything slex knows about a position where scanning failed. */
export interface LexerErrorContext {
  /** Human readable explanation, matching the historical `reason` string. */
  reason: string;
  /** One based line number. */
  line: number;
  /** Zero based column number. */
  column: number;
  /** Absolute character offset into the input. */
  offset: number;
  /** The character that could not be scanned. */
  character: string;
  /** Names of the rules that were able to match this character. */
  expected: string[];
  /** The full input that was being scanned. */
  input: string;
  /** The offending line, with a caret under the character. */
  snippet: string;
}

/** Thrown (and returned) when the scanner cannot match any rule at a position. */
export class LexerError extends SlexError {
  public constructor(
    public readonly reason: string,
    public readonly line: number,
    public readonly column: number,
    public readonly offset: number,
    public readonly character: string,
    public readonly expected: string[] = [],
    public readonly input: string = ""
  ) {
    super(reason);
  }

  /** The offending line, with a caret under the character. */
  public get snippet(): string {
    return renderSnippet(this.input, this.line, this.offset);
  }

  /** Structured view of this error, handy for tooling and tests. */
  public toContext(): LexerErrorContext {
    return {
      reason: this.reason,
      line: this.line,
      column: this.column,
      offset: this.offset,
      character: this.character,
      expected: this.expected,
      input: this.input,
      snippet: this.snippet,
    };
  }
}
