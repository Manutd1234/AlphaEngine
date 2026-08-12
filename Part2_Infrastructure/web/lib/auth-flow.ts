/**
 * The login flow's decisions, as pure functions.
 *
 * No React, no Supabase client, no DOM — so the node test runner can assert the
 * parts that are easy to get quietly wrong (which step a URL means, how long
 * until a resend is allowed, what an unconfigured provider should read as)
 * without a browser.
 *
 * The OTP gate is an app-level marker, not a Supabase concept. Supabase
 * considers you signed in the moment OAuth returns; this app additionally
 * requires proof of mailbox control before it treats that session as a full
 * identity, so the marker records "OAuth landed, code not yet verified" and
 * `use-session` reports `otp-pending` while it is set.
 */

/** Set immediately BEFORE redirecting to a provider; cleared on verify or sign-out. */
export const OTP_PENDING_KEY = "alphaengine-auth-otp-pending";
/** Epoch millis of the last OTP send, so a reload cannot reset the cooldown. */
export const OTP_SENT_AT_KEY = "alphaengine-auth-otp-sent-at";

/** Supabase's own inter-send minimum. Asking sooner earns a 429, not an email. */
export const OTP_RESEND_COOLDOWN_MS = 60_000;

export type LoginStep =
  | "signin"
  | "verify"
  /** Landed here by opening the emailed sign-in link — mailbox proven. */
  | "verified"
  | "reset"
  | "confirmed";

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

const STEPS = new Set<LoginStep>(["signin", "verify", "verified", "reset", "confirmed"]);

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

/** Milliseconds left before another OTP may be requested. 0 means "now". */
export function resendCooldownRemaining(sentAt: number | null, now: number): number {
  if (sentAt == null || !Number.isFinite(sentAt)) return 0;
  // A clock that moved backwards (or a stored value from the future) must not
  // lock the button for hours.
  if (sentAt > now) return OTP_RESEND_COOLDOWN_MS;
  return Math.max(0, OTP_RESEND_COOLDOWN_MS - (now - sentAt));
}

/** Whole seconds, for a countdown that never renders "0s" while still blocked. */
export function cooldownSeconds(remainingMs: number): number {
  return Math.ceil(remainingMs / 1000);
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
  if (lower.includes("token has expired") || lower.includes("expired")) {
    return `${raw} — request a new code and try again.`;
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return `${raw} — wait a minute before asking for another email.`;
  }
  if (lower.includes("user already registered")) {
    return "An account with that email already exists. Sign in instead, or reset the password.";
  }
  return raw;
}

/** Cheap client-side shape check, so an obvious typo does not cost an email. */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/** Six digits, as Supabase mints them; spaces tolerated because people paste. */
export function normaliseOtp(value: string): string {
  return value.replace(/\s+/g, "");
}

export function isCompleteOtp(value: string): boolean {
  return /^\d{6}$/.test(normaliseOtp(value));
}
