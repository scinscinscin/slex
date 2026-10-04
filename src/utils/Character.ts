/**
 * Every checker answers a single question about a single character and never
 * throws: passing the empty string always answers `false`.
 */
export type Checker = (ch: string) => boolean;

const PROPERTY = {
  letter: /^\p{L}$/u,
  uppercaseLetter: /^\p{Lu}$/u,
  lowercaseLetter: /^\p{Ll}$/u,
  number: /^\p{N}$/u,
  mark: /^\p{M}$/u,
  control: /^\p{Cc}$/u,
  punctuation: /^\p{P}$/u,
  symbol: /^\p{S}$/u,
  separator: /^\p{Z}$/u,
  identifierStart: /^[\p{L}\p{Nl}_$]$/u,
  identifierPart: /^[\p{L}\p{N}\p{M}\p{Pc}_$]$/u,
} as const;

const DIGITS = /^[0-9]$/;
const HEX_DIGITS = /^[0-9A-Fa-f]$/;
const OCTAL_DIGITS = /^[0-7]$/;
const BINARY_DIGITS = /^[01]$/;

/**
 * Character tests are called once per character per rule per position, so the
 * results are memoized. The cache is bounded by the number of distinct
 * characters in the input, which is small in practice.
 */
function memoize(test: (ch: string) => boolean): Checker {
  const cache = new Map<string, boolean>();

  return (ch) => {
    const cached = cache.get(ch);
    if (cached !== undefined) return cached;

    const result = ch.length > 0 && test(ch);
    cache.set(ch, result);
    return result;
  };
}

export const initializeCharacter = (options: { whitespace?: string[] }) => {
  const whitespace = new Set(options.whitespace ?? [" ", "\t", "\n", "\r"]);

  return {
    isAny: (ch: string) => ch.length > 0,
    isDigit: memoize((ch) => DIGITS.test(ch)),
    isHexDigit: memoize((ch) => HEX_DIGITS.test(ch)),
    isOctalDigit: memoize((ch) => OCTAL_DIGITS.test(ch)),
    isBinaryDigit: memoize((ch) => BINARY_DIGITS.test(ch)),
    isAlphabetic: memoize((ch) => PROPERTY.letter.test(ch)),
    isAlphabeticUppercase: memoize((ch) => PROPERTY.uppercaseLetter.test(ch)),
    isAlphabeticLowercase: memoize((ch) => PROPERTY.lowercaseLetter.test(ch)),
    isNumber: memoize((ch) => PROPERTY.number.test(ch)),
    isMark: memoize((ch) => PROPERTY.mark.test(ch)),
    isControl: memoize((ch) => PROPERTY.control.test(ch)),
    isPunctuation: memoize((ch) => PROPERTY.punctuation.test(ch)),
    isSymbolic: memoize((ch) => PROPERTY.punctuation.test(ch) || PROPERTY.symbol.test(ch)),
    isSeparator: memoize((ch) => PROPERTY.separator.test(ch)),
    isIdentifierStart: memoize((ch) => PROPERTY.identifierStart.test(ch)),
    isIdentifierPart: memoize((ch) => PROPERTY.identifierPart.test(ch)),
    isLineBreak: (ch: string) =>
      ch === "\n" || ch === "\r" || ch === "\v" || ch === "\f" || ch === "\u2028" || ch === "\u2029",
    isWhitespace: (ch: string) => whitespace.has(ch),
  } satisfies { [key: string]: Checker };
};

export type CharacterCheckers = ReturnType<typeof initializeCharacter>;
