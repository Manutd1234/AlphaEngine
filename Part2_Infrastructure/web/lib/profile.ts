/**
 * The profile page's decisions, as pure functions.
 *
 * No React, no Supabase client, no DOM — the same split as `auth-flow.ts`, and
 * for the same reason: the parts most likely to be quietly wrong here are
 * judgements about wording and eligibility, not rendering. A password meter
 * that flatters a weak string, an Unlink button offered when the library will
 * refuse it, or a one-row session list captioned as though it were a complete
 * answer are all bugs that look completely fine on screen.
 */

/**
 * Where the workspace stores the name you chose.
 *
 * NOT `name`, `full_name`, `avatar_url` or `picture`. GoTrue merges the
 * provider's claims into `user_metadata` on *every* OAuth sign-in, so anything
 * a provider also writes is silently reverted the next time you sign in with
 * Google or GitHub — the edit saves, the toast says so, and the old value is
 * back tomorrow. This key is one no provider emits.
 */
export const DISPLAY_NAME_KEY = "workspace_display_name";

/**
 * Claims GoTrue is known to merge from providers. Held here so the test can
 * assert the key above is not one of them rather than trusting the comment.
 */
export const PROVIDER_WRITTEN_KEYS: readonly string[] = [
  "name",
  "full_name",
  "avatar_url",
  "picture",
  "email",
  "email_verified",
  "phone_verified",
  "preferred_username",
  "user_name",
  "provider_id",
  "sub",
  "iss",
];

/** Hardcoded, not an env var: a NEXT_PUBLIC_* addition fails the deployment contract test. */
export const AVATAR_BUCKET = "avatars";

/**
 * `<uid>/avatar`, and the first segment is load-bearing — every storage policy
 * compares `(storage.foldername(name))[1]` to the caller's uid. No extension:
 * the object is served with the content type it was uploaded under, and a fixed
 * path means replacing an avatar overwrites rather than accumulating.
 */
export function avatarPath(userId: string): string {
  return `${userId}/avatar`;
}

export interface LinkableProvider {
  /** The id GoTrue knows it by, which is not always the id people know it by. */
  id: string;
  label: string;
}

/** Microsoft is `azure` to GoTrue. Using "microsoft" returns 400. */
export const LINKABLE_PROVIDERS: readonly LinkableProvider[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "azure", label: "Microsoft" },
];

export function providerLabel(id: string): string {
  return LINKABLE_PROVIDERS.find((provider) => provider.id === id)?.label
    ?? (id === "email" ? "Email and password" : id);
}

/**
 * Unlink needs a second identity to fall back to.
 *
 * `unlinkIdentity` refuses below two and returns an error, so offering the
 * button at one identity means a control whose only outcome is a failure
 * message. Disabled with a reason beside it says the same thing without the
 * round trip — and, more importantly, without implying the account could be
 * left with no way back in.
 */
export function canUnlink(identityCount: number): boolean {
  return identityCount >= 2;
}

export interface PasswordAssessment {
  /** 0–4. A heuristic score. Deliberately not called entropy. */
  score: number;
  label: string;
  hint: string;
}

const COMMON_FRAGMENTS = [
  "password", "qwerty", "letmein", "welcome", "admin", "iloveyou",
  "alphaengine", "123456", "abc123",
];

/**
 * A rough shape check, and it says so wherever it is shown.
 *
 * Hand-rolled because the alternative is a dependency, and this repository does
 * not take one for a progress bar. What it can honestly claim is narrow: it
 * rewards length and variety and punishes the four shapes that defeat both. It
 * cannot know whether a password has been breached, and a full bar is not a
 * promise — which is why the label is a word rather than a colour, and why the
 * hint never says "secure".
 */
export function assessPassword(value: string): PasswordAssessment {
  if (value.length === 0) {
    return { score: 0, label: "Empty", hint: "At least 8 characters." };
  }

  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]
    .filter((pattern) => pattern.test(value)).length;
  if (classes >= 3) score += 1;

  // The shapes length alone cannot rescue. Each caps rather than subtracts, so
  // a long repetitive string cannot out-score a short varied one.
  const lower = value.toLowerCase();
  if (/^(.)\1*$/.test(value)) score = 0;
  if (/^\d+$/.test(value)) score = Math.min(score, 1);
  if (COMMON_FRAGMENTS.some((fragment) => lower.includes(fragment))) score = Math.min(score, 1);
  if (value.length < 8) score = 0;

  const label = ["Too weak", "Weak", "Fair", "Strong", "Very strong"][score];
  const hint = score <= 1
    ? "Longer helps more than punctuation does. Aim for 12 characters or a passphrase."
    : score === 2
      ? "Reasonable. Another few characters would do more than another symbol."
      : "A rough check only — it cannot tell whether this password has appeared in a breach.";

  return { score, label, hint };
}

/** The minimum this page will submit. Matches the login screen's reset step. */
export const MIN_PASSWORD_LENGTH = 8;

export type SessionSource = "sessions" | "jwt";

/**
 * What a session list is allowed to claim.
 *
 * The `jwt` case is the one that matters. When the database cannot read
 * `auth.sessions` the RPC answers from the caller's own token, which produces a
 * one-row list — and a one-row list captioned "1 active session" asserts that
 * there are no others. There is no evidence for that, so this says so instead.
 */
export function describeSessionSource(source: SessionSource, count: number): string {
  if (source === "jwt") {
    return "Only this device can be listed on this project. Other sessions are neither "
      + "shown nor ruled out — the session table is not readable from here.";
  }
  if (count === 0) {
    // Unreachable while signed in — the caller always holds at least the
    // session it is calling with — so saying "no sessions" would be reporting
    // an impossible fact rather than an empty one.
    return "No sessions came back, which should not happen while you are signed in. "
      + "Treat this as a failed read rather than an empty list.";
  }
  if (count === 1) {
    return "One active session: this device. Signing in elsewhere would add a row here.";
  }
  return `${count} active sessions. Anything you do not recognise should be revoked.`;
}

/**
 * A readable guess at a device, from a string the browser chose to send.
 *
 * User-agent strings are self-reported and deliberately full of lies for
 * compatibility — every browser claims to be Mozilla, and most claim to be
 * Safari. So this is presented as "reported as", never as identification, and
 * the raw string stays available rather than being replaced by the guess.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unreported device";

  // Order matters: every one of these also matches the ones below it.
  const browser =
    /\bEdg\//.test(userAgent) ? "Edge"
    : /\bOPR\/|\bOpera\b/.test(userAgent) ? "Opera"
    : /\bFirefox\//.test(userAgent) ? "Firefox"
    // Before the Chrome test, and unanchored, because "HeadlessChrome" has no
    // word boundary in front of "Chrome" — `\bChrome\/` misses it and the
    // string falls through to the Safari token every UA also carries.
    : /HeadlessChrome\//.test(userAgent) ? "Headless Chrome"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /\bSafari\//.test(userAgent) ? "Safari"
    : null;

  const os =
    /\bWindows NT\b/.test(userAgent) ? "Windows"
    : /\biPhone\b|\biPad\b|\biOS\b/.test(userAgent) ? "iOS"
    : /\bMac OS X\b|\bMacintosh\b/.test(userAgent) ? "macOS"
    : /\bAndroid\b/.test(userAgent) ? "Android"
    : /\bLinux\b/.test(userAgent) ? "Linux"
    : null;

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return "Unrecognised browser";
}

/**
 * The address without the netmask Postgres insists on carrying.
 *
 * `auth.sessions.ip` is `inet`, and the live rows come back as
 * `115.66.103.192/32` — a single host wearing a subnet's notation. Only the
 * full-width masks are stripped: /32 on IPv4 and /128 on IPv6 mean "exactly
 * this address" and lose nothing, while anything narrower is a genuine range
 * and stays visible rather than being quietly rounded off.
 *
 * Done here rather than with `host()` in the migration because migrations are
 * forward-only, and this is presentation.
 */
export function formatIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return ip.replace(/\/(32|128)$/, "");
}

/**
 * True when an error means "this project has not been set up for that yet"
 * rather than "that went wrong".
 *
 * The same distinction `user-prefs.ts` draws for its table. A missing RPC, a
 * missing bucket and a missing table are all states this deployment is allowed
 * to be in — CI builds with no Supabase project at all — so they render as
 * "not configured" and never as a fault.
 */
export function isNotConfigured(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    text.includes("could not find")            // PostgREST: unknown function
    || text.includes("does not exist")
    || text.includes("bucket not found")
    || text.includes("schema cache")
    || text.includes("404")
    || error.code === "42883"                  // undefined_function
    || error.code === "42p01"                  // undefined_table
  );
}

/**
 * True when GoTrue is asking for a fresh authentication before it will change a
 * password. `describeAuthError` has no case for this and would print the raw
 * string, which reads as a bug rather than as a step you can take.
 */
export function needsReauthentication(
  error: { message?: string } | null | undefined,
): boolean {
  const text = error?.message?.toLowerCase() ?? "";
  return text.includes("reauthentication") || text.includes("nonce");
}
