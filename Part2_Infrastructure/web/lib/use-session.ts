"use client";

/**
 * The signed-in identity, shared by every component that reads it.
 *
 * One module-level value with a subscriber set rather than React context,
 * matching `use-complexity.ts` and `use-system-health.ts`: the readers are the
 * header chip and the preference sync engine, and wrapping the tree in a
 * provider to move one email is more plumbing than the problem needs.
 *
 * Five states, because "signed in" is not binary here. After OAuth returns,
 * Supabase considers the session complete; this app does not, until the person
 * has proved they control the mailbox. `otp-pending` is that gap, and it reads
 * as *not yet* signed in everywhere it matters — the account chip offers to
 * finish verifying, and preference sync stays off.
 *
 * The first read happens in an effect, never during render: the session lives
 * in storage, and reading storage while rendering makes the server's HTML and
 * the client's first paint disagree.
 */

import { useEffect, useState } from "react";

import { authClient, authConfigured } from "./auth-client";
import { OTP_PENDING_KEY, OTP_SENT_AT_KEY } from "./auth-flow";

export type SessionStatus =
  /** No Supabase config in this deployment — login is absent, not broken. */
  | "unconfigured"
  /** Configured, first getSession() still in flight. */
  | "loading"
  | "signed-out"
  /** OAuth completed; the emailed code has not been verified yet. */
  | "otp-pending"
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

function readOtpPending(): boolean {
  try {
    return localStorage.getItem(OTP_PENDING_KEY) === "1";
  } catch {
    // Storage blocked: treat the session at face value rather than stranding
    // someone in a verification step they cannot leave.
    return false;
  }
}

export function markOtpPending(): void {
  try {
    localStorage.setItem(OTP_PENDING_KEY, "1");
  } catch {
    // Without the marker the OTP step is skipped — the OAuth session is still
    // a real one, so this degrades to "less verification", never to a lockout.
  }
}

export function clearOtpPending(): void {
  try {
    localStorage.removeItem(OTP_PENDING_KEY);
    localStorage.removeItem(OTP_SENT_AT_KEY);
  } catch {
    // ignored
  }
}

function publish(next: SessionInfo): void {
  current = next;
  for (const listener of listeners) listener(next);
}

function fromSession(session: { user?: { id?: string; email?: string | null } } | null): SessionInfo {
  if (!session?.user?.id) return SIGNED_OUT;
  return {
    status: readOtpPending() ? "otp-pending" : "signed-in",
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

/** Re-reads the OTP marker against the session already in hand. */
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

export async function signOutUser(): Promise<void> {
  clearOtpPending();
  const supabase = authClient();
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // A failed network sign-out still clears local state below.
  }
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
