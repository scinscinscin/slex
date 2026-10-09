export interface NFAState {
  id: number;
  transitions: NFATransition[];
  epsilon: NFAState[];
  acceptRules: string[];
}

export interface NFATransition {
  key: string;
  test: (ch: string) => boolean;
  target: NFAState;
}

export interface NFAFragment {
  start: NFAState;
  accept: NFAState;
}

export interface NFAOptions {
  caseInsensitive: boolean;
}

let nextStateId = 0;

export function createNFAState(acceptRules: string[] = []): NFAState {
  return { id: nextStateId++, transitions: [], epsilon: [], acceptRules };
}

export function resetNFAStateId(): void {
  nextStateId = 0;
}

export function epsilonClosure(states: Set<NFAState>): Set<NFAState> {
  const closure = new Set<NFAState>(states);
  const stack: NFAState[] = [...states];
  while (stack.length > 0) {
    const state = stack.pop()!;
    for (const eps of state.epsilon) {
      if (!closure.has(eps)) {
        closure.add(eps);
        stack.push(eps);
      }
    }
  }
  return closure;
}

export function move(states: Set<NFAState>, ch: string): Set<NFAState> {
  const result = new Set<NFAState>();
  for (const state of states) {
    for (const transition of state.transitions) {
      if (transition.test(ch)) {
        result.add(transition.target);
      }
    }
  }
  return result;
}

export function collectTransitionKeys(states: Set<NFAState>): Map<string, (ch: string) => boolean> {
  const keys = new Map<string, (ch: string) => boolean>();
  for (const state of states) {
    for (const transition of state.transitions) {
      if (!keys.has(transition.key)) {
        keys.set(transition.key, transition.test);
      }
    }
  }
  return keys;
}
