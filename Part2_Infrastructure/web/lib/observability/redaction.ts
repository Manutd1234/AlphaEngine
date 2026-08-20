// --------------------------------------------------------------------------
// Redaction
// --------------------------------------------------------------------------

/**
 * Credential values the console must never echo.
 *
 * Registered rather than read from `process.env` here so this module stays
 * isomorphic — and so the redactor covers values that arrived some other way.
 * Short values are ignored: a two-character "key" would blank unrelated text.
 */
const secrets = new Set<string>();

const MIN_SECRET_LENGTH = 8;

export function registerSecret(value: string | undefined | null): void {
  const trimmed = value?.trim();
  if (trimmed && trimmed.length >= MIN_SECRET_LENGTH) secrets.add(trimmed);
}

export function clearSecrets(): void {
  secrets.clear();
}

/** Query parameters whose *value* is a credential regardless of its content. */
const SECRET_PARAM_RE = /^(api[-_]?key|apikey|token|access[-_]?token|auth|key|secret|password|pwd|sig|signature)$/i;

const MASK = "«redacted»";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace every registered secret literal anywhere in `text`. */
export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) {
    out = out.replace(new RegExp(escapeRegExp(secret), "g"), MASK);
  }
  return out;
}

/**
 * A URL safe to display.
 *
 * Two independent passes, because either alone leaks. Blanking known parameter
 * names misses a vendor that calls its key something unexpected; blanking known
 * secret literals misses a key that is not registered because its env var was
 * read somewhere else. Both run, and a URL that fails to parse is redacted as a
 * plain string rather than returned raw.
 */
export function redactUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return redact(raw);
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (SECRET_PARAM_RE.test(name)) parsed.searchParams.set(name, MASK);
  }
  // Credentials in the authority component (https://user:pass@host) never
  // survive to a screen.
  if (parsed.username || parsed.password) {
    parsed.username = MASK;
    parsed.password = "";
  }
  return redact(parsed.toString());
}

/** Header names whose values are credentials. */
const SECRET_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|apikey)$/i;

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_HEADER_RE.test(name) ? MASK : redact(value);
  }
  return out;
}
