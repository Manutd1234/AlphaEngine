import type { Metadata } from "next";

import LoginScreen from "@/components/auth/LoginScreen";

/**
 * The one route outside the workspace shell.
 *
 * A server component so it can carry its own metadata — noindex in particular:
 * a sign-in form is not a landing page, and the workspace it belongs to is the
 * thing worth indexing. Everything interactive lives in the client component
 * below, which renders an honest "not configured" state when this deployment
 * has no Supabase credentials, so `next build` can prerender this page with no
 * environment at all.
 */
export const metadata: Metadata = {
  title: "Sign in — AlphaEngine",
  description:
    "Sign in to store workspace preferences against your account. The AlphaEngine demo desk is browsable without one.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginScreen />;
}
