import { redirect } from "next/navigation";

/**
 * The root, which is now a signpost rather than the desk.
 *
 * The desk moved to `/dashboard` so that "am I allowed in" is a routing question
 * with an answer before anything renders. While the workspace lived at `/`, a
 * visitor with no session got the whole shell painted at them and a Sign in
 * button in the corner — and a magic link landed them on a dashboard that was
 * still deciding who they were.
 *
 * `middleware.ts` intercepts `/` before this file runs and sends the visitor to
 * `/login` or `/dashboard` depending on the desk cookie, so in practice this
 * component is only reached when middleware is bypassed — a static export, a
 * misconfigured matcher, a future framework change. It redirects to the guarded
 * route rather than the login page, so the middleware stays the single place
 * that decides, and a bypass degrades to "ask again" rather than to "always show
 * the sign-in form" — which would strand a signed-in visitor.
 *
 * FRAGMENTS SURVIVE THIS. Browsers reattach `#research/codex` across a 3xx, so
 * every deep link that has ever been shared still lands on its tab and section.
 * `tests/auth-routing.test.ts` pins that reasoning; it is the one property that
 * would break silently and only for people following old links.
 */
export default function RootPage() {
  redirect("/dashboard");
}
