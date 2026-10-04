import { Slex } from "../src/index";

// A small, dependency free benchmark. Run it with `yarn bench`.
//
// It measures the two things that matter for a lexer: how fast a small rule set
// scans input, and how fast a realistic rule set scales as rules that cannot
// match the current character are skipped.

enum TokenType {
  MATCH,
  EOF,
}

/** A rule set shaped like the examples: dozens of rules, a few hot ones. */
function buildGrammar(): Slex<TokenType, {}> {
  const lexerGenerator = new Slex<TokenType, {}>({
    EOF_TYPE: TokenType.EOF,
    isHigherPrecedence: () => false,
  });

  lexerGenerator.addRule("letter", "${__letter}");
  lexerGenerator.addRule("digit", "${__decimal_digit}");
  lexerGenerator.addRule("underscore", "$_");

  for (let i = 0; i < 40; i++) lexerGenerator.addRule(`keyword_${i}`, `keyword${i}`, TokenType.MATCH);

  lexerGenerator.addRule("float_number", "(${__decimal_digit})+$.(${__decimal_digit})+", TokenType.MATCH);
  lexerGenerator.addRule("decimal_number", "(${__decimal_digit})+", TokenType.MATCH);
  lexerGenerator.addRule("identifier", "(${__letter}|$_)(${__letter}|${__decimal_digit}|$_)*", TokenType.MATCH);
  lexerGenerator.addRule("space", "$ ", TokenType.MATCH);
  lexerGenerator.addRule("plus", "$+", TokenType.MATCH);

  return lexerGenerator;
}

/** Three rules only, so nothing can be skipped. */
function buildSmallGrammar(): Slex<TokenType, {}> {
  const lexerGenerator = new Slex<TokenType, {}>({
    EOF_TYPE: TokenType.EOF,
    isHigherPrecedence: () => false,
  });

  lexerGenerator.addRule("decimal_number", "(${__decimal_digit})+");
  lexerGenerator.addRule("identifier", "(${__letter}|${decimal_number})+", TokenType.MATCH);
  lexerGenerator.addRule("plus", "$+", TokenType.MATCH);

  return lexerGenerator;
}

function countTokens(generator: Slex<TokenType, {}>, input: string): number {
  const lexer = generator.generate(input, () => ({}));

  let count = 0;
  while (lexer.hasNextToken()) {
    if (!lexer.tryGetNextToken().success) break;
    count++;
  }

  return count;
}

interface Measurement {
  label: string;
  rules: number;
  bytes: number;
  tokens: number;
  ms: number;
}

function measure(label: string, generator: Slex<TokenType, {}>, rules: number, input: string, iterations: number) {
  // Warm up so the JIT has seen the rules before measuring.
  for (let i = 0; i < 3; i++) countTokens(generator, input);

  const started = performance.now();
  let tokens = 0;

  for (let i = 0; i < iterations; i++) tokens += countTokens(generator, input);

  const ms = performance.now() - started;

  return { label, rules, bytes: input.length * iterations, tokens, ms } satisfies Measurement;
}

function report(measurement: Measurement): void {
  const megabytes = measurement.bytes / 1_000_000;
  const seconds = measurement.ms / 1000;

  const megabytesPerSecond = seconds === 0 ? 0 : megabytes / seconds;
  const tokensPerSecond = seconds === 0 ? 0 : measurement.tokens / seconds;

  console.log(
    measurement.label.padEnd(30) +
      String(measurement.rules).padStart(3) +
      " rules " +
      megabytes.toFixed(2).padStart(7) +
      " MB " +
      String(measurement.tokens).padStart(8) +
      " tokens " +
      measurement.ms.toFixed(1).padStart(8) +
      " ms " +
      megabytesPerSecond.toFixed(2).padStart(8) +
      " MB/s " +
      (tokensPerSecond / 1000).toFixed(0).padStart(7) +
      "k tokens/s"
  );
}

const small = buildSmallGrammar();
const many = buildGrammar();

const denseInput = Array.from({ length: 4000 }, () => "abc123 + ").join("");
const sourceInput = Array.from(
  { length: 500 },
  (_, i) => `keyword${i % 40} value_${i} 12.5 identifier${i} + value`
).join("\n");

const measurements = [
  measure("3 rules, dense input", small, 3, denseInput, 5),
  measure("45 rules, source like input", many, 45, sourceInput, 5),
  measure("45 rules, single long token", many, 45, "a".repeat(50_000), 20),
  measure("rule set construction", many, 45, "", 200),
];

console.log("slex benchmark\n");
for (const measurement of measurements) report(measurement);

// Scanning the same input many times has to stay linear in its size.
const sizes = [100, 400, 1600];
console.log("\nscaling of the 45 rule lexer:");
for (const size of sizes) {
  const input = Array.from({ length: size }, (_, i) => `keyword${i % 40} value_${i}`).join(" ");
  report(measure(`${size} lines`, many, 45, input, 5));
}
