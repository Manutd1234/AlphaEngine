"use client";

/**
 * The signed-in identity, shared by every component that reads it.
 *
 * One module-level value with a subscriber set rather than React context,
 * matching `use-complexity.ts` and `use-system-health.ts`: the readers are the
 * header chip and the preference sync engine, and wrapping the tree in a
 * provider to move one email is more plumbing than the problem needs.
 *
 * Four states. A provider sign-in is complete the moment it returns: GitHub has
 * already verified the address it hands over, and an extra round trip to
 * re-prove it added a failure mode without adding a fact.
 *
 * The first read happens in an effect, never during render: the session lives
 * in storage, and reading storage while rendering makes the server's HTML and
 * the client's first paint disagree.
 */

import { useEffect, useState } from "react";

import { authClient, authConfigured } from "./auth-client";

export type SessionStatus =
  /** No Supabase config in this deployment — login is absent, not broken. */
  | "unconfigured"
  /** Configured, first getSession() still in flight. */
  | "loading"
  | "signed-out"
  | "signed-in";

export interface SessionInfo {
  status: SessionStatus;
  email: string | null;
  userId: string | null;
}

const SIGNED_OUT: SessionInfo = { status: "signed-out", email: null, userId: null };

let current: SessionInfo = authConfigured()
  ? { status: "loading", email: null, userId: null }
  : { status: "unconfigured", email: null, userId: null };

let started = false;
const listeners = new Set<(info: SessionInfo) => void>();

function publish(next: SessionInfo): void {
  current = next;
  for (const listener of listeners) listener(next);
}

function fromSession(session: { user?: { id?: string; email?: string | null } } | null): SessionInfo {
  if (!session?.user?.id) return SIGNED_OUT;
  return {
    status: "signed-in",
    email: session.user.email ?? null,
    userId: session.user.id,
  };
}

/**
 * Idempotent. Called from the hook and from the preference engine, which needs
 * the session without rendering anything.
 */
function ensureStarted(): void {
  if (started) return;
  const supabase = authClient();
  if (!supabase) {
    started = true;
    publish({ status: "unconfigured", email: null, userId: null });
    return;
  }
  started = true;

  void supabase.auth
    .getSession()
    .then(({ data }) => publish(fromSession(data.session)))
    .catch(() => publish(SIGNED_OUT));

  supabase.auth.onAuthStateChange((_event, session) => {
    publish(fromSession(session));
  });
}

/** Re-reads the session after a sign-in or sign-out completes elsewhere. */
export function refreshSession(): void {
  const supabase = authClient();
  if (!supabase) return;
  void supabase.auth
    .getSession()
    .then(({ data }) => publish(fromSession(data.session)))
    .catch(() => undefined);
}

export function getSessionInfo(): SessionInfo {
  ensureStarted();
  return current;
}

export function subscribeSession(listener: (info: SessionInfo) => void): () => void {
  ensureStarted();
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ends the session. Deliberately does NOT navigate — this module is imported by
 * the headless preference engine, which has no business redirecting anyone.
 * The caller decides where to go, and must `await` this before it does: GoTrue
 * removes the persisted session *after* its server round-trip, so a navigation
 * that races it can unload the document with the token still in storage.
 */
export async function signOutUser(): Promise<void> {
  const supabase = authClient();
  if (!supabase) return;
  try {
    // `signOut()` resolves with `{ error }` rather than throwing, so this catch
    // only ever covers a genuine network throw. Either way GoTrue has already
    // cleared the stored session — it calls removeCurrentSession() before
    // returning any error that is not 404/401/403. A returned error means the
    // server-side revoke of the refresh token failed, which nobody here can
    // act on and which does not change that this browser is signed out.
    await supabase.auth.signOut();
  } catch {
    // Same conclusion: the local session is gone regardless.
  }
  // Notifies listeners. It does not clear storage — GoTrue did that above.
  publish(SIGNED_OUT);
}

export function useSession(): SessionInfo {
  const [info, setInfo] = useState<SessionInfo>(current);

  useEffect(() => {
    ensureStarted();
    setInfo(current);
    listeners.add(setInfo);
    return () => {
      listeners.delete(setInfo);
    };
  }, []);

  return info;
}
