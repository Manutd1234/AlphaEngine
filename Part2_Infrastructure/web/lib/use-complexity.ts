"use client";

/**
 * The detail-level preference, shared by every panel that reads it.
 *
 * One module-level value with a subscriber set rather than React context,
 * matching `use-system-health.ts`: the panels that care are scattered across
 * six workspaces and wrapping the tree in a provider to move one string is more
 * plumbing than the problem needs. It also means a panel rendered outside the
 * workspace shell still gets the right answer instead of a default.
 *
 * The first read happens in an effect, not during render. Reading localStorage
 * while rendering makes the server's HTML and the client's first paint disagree,
 * which React reports as a hydration error and resolves by throwing away the
 * server markup — a visible flash on every page load, to move a preference.
 */

import { useEffect, useState } from "react";

import {
  COMPLEXITY_STORAGE_KEY,
  DEFAULT_COMPLEXITY,
  isComplexity,
  type Complexity,
} from "./complexity";
import { emitPrefChange } from "./pref-sync-bus";

let current: Complexity = DEFAULT_COMPLEXITY;
let hydrated = false;
const listeners = new Set<(tier: Complexity) => void>();

function readStored(): Complexity {
  try {
    const saved = localStorage.getItem(COMPLEXITY_STORAGE_KEY);
    return isComplexity(saved) ? saved : DEFAULT_COMPLEXITY;
  } catch {
    // A blocked storage API costs the preference, never the workspace.
    return DEFAULT_COMPLEXITY;
  }
}

export function setComplexity(tier: Complexity): void {
  current = tier;
  hydrated = true;
  try {
    localStorage.setItem(COMPLEXITY_STORAGE_KEY, tier);
  } catch {
    // The session still honours the choice; only persistence is lost.
  }
  emitPrefChange(COMPLEXITY_STORAGE_KEY);
  for (const listener of listeners) listener(tier);
}

export function useComplexity(): Complexity {
  const [tier, setTier] = useState<Complexity>(current);

  useEffect(() => {
    if (!hydrated) {
      hydrated = true;
      current = readStored();
    }
    setTier(current);
    listeners.add(setTier);
    return () => {
      listeners.delete(setTier);
    };
  }, []);

  return tier;
}
