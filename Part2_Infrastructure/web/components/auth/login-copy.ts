/**
 * The four forms' vocabulary, and the providers this app knows how to name.
 *
 * `LoginScreen` is four forms on one route — sign in, create account, forgot
 * password, set a new password — so the wording that changes between them is a
 * table rather than four branches. It sits here because both the screen and the
 * card it renders read it, and a second copy of "Create account" in either
 * would be the kind of drift no test can see.
 */

import type { Provider } from "@supabase/supabase-js";

export type FormMode = "signin" | "signup" | "forgot" | "reset";

export type BannerTone = "error" | "warn" | "context-change";

export interface Banner {
  tone: BannerTone;
  message: string;
}

/**
 * Every provider the button list can name. Which of them is actually offered is
 * decided at runtime by the enabled-providers probe — see `LoginScreen` — because
 * drawing a button for a provider the project has not enabled sends the reader
 * out of the app to a page of raw JSON.
 */
export const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  // Supabase's Microsoft/Outlook provider is registered as "azure".
  { id: "azure", label: "Outlook" },
];

export const MODE_COPY: Record<FormMode, { title: string; blurb: string; submit: string }> = {
  signin: {
    title: "Sign in",
    blurb: "Preferences follow your account between devices.",
    submit: "Sign in",
  },
  signup: {
    title: "Create an account",
    blurb: "Paper-only and free. No funds, no brokerage relationship, no card.",
    submit: "Create account",
  },
  forgot: {
    title: "Reset your password",
    blurb: "The link brings you back here to choose a new one.",
    submit: "Email a reset link",
  },
  reset: {
    title: "Choose a new password",
    blurb: "This link signed you in for the moment it takes to set a password.",
    submit: "Set password",
  },
};
