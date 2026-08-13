"use client";

/**
 * Keeping the desk pass and the Supabase session from disagreeing.
 * ===============================================================
 *
 * Two stores hold half the answer each, and neither can see the other. The
 * session lives in localStorage, where the edge cannot read it; the pass is an
 * httpOnly cookie, which page scripts cannot read or write. So every transition
 * has to tell the other side, and the two transitions that were missed are both
 * visible to a user:
 *
 *  - **Signing out left the pass behind.** `signOutUser()` revokes the session
 *    and navigates; the cookie stayed. The guard then admitted a signed-out
 *    visitor to the desk on a pass that claimed an account, while the header
 *    correctly showed them as signed out. Nothing private is behind the shell, so
 *    this is not an escalation — it is the desk telling two different stories
 *    about the same person.
 *  - **Coming back the next day bounced them to the form.** The pass expires with
 *    the browser session by design; the Supabase session does not. So a returning
 *    visitor who was still signed in arrived with a valid session and no pass, and
 *    the guard sent them to /login — a sign-in page shown to someone already
 *    signed in, which reads as the session having silently failed.
 *
 * Both are fixed by minting the pass whenever a live session is observed, and
 * dropping it before navigating away on sign-out.
 */

/**
 * Both budgets are set by what someone is waiting for, not by what the route
 * needs — `/api/auth/session` validates a JWT and sets a cookie, and
 * `/api/auth/logout` clears one. Neither is slow when it is working at all.
 *
 * A navigation is held open behind the mint, so a stalled request there is a
 * visitor watching nothing happen after a successful sign-in. Five seconds is
 * long enough to survive a cold serverless start and short enough that the
 * fallback — the guard asking again on the next navigation — takes over while
 * they are still paying attention.
 */
const MINT_DEADLINE_MS = 5_000;

/**
 * Shorter, because by the time this runs the session is already revoked. A
 * stalled request can only keep someone on the page they asked to leave, and
 * the pass expires with the browser session regardless of whether it lands.
 */
const DROP_DEADLINE_MS = 3_000;

/**
 * Trade a live access token for the routing pass.
 *
 * The server validates the token with `getUser()` before setting anything, so
 * this cannot be used to mint a pass for a session that is not real. Returns
 * whether it worked, and the caller decides whether that matters — for a
 * returning visitor it does (they cannot reach the desk without it), for a
 * background top-up it does not (the next navigation asks again).
 *
 * A timeout returns false alongside every other failure, and that is correct
 * here rather than lossy: `false` means "this call did not confirm a pass", and
 * a request that was abandoned in flight has confirmed nothing. No caller shows
 * this to anyone — they retry or carry on — so there is nothing to word
 * differently.
 */
export async function mintDeskPass(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/session", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(MINT_DEADLINE_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Drop the pass. Awaited by the caller before navigating.
 *
 * Not fire-and-forget: navigating first can unload the document before the
 * request leaves, which is the same failure that made `signOutUser()` await
 * GoTrue's round trip rather than racing it.
 */
export async function dropDeskPass(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      cache: "no-store",
      // Awaited before a navigation, so "not fire-and-forget" must not become
      // "waits forever": a hung logout would strand someone on the desk they
      // just signed out of, which is the exact confusion this module exists to
      // remove.
      signal: AbortSignal.timeout(DROP_DEADLINE_MS),
    });
  } catch {
    // The Supabase session is revoked regardless; the pass will expire with the
    // browser session even if this never landed.
  }
}
