import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { DESK_COOKIE, deskCookie, isGuest } from "@/lib/desk-cookie";

/**
 * Validate a bearer token server-side and issue the desk pass.
 *
 * This is the only route that can turn a Supabase session into a routing pass,
 * and the reason the pass means anything: `getUser(jwt)` is a call to Supabase's
 * auth server, which verifies the signature and the expiry. Decoding the JWT
 * here and trusting its claims would accept anything shaped like a token.
 *
 * The client holds the session in localStorage — Supabase's own storage, which
 * middleware cannot read — so the browser presents it here once after signing in
 * and once per fresh page load, and the cookie carries the answer to the edge.
 *
 * GET, because it is a read of "who am I": no state changes on Supabase's side.
 * It does set a cookie, which is a side effect, but the underlying question is
 * idempotent and safe to repeat, and the client calls it on every hydrate.
 */

function client(url: string, anonKey: string) {
  return createClient(url, anonKey, {
    auth: {
      // A request-scoped client: it must not read or write the browser's storage
      // (there is none here) and must not try to refresh anything.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  /**
   * No auth in this deployment.
   *
   * Reported as its own status rather than as "signed out", because the two lead
   * to opposite behaviour: signed-out means "go and sign in", unconfigured means
   * "there is nothing to sign in to, come in as a guest". Collapsing them is what
   * would strand every visitor to the public desk on a sign-in page.
   */
  if (!url || !anonKey) {
    return NextResponse.json({ status: "unconfigured", user: null }, { status: 200 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ status: "signed-out", user: null }, { status: 401 });
  }

  const { data, error } = await client(url, anonKey).auth.getUser(token);
  if (error || !data.user) {
    /**
     * Clear the pass on the way out — an ACCOUNT pass, never a guest one.
     *
     * An expired token with a live cookie is the state that would let someone sit
     * on the desk shell indefinitely after their session ended. Nothing sensitive
     * is behind the shell, but a stale pass is still a lie about the session, and
     * the header would render a signed-in chip for an account that is gone.
     *
     * A guest pass makes no claim about this token. It was minted by
     * `/api/auth/guest` for someone who chose not to have an account, and
     * dropping it here evicts them from the desk because a *different* identity
     * failed to validate. That is reachable rather than theoretical: `/` always
     * redirects to `/login`, the login page mints from whatever token it finds in
     * storage, and a token Supabase rejects — a rotated project, a deleted user, a
     * session left behind by earlier testing — then takes the guest's pass with
     * it, bouncing them back to the form on their next navigation. `isGuest` is
     * the same shape test the guard uses, so the two cannot disagree about which
     * kind of pass this is.
     */
    const response = NextResponse.json({ status: "signed-out", user: null }, { status: 401 });
    if (!isGuest(request.cookies.get(DESK_COOKIE)?.value)) {
      response.cookies.set({ ...deskCookie(""), value: "", maxAge: 0 });
    }
    return response;
  }

  const response = NextResponse.json({
    status: "authenticated",
    user: { id: data.user.id, email: data.user.email ?? null },
  });
  // The pass is the validated user's id, so a guest pass and an account pass are
  // distinguishable by shape alone (`guest:` prefix) without another lookup.
  response.cookies.set(deskCookie(data.user.id));
  return response;
}

/**
 * Drop the pass.
 *
 * The Supabase session itself is revoked by the client — `signOutUser()` awaits
 * GoTrue's round trip before navigating, because navigating first can unload the
 * document mid-flight and leave the token behind. This route's job is only the
 * cookie, so that the next request is routed as a stranger.
 */
export async function DELETE() {
  const response = NextResponse.json({ status: "signed-out", user: null });
  response.cookies.set({ ...deskCookie(""), value: "", maxAge: 0 });
  return response;
}

export const dynamic = "force-dynamic";
export { DESK_COOKIE };
