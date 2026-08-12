/**
 * The login flow's decisions, as pure functions.
 *
 * No React, no Supabase client, no DOM — so the node test runner can assert the
 * parts that are easy to get quietly wrong (which step a URL means, what an
 * unconfigured provider should read as) without a browser.
 *
 * There is deliberately no second verification step after a provider sign-in.
 * An earlier design emailed a six-digit code to re-prove the mailbox that
 * GitHub had just vouched for, which was redundant on its own terms and, on a
 * project using Supabase's built-in email sender, impossible: template editing
 * is gated behind custom SMTP, and the stock template carries no token to send.
 * The provider's own verification is the verification.
 */

export type LoginStep = "signin" | "reset" | "confirmed";

export interface LoginLocation {
  step: LoginStep;
  /** Present on token_hash-style email links, which need no PKCE verifier. */
  tokenHash: string | null;
  /** Supabase's `type` param: signup | recovery | magiclink | email. */
  tokenType: string | null;
  /** True when PKCE returned a code for detectSessionInUrl to exchange. */
  hasCode: boolean;
  /** Supabase reports provider failures on the URL, not through the client. */
  errorMessage: string | null;
}

const STEPS = new Set<LoginStep>(["signin", "reset", "confirmed"]);

/**
 * Reads the login route's query string. Both email-link shapes land here: PKCE
 * `?code=`, which the client exchanges automatically, and `?token_hash=&type=`,
 * which we verify explicitly because it survives being opened in a different
 * tab or browser than the one that started the flow.
 */
export function resolveLoginStep(search: string): LoginLocation {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawStep = params.get("step");
  const tokenType = params.get("type");
  const requested = STEPS.has(rawStep as LoginStep) ? (rawStep as LoginStep) : null;

  // A recovery link is a recovery link even if the template lost the step
  // param — the type carries the intent and must win over the default.
  const step: LoginStep = requested ?? (tokenType === "recovery" ? "reset" : "signin");

  return {
    step,
    tokenHash: params.get("token_hash"),
    tokenType,
    hasCode: params.has("code"),
    errorMessage: params.get("error_description") ?? params.get("error") ?? null,
  };
}

/**
 * Turns a Supabase error into something a reader can act on, while keeping the
 * original words. A provider nobody has configured yet is the expected state of
 * this deployment, not a fault, and must not read like one.
 */
export function describeAuthError(error: { message?: string } | null | undefined): string {
  const raw = error?.message?.trim();
  if (!raw) return "Something went wrong. Try again.";

  const lower = raw.toLowerCase();

  if (lower.includes("provider is not enabled") || lower.includes("unsupported provider")) {
    return `${raw} — this sign-in provider has not been configured for this deployment yet.`;
  }
  if (lower.includes("invalid login credentials")) {
    return "That email and password combination does not match an account.";
  }
  if (lower.includes("email not confirmed")) {
    return "This account still needs its email confirmed. Check your inbox for the confirmation link.";
  }
  if (lower.includes("expired")) {
    return `${raw} — request a new link and try again.`;
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return `${raw} — wait a minute before trying again.`;
  }
  if (lower.includes("user already registered")) {
    return "An account with that email already exists. Sign in instead, or reset the password.";
  }
  return raw;
}

/** Cheap client-side shape check, so an obvious typo does not cost a request. */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
