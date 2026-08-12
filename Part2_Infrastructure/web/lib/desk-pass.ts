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
 * Trade a live access token for the routing pass.
 *
 * The server validates the token with `getUser()` before setting anything, so
 * this cannot be used to mint a pass for a session that is not real. Returns
 * whether it worked, and the caller decides whether that matters — for a
 * returning visitor it does (they cannot reach the desk without it), for a
 * background top-up it does not (the next navigation asks again).
 */
export async function mintDeskPass(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/session", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
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
    await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
  } catch {
    // The Supabase session is revoked regardless; the pass will expire with the
    // browser session even if this never landed.
  }
}
