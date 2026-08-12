import { NextResponse, type NextRequest } from "next/server";

/**
 * Sign-in first: the routing gate in front of the desk.
 * =====================================================
 *
 * NAMED `proxy.ts`, not `middleware.ts`. Next 16 deprecated the middleware file
 * convention in favour of this one and says so on every dev boot; writing a new
 * file against a convention the framework is already warning about would be
 * inheriting a migration for no reason. The signature is unchanged.
 *
 * WHAT THIS IS: routing, not authorisation. It decides which page a request is
 * shown, and nothing more. Every data path keeps its own guard — the gateway
 * proxies check the operator token, Supabase enforces RLS, `/api/auth/session`
 * validates the JWT server-side — so a forged cookie here buys the application
 * shell and no data whatsoever. Saying that plainly matters, because a cookie
 * check in middleware is exactly the shape of a thing people later mistake for
 * a security boundary and build on.
 *
 * WHY A COOKIE AT ALL: Supabase's session lives in localStorage, which no
 * middleware can read — it runs before the document exists. So the browser tells
 * the edge what it has, once, through `ae_desk`, and that cookie is only ever set
 * by a server route that has already validated the JWT with `getUser()` (see
 * `/api/auth/session`) or minted a guest id (`/api/auth/guest`). httpOnly, so
 * page scripts cannot forge it; sameSite=lax, so it survives the return trip
 * from an OAuth provider.
 *
 * THE TRAP THIS AVOIDS: a deployment with no Supabase credentials can never
 * produce a session, so a naive `no cookie -> /login` guard would send every
 * visitor to a sign-in page that cannot sign anyone in — the entire product
 * locked, with a green build and no error anywhere. `unconfigured` therefore
 * grants a guest pass automatically. The desk is browsable; only the parts that
 * follow an account are absent.
 */

/** Set only by a server route that validated a JWT, or minted a guest id. */
const DESK_COOKIE = "ae_desk";

/**
 * Whether this deployment could authenticate anyone at all.
 *
 * Read from the same public env the browser client reads, so the middleware and
 * `authClient()` can never disagree about whether auth exists.
 */
function authConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * A guest id for a deployment that has no auth, minted at the edge.
 *
 * `crypto.randomUUID` is available in the edge runtime. This is the same shape
 * `/api/auth/guest` mints, so the sandbox seeding downstream cannot tell the two
 * apart — which is the point: an unconfigured deployment behaves exactly like a
 * visitor who chose to browse as a guest.
 */
function guestValue(): string {
  return `guest:${crypto.randomUUID()}`;
}

export default function proxy(request: NextRequest) {
  const { pathname, search, hash } = request.nextUrl;
  const desk = request.cookies.get(DESK_COOKIE)?.value;

  /**
   * The root ALWAYS shows sign-in, cookie or no cookie.
   *
   * It used to forward a visitor holding a pass straight to `/dashboard`, which
   * seemed obviously right and was wrong in practice: the pass has no expiry, so
   * it survives until the browser is fully closed — and Chrome's "continue where
   * you left off" keeps session cookies alive across restarts too. The effect was
   * that the shared link landed on the desk indefinitely after one guest entry,
   * and "open the link and you are on the sign-in page" turned out to depend on
   * the reader's browser state rather than on anything this app decides.
   *
   * So the entry point is unconditional. It costs a signed-out visitor one click
   * they were going to make anyway, and it is worth more than that: the landing
   * page is now the same for the first visit and the hundredth.
   *
   * Deep links are untouched, deliberately. `/dashboard#research/codex` still
   * opens for anyone holding a pass, because bouncing it would break every link
   * the desk shares of itself and would leave nowhere for "Continue as guest" to
   * land. And someone with a live account session does not stall here: the login
   * page mints their pass and forwards them, which is one repaint rather than a
   * form they have to answer again.
   */
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // The fragment rides along on its own — browsers reattach it across a 3xx —
    // but carrying the query string explicitly keeps `?step=verify` links intact.
    url.search = search;
    url.hash = hash;
    return NextResponse.redirect(url);
  }

  const guarded = pathname === "/dashboard" || pathname.startsWith("/dashboard/")
    || pathname === "/profile" || pathname.startsWith("/profile/");
  if (!guarded) return NextResponse.next();

  if (desk) return NextResponse.next();

  /**
   * No cookie, and no way to get one. Let them in as a guest rather than
   * bouncing them to a form that cannot help — see THE TRAP above.
   */
  if (!authConfigured()) {
    const response = NextResponse.next();
    response.cookies.set({
      name: DESK_COOKIE,
      value: guestValue(),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // A visit, not an account: it expires with the browser session, matching
      // the sessionStorage guest id the sandbox seeds from.
    });
    return response;
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  /**
   * Where they were trying to go, so the callback can finish the journey.
   *
   * Encoded as a single `next` param including the fragment, because a fragment
   * does NOT survive being handed to an OAuth provider and back — the browser
   * drops it at the first hop. `/dashboard#research/codex` therefore has to be
   * carried as data and reapplied by the callback page.
   */
  const intended = `${pathname}${search}${hash}`;
  if (intended !== "/dashboard") url.searchParams.set("next", intended);
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Only the guarded routes and the root.
   *
   * Deliberately NOT a catch-all with exclusions. `/login`, `/auth/callback` and
   * every `/api/*` route must run untouched — a matcher that swept them up would
   * redirect the sign-in page to itself, and the callback that establishes the
   * session would never execute. Static assets are absent for the same reason:
   * middleware on `/_next/*` is latency spent on every chunk to decide nothing.
   */
  matcher: ["/", "/dashboard", "/dashboard/:path*", "/profile", "/profile/:path*"],
};
