export class ColumnAndRow {
  public readonly column: number;
  public readonly row: number;

  public constructor(row: number, column: number) {
    this.column = column;
    this.row = row;
  }

  public getActualRow() {
    return this.row + 1;
  }

  public getActualColumn() {
    return this.column;
  }

  public static calculate(index: number, source: string): ColumnAndRow {
    const lines = source.split("\n", -1);
    let currentLine = 0;
    let column = index;

    for (; column > lines[currentLine].length; column -= lines[currentLine++].length + 1);

    return new ColumnAndRow(currentLine, column);
  }
}
