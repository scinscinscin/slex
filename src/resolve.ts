import { RegexNode } from "./internal";

export function resolveVariables<TokenType>(
  rules: Map<string, RegexNode<TokenType>>
): Map<string, RegexNode<TokenType>> {
  const resolved = new Map<string, RegexNode<TokenType>>();
  const inProgress = new Set<string>();

  function resolveInline(name: string): RegexNode<TokenType> {
    if (resolved.has(name)) return resolved.get(name)!;
    if (inProgress.has(name)) throw new Error("Circular reference detected involving rule: '" + name + "'");
    if (!rules.has(name)) throw new Error("Unknown variable reference: '" + name + "'");

    inProgress.add(name);
    const original = rules.get(name)!;
    const inlined = original.replaceVariables(resolveInline);
    inProgress.delete(name);

    inlined.clearTokenType();
    inlined.clearTransformer();

    resolved.set(name, inlined);
    return inlined;
  }

  const result = new Map<string, RegexNode<TokenType>>();
  for (const [name, node] of rules) {
    const inlined = node.replaceVariables(resolveInline);
    const tokenType = node.getTokenType();
    const transformer = node.getTransformer();
    if (tokenType !== null) inlined.setTokenType(tokenType);
    if (transformer !== null) inlined.setTransformer(transformer);
    result.set(name, inlined);
  }

  return result;
}
