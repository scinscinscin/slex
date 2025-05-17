import { ColumnAndRow } from "./ColumnAndRow";

export class Token<Type, Metadata> {
  public readonly type: Type;
  public readonly lexeme: string;
  public readonly column: number;
  public readonly line: number;
  public readonly metadata: Metadata;

  public constructor(type: Type, lexeme: string, info: ColumnAndRow, metadata: Metadata) {
    this.type = type;
    this.lexeme = lexeme;
    this.column = info.getActualColumn();
    this.line = info.getActualRow();
    this.metadata = metadata;
  }
}
