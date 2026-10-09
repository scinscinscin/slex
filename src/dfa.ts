import { NFAState, NFAOptions, createNFAState, epsilonClosure, collectTransitionKeys } from "./nfa";
import { RegexNode } from "./internal";

export interface DFAState {
  transitions: { key: string; test: (ch: string) => boolean; target: number }[];
  acceptRules: Map<string, number>;
}

export interface DFA {
  start: number;
  states: DFAState[];
}

function specificity(key: string): number {
  if (key.startsWith("char:")) return 0;
  if (key.startsWith("ci:char:")) return 1;
  if (key.startsWith("intrinsic:")) return 2;
  if (key.startsWith("ci:intrinsic:")) return 3;
  if (key.startsWith("neg:")) return 4;
  return 5;
}

function canMatchSameCharacter(key: string, otherTest: (ch: string) => boolean): boolean {
  if (key.startsWith("char:")) {
    return otherTest(key.substring(5));
  }
  if (key.startsWith("ci:char:")) {
    const ch = key.substring(8);
    return otherTest(ch.toLowerCase()) || otherTest(ch.toUpperCase());
  }
  return false;
}

export function buildDFA<TokenType>(rules: Map<string, RegexNode<TokenType>>, ruleOrder: string[]): DFA {
  const nfaStart = createNFAState();
  const options: NFAOptions = { caseInsensitive: false };

  for (const name of ruleOrder) {
    const node = rules.get(name)!;
    const fragment = node.toNFA(options);
    fragment.accept.acceptRules.push(name);
    nfaStart.epsilon.push(fragment.start);
  }

  const startClosure = epsilonClosure(new Set([nfaStart]));
  const dfaStates: DFAState[] = [];
  const closures: Set<NFAState>[] = [];
  const stateKeys = new Map<string, number>();

  function stateKey(closure: Set<NFAState>): string {
    const ids = [...closure].map((s) => s.id).sort((a, b) => a - b);
    return ids.join(",");
  }

  function createDFAState(closure: Set<NFAState>): DFAState {
    const acceptRules = new Map<string, number>();
    for (const state of closure)
      for (const rule of state.acceptRules) if (!acceptRules.has(rule)) acceptRules.set(rule, ruleOrder.indexOf(rule));
    return { transitions: [], acceptRules };
  }

  const startKey = stateKey(startClosure);
  stateKeys.set(startKey, 0);
  dfaStates.push(createDFAState(startClosure));
  closures.push(startClosure);

  const queue: number[] = [0];

  while (queue.length > 0) {
    const stateIndex = queue.shift()!;
    const closure = closures[stateIndex];
    const keys = collectTransitionKeys(closure);

    for (const [key, test] of keys) {
      const moveResult = new Set<NFAState>();
      for (const state of closure) {
        for (const transition of state.transitions) {
          if (transition.key === key || canMatchSameCharacter(key, transition.test)) {
            moveResult.add(transition.target);
          }
        }
      }

      if (moveResult.size === 0) continue;

      const targetClosure = epsilonClosure(moveResult);
      const targetKey = stateKey(targetClosure);

      let targetIndex: number;
      if (stateKeys.has(targetKey)) {
        targetIndex = stateKeys.get(targetKey)!;
      } else {
        targetIndex = dfaStates.length;
        stateKeys.set(targetKey, targetIndex);
        dfaStates.push(createDFAState(targetClosure));
        closures.push(targetClosure);
        queue.push(targetIndex);
      }

      dfaStates[stateIndex].transitions.push({ key, test, target: targetIndex });
    }

    dfaStates[stateIndex].transitions.sort((a, b) => specificity(a.key) - specificity(b.key));
  }

  return { start: 0, states: dfaStates };
}

export function dfaTransition(state: DFAState, ch: string): number | null {
  for (const transition of state.transitions) if (transition.test(ch)) return transition.target;
  return null;
}
