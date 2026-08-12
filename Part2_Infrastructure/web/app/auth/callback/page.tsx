import type { Metadata } from "next";

import AuthCallback from "@/components/auth/AuthCallback";

/**
 * Where every sign-in lands before the desk.
 *
 * Magic links, OTP confirmations and OAuth returns all arrive here, the session
 * is established, the desk pass is issued, and only then does the visitor reach
 * `/dashboard`. Previously they were sent straight to the workspace, which meant
 * the dashboard rendered while the session was still being read out of the URL —
 * the flash of a signed-out desk that made sign-in feel unreliable even when it
 * had worked.
 *
 * A CLIENT PAGE, NOT A ROUTE HANDLER, and this is the load-bearing decision.
 * `authClient` uses the PKCE flow, whose code verifier is generated in the
 * browser and kept in browser storage. A server handler receiving `?code=…` has
 * no access to that verifier and cannot complete the exchange. It would appear
 * to work — `token_hash` links, which carry everything server-side, would
 * succeed — and fail only for `?code=` links, which is what OAuth and the
 * default magic-link template produce. `tests/auth-routing.test.ts` pins that
 * this file stays a page.
 */
export const metadata: Metadata = {
  title: "Signing in — AlphaEngine",
  robots: { index: false, follow: false },
};

export default function AuthCallbackPage() {
  return <AuthCallback />;
}
