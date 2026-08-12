/**
 * A one-line announcement that a preference changed.
 *
 * The stores that own preferences — theme, detail level, the research auto-run
 * switch, the palette's recents — predate any notion of an account and are
 * deliberately independent of each other. Making each of them import the sync
 * engine would invert that: four leaf modules would depend on Supabase, and
 * `theme.ts` would stop being usable by the pre-paint bootstrap script.
 *
 * So the dependency runs the other way. This module imports nothing, each store
 * gains a single `emitPrefChange(KEY)` call at its existing write site, and the
 * engine subscribes. A build with no engine loaded still calls this; it just
 * has no listeners, which costs a Set iteration over nothing.
 *
 * Deliberately not an EventTarget: this has to work identically during SSR,
 * where `window` does not exist and `CustomEvent` is not global.
 */

type PrefListener = (key: string) => void;

const listeners = new Set<PrefListener>();

/** Called by a store immediately after it writes to localStorage. */
export function emitPrefChange(key: string): void {
  for (const listener of listeners) listener(key);
}

export function onPrefChange(listener: PrefListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
