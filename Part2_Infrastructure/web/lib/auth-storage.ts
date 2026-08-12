"use client";

/**
 * Where the session lives — the "Remember me" checkbox, expressed as storage.
 *
 * GoTrue takes a storage adapter once, at client construction, but the choice
 * this file encodes is made later, when someone ticks a box on the login form.
 * So the adapter is a permanent indirection: every get/set/remove re-reads the
 * marker and delegates to localStorage or sessionStorage accordingly. Swapping
 * the client's storage after construction is not supported, and building a
 * second client to hold the other kind of session is the multi-GoTrueClient
 * mistake this codebase is specifically avoiding.
 *
 * The marker itself always lives in localStorage: it is a preference about
 * sessions, not a session, and forgetting it would silently re-tick the box.
 *
 * Every access is guarded twice — `typeof window` because this module is
 * evaluated while a client component is server-rendered, and try/catch because
 * Safari's private mode and enterprise policies both make Storage throw on
 * read. A blocked storage API costs the session, never the page.
 */

export const AUTH_PERSIST_KEY = "alphaengine-auth-persist";

/** localStorage survives the tab; sessionStorage dies with it. */
export type AuthPersistence = "local" | "session";

export const DEFAULT_AUTH_PERSISTENCE: AuthPersistence = "local";

export function isAuthPersistence(value: unknown): value is AuthPersistence {
  return value === "local" || value === "session";
}

export function getAuthPersistence(): AuthPersistence {
  if (typeof window === "undefined") return DEFAULT_AUTH_PERSISTENCE;
  try {
    const saved = window.localStorage.getItem(AUTH_PERSIST_KEY);
    return isAuthPersistence(saved) ? saved : DEFAULT_AUTH_PERSISTENCE;
  } catch {
    return DEFAULT_AUTH_PERSISTENCE;
  }
}

/**
 * Call BEFORE any sign-in. The adapter reads this on the very next write, so
 * setting it afterwards would leave the freshly minted session in the wrong
 * store until something else touched it.
 */
export function setAuthPersistence(mode: AuthPersistence): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_PERSIST_KEY, mode);
  } catch {
    // The choice still applies to this tab through the adapter's default.
  }
}

function activeStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return getAuthPersistence() === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The adapter handed to GoTrue. Synchronous on purpose: supabase-js accepts
 * either shape, and the async one adds a microtask to every token read.
 */
export const authStorage = {
  getItem(key: string): string | null {
    try {
      return activeStore()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      activeStore()?.setItem(key, value);
    } catch {
      // Sign-in still works for this page view; only persistence is lost.
    }
  },
  removeItem(key: string): void {
    // Clear both stores. The marker can change between sign-in and sign-out,
    // and a token left behind in the store we are no longer reading would be
    // a session nobody can see and nobody can end.
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignored
    }
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignored
    }
  },
};
