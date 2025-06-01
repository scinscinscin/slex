export const initializeCharacter = (options: { whitespace?: string[] }) => {
  const whitespace = options.whitespace || [" ", "\t", "\n", "\r"];

  return {
    isDigit: (ch: string) => ch >= "0" && ch <= "9",
    isAlphabetic: (ch: string) => /^\p{L}+$/u.test(ch),
    isAlphabeticUppercase: (ch: string) => /^\p{Lu}+$/u.test(ch),
    isAlphabeticLowercase: (ch: string) => /^\p{Ll}+$/u.test(ch),
    isControl: (ch: string) => /^\p{Cc}+$/u.test(ch),
    isSymbolic: (ch: string) => /^\p{P}+$/u.test(ch) || /^\p{S}+$/u.test(ch),
    isWhitespace: (ch: string) => whitespace.includes(ch),
  };
};
