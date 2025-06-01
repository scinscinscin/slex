## Slex - Scin's Lexing Library

Slex allows developers to easily create lexers using regular expressions that can emit tokens.

## Getting started

To get started, create a new TypeScript project and install `@scinorandex/slex`.

Enumerate the types of tokens your language has, make sure to implement an `EOF` (end of file) token too: 

```ts
enum TokenType {
  PLUS, MINUS, STAR, SLASH, NUMBER, EOF
}
```

Then create your lexer generator and define the rules it uses to generate tokens:

```ts
// You can define metadata that the tokens will have, like source file paths
type Metadata = {};

const lexerGenerator = new Slex<TokenType, Metadata>({
  EOF_TYPE: TokenType.EOF,

  // This is used to define precdence between keywords, 
  // like keywords ("if", "else") vs identifiers
  // 
  // For this example, the return is false beacuse 
  // there's no ambiguity when it comes to token types
  isHigherPrecedence: ({ current, next }) => false,
});

lexerGenerator.addRule("plus", "$+", TokenType.PLUS);
lexerGenerator.addRule("minus", "$-", TokenType.MINUS);
lexerGenerator.addRule("star", "$*", TokenType.STAR);
lexerGenerator.addRule("forward_slash", "$/", TokenType.SLASH);
lexerGenerator.addRule("float_number", "(${__decimal_digit})+$.(${__decimal_digit})+");
lexerGenerator.addRule("decimal_number", "(${__decimal_digit})+");
lexerGenerator.addRule("number_literal", "${float_number}|${decimal_number}", TokenType.NUMBER);
```

Rules are added using the `addRule()` method, which has the following parameters:
 - `name` - provide a name to the regular definition, allowing other definitions to refer to this definition
 - `expression` - this is the actual regular expression used when scanning. Refer to [the following section](#regular-expression-syntax) to see how it works.
 - `token_type` (optional) - this associates a token type to the regular defintion, meaning the lexer will output tokens of this type. When not provided, the definition will not be used to begin new tokens, and can only be referred by other definitions.
 - `transformer` (optional) - transforms the lexeme detected.

Finally, you can begin lexing:

```ts
// Generate your lexer by providing the input string and the metadata generator
const lexer = lexerGenerator.generate(`2.4 + 3.5 * 1 / 456.789`, () => ({}));

while (lexer.hasNextToken()) {
  const token = lexer.getNextToken();
  console.log(
    "Token: " + TokenType[token.type] +  ". Lexeme: " + token.lexeme + 
    ". Column: " + token.column + ". Line: " + token.line
  );
}
```

**Output:**

```
Token: NUMBER. Lexeme: 2.4. Column: 0. Line: 1
Token: PLUS. Lexeme: +. Column: 4. Line: 1
Token: NUMBER. Lexeme: 3.5. Column: 6. Line: 1
Token: STAR. Lexeme: *. Column: 10. Line: 1
Token: NUMBER. Lexeme: 1. Column: 12. Line: 1
Token: SLASH. Lexeme: /. Column: 14. Line: 1
Token: NUMBER. Lexeme: 456.789. Column: 16. Line: 1
```

### Regular Expression Syntax

|   Construct   |                                                    Action                                                    |   Example    |
| :-----------: | :----------------------------------------------------------------------------------------------------------: | :----------: |
| Concatenation |                           Represents the concatenation of multiple rules together.                           |    $R1R2$    |
|    Either     |                              Represents possibilities between different rules.                               |  $R1 \| R2$  |
|  Kleene-star  | Groups multiple rules together and dictates that they may appear zero or multiple times in the input string. |   $(R1)*$    |
|  Kleene-plus  |     Groups multiple rules together and dictate that they must appear at least once in the input string.      |   $(R1)+$    |
|   Negation    |  Groups multiple rules together and negates them. This is only meaningful with groups of single characters.  |   $(R1)!$    |
|   Grouping    |                     Groups multiple rules together so they are treated as a single rule.                     |    $(R1)$    |
|    Literal    |                                    Represents a single character literal.                                    |     $a$      |
|   Variable    |                                    Represents another regular definition.                                    | $\$\{name\}$ |

For literals, non-alphanumeric characters must be escaped using the $ symbol. Example: to represent the tab character as a character literal, it must be encoded in the regular expression as "$\t"


### Built in character classes

Slex contains built-in unicode character classes to match frequently used sets of literals. These are available as variables inside regular expression strings.

 - `__decimal_digit` - matches `0` - `9`
 - `__letter` - matches Unicode character classes `L`
 - `__uppercase_letter` - matches Unicode character classes `Lu`
 - `__lowercase_letter` - matches Unicode character classes `Ll`
 - `__symbols` - matches Unicode character `P` and `S`
 - `__control_character` - matches Unicode character classes `Cc`

## API Reference

### `Slex<TokenType, Metadata>` class

**Constructor**

`new Slex<TokenType, Metadata>(SlexOptions)` - creates a new lexer generator instance. `SlexOptions` interface has the following properties:
 - `EOF_TYPE: TokenType;` - specifies the TokenType to be used when the end of the file has been reached.
 - `isHigherPrecedence: (options: { current: TokenType; next: TokenType }) => boolean;` - specifies the precendence order of tokens types
 - `whitespaceCharacters?: string[];` - specifies the list of whitespace tokens to skip in the input. Defaults to `[" ", "\n", "\r", "\t"]`
   -  Before attempting to match a token, the scanner removes all characters at the beginning of the input belogning in this array. 
 - `ignoreTokens?: TokenType[];` - specify a list of tokens to match but not emit, skipping them when encountered

**Methods:**

 - `addRule(definitionName: string, regularExpression: string, emit?: TokenType, transformer?: (lexeme: string) => string): void`
   -  `definitionName: string` - the name of the regular definition
   -  `regularExpression: string` - the regular expression that matches the token
   -  `emit?: TokenType` - the type of the token to be emitted when the regular expression has been matched. When not provided, the definition is only used when called from a variable in another definition's pattern.
   -  `transformer?: (lexeme: string) => string` - a transformer to be applied on the matched lexeme
-  `generate(input: string, metadataGenerator: () => Metadata): RegexEngine`
   -  `input: string` - the input to be scanned
   -  `metadataGenerator: () => Metadata` - a function which generates the metadata for the emitted token

---

### `RegexEngine<TokenType, Metadata>` class

**Methods**

 - `hasNextToken(): boolean` - returns true if the lexer is not at the end of the input yet
 - `peekNextToken(): Token<TokenType, Metadata>` - returns the next token in the input, **without consuming it**
   - this method throws an Error if the scanner failed to match any tokens
 - `tryPeekNextToken(): TokenResult<TokenType, Metadata>` - returns the next token in the input, **without consuming it**
 - `getNextToken(): Token<TokenType, Metadata>` - returns the next token in the input, consuming it in the process
   - this method throws an Error if the scanner failed to match any tokens
 - `tryGetNextToken(): TokenResult<TokenType, Metadata>` - returns the next token in the input, consuming it in the process

---

### `TokenResult<TokenType, Metadata` interface

This interface is used to represent the result of scanning, without throwing an Error.

```ts
export type TokenResult<TokenType, Metadata> =
  | { success: true; token: Token<TokenType, Metadata> }
  | { success: false; reason: string; line: number; column: number };
```

## Realistic Examples

You can view an example lexer for a toy programming language based on League of Legends in [examples/basic.ts](./examples/basic.ts). This example shows common usecases like keywords, specific symbols, and comment handling.