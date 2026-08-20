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
 *  2. A migration that publishes a signed-in user's own rows to anonymous
 *     visitors, or leaves a SECURITY DEFINER writer reachable by anyone who
 *     can sign up.
 *
 * None of those fail loudly. All three are assertable from source.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { describeAuthError, looksLikeEmail, resolveLoginStep } from "../lib/auth-flow";
import {
  DEFAULT_AUTH_PERSISTENCE,
  isAuthPersistence,
} from "../lib/auth-storage";
import { initialsFrom } from "../components/header/AccountChip";

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
    assert.equal(resolveLoginStep("?step=reset").step, "reset");
    assert.equal(resolveLoginStep("?step=confirmed").step, "confirmed");
    // The verification steps are gone with the gate they served.
    assert.equal(resolveLoginStep("?step=verify").step, "signin");
    assert.equal(resolveLoginStep("?step=verified").step, "signin");
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
    assert.equal(resolveLoginStep("?step=reset").hasCode, false);
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

  it("a sign-in service that cannot be reached does not read as a bad password", () => {
    // Observed in a browser: GoTrue passes the transport error through, so the
    // banner said "Failed to fetch" and nothing else. Safari words it "Load
    // failed"; both mean the request never arrived.
    for (const raw of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
      const message = describeAuthError({ message: raw });
      assert.match(message, /could not be reached/i, `unmapped: ${raw}`);
      assert.match(message, /guest/i, "the visitor is left with a way in");
    }
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

  it("treats an unknown answer as unknown, and a pending one as pending", () => {
    /**
     * The original rule — "a blocked probe must not hide a working button" —
     * still holds, and the way it was implemented did not. `null` meant BOTH
     * "still asking" and "asked and failed", and both rendered every provider.
     * On this project only GitHub is enabled, so the pending path drew Google and
     * Outlook, and clicking either left the app for a Supabase URL reading
     * "Unsupported provider: provider is not enabled". `signInWithOAuth` is a
     * full-page redirect, so no in-page handler could have caught it.
     *
     * Three states now. The probe still fails open — `"unknown"` renders every
     * provider — but a probe that has not answered yet renders none.
     */
    assert.match(code(client), /return null;/);
    assert.match(code(screen), /probePending/);
    assert.match(code(screen), /probeFailed \? PROVIDERS : \[\]/);
    // The old two-state shape must not come back.
    assert.doesNotMatch(code(screen), /enabledProviders\s*\?\s*PROVIDERS\.filter/);
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


describe("a provider sign-in is finished when the provider says so", () => {
  it("returns through the callback, not straight to the workspace", () => {
    /**
     * The point of this assertion is unchanged: a provider sign-in is finished
     * when the provider says so, and no second verification step is added. What
     * changed is the landing place. It was the workspace itself, which now sits
     * behind a routing guard — and an OAuth return has no desk cookie yet, so
     * landing there bounced the visitor straight back to the form they had just
     * completed. `/auth/callback` establishes the session, trades it for the
     * pass, and only then enters the desk.
     */
    assert.match(code(screen), /redirectTo: `\$\{window\.location\.origin\}\/auth\/callback`/);
    assert.doesNotMatch(code(screen), /redirectTo: `\$\{window\.location\.origin\}\/`/);
  });

  it("keeps no verification state anywhere", () => {
    const sources = [screen, session, read("../components/header/AccountChip.tsx"), read("../lib/auth-flow.ts")];
    for (const source of sources) {
      assert.doesNotMatch(code(source), /otp-pending|OTP_PENDING|markOtpPending|clearOtpPending/i);
    }
  });

  it("leaves the session with four honest states", () => {
    assert.match(code(session), /"unconfigured"/);
    assert.match(code(session), /"loading"/);
    assert.match(code(session), /"signed-out"/);
    assert.match(code(session), /"signed-in"/);
    assert.doesNotMatch(code(session), /"otp-pending"/);
  });

  it("still verifies a recovery link, which is a different thing", () => {
    // Password reset genuinely needs the emailed proof; that path is untouched.
    assert.match(code(screen), /verifyOtp\(\{ token_hash/);
    assert.match(code(screen), /type: "recovery"/);
  });
});

describe("signing out actually leaves, and in the right order", () => {
  const chip = read("../components/header/AccountChip.tsx");

  it("navigates to the login page", () => {
    // The reported bug: the chip flipped to "Sign in" and the browser stayed on
    // whichever tab you were reading. On a dense dashboard that signal is far
    // too quiet to notice, and it reads as sign-out having failed.
    assert.match(code(chip), /window\.location\.assign\("\/login"\)/);
  });

  it("awaits the sign-out before navigating", () => {
    // The assertion that matters. GoTrue removes the stored session only after
    // its server round-trip, so `void signOutUser(); location.assign(...)`
    // can unload the document mid-flight and leave the token in storage — the
    // browser comes back signed in, having just been told otherwise.
    const handler = code(chip).slice(code(chip).indexOf("setSigningOut(true)"));
    const awaited = handler.indexOf("await signOutUser()");
    const navigate = handler.indexOf('window.location.assign("/login")');
    assert.ok(awaited > 0, "sign-out must be awaited, not fired and forgotten");
    assert.ok(navigate > awaited, "the navigation must follow the awaited sign-out");
    assert.doesNotMatch(handler, /void signOutUser\(\)/);
  });

  it("flushes the pending preference write first", () => {
    // Preference pushes are debounced, and sign-out drops the timer. Changing
    // the theme and signing out within that window would keep the change
    // locally and never send it — sync that looks like it worked.
    const handler = code(chip).slice(code(chip).indexOf("setSigningOut(true)"));
    const flush = handler.indexOf("await flushPendingPrefs()");
    const signOut = handler.indexOf("await signOutUser()");
    assert.ok(flush > 0, "the pending write must be flushed");
    assert.ok(flush < signOut, "flush before the token is revoked, not after");
  });

  it("cannot be fired twice", () => {
    assert.match(code(chip), /disabled=\{signingOut\}/);
    assert.match(code(chip), /if \(signingOut\) return;/);
  });

  it("does not navigate from the session module", () => {
    // use-session is imported by the headless preference engine, which must
    // never be able to redirect anyone.
    const session = read("../lib/use-session.ts");
    assert.doesNotMatch(code(session), /location\.(assign|replace|href)/);
  });
});

describe("an abandoned account cannot keep writing", () => {
  const prefs = read("../lib/user-prefs.ts");

  it("stamps each pull with the session generation", () => {
    assert.match(code(prefs), /let generation = 0;/);
    assert.match(code(prefs), /const startedAt = generation;/);
  });

  it("drops a pull that outlived its session", () => {
    // Without this the in-flight round-trip still applies the departed
    // account's theme, detail level and last-open tab, and stamps their id as
    // the last user — all after the UI says you are signed out.
    assert.match(code(prefs), /if \(startedAt !== generation\) return;/);
    const guard = code(prefs).indexOf("startedAt !== generation");
    const apply = code(prefs).indexOf("applyRemoteValue(key, value)");
    const stamp = code(prefs).indexOf("setItem(PREF_LAST_USER_KEY");
    assert.ok(guard < apply, "the guard must precede applying remote values");
    assert.ok(guard < stamp, "the guard must precede stamping the last user");
  });

  it("bumps the generation on every session change", () => {
    const onSession = code(prefs).slice(code(prefs).indexOf("function onSession"));
    assert.match(onSession.slice(0, 400), /generation \+= 1;/);
  });

  it("clears the dirty flag on sign-out", () => {
    // A stale flag would make the next sign-in believe it had a failed write
    // to retry, for an account that is no longer here.
    const signedOut = code(prefs).slice(code(prefs).indexOf("if (!next) {"));
    assert.match(signedOut.slice(0, 400), /dirty = false;/);
  });

  it("still keeps local values and the last-user marker", () => {
    // Signing out is leaving an account, not asking the browser to forget the
    // theme; and the marker is what lets the NEXT account's remote win.
    const signedOut = code(prefs).slice(code(prefs).indexOf("if (!next) {"));
    assert.doesNotMatch(signedOut.slice(0, 400), /removeItem|clear\(\)/);
  });
});

describe("the session probe cannot hang the header", () => {
  it("bounds the first read with a timeout", () => {
    // getSession() carries no timeout of its own. Blocked storage or a hung
    // network leaves the promise pending forever — and because the page still
    // renders and returns 200, every automated check stays green while the
    // header shimmers for the life of the tab.
    assert.match(code(session), /SESSION_PROBE_TIMEOUT_MS/);
    assert.match(code(session), /setTimeout\(\(\) => settle\(SIGNED_OUT\)/);
  });

  it("resolves the probe exactly once", () => {
    assert.match(code(session), /if \(settled\) return;/);
    assert.match(code(session), /clearTimeout\(timer\)/);
  });

  it("lets a real auth event override a timed-out probe", () => {
    // A slow answer that eventually arrives should still be believed, rather
    // than being locked out by the fallback.
    const onChange = code(session).slice(code(session).indexOf("onAuthStateChange"));
    assert.match(onChange.slice(0, 320), /settled = true;/);
    assert.match(onChange.slice(0, 320), /publish\(fromSession\(session\)\)/);
  });

  it("falls back to signed-out, not to a fifth state", () => {
    // Signed-out grants nothing and offers an action, which is the safe
    // reading of "we could not determine the session".
    assert.match(code(session), /settle\(SIGNED_OUT\)/);
    assert.doesNotMatch(code(session), /"unavailable"|"error"|"timeout"/);
  });
});

describe("useAuth is the shape callers want, without context", () => {
  it("exposes user, isAuthenticated and sessionStatus", () => {
    assert.match(code(session), /export function useAuth\(\): AuthState/);
    assert.match(code(session), /isAuthenticated: info\.status === "signed-in"/);
    assert.match(code(session), /sessionStatus: info\.status/);
  });

  it("derives from the shared store rather than a provider", () => {
    // React context re-renders every consumer on every change, which is the
    // opposite of what reading a session should cost.
    assert.match(code(session), /const info = useSession\(\);/);
    assert.doesNotMatch(code(session), /createContext|useContext|Provider/);
  });

  it("memoises so a re-render does not churn the object identity", () => {
    assert.match(code(session), /useMemo\(/);
  });
});

describe("the header does not guess while the probe is out", () => {
  const chip = read("../components/header/AccountChip.tsx");

  it("renders a skeleton for loading, not a Sign in link", () => {
    // The bug: every page load flashed a signed-out control at someone who was
    // signed in, which is what made sign-out feel unreliable even when it
    // worked.
    assert.match(code(chip), /session\.status === "loading"/);
    const loading = code(chip).slice(code(chip).indexOf('session.status === "loading"'));
    const nextBranch = loading.indexOf('session.status === "signed-out"');
    assert.match(loading.slice(0, nextBranch), /className="skeleton/);
    assert.doesNotMatch(loading.slice(0, nextBranch), /href="\/login"/);
  });

  it("reuses the house skeleton rather than inventing a class", () => {
    // .skeleton is already shimmer-animated, already clamped by the single
    // reduced-motion block, and already referenced — a new class would cost a
    // dead-CSS slot for nothing.
    assert.match(code(chip), /skeleton block/);
    assert.doesNotMatch(code(chip), /account-skeleton|chip-skeleton/);
  });

  it("occupies the same box as the control it replaces", () => {
    // Otherwise the header reflows when the answer lands, which is the CLS
    // this branch exists to prevent.
    const loading = code(chip).slice(code(chip).indexOf('session.status === "loading"'));
    assert.match(loading.slice(0, 700), /gap-1\.5 rounded-\[9px\] border border-transparent px-2 py-1\.5/);
  });

  it("keeps the unconfigured guard byte-identical", () => {
    assert.match(code(chip), /if \(session\.status === "unconfigured"\) return null;/);
  });
});

describe("the account menu", () => {
  const chip = read("../components/header/AccountChip.tsx");
  const header = read("../components/WorkspaceHeader.tsx");
  const panel = read("../components/header/QuickSettings.tsx");

  it("shows a monogram, not an image that may not exist", () => {
    // Provider avatars and uploads arrive with the profile page that can
    // manage them. Until then there is no URL, and a broken-image glyph would
    // be worse than initials.
    assert.match(code(chip), /initialsFrom\(null, session\.email\)/);
    assert.doesNotMatch(code(chip), /<img|avatar_url/);
  });

  it("derives sane initials", () => {
    assert.equal(initialsFrom(null, "ian.wangsa@example.com"), "IW");
    assert.equal(initialsFrom(null, "desk@example.com"), "D");
    assert.equal(initialsFrom("Ian Wangsa", "x@y.com"), "IW");
    assert.equal(initialsFrom(null, null), "?");
    // Never three characters: the circle is 22px.
    assert.ok(initialsFrom("a b c d", null).length <= 2);
  });

  it("states the session with a dot AND a word", () => {
    // Colour alone carries nothing for a reader who cannot see it, and the
    // house rule forbids it — which is also why this cannot be added to the
    // forced-colors allow-list.
    assert.match(code(chip), /Session active/);
    const dot = code(chip).slice(code(chip).indexOf("Session active") - 400);
    assert.match(dot.slice(0, 400), /aria-hidden/);
  });

  it("uses the token ladder for motion, in the shorthand that compiles", () => {
    // `duration-[--dur-fast]` emits `transition-duration: --dur-fast`, which is
    // invalid CSS — the transition silently does nothing while every test and
    // the build stay green. The `(--var)` shorthand is the one that works.
    assert.match(code(chip), /duration-\(--dur-fast\) ease-\(--ease\)/);
    assert.doesNotMatch(code(chip), /duration-\[--|ease-\[--/);
  });

  it("links to /profile, and only because the route now exists", () => {
    // This assertion was the inverse until the route landed: a menu item that
    // 404s for four commits is the same lie as an unconfigured provider
    // button. Kept as a pair rather than deleted, so the link and the page it
    // points at cannot be separated again — removing the route without
    // removing the item fails here.
    assert.match(code(chip), /href="\/profile"/);
    assert.ok(
      existsSync(fileURLToPath(new URL("../app/profile/page.tsx", import.meta.url))),
      "the account menu points at /profile but the route is gone",
    );
  });

  it("opens the settings panel without taking over its state", () => {
    // QuickSettings keeps owning `open`, so its dismissal logic and its
    // aria-expanded binding are untouched; a counter lets the same request be
    // made twice in a row, which a boolean could not.
    assert.match(code(chip), /onOpenPreferences\(\)/);
    // The handler is a `useCallback` now rather than an arrow written at the
    // call site — the header memoises its props so a keystroke in one control
    // cannot re-render the whole chrome. Both halves are pinned, because a
    // named handler can drift from the prop it is passed to in a way an inline
    // arrow could not: the counter bump, and the wiring that delivers it.
    assert.match(code(header), /const openPreferences = useCallback\(\(\) => setSettingsSignal\(\(n\) => n \+ 1\), \[\]\)/);
    assert.match(code(header), /onOpenPreferences=\{openPreferences\}/);
    assert.match(code(header), /openSignal=\{settingsSignal\}/);
    assert.match(code(panel), /if \(openSignal > 0\)/);
    assert.match(code(panel), /setOpen\(true\)/);
    assert.match(code(panel), /aria-expanded=\{open\}/);
  });

  it("offers the way back, and only from the door it was opened by", () => {
    /**
     * Preferences closes the account menu on its way to Quick settings, so
     * without a return path the only way back is to dismiss the panel and press
     * the avatar again — two panels that cannot reach each other, which is how
     * a two-page menu read as two dead ends.
     *
     * The condition is the part worth pinning. Quick settings has two doors —
     * the header gear and Preferences — and a "back to Account" shown to
     * someone who pressed the gear points at somewhere they have never been.
     * So the control is gated on the opening having come from the account menu,
     * and the gear resets that flag rather than leaving it set from last time.
     */
    assert.match(code(panel), /fromAccount && onBackToAccount/);
    assert.match(code(panel), /setFromAccount\(true\)/, "the account door must set the flag");
    assert.match(code(panel), /setFromAccount\(false\)/, "the gear must clear it");
    assert.match(code(panel), /onBackToAccount\(\)/);

    // Counters both ways, for the same reason the first one is a counter:
    // Preferences -> back -> Preferences -> back must work on every lap.
    // Memoised like its opposite number, and pinned the same way.
    assert.match(code(header), /const backToAccount = useCallback\(\(\) => setAccountSignal\(\(n\) => n \+ 1\), \[\]\)/);
    assert.match(code(header), /onBackToAccount=\{backToAccount\}/);
    assert.match(code(header), /openSignal=\{accountSignal\}/);
    assert.match(code(chip), /if \(openSignal > 0\) setOpen\(true\)/);
  });

  it("gives panel links a real touch target without a second coarse block", () => {
    const css = read("../app/globals.css");
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    assert.match(coarse.slice(0, 900), /#account-panel a/);
    // Addressed by id, so no class is declared and the dead-CSS ratchet does
    // not move.
    assert.equal((css.match(/@media \(pointer: coarse\)/g) ?? []).length, 1);
  });
});

describe("the header cannot clip its own controls", () => {
  const css = read("../app/globals.css");
  const chip = read("../components/header/AccountChip.tsx");

  it("shows a monogram, not the whole address, in the busiest row", () => {
    // The address was up to 132px of the most crowded row in the app, and it
    // is already the panel's heading. Carrying it twice cost the Settings gear
    // its place on screen at 1280px and 1440px.
    assert.doesNotMatch(code(chip), /truncate max-\[900px\]:hidden/);
    assert.match(code(chip), /aria-label=\{`Account menu for \$\{label\}`\}/);
  });

  it("wraps only in the band that cannot fit one row", () => {
    // Unconditional wrap costs 24px of height at 1440px for nothing: the
    // spacer's flex:1 makes the line overfull and wraps early. The band's top
    // is 1060px — measured as a guest with every rung of the header's priority
    // ladder applied (header-ladder.test.ts), the last width at which even the
    // icon-only row fits; it was 1024 when the ladder did not exist.
    assert.match(css, /@media \(max-width: 1110px\) \{\s*\.workspace-header__utility \{\s*flex-wrap: wrap;/);
  });

  it("does not shrink the tab strip to buy the room", () => {
    // Tried and rejected: min-width:0 on a flex:1 strip collapsed the eight
    // primary labels to a few pixels each.
    assert.doesNotMatch(css, /\.workspace-tabs \{\s*min-width: 0;/);
  });

  it("introduces no 768px breakpoint", () => {
    const widths = new Set([...css.matchAll(/@media \([^)]*?(\d+)px\)/g)].map((m) => Number(m[1])));
    assert.equal(widths.has(768), false, "768px is not one of this stylesheet's widths");
  });
});
