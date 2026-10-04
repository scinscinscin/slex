import { ColumnAndRow } from "./ColumnAndRow";

export class Token<Type, Metadata> {
  public readonly type: Type;
  public readonly lexeme: string;
  public readonly column: number;
  public readonly line: number;
  public readonly metadata: Metadata;
  /** Absolute character offset of the first character of the lexeme. */
  public readonly offset: number;

  public constructor(type: Type, lexeme: string, info: ColumnAndRow, metadata: Metadata, offset: number = 0) {
    this.type = type;
    this.lexeme = lexeme;
    this.column = info.getActualColumn();
    this.line = info.getActualRow();
    this.metadata = metadata;
    this.offset = offset;
  }
}
