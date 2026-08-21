/**
 * The provider buttons: only the ones that can actually complete, and what
 * "completed" means.
 *
 * A provider button that cannot finish is the worst control on the page.
 * `signInWithOAuth` is a full-page redirect, so nothing in the app can catch
 * the failure — the visitor simply leaves for a Supabase URL reading
 * "Unsupported provider: provider is not enabled" and has to find their own way
 * back. That is why the offered list is filtered by a probe of the project's
 * own settings, and why a probe that has not answered yet renders nothing
 * rather than everything.
 *
 * The return leg is the same argument. A provider sign-in is finished when the
 * provider says so — no second verification step was ever added — but the
 * landing place has to be the callback that establishes the session, not the
 * desk behind the routing guard.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { card, code, screen, session, submitSource } from "./helpers/auth-sources";
import { readSource } from "./helpers/source-files";

describe("the page offers only providers that can actually complete", () => {
  const client = readSource("lib/auth-client.ts");

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
    assert.match(code(card), /\{offeredProviders\.map\(/);
    // Neither half of the split may reach for the unfiltered list.
    assert.doesNotMatch(code(screen) + code(card), /\{PROVIDERS\.map\(/);
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
    assert.doesNotMatch(code(screen) + code(submitSource), /redirectTo: `\$\{window\.location\.origin\}\/`/);
  });

  it("keeps no verification state anywhere", () => {
    const sources = [screen, card, submitSource, session, readSource("components/header/AccountChip.tsx"), readSource("lib/auth-flow.ts")];
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
