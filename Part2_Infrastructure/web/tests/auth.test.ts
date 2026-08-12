/**
 * Login, and the four ways it could quietly break something else.
 *
 * The flow logic here is pure and tested directly. The rest of this file is
 * structural, because the hazards that matter are not "does the form submit" —
 * they are:
 *
 *  1. A second session-carrying client written into the tape client, which
 *     would flip the browser's Postgres role and empty the demo tape while it
 *     still reported itself live.
 *  2. An OTP step that mints a second identity instead of proving the first.
 *  3. A migration that publishes a signed-in user's own rows to anonymous
 *     visitors, or leaves a SECURITY DEFINER writer reachable by anyone who
 *     can sign up.
 *
 * None of those fail loudly. All three are assertable from source.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  OTP_RESEND_COOLDOWN_MS,
  cooldownSeconds,
  describeAuthError,
  isCompleteOtp,
  looksLikeEmail,
  normaliseOtp,
  resendCooldownRemaining,
  resolveLoginStep,
} from "../lib/auth-flow";
import {
  DEFAULT_AUTH_PERSISTENCE,
  isAuthPersistence,
} from "../lib/auth-storage";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comment bodies removed before keyword scans — these files document the very
 *  hazards they avoid, so raw text finds the explanation and reports the
 *  safeguard as the violation. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/** The same rule for SQL. These migrations spend more lines explaining which
 *  grants they are closing than issuing statements, so a raw scan for
 *  "grant … to anon" finds the rationale and reports it as the grant. */
const sqlCode = (source: string) => source.replace(/--[^\n]*/g, "");

const tapeClient = read("../lib/supabaseClient.ts");
const authClientSource = read("../lib/auth-client.ts");
const storage = read("../lib/auth-storage.ts");
const screen = read("../components/auth/LoginScreen.tsx");
const session = read("../lib/use-session.ts");

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8") }));

describe("the tape client never learns to hold a session", () => {
  it("stays anonymous, so the demo tape keeps its policy", () => {
    // The demo tape reads through a `to anon` policy. A session on THIS client
    // would switch the role to `authenticated`, that policy would stop
    // applying, and the tape would go empty while still reporting "live".
    assert.match(tapeClient, /persistSession:\s*false/);
    assert.match(tapeClient, /autoRefreshToken:\s*false/);
    assert.doesNotMatch(code(tapeClient), /flowType|storageKey|signIn/);
  });

  it("the auth client is the only one that persists, under its own key", () => {
    assert.match(authClientSource, /persistSession:\s*true/);
    assert.match(authClientSource, /autoRefreshToken:\s*true/);
    assert.match(authClientSource, /flowType:\s*"pkce"/);
    // Two GoTrueClients on one origin collide over a shared storage slot. They
    // do not here, and the explicit key is what guarantees it.
    assert.match(authClientSource, /storageKey:\s*AUTH_STORAGE_KEY/);
  });

  it("exactly two clients exist in the web app", () => {
    const files = [tapeClient, authClientSource, screen, session, storage];
    const constructions = files.reduce(
      (total, source) => total + (code(source).match(/createClient\(/g)?.length ?? 0),
      0,
    );
    assert.equal(constructions, 2, "a third Supabase client would fight over auth storage");
  });

  it("reads the public variables statically", () => {
    // Next substitutes `process.env.NEXT_PUBLIC_*` textually at build time, so
    // a computed lookup is undefined in the browser bundle.
    assert.match(code(authClientSource), /process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
    assert.match(code(authClientSource), /process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    assert.doesNotMatch(code(authClientSource), /process\.env\[/);
  });

  it("never names the service-role key", () => {
    assert.doesNotMatch(code(authClientSource + screen + session + storage), /SERVICE_ROLE/);
  });
});

describe("remember me chooses a store, not a second client", () => {
  it("defaults to surviving the tab", () => {
    assert.equal(DEFAULT_AUTH_PERSISTENCE, "local");
    assert.ok(isAuthPersistence("session"));
    assert.ok(!isAuthPersistence("forever"));
  });

  it("routes reads and writes through whichever store is marked", () => {
    assert.match(code(storage), /sessionStorage/);
    assert.match(code(storage), /localStorage/);
    // The marker itself is a preference about sessions, so it outlives them.
    assert.match(code(storage), /localStorage\.getItem\(AUTH_PERSIST_KEY\)/);
  });

  it("clears both stores on removal", () => {
    // The marker can change between sign-in and sign-out. A token left in the
    // store we stopped reading is a session nobody can see or end.
    const removeBlock = code(storage).slice(code(storage).indexOf("removeItem(key: string)"));
    assert.match(removeBlock, /localStorage\.removeItem/);
    assert.match(removeBlock, /sessionStorage\.removeItem/);
  });

  it("guards every access twice", () => {
    assert.match(storage, /typeof window === "undefined"/);
    assert.match(storage, /catch/);
  });
});

describe("the login route reads its own URL", () => {
  it("defaults to sign-in", () => {
    assert.equal(resolveLoginStep("").step, "signin");
    assert.equal(resolveLoginStep("?nonsense=1").step, "signin");
  });

  it("recognises each step", () => {
    assert.equal(resolveLoginStep("?step=verify").step, "verify");
    assert.equal(resolveLoginStep("?step=reset").step, "reset");
    assert.equal(resolveLoginStep("?step=confirmed").step, "confirmed");
  });

  it("a recovery type wins over a missing step", () => {
    // Email templates are edited by hand in a dashboard. Losing the step param
    // must not drop someone into a sign-in form holding a recovery token.
    assert.equal(resolveLoginStep("?token_hash=abc&type=recovery").step, "reset");
    assert.equal(resolveLoginStep("?token_hash=abc&type=recovery").tokenHash, "abc");
  });

  it("surfaces provider failures that arrive on the URL", () => {
    const location = resolveLoginStep("?error=access_denied&error_description=User+denied");
    assert.equal(location.errorMessage, "User denied");
  });

  it("notices a PKCE code without consuming it", () => {
    assert.equal(resolveLoginStep("?code=abc123").hasCode, true);
    assert.equal(resolveLoginStep("?step=verify").hasCode, false);
  });
});

describe("the resend cooldown cannot be reset by reloading", () => {
  it("counts down from the stored stamp", () => {
    const now = 1_000_000;
    assert.equal(resendCooldownRemaining(now, now), OTP_RESEND_COOLDOWN_MS);
    assert.equal(resendCooldownRemaining(now - 20_000, now), OTP_RESEND_COOLDOWN_MS - 20_000);
    assert.equal(resendCooldownRemaining(now - OTP_RESEND_COOLDOWN_MS, now), 0);
  });

  it("treats a missing or absurd stamp as ready", () => {
    assert.equal(resendCooldownRemaining(null, 1_000), 0);
    assert.equal(resendCooldownRemaining(Number.NaN, 1_000), 0);
  });

  it("a stamp from the future locks for one full window, not for hours", () => {
    // A clock that jumped backwards must not strand someone behind a countdown
    // measured in days.
    assert.equal(resendCooldownRemaining(5_000_000, 1_000), OTP_RESEND_COOLDOWN_MS);
  });

  it("never renders a zero while still blocked", () => {
    assert.equal(cooldownSeconds(1), 1);
    assert.equal(cooldownSeconds(1_001), 2);
  });
});

describe("errors say what to do about them", () => {
  it("an unconfigured provider reads as unconfigured, not broken", () => {
    const message = describeAuthError({ message: "Unsupported provider: provider is not enabled" });
    // The raw words survive — a maintainer searching the Supabase docs needs
    // the phrase the API actually returned.
    assert.match(message, /provider is not enabled/);
    assert.match(message, /not been configured/i);
    assert.doesNotMatch(message, /error|failed/i);
  });

  it("keeps unknown messages verbatim rather than inventing one", () => {
    assert.equal(describeAuthError({ message: "Weird upstream thing" }), "Weird upstream thing");
  });

  it("has something to say when there is no message at all", () => {
    assert.match(describeAuthError(null), /try again/i);
    assert.match(describeAuthError({}), /try again/i);
  });
});

describe("field validation is cheap and local", () => {
  it("catches the obvious email typo before spending an email", () => {
    assert.ok(looksLikeEmail("desk@example.com"));
    assert.ok(!looksLikeEmail("desk@example"));
    assert.ok(!looksLikeEmail("not an email"));
    assert.ok(!looksLikeEmail(""));
  });

  it("accepts a pasted code with spaces in it", () => {
    assert.equal(normaliseOtp("123 456"), "123456");
    assert.ok(isCompleteOtp("123 456"));
    assert.ok(!isCompleteOtp("12345"));
    assert.ok(!isCompleteOtp("abcdef"));
  });
});

describe("the OAuth handshake is gated on proving the mailbox", () => {
  it("marks the session pending before leaving for the provider", () => {
    // Set after the redirect would be set never: the browser has already gone.
    const oauth = code(screen).slice(code(screen).indexOf("const onProvider"));
    const markIndex = oauth.indexOf("markOtpPending()");
    const redirectIndex = oauth.indexOf("signInWithOAuth");
    assert.ok(markIndex > 0 && markIndex < redirectIndex, "the marker must precede the redirect");
  });

  it("never creates a user from the verification step", () => {
    // verifyOtp proves control of an existing mailbox. Allowing it to create
    // one would turn the safety check into a second sign-up path.
    assert.match(code(screen), /shouldCreateUser:\s*false/);
  });

  it("signs out rather than silently swapping identity", () => {
    assert.match(code(screen), /before !== after/);
    assert.match(code(screen), /signOutUser\(\)/);
  });

  it("password sign-in is never gated behind the code", () => {
    const passwordBlock = code(screen).slice(code(screen).indexOf("signInWithPassword"));
    assert.match(passwordBlock, /clearOtpPending\(\)/);
  });

  it("pending is not signed in", () => {
    // The chip and the preference engine both branch on this. Collapsing it
    // into "signed in" would claim an identity the app has not confirmed.
    assert.match(session, /"otp-pending"/);
    assert.match(code(session), /readOtpPending\(\)\s*\?\s*"otp-pending"\s*:\s*"signed-in"/);
  });

  it("all three providers ship wired, whatever the dashboard says", () => {
    assert.match(code(screen), /"google"/);
    assert.match(code(screen), /"github"/);
    // Supabase registers Microsoft/Outlook as "azure".
    assert.match(code(screen), /"azure"/);
  });
});

describe("the login page survives a deployment with no Supabase", () => {
  it("renders an honest unconfigured state instead of throwing", () => {
    // CI builds this app with zero environment variables and prerenders every
    // route, this one included.
    assert.match(code(screen), /authConfigured\(\)/);
    assert.match(screen, /not configured in this deployment/i);
  });

  it("the account chip disappears rather than offering a dead link", () => {
    const chip = read("../components/header/AccountChip.tsx");
    assert.match(code(chip), /status === "unconfigured"\) return null/);
  });
});

describe("the form carries the controls the desk asked for", () => {
  it("has a show-password toggle that announces its state", () => {
    assert.match(code(screen), /aria-pressed=\{showPassword\}/);
    assert.match(code(screen), /showPassword \? "text" : "password"/);
  });

  it("has remember me, create account and forgot password", () => {
    assert.match(code(screen), /id="auth-remember"/);
    assert.match(screen, /Create account/);
    assert.match(screen, /Forgot password\?/);
  });

  it("sets persistence before signing in, never after", () => {
    const submit = code(screen).slice(code(screen).indexOf("const onSubmit"));
    const persistIndex = submit.indexOf("setAuthPersistence");
    const signInIndex = submit.indexOf("signInWithPassword");
    assert.ok(
      persistIndex > 0 && persistIndex < signInIndex,
      "a session minted before the store is chosen lands in the wrong one",
    );
  });
});

describe("the migrations that ship with the login", () => {
  const demo = migrations.find((file) => file.name === "20260812090000_authenticated_demo_realtime.sql");
  const hardening = migrations.find((file) => file.name === "20260812091000_close_authenticated_writes.sql");

  it("both exist", () => {
    assert.ok(demo, "the authenticated demo-tape policy is missing");
    assert.ok(hardening, "the authenticated write-closure migration is missing");
  });

  it("mirrors the anon demo predicate exactly, and no wider", () => {
    assert.match(demo!.sql, /to authenticated/);
    assert.match(demo!.sql, /00000000-0000-0000-0000-000000000001/);
    // Each clause is load-bearing: dropping user_id is null would publish
    // every signed-in trader's own rows to the shared tape.
    assert.match(demo!.sql, /user_id is null/);
    assert.match(demo!.sql, /decided_by = 'gateway'/);
    assert.match(demo!.sql, /for select/);
    assert.doesNotMatch(demo!.sql, /for (insert|update|delete|all)/);
  });

  it("revokes the SECURITY DEFINER writer from authenticated", () => {
    // 20260808120300 revoked it from public and anon and concluded nothing else
    // carried it. Supabase's bootstrap grants it to authenticated by name, and
    // a revoke from PUBLIC does not touch a named-role grant.
    assert.match(
      hardening!.sql,
      /revoke execute on function public\.record_alphaengine_decision\(jsonb\) from authenticated/,
    );
  });

  it("stops a browser claiming the gateway decided its rows", () => {
    assert.match(hardening!.sql, /decided_by = 'supabase_rpc'/);
  });

  it("never grants anything to anon", () => {
    for (const file of [demo!, hardening!]) {
      assert.doesNotMatch(sqlCode(file.sql), /grant[\s\S]{0,80}to anon/i, `${file.name} widens anon`);
    }
  });

  it("every migration name is applied-once shaped", () => {
    // Matches the gateway suite's rule, asserted here too so a web-side commit
    // cannot land a file the Python tests will reject later.
    for (const file of migrations) {
      assert.match(file.name, /^\d{14}_[a-z0-9_]+\.sql$/, `${file.name} is misnamed`);
    }
  });

  it("carries no key-shaped literals", () => {
    for (const file of migrations) {
      assert.doesNotMatch(file.sql, /sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{10}/, file.name);
    }
  });
});

describe("the page offers only providers that can actually complete", () => {
  const client = read("../lib/auth-client.ts");

  it("asks the project which providers hold credentials", () => {
    // /auth/v1/settings is public and unauthenticated — it is what the hosted
    // dashboard reads to decide the same thing.
    assert.match(code(client), /auth\/v1\/settings/);
    assert.match(code(client), /enabled === true/);
  });

  it("treats an unknown answer as unknown, not as none", () => {
    // A blocked or failing probe must not hide a working button; the failure
    // path returns null and the caller keeps rendering every provider.
    assert.match(code(client), /return null;/);
    assert.match(code(screen), /enabledProviders\s*\?\s*PROVIDERS\.filter/);
    assert.match(code(screen), /: PROVIDERS;/);
  });

  it("drops the whole block rather than leaving a headless divider", () => {
    // "or continue with" above nothing is worse than no section at all.
    assert.match(code(screen), /offeredProviders\.length > 0/);
  });

  it("renders the filtered list, never the raw one", () => {
    assert.match(code(screen), /\{offeredProviders\.map\(/);
    assert.doesNotMatch(code(screen), /\{PROVIDERS\.map\(/);
  });
});
