/**
 * The pure half of the login: what the URL says, and what an error means.
 *
 * `lib/auth-flow.ts` is the only part of this feature that can be tested
 * directly rather than structurally, and all three of its jobs are ones a user
 * meets at their worst moment.
 *
 * A recovery link that loses its `step` param must still open the reset form,
 * because email templates are edited by hand in a dashboard and a visitor
 * holding a recovery token should never be dropped into a sign-in box. A
 * transport failure must not read as a bad password, or the visitor retypes a
 * correct one until they give up. And an unconfigured provider must read as
 * unconfigured — a fact about this deployment, not about them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeAuthError, looksLikeEmail, resolveLoginStep } from "../lib/auth-flow";

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
