"use client";

/**
 * What "submit" means in each of the login form's four modes.
 *
 * Sign in, create account, forgot password and set-a-new-password share one
 * button, and each of them validates something different, calls a different
 * Supabase method and ends somewhere different. Keeping that in one place — and
 * out of the screen component — is what makes the ordering below reviewable.
 *
 * The ordering that matters: `setAuthPersistence` runs BEFORE any call that
 * mints a session. A session minted before the store is chosen lands in the
 * wrong one, and "remember me" then means nothing on the next visit.
 *
 * Nothing here reports success it cannot see. A signup against a project with
 * confirmations on returns no session, so the reader is told to check their
 * mail rather than sent to a desk they are not signed in to; a reset email is
 * acknowledged without claiming the address exists, because the endpoint does
 * not say.
 */

import { authClient } from "@/lib/auth-client";
import { describeAuthError, looksLikeEmail } from "@/lib/auth-flow";
import { setAuthPersistence } from "@/lib/auth-storage";
import { refreshSession } from "@/lib/use-session";
import type { Banner, FormMode } from "@/components/auth/login-copy";

export interface SubmitLoginInput {
  mode: FormMode;
  email: string;
  password: string;
  remember: boolean;
  /** The origin-qualified `/login` URL emailed links come back to. */
  loginUrl: string;
  setBanner: (banner: Banner | null) => void;
  setBusy: (busy: boolean) => void;
  /** Called only once a session exists — never on an acknowledgement. */
  goToWorkspace: () => void;
}

export async function submitLogin({
  mode, email, password, remember, loginUrl, setBanner, setBusy, goToWorkspace,
}: SubmitLoginInput): Promise<void> {
  const supabase = authClient();
  if (!supabase) return;
  setBanner(null);

  if (mode === "reset") {
    if (password.length < 8) {
      setBanner({ tone: "warn", message: "Use at least 8 characters." });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setBanner({ tone: "error", message: describeAuthError(error) });
      return;
    }
    refreshSession();
    goToWorkspace();
    return;
  }

  if (!looksLikeEmail(email)) {
    setBanner({ tone: "warn", message: "That does not look like an email address." });
    return;
  }

  if (mode === "forgot") {
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${loginUrl}?step=reset`,
    });
    setBusy(false);
    setBanner(
      error
        ? { tone: "error", message: describeAuthError(error) }
        : { tone: "context-change", message: "If that address has an account, a reset link is on its way." },
    );
    return;
  }

  if (password.length < 8) {
    setBanner({ tone: "warn", message: "Use at least 8 characters." });
    return;
  }

  setAuthPersistence(remember ? "local" : "session");

  if (mode === "signup") {
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${loginUrl}?step=confirmed` },
    });
    setBusy(false);
    if (error) {
      setBanner({ tone: "error", message: describeAuthError(error) });
      return;
    }
    // A project with confirmations off returns a live session immediately.
    if (data.session) {
      refreshSession();
      goToWorkspace();
      return;
    }
    setBanner({
      tone: "context-change",
      message: `Check ${email.trim()} for a confirmation link, then sign in.`,
    });
    return;
  }

  setBusy(true);
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  setBusy(false);
  if (error) {
    setBanner({ tone: "error", message: describeAuthError(error) });
    return;
  }
  refreshSession();
  goToWorkspace();
}
