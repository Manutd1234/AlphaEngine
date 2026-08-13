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
 * This page DOES guard the door now, and the sentence that used to sit here
 * saying otherwise was true until the desk moved behind a routing guard. What is
 * unchanged is that nobody is turned away: "Continue as guest" mints a pass and
 * opens the full workspace on generated data. An account buys preferences that
 * follow you between devices, not access.
 */

import { useEffect, useMemo, useState } from "react";
import type { Provider } from "@supabase/supabase-js";

import BrandLockup from "@/components/common/BrandLockup";
import { authClient, authConfigured, fetchEnabledProviders } from "@/lib/auth-client";
import { describeAuthError, looksLikeEmail, resolveLoginStep } from "@/lib/auth-flow";
import { setAuthPersistence } from "@/lib/auth-storage";
import { mintDeskPass } from "@/lib/desk-pass";
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
    blurb: "Sign in so preferences follow your account between devices — or open the desk as a guest below.",
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
  const [guestBusy, setGuestBusy] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  /** Provider ids this project has credentials for; null while unknown. */
  /**
   * `null` = the probe has not answered. `"unknown"` = it answered by failing.
   * A Set = the answer. The three are different and used to be two.
   */
  const [enabledProviders, setEnabledProviders] = useState<Set<string> | "unknown" | null>(null);

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
   * A visitor who is already signed in should not be looking at this form.
   *
   * The desk pass expires with the browser session; the Supabase session in
   * localStorage does not. So a returning visitor arrives still signed in and
   * with no pass, the guard sends them here, and they are shown a sign-in page
   * for an account they are already using — which reads as the session having
   * quietly failed. Minting the pass from the session they already have and
   * continuing is the whole fix.
   *
   * Deliberately not gated on `sessionStatus`: this reads the token directly,
   * because it needs the access token itself rather than the derived boolean, and
   * a status of "signed-in" without a readable token is not something to act on.
   */
  useEffect(() => {
    const supabase = authClient();
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!alive || !token) return;
      // A recovery link signs the visitor in for exactly as long as it takes to
      // choose a new password. Redirecting them to the desk here would skip the
      // form they came for.
      if (resolveLoginStep(window.location.search).step === "reset") return;
      if (await mintDeskPass(token)) goToWorkspace();
    });
    return () => { alive = false; };
  }, []);

  /**
   * Ask the project which providers it can actually complete.
   *
   * This used to fail OPEN: an unresolved or failed probe left the set null and
   * null rendered every provider, reasoned as "a blocked request is not evidence
   * that a provider is missing". Sound in the abstract, wrong here — this project
   * has only GitHub enabled, so the null path offered Google and Outlook, and
   * clicking either left the app entirely for a Supabase URL showing
   * {"code":400,"error_code":"validation_failed","msg":"Unsupported provider:
   * provider is not enabled"}. Because `signInWithOAuth` is a full-page redirect,
   * no in-page error handling can rescue that; the only fix is not to offer the
   * button until we know.
   *
   * So: `null` now means "still asking" and renders no provider buttons, and a
   * probe that genuinely fails resolves to `"unknown"`, which renders them behind
   * a warning that they may not be enabled. The original concern is preserved —
   * a network hiccup does not permanently hide a working button — without
   * presenting a button that cannot work as though it can.
   */
  useEffect(() => {
    let alive = true;
    void fetchEnabledProviders().then((enabled) => {
      if (!alive) return;
      setEnabledProviders(enabled ?? "unknown");
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Every emailed link comes back through the callback, never straight to a page
   * that renders the desk. `/login` was the old base and `/` the old OAuth
   * target; both put a visitor in front of the workspace while the session was
   * still being read out of the URL.
   */
  const redirectTo = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/auth/callback`),
    [],
  );

  /**
   * The two emailed links that come back to THIS page rather than the callback.
   *
   * A password recovery link has to land on a form that asks for the new
   * password, and a signup confirmation is an acknowledgement rather than a
   * sign-in — routing either through the callback would either lose the form or
   * report "this link did not complete" for a link that worked perfectly. Only
   * links that are meant to establish a session go to `/auth/callback`.
   */
  const loginUrl = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/login`),
    [],
  );

  /**
   * Into the desk, through the callback.
   *
   * This assigned "/" — the workspace itself — which now redirects by cookie, and
   * a password sign-in has no cookie yet: the session is in localStorage and
   * nothing has traded it for a desk pass. Going via the callback is what mints
   * the pass, so this lands on the dashboard instead of bouncing back to the form
   * the visitor just completed.
   */
  const goToWorkspace = () => {
    const next = new URLSearchParams(window.location.search).get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//")
      ? `/auth/callback?next=${encodeURIComponent(next)}`
      : "/auth/callback";
    window.location.assign(target);
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
      options: { redirectTo: `${window.location.origin}/auth/callback` },
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
  };

  /**
   * Mint a guest pass, then enter the desk.
   *
   * POST rather than a link, because the route that mints it is a POST — a GET
   * would hand out guest passes to every link prefetcher and crawler that touched
   * this page. The id comes back in the response so the sandbox seeds from the
   * same value the cookie carries rather than minting a second one that would
   * disagree with it.
   *
   * A failure still enters the desk. On a deployment with no auth the middleware
   * grants a guest pass itself, so the only way this can fail is a transient
   * network error, and stranding someone on the sign-in form for that would be
   * worse than letting the guard sort it out on the next request.
   */
  const enterAsGuest = async () => {
    setGuestBusy(true);
    try {
      const response = await fetch("/api/auth/guest", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { id?: string } | null;
      if (body?.id) {
        try {
          sessionStorage.setItem("alphaengine-desk-guest", body.id);
        } catch {
          // Private mode. The desk falls back to its shared worked example.
        }
      }
    } catch {
      // See above: proceed regardless.
    }
    window.location.assign("/dashboard");
  };

  const switchMode = (next: FormMode) => {
    setMode(next);
    setBanner(null);
    setPassword("");
  };

  /**
   * No auth in this deployment — which is the PUBLIC deployment's normal state,
   * not an edge case, so this branch is the page most visitors will ever see.
   *
   * It shares the shell and the masthead with the configured page for exactly
   * that reason. It previously had its own bare layout with no brand mark at all,
   * which meant the most-visited version of the sign-in page was the one that
   * looked least like the product. The guest action is the primary button here
   * because it is the only way in, and the guard will admit them regardless.
   */
  if (!configured) {
    return (
      <main className="auth-shell standalone-scroll">
        <BrandLockup size="lg" />
        <div className="card auth-card">
          <h1 className="text-[21px]">Open the desk</h1>
          <div className="banner warn mt-3" role="status">
            <span aria-hidden>◌</span>
            <div>
              Accounts are not configured in this deployment, so there is nothing to sign in to.
              The desk opens as a guest instead — the full workspace, on generated data.
            </div>
          </div>
          <button
            type="button"
            className="primary-action mt-3 w-full"
            disabled={guestBusy}
            onClick={() => void enterAsGuest()}
          >
            {guestBusy ? "Opening the desk…" : "Open the workspace"}
          </button>
        </div>
        <p className="auth-guest__note">
          Every visitor gets a desk seeded just for their browser. Nothing is shared, and nothing
          here reaches a real venue.
        </p>
      </main>
    );
  }

  const probePending = enabledProviders === null;
  const probeFailed = enabledProviders === "unknown";
  const offeredProviders = enabledProviders instanceof Set
    ? PROVIDERS.filter((provider) => enabledProviders.has(provider.id))
    // Only when the probe failed outright — never while it is still out.
    : probeFailed ? PROVIDERS : [];
  const showProviders = (mode === "signin" || mode === "signup")
    && (offeredProviders.length > 0 || probePending);
  const showPasswordField = mode !== "forgot";
  const showRemember = mode === "signin" || mode === "signup";

  return (
    <main className="auth-shell standalone-scroll">
      {/* The mark, which this page had none of: a bare form gave no indication of
          what was being signed into. One component, shared with the header, so the
          two can never drift into looking like different products. */}
      <BrandLockup size="lg" />
      <div className="card auth-card">
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
              {/* Not a bare "or" while the probe is out: a divider above nothing
                  is the headless-section case, and saying what is being waited
                  for costs one word. */}
              {probePending ? "checking sign-in options" : "or"}
            </p>
            {probeFailed && (
              /**
               * The buttons are drawn, and the warning is the price of drawing
               * them. The probe failing is not evidence a provider is missing —
               * that is why this fails open — but it is also not evidence one
               * works, and this project has two providers that answer
               * "provider is not enabled". Without this line, a reader clicking
               * Google would leave the app for a page of raw JSON with no
               * warning at all, which is the defect this whole branch exists to
               * bound.
               */
              <p className="mb-2 text-center text-[10.5px] leading-snug text-text-muted">
                We could not check which of these are enabled here, so one may not complete.
              </p>
            )}
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

      {/* A first-class action, at the weight of the provider buttons above it.
          It was a low-contrast underlined link to "/" — which worked only while
          the desk was ungated, and now has to mint a real guest pass. */}
      <button
        type="button"
        className="auth-guest"
        disabled={guestBusy}
        onClick={() => void enterAsGuest()}
      >
        {guestBusy ? "Opening the desk…" : "Continue as guest"}
      </button>
      <p className="auth-guest__note">
        A guest desk is seeded just for this browser: the full workspace, generated data, no
        account. Preferences will not follow you to another device.
      </p>
    </main>
  );
}
