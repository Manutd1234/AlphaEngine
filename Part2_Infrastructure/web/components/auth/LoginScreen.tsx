"use client";

/**
 * The login screen — four forms on one route.
 *
 * Sign in, create account, forgot password, and set a new password. They share
 * an email field, a banner and a card, so they are modes of one component
 * rather than four routes; the URL still distinguishes the one that arrives
 * from an email link (`?step=reset`), because a link has to land somewhere
 * specific.
 *
 * A provider sign-in completes immediately. An earlier version emailed a
 * six-digit code afterwards to re-prove the mailbox GitHub had just handed
 * over, which was redundant on its own terms and impossible in practice on a
 * project using Supabase's built-in sender: template editing is gated behind
 * custom SMTP, so the stock template has no token to put in the mail. It was a
 * step that could fail and could not succeed.
 *
 * Nothing here gates the product. The workspace stays fully browsable signed
 * out — this page adds an identity, it does not guard the door.
 */

import { useEffect, useMemo, useState } from "react";
import type { Provider } from "@supabase/supabase-js";

import { authClient, authConfigured, fetchEnabledProviders } from "@/lib/auth-client";
import { describeAuthError, looksLikeEmail, resolveLoginStep } from "@/lib/auth-flow";
import { setAuthPersistence } from "@/lib/auth-storage";
import { refreshSession } from "@/lib/use-session";

type FormMode = "signin" | "signup" | "forgot" | "reset";

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

const MODE_COPY: Record<FormMode, { title: string; blurb: string; submit: string }> = {
  signin: {
    title: "Sign in",
    blurb: "Your workspace preferences follow your account. The desk itself is open to everyone.",
    submit: "Sign in",
  },
  signup: {
    title: "Create an account",
    blurb: "Paper-only and free. No funds, no brokerage relationship, no card.",
    submit: "Create account",
  },
  forgot: {
    title: "Reset your password",
    blurb: "We will email a link that brings you back here to choose a new one.",
    submit: "Email a reset link",
  },
  reset: {
    title: "Choose a new password",
    blurb: "This link signed you in for the moment it takes to set a password.",
    submit: "Set password",
  },
};

export default function LoginScreen() {
  const configured = authConfigured();

  const [mode, setMode] = useState<FormMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  /** Provider ids this project has credentials for; null while unknown. */
  const [enabledProviders, setEnabledProviders] = useState<Set<string> | null>(null);

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
    }
  }, []);

  /**
   * Ask the project which providers it can actually complete. Unresolved and
   * failed probes both leave this null, and null renders every provider — a
   * blocked request is not evidence that a provider is missing.
   */
  useEffect(() => {
    let alive = true;
    void fetchEnabledProviders().then((enabled) => {
      if (alive && enabled) setEnabledProviders(enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

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
    // Straight back to the workspace. The provider has already verified the
    // address it hands over; there is nothing further for this app to check.
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) {
      setBusy(false);
      setBanner({ tone: "error", message: describeAuthError(error) });
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
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
    refreshSession();
    goToWorkspace();
  };

  const switchMode = (next: FormMode) => {
    setMode(next);
    setBanner(null);
    setPassword("");
  };

  if (!configured) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-3 px-5 py-10">
        <h1 className="text-[22px]">Sign in</h1>
        <div className="banner warn" role="status">
          <span aria-hidden>◌</span>
          <div>
            Authentication is not configured in this deployment. The workspace is fully browsable
            without an account.
          </div>
        </div>
        <a href="/" className="primary-action text-center">
          Open the workspace
        </a>
      </main>
    );
  }

  const offeredProviders = enabledProviders
    ? PROVIDERS.filter((provider) => enabledProviders.has(provider.id))
    : PROVIDERS;
  const showProviders = (mode === "signin" || mode === "signup") && offeredProviders.length > 0;
  const showPasswordField = mode !== "forgot";
  const showRemember = mode === "signin" || mode === "signup";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-4 px-5 py-10">
      <div className="card p-5">
        <h1 className="text-[21px]">{copy.title}</h1>
        <p className="mt-1 text-[12px] leading-snug text-text-secondary">{copy.blurb}</p>

        {banner && (
          <div className={`banner ${banner.tone} mt-3`} role={banner.tone === "error" ? "alert" : "status"}>
            <span aria-hidden>{banner.tone === "error" ? "✕" : banner.tone === "warn" ? "◌" : "✓"}</span>
            <div>{banner.message}</div>
          </div>
        )}

        <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
          {mode !== "reset" && (
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
                required
                className="mt-1 w-full"
              />
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
            {busy ? "Working…" : copy.submit}
          </button>
        </form>

        {showProviders && (
          <>
            <p className="mt-4 mb-2 text-center text-[10.5px] uppercase tracking-[0.08em] text-text-muted">
              or
            </p>
            <div className="flex flex-col gap-2">
              {offeredProviders.map((provider) => (
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
          </>
        )}

        <div className="mt-4 border-t border-grid pt-3 text-[11.5px] text-text-secondary">
          {mode === "signin" ? (
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
          ) : (
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
