"use client";

/**
 * Finish the sign-in, then hand over to the desk.
 *
 * Three link shapes arrive here and they complete differently:
 *
 *  - `?code=…` — OAuth returns and the default magic-link template. Exchanged by
 *    `detectSessionInUrl`, which `authClient()` already enables, using the PKCE
 *    verifier held in browser storage. This is the shape a server route could
 *    never have handled.
 *  - `#access_token=…` — the implicit fragment, also consumed by
 *    `detectSessionInUrl`, and invisible to a server by construction: fragments
 *    are never sent to the origin.
 *  - `?token_hash=…&type=…` — carries its own proof, so it works in a different
 *    browser from the one that asked. Verified explicitly below, the same way
 *    the login screen already handles recovery links.
 *
 * Then the pass, then the redirect. `/api/auth/session` is what turns the
 * session into the routing cookie the middleware reads, and it must be awaited:
 * navigating to `/dashboard` before the cookie is set means the guard sees a
 * stranger and bounces the visitor straight back to the form they just completed.
 * That loop is the whole reason this page exists rather than a redirect.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import BrandLockup from "@/components/common/BrandLockup";
import { authClient, authConfigured } from "@/lib/auth-client";

/** Where to go once the session is real. */
const DEFAULT_DESTINATION = "/dashboard";

/**
 * The visitor is watching "Signing you in…" while this runs, and the page
 * continues to the desk whether or not the pass was minted — the guard asks
 * again on the next navigation. So the budget is set by patience rather than by
 * the route: without it a stalled mint holds someone on a spinner for the life
 * of the tab, on a page whose only two outcomes are "in" and "this link did not
 * complete". Longer than `mintDeskPass`'s own budget because there is no second
 * chance here: this link is one-time and Back cannot re-run it.
 */
const PASS_MINT_DEADLINE_MS = 6_000;

/**
 * Only same-origin paths, and only ones that look like our routes.
 *
 * `next` comes off the query string, so it is attacker-controlled: without this
 * the callback is an open redirector, and a link that genuinely signs someone in
 * before forwarding them to another site is a very effective phish. A leading
 * single slash excludes both absolute URLs and protocol-relative `//host` ones.
 */
function safeDestination(raw: string | null): string {
  if (!raw) return DEFAULT_DESTINATION;
  if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_DESTINATION;
  return raw;
}

type Phase = "working" | "failed";

export default function AuthCallback() {
  const [phase, setPhase] = useState<Phase>("working");
  const [detail, setDetail] = useState<string | null>(null);
  /** Effects run twice in development's strict mode; the exchange must not. */
  const started = useRef(false);

  const finish = useCallback((destination: string) => {
    // `replace`, not `assign`: the callback URL carries a one-time code, and
    // leaving it in history means Back re-runs a link that can no longer work.
    window.location.replace(destination);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const destination = safeDestination(params.get("next"));

    /**
     * No auth configured, yet a callback URL was somehow reached. There is
     * nothing to exchange and nothing to validate, and the middleware will admit
     * this visitor as a guest, so send them on rather than showing an error for a
     * situation they cannot act on.
     */
    if (!authConfigured()) {
      finish(destination);
      return;
    }

    const supabase = authClient();
    if (!supabase) {
      finish(destination);
      return;
    }

    void (async () => {
      const tokenHash = params.get("token_hash");
      const type = params.get("type");
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          // The link states its own kind; `email` is the magic-link default.
          type: (type as "email" | "recovery" | "invite" | "signup") ?? "email",
        });
        if (error) {
          setPhase("failed");
          setDetail(error.message);
          return;
        }
      }

      /**
       * Read the session back rather than trusting the exchange.
       *
       * `detectSessionInUrl` runs inside the client's own initialisation, so by
       * the time this executes the `?code=` exchange has either happened or
       * failed. Asking for the session is how we find out which — and a null
       * session here is the case that used to land someone on a dashboard that
       * quietly behaved as signed out.
       */
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setPhase("failed");
        setDetail(error?.message
          ?? "This sign-in link could not be completed. It may have expired or already been used.");
        return;
      }

      /**
       * Trade the token for the desk pass, and wait for it.
       *
       * Not fire-and-forget: the cookie is what the middleware reads, so
       * navigating first is a race that resolves as "bounced back to /login"
       * often enough to look like the link failing at random.
       */
      try {
        await fetch("/api/auth/session", {
          headers: { authorization: `Bearer ${data.session.access_token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(PASS_MINT_DEADLINE_MS),
        });
      } catch {
        // The session itself is real and stored; a failed cookie mint means the
        // guard will ask again on the next navigation rather than losing it.
        // A timeout is not worded differently because it is not reported: both
        // outcomes continue to the desk, which is the honest answer either way —
        // the sign-in genuinely succeeded, only the cookie is unconfirmed.
      }
      finish(destination);
    })();
  }, [finish]);

  return (
    <main className="auth-shell">
      <BrandLockup size="lg" />
      <div className="card auth-card" role="status" aria-live="polite">
        {phase === "working" ? (
          <>
            <h1 className="text-[20px]">Signing you in…</h1>
            <p className="sub">Completing the link and starting your session.</p>
            <div className="skeleton" style={{ height: 56, marginTop: 12 }} aria-busy="true" />
          </>
        ) : (
          <>
            <h1 className="text-[20px]">This link did not complete</h1>
            <p className="sub">{detail}</p>
            <a href="/login" className="primary-action mt-3 inline-flex">
              Back to sign in
            </a>
          </>
        )}
      </div>
    </main>
  );
}
