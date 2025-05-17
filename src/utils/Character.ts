export const Character = {
  isAlphabetic(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
  },

  isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  },

  isWhitespace(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
  },
};
