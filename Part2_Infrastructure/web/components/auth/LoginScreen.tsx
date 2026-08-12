"use client";

/**
 * The login screen — five forms on one route.
 *
 * Sign in, create account, forgot password, set a new password, and verify a
 * mailbox. They share an email field, a banner and a card, so they are modes of
 * one component rather than five routes; the URL still distinguishes the two
 * that arrive from an email link (`?step=reset`, `?step=verify`) because a link
 * has to land somewhere specific.
 *
 * The OAuth → OTP gate is the one unusual rule. Supabase treats a completed
 * OAuth handshake as a finished sign-in; this app additionally asks for a code
 * sent to the account's email before it calls that identity complete. The
 * marker is set before the redirect and cleared on a successful verify, which
 * means the provider round-trip cannot skip the step by returning early.
 *
 * Nothing here is a gate on the product. The workspace stays fully browsable
 * signed out — this page adds an identity, it does not guard the door.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Provider } from "@supabase/supabase-js";

import { authClient, authConfigured } from "@/lib/auth-client";
import {
  OTP_SENT_AT_KEY,
  OTP_RESEND_COOLDOWN_MS,
  cooldownSeconds,
  describeAuthError,
  isCompleteOtp,
  looksLikeEmail,
  normaliseOtp,
  resendCooldownRemaining,
  resolveLoginStep,
} from "@/lib/auth-flow";
import { setAuthPersistence } from "@/lib/auth-storage";
import { clearOtpPending, markOtpPending, refreshSession, signOutUser } from "@/lib/use-session";

type FormMode = "signin" | "signup" | "forgot" | "reset" | "verify";

type BannerTone = "error" | "warn" | "context-change";

interface Banner {
  tone: BannerTone;
  message: string;
}

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  // Supabase's Microsoft/Outlook provider is registered as "azure".
  { id: "azure", label: "Outlook" },
];

const MODE_COPY: Record<FormMode, { kicker: string; title: string; blurb: string }> = {
  signin: {
    kicker: "Account",
    title: "Sign in",
    blurb:
      "Signing in stores your workspace preferences against your account. The desk itself is open — nothing here is behind a login.",
  },
  signup: {
    kicker: "Account",
    title: "Create an account",
    blurb: "Paper-only, educational, and free. No funds, no brokerage relationship, no card.",
  },
  forgot: {
    kicker: "Account",
    title: "Reset your password",
    blurb: "We will email a link that returns you here to choose a new one.",
  },
  reset: {
    kicker: "Account",
    title: "Choose a new password",
    blurb: "This link signed you in for the moment it takes to set a password.",
  },
  verify: {
    kicker: "Account",
    title: "Verify your email",
    blurb: "Enter the six-digit code we emailed you to finish signing in.",
  },
};

function readSentAt(): number | null {
  try {
    const raw = localStorage.getItem(OTP_SENT_AT_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSentAt(at: number): void {
  try {
    localStorage.setItem(OTP_SENT_AT_KEY, String(at));
  } catch {
    // Losing the stamp costs the countdown, not the send.
  }
}

export default function LoginScreen() {
  const configured = authConfigured();

  const [mode, setMode] = useState<FormMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const autoSent = useRef(false);

  const copy = MODE_COPY[mode];

  /**
   * Reads the URL once, after mount. `window.location` rather than
   * useSearchParams: this page is prerendered, and the hook would force it into
   * a Suspense boundary to say something the effect can say for free.
   */
  useEffect(() => {
    const supabase = authClient();
    const location = resolveLoginStep(window.location.search);

    if (location.errorMessage) {
      setBanner({ tone: "error", message: describeAuthError({ message: location.errorMessage }) });
      clearOtpPending();
    }

    if (location.step === "confirmed") {
      setBanner({ tone: "context-change", message: "Email confirmed. Sign in to continue." });
      return;
    }

    if (location.step === "reset") {
      setMode("reset");
      // token_hash links carry their own proof and need no PKCE verifier, which
      // is what lets a recovery email work in a different browser than the one
      // that asked for it. `?code=` links are exchanged by detectSessionInUrl.
      if (location.tokenHash && supabase) {
        void supabase.auth
          .verifyOtp({ token_hash: location.tokenHash, type: "recovery" })
          .then(({ error }) => {
            if (error) setBanner({ tone: "error", message: describeAuthError(error) });
          });
      }
      return;
    }

    if (location.step === "verify") {
      setMode("verify");
      setCooldownMs(resendCooldownRemaining(readSentAt(), Date.now()));
      if (supabase) {
        void supabase.auth.getSession().then(({ data }) => {
          const address = data.session?.user?.email ?? null;
          setPendingEmail(address);
          if (address) setEmail(address);
        });
      }
    }
  }, []);

  /** One timer for the resend countdown; it stops as soon as it reaches zero. */
  useEffect(() => {
    if (cooldownMs <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownMs((remaining) => Math.max(0, remaining - 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownMs > 0]);

  const sendOtp = useCallback(
    async (address: string) => {
      const supabase = authClient();
      if (!supabase || !address) return;
      setBusy(true);
      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        // Never mint a second identity from the verification step: this code
        // exists to prove the OAuth account's mailbox, not to create one.
        options: { shouldCreateUser: false },
      });
      setBusy(false);
      if (error) {
        setBanner({ tone: "error", message: describeAuthError(error) });
        return;
      }
      const now = Date.now();
      writeSentAt(now);
      setCooldownMs(OTP_RESEND_COOLDOWN_MS);
      setBanner({ tone: "context-change", message: `Code sent to ${address}.` });
    },
    [],
  );

  /** Auto-send once when the verify step opens with no live cooldown. */
  useEffect(() => {
    if (mode !== "verify" || !pendingEmail || autoSent.current) return;
    if (resendCooldownRemaining(readSentAt(), Date.now()) > 0) {
      autoSent.current = true;
      return;
    }
    autoSent.current = true;
    void sendOtp(pendingEmail);
  }, [mode, pendingEmail, sendOtp]);

  const redirectTo = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/login`),
    [],
  );

  const goToWorkspace = () => {
    window.location.assign("/");
  };

  const onProvider = async (provider: Provider) => {
    const supabase = authClient();
    if (!supabase) return;
    setBanner(null);
    setBusy(true);
    setAuthPersistence(remember ? "local" : "session");
    // Set before the redirect: the browser leaves this page immediately, and
    // the marker is what makes the return trip land on the verification step.
    markOtpPending();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${redirectTo}?step=verify` },
    });
    if (error) {
      clearOtpPending();
      setBusy(false);
      setBanner({ tone: "error", message: describeAuthError(error) });
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = authClient();
    if (!supabase) return;
    setBanner(null);

    if (mode === "verify") {
      const address = pendingEmail ?? email;
      if (!isCompleteOtp(otp)) {
        setBanner({ tone: "warn", message: "Enter the six-digit code from the email." });
        return;
      }
      setBusy(true);
      // Capture first: verifyOtp signs in whoever owns this address, and if
      // that is somehow not the account OAuth just returned, the safe move is
      // to end both rather than silently swap identities.
      const before = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
      const { data, error } = await supabase.auth.verifyOtp({
        email: address,
        token: normaliseOtp(otp),
        type: "email",
      });
      setBusy(false);
      if (error) {
        setBanner({ tone: "error", message: describeAuthError(error) });
        return;
      }
      const after = data.user?.id ?? null;
      if (before && after && before !== after) {
        await signOutUser();
        setBanner({
          tone: "error",
          message: "That code belongs to a different account. Signed out — please start again.",
        });
        return;
      }
      clearOtpPending();
      refreshSession();
      goToWorkspace();
      return;
    }

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
        redirectTo: `${redirectTo}?step=reset`,
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
        options: { emailRedirectTo: `${redirectTo}?step=confirmed` },
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
    // Password sign-in is already proof of the account; only the OAuth path
    // carries the extra mailbox check.
    clearOtpPending();
    refreshSession();
    goToWorkspace();
  };

  const switchMode = (next: FormMode) => {
    setMode(next);
    setBanner(null);
    setPassword("");
    setOtp("");
  };

  if (!configured) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-3 px-5 py-10">
        <span className="page-kicker">Account</span>
        <h1 className="text-[22px]">Sign in</h1>
        <div className="banner warn" role="status">
          <span aria-hidden>◌</span>
          <div>
            Authentication is not configured in this deployment. The workspace is fully browsable
            without an account — every tab, every panel.
          </div>
        </div>
        <a href="/" className="primary-action text-center">
          Open the workspace
        </a>
      </main>
    );
  }

  const showEmail = mode !== "reset";
  const showPasswordField = mode === "signin" || mode === "signup" || mode === "reset";
  const showRemember = mode === "signin" || mode === "signup";
  const showProviders = mode === "signin" || mode === "signup";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-4 px-5 py-10">
      <div className="card p-5">
        <span className="page-kicker">{copy.kicker}</span>
        <h1 className="mt-0.5 text-[22px]">{copy.title}</h1>
        <p className="mt-1.5 text-[12px] leading-snug text-text-secondary">{copy.blurb}</p>

        {banner && (
          <div className={`banner ${banner.tone} mt-3`} role={banner.tone === "error" ? "alert" : "status"}>
            <span aria-hidden>{banner.tone === "error" ? "✕" : banner.tone === "warn" ? "◌" : "✓"}</span>
            <div>{banner.message}</div>
          </div>
        )}

        <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
          {showEmail && (
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary" htmlFor="auth-email">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                readOnly={mode === "verify" && Boolean(pendingEmail)}
                required
                className="mt-1 w-full"
              />
            </div>
          )}

          {mode === "verify" && (
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary" htmlFor="auth-otp">
                Six-digit code
              </label>
              <input
                id="auth-otp"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="000000"
                autoComplete="one-time-code"
                spellCheck={false}
                required
                className="mt-1 w-full font-mono tracking-[0.3em]"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                <button
                  type="button"
                  className="bg-transparent p-0 text-[11px] font-semibold text-series-1 underline"
                  disabled={busy || cooldownMs > 0}
                  onClick={() => void sendOtp(pendingEmail ?? email)}
                >
                  {cooldownMs > 0 ? `Resend in ${cooldownSeconds(cooldownMs)}s` : "Resend code"}
                </button>
                <button
                  type="button"
                  className="bg-transparent p-0 text-[11px] text-text-muted underline"
                  onClick={() => void signOutUser().then(() => switchMode("signin"))}
                >
                  Use a different account
                </button>
              </div>
            </div>
          )}

          {showPasswordField && (
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary" htmlFor="auth-password">
                {mode === "reset" ? "New password" : "Password"}
              </label>
              <div className="relative mt-1 flex">
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  spellCheck={false}
                  required
                  className="w-full pr-[68px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-pressed={showPassword}
                  aria-controls="auth-password"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 border-none bg-transparent px-1.5 py-1 text-[11px] font-semibold text-text-secondary underline"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>
          )}

          {showRemember && (
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[11.5px] text-text-secondary" htmlFor="auth-remember">
                <input
                  id="auth-remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-auto w-auto"
                />
                Remember me
              </label>
              {mode === "signin" && (
                <button
                  type="button"
                  className="bg-transparent p-0 text-[11.5px] font-semibold text-series-1 underline"
                  onClick={() => switchMode("forgot")}
                >
                  Forgot password?
                </button>
              )}
            </div>
          )}

          <button type="submit" className="primary-action" disabled={busy}>
            {busy
              ? "Working…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Email a reset link"
                    : mode === "reset"
                      ? "Set password"
                      : "Verify and continue"}
          </button>
        </form>

        {showProviders && (
          <>
            <p className="mt-4 mb-2 text-center text-[10.5px] uppercase tracking-[0.08em] text-text-muted">
              or continue with
            </p>
            <div className="flex flex-col gap-2">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void onProvider(provider.id)}
                  className="w-full rounded-[10px] border border-border bg-surface-1 px-3 py-2 text-[12px] font-semibold text-text-primary hover:bg-surface-2"
                >
                  Continue with {provider.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-text-muted">
              After a provider sign-in we email a six-digit code to confirm the mailbox before the
              account is complete.
            </p>
          </>
        )}

        <div className="mt-4 border-t border-grid pt-3 text-[11.5px] text-text-secondary">
          {mode === "signin" && (
            <>
              No account?{" "}
              <button
                type="button"
                className="bg-transparent p-0 text-[11.5px] font-semibold text-series-1 underline"
                onClick={() => switchMode("signup")}
              >
                Create account
              </button>
            </>
          )}
          {(mode === "signup" || mode === "forgot" || mode === "verify") && (
            <button
              type="button"
              className="bg-transparent p-0 text-[11.5px] font-semibold text-series-1 underline"
              onClick={() => switchMode("signin")}
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>

      <a href="/" className="text-center text-[11.5px] text-text-secondary underline">
        Continue without an account
      </a>
    </main>
  );
}
