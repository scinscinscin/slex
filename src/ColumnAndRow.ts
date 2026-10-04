import { LineMap } from "./Position";

export class ColumnAndRow {
  public readonly column: number;
  public readonly row: number;

  public constructor(row: number, column: number) {
    this.column = column;
    this.row = row;
  }

  public getActualRow(): number {
    return this.row + 1;
  }

  public getActualColumn(): number {
    return this.column;
  }

  /**
   * Resolves `index` inside `source`. Out of range indexes are clamped instead
   * of throwing, and `\r\n` counts as a single line break.
   *
   * Prefer reusing a {@link LineMap} when resolving many indexes of the same
   * source, which is what the engine does.
   */
  public static calculate(index: number, source: string): ColumnAndRow {
    return ColumnAndRow.fromIndex(index, new LineMap(source));
  }

  /** Same as {@link ColumnAndRow.calculate}, reusing a precomputed line map. */
  public static fromIndex(index: number, lineMap: LineMap): ColumnAndRow {
    const { line, column } = lineMap.positionAt(index);
    return new ColumnAndRow(line - 1, column);
  }
}
