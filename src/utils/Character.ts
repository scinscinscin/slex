type Checker = (ch: string, caseSensitive: boolean) => boolean;

export const initializeCharacter = (options: { whitespace?: string[] }) => {
  const whitespace = options.whitespace || [" ", "\t", "\n", "\r"];

  return {
    isDigit: (ch) => ch >= "0" && ch <= "9",
    isAlphabetic: (ch) => /^\p{L}+$/u.test(ch),
    isAlphabeticUppercase: (ch, negated) => (negated ? /^\p{L}+$/u.test(ch) : /^\p{Lu}+$/u.test(ch)),
    isAlphabeticLowercase: (ch) => /^\p{Ll}+$/u.test(ch),
    isControl: (ch) => /^\p{Cc}+$/u.test(ch),
    isSymbolic: (ch) => /^\p{P}+$/u.test(ch) || /^\p{S}+$/u.test(ch),
    isWhitespace: (ch) => whitespace.includes(ch),
  } satisfies { [key: string]: Checker };
};
