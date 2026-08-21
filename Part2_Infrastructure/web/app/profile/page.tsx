import type { Metadata } from "next";

import ProfileScreen from "@/components/profile/ProfileScreen";

/**
 * The second route outside the workspace shell, and a sibling to `/login`
 * rather than a ninth tab: `tests/workspace-routing-nav.test.ts` deep-equals the
 * eight nav ids and `app/page.tsx` derives its view union from the same list,
 * so adding one there would change what the desk is.
 *
 * A server component for its metadata only — noindex in particular, since an
 * account page is not a landing page. Everything interactive is in the client
 * component below, which renders an honest "not configured" state when this
 * deployment has no Supabase credentials, so `next build` can prerender this
 * with no environment at all.
 */
export const metadata: Metadata = {
  title: "Account — AlphaEngine",
  description:
    "Manage the account AlphaEngine stores workspace preferences against: display name, avatar, "
    + "connected sign-in methods, active sessions and password.",
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return <ProfileScreen />;
}
