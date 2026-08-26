"use client";

/**
 * One index, shared between sibling figures that share an index space.
 *
 * Two figures side by side over the same runs — the skill trend and the
 * record of every measure, the index series and its measurability strip — each
 * answer a pointer on their own, so a reader comparing them holds two
 * crosshairs in their head. This lets the figure under the pointer PUBLISH its
 * index and every sibling with the same `key` FOLLOW it: one position, drawn
 * on both, spoken once.
 *
 * The only honest link is a shared index space. Two figures whose x axes are
 * different things — a tape indexed by this browser's polls beside a record
 * indexed by the recorder's runs — must never share a key, because the same
 * index names two different moments and the follower would draw a lie. The
 * pairs are declared in `tests/engine-linked-x.test.ts`, each with the one
 * identifier both members derive their `count` from.
 *
 * NO ELEMENT. The provider renders its children and nothing else, so it can
 * wrap a view's figures without becoming the first thing in the view — the
 * "opens on a drawing" guard walks past wrappers it knows and would stop on a
 * `div` it did not. Placed inside the view's first `div` regardless.
 *
 * Ownership matters on the way out: a follower must not clear a state it did
 * not publish, or one figure's pointer leaving would erase the other's walked
 * position. Clearing is by the owner only; publishing always wins.
 */

import { createContext, useCallback, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export interface LinkedXState {
  /** The pair's name — the same string on both members' `sharedX`. */
  key: string;
  index: number;
  /** Which hook instance published it; `useId()` on the publisher. */
  owner: string;
}

interface LinkedXValue {
  state: LinkedXState | null;
  set: Dispatch<SetStateAction<LinkedXState | null>>;
}

const LinkedXContext = createContext<LinkedXValue | null>(null);

export function LinkedX({ children }: { children: ReactNode }) {
  const [state, set] = useState<LinkedXState | null>(null);
  const value = useMemo(() => ({ state, set }), [state]);
  return <LinkedXContext.Provider value={value}>{children}</LinkedXContext.Provider>;
}

/**
 * What a figure follows, and how it publishes.
 *
 * `followed` is the index a SIBLING published under this key — never one's
 * own, which is already in hand as the hovered or walked index. Outside any
 * provider, or without a key, it is null and `publish` is a no-op: a figure
 * that declares no `link` behaves exactly as it did before this existed.
 */
export function useLinkedX(key: string | undefined, owner: string): {
  followed: number | null;
  publish: (index: number | null) => void;
} {
  const context = useContext(LinkedXContext);
  const state = context?.state ?? null;
  const followed = key && state && state.key === key && state.owner !== owner ? state.index : null;
  const set = context?.set;
  const publish = useCallback((index: number | null) => {
    if (!set || !key) return;
    set((previous) => {
      // A null is a CLEAR, and only the owner may clear: a follower's pointer
      // leaving must not erase the position the other figure is standing on.
      if (index === null) return previous && previous.owner === owner ? null : previous;
      return { key, index, owner };
    });
  }, [set, key, owner]);
  return { followed, publish };
}
