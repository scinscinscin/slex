/**
 * Maps character offsets to line/column pairs.
 *
 * The line starts are computed once and looked up with a binary search, so
 * computing the position of a token is O(log lines) instead of re-scanning the
 * whole input for every token.
 */
export class LineMap {
  private readonly lineStarts: number[];

  public constructor(private readonly source: string) {
    const lineStarts = [0];

    for (let index = 0; index < source.length; index++) {
      const ch = source.charAt(index);

      if (ch === "\n") lineStarts.push(index + 1);
      else if (ch === "\r") {
        // "\r\n" is a single line break, reported by the "\n" branch.
        if (source.charAt(index + 1) !== "\n") lineStarts.push(index + 1);
      }
    }

    this.lineStarts = lineStarts;
  }

  /** One based line and zero based column of `index`, clamped to the input. */
  public positionAt(index: number): { line: number; column: number } {
    const offset = Math.max(0, Math.min(index, this.source.length));

    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }

    return { line: low + 1, column: offset - this.lineStarts[low] };
  }

  /** Number of lines in the source. */
  public get lineCount(): number {
    return this.lineStarts.length;
  }
}
