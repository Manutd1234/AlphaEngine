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
import LoginCard from "@/components/auth/LoginCard";
import {
  MODE_COPY,
  PROVIDERS,
  type Banner,
  type FormMode,
} from "@/components/auth/login-copy";
import { authClient, authConfigured, fetchEnabledProviders } from "@/lib/auth-client";
import { describeAuthError, looksLikeEmail, resolveLoginStep } from "@/lib/auth-flow";
import { setAuthPersistence } from "@/lib/auth-storage";
import { mintDeskPass } from "@/lib/desk-pass";
import { submitLogin } from "@/lib/auth-submit";

/**
 * Short, because the desk opens whether or not this lands — the middleware
 * grants a guest pass itself on a deployment with no auth, so the entire cost of
 * giving up early is a sandbox seeded from a different id than the cookie
 * carries. Making someone wait longer than that for a button labelled "open the
 * desk" trades a visible delay for an invisible detail.
 */
const GUEST_PASS_DEADLINE_MS = 4_000;

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
    await submitLogin({
      mode, email, password, remember, loginUrl, setBanner, setBusy, goToWorkspace,
    });
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
      const response = await fetch("/api/auth/guest", {
        method: "POST",
        signal: AbortSignal.timeout(GUEST_PASS_DEADLINE_MS),
      });
      const body = (await response.json().catch(() => null)) as { id?: string } | null;
      if (body?.id) {
        try {
          sessionStorage.setItem("alphaengine-desk-guest", body.id);
        } catch {
          // Private mode. The desk falls back to its shared worked example.
        }
      }
    } catch {
      // See above: proceed regardless. A timeout arrives here alongside a
      // transport failure and is not worded differently because it is never
      // shown — both end in the same place, with the guard sorting it out.
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
          <h1>Open the desk</h1>
          <div className="banner warn mt-3" role="status">
            <span aria-hidden>◌</span>
            <div>
              Accounts are not configured in this deployment, so there is nothing to sign in to.
              The desk opens as a guest instead.
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
          Each browser gets its own seeded desk — the full workspace, on generated data. Nothing
          is shared, and nothing here reaches a real venue.
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
  const providersOffered = offeredProviders.length > 0;
  /**
   * The region exists because the MODE has one, not because the probe has
   * answered — and that inversion is the layout fix.
   *
   * It used to read `(offeredProviders.length > 0 || probePending)`, which is
   * true while the probe is out and false the instant it comes back empty, so
   * the region appeared, then vanished, and the card changed height twice. The
   * card reserves the region's height instead (14k-login-layout-stability.css)
   * and the answer decides only what fills it — including the sentence that
   * says nothing is enabled, which is what stops the reserve being a hole.
   */
  const showProviderSlot = mode === "signin" || mode === "signup";
  const showPasswordField = mode !== "forgot";
  const showRemember = mode === "signin" || mode === "signup";

  return (
    <main className="auth-shell standalone-scroll">
      {/* The mark, which this page had none of: a bare form gave no indication of
          what was being signed into. One component, shared with the header, so the
          two can never drift into looking like different products. */}
      <BrandLockup size="lg" />
      <LoginCard
        copy={copy}
        banner={banner}
        mode={mode}
        email={email}
        onEmailChange={setEmail}
        password={password}
        onPasswordChange={setPassword}
        showPassword={showPassword}
        onShowPasswordChange={setShowPassword}
        remember={remember}
        onRememberChange={setRemember}
        busy={busy}
        onSubmit={(event) => void onSubmit(event)}
        onSwitchMode={switchMode}
        showPasswordField={showPasswordField}
        showRemember={showRemember}
        showProviderSlot={showProviderSlot}
        probePending={probePending}
        probeFailed={probeFailed}
        providersOffered={providersOffered}
        offeredProviders={offeredProviders}
        onProvider={(provider) => void onProvider(provider)}
      />

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
        A guest desk is seeded for this browser: the full workspace, on generated data. Without
        an account, preferences stay on this device.
      </p>
    </main>
  );
}
