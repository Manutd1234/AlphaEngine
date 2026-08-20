/**
 * The security centre, and the claims it is not allowed to make.
 *
 * Almost everything that can go wrong on this page goes wrong *quietly*. A
 * display name saved under a key providers also write looks saved and is gone
 * tomorrow. A one-row session list captioned "1 active session" asserts that
 * there are no others, on no evidence. A password meter that rewards length
 * alone gives "aaaaaaaaaaaaaaaa" a full bar. An Unlink button offered at one
 * identity is a control whose only outcome is a failure message. None of those
 * throw, none of them log, and none of them look wrong in a screenshot.
 *
 * The storage and RPC guards are asserted in `account-schema.test.ts` against
 * the migrations themselves; these cover the reasoning in front of them.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AVATAR_BUCKET,
  DISPLAY_NAME_KEY,
  LINKABLE_PROVIDERS,
  MIN_PASSWORD_LENGTH,
  PROVIDER_WRITTEN_KEYS,
  assessPassword,
  avatarPath,
  canUnlink,
  describeDevice,
  describeSessionSource,
  formatIp,
  isNotConfigured,
  needsReauthentication,
  providerLabel,
} from "../lib/profile";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
/**
 * The security centre is five files.
 *
 * `ProfileScreen` kept the client boundary, the session, the two lists the page
 * head counts and the one banner every panel reports through; the four cards
 * each took the state only they read. Every assertion below reads the file its
 * subject actually lives in — pointed at the screen alone, half of them would
 * have gone green scanning a file that no longer contains what they guard.
 *
 * The assertions that FORBID something read `centre`, the whole surface. A
 * "never `getPublicUrl`" or "never `next/image`" scoped to the screen would be
 * satisfied by a card doing exactly that.
 */
const screen = read("../components/profile/ProfileScreen.tsx");
const cards = {
  identity: read("../components/profile/ProfileIdentityCard.tsx"),
  connections: read("../components/profile/ProfileConnectionsCard.tsx"),
  sessions: read("../components/profile/ProfileSessionsCard.tsx"),
  password: read("../components/profile/ProfilePasswordCard.tsx"),
};
const centre = [screen, ...Object.values(cards)].join("\n");
const route = read("../app/profile/page.tsx");

describe("the display name survives the next OAuth sign-in", () => {
  it("is stored under a key no provider writes", () => {
    // GoTrue merges the provider's claims into user_metadata on *every* OAuth
    // sign-in. A name kept under `name` or `full_name` saves correctly, shows
    // correctly, and is silently reverted the next time you use Google.
    assert.ok(!PROVIDER_WRITTEN_KEYS.includes(DISPLAY_NAME_KEY));
    assert.equal(DISPLAY_NAME_KEY, "workspace_display_name");
  });

  it("writes it through updateUser's data bag, not a preference key", () => {
    assert.match(code(cards.identity), /updateUser\(\{\s*data: \{ \[DISPLAY_NAME_KEY\]/);
    // SYNCED_PREF_KEYS is pinned at five in tests/user-prefs.test.ts, and a
    // display name is account state rather than a viewing preference anyway.
    assert.doesNotMatch(code(centre), /SYNCED_PREF_KEYS/);
  });
});

describe("a session list only claims what it can show", () => {
  it("refuses to read a JWT fallback as an empty world", () => {
    const jwt = describeSessionSource("jwt", 1);
    assert.match(jwt, /neither\s+shown nor ruled out/);
    // The exact wording that must never appear for this case.
    assert.doesNotMatch(jwt, /1 active session|One active session/);
  });

  it("labels a genuine single session as the fact it is", () => {
    assert.match(describeSessionSource("sessions", 1), /One active session/);
  });

  it("counts plainly above one", () => {
    assert.match(describeSessionSource("sessions", 3), /^3 active sessions/);
  });

  it("treats zero rows as a failed read, not an empty list", () => {
    // Unreachable while signed in — the caller holds at least its own session
    // — so "no sessions" would be reporting an impossible fact.
    assert.match(describeSessionSource("sessions", 0), /failed read/);
  });

  it("revokes others directly, never through the shared sign-out", () => {
    // signOutUser() defaults to scope 'global' and would end this session too,
    // after which the password form on the same page 401s.
    assert.match(code(cards.sessions), /signOut\(\{ scope: "others" \}\)/);
    assert.doesNotMatch(code(centre), /signOutUser/);
  });

  it("does not claim other devices stop immediately", () => {
    // Access JWTs cannot be revoked; other devices keep working until theirs
    // expires. "Signed out everywhere" would be the overstatement.
    assert.match(code(cards.sessions), /within the hour/);
    // Comments stripped: the component states the rule by quoting the phrase it
    // forbids, so a raw scan reports the doctrine as the violation.
    assert.doesNotMatch(code(centre), /signed out everywhere/i);
  });
});

describe("the password meter cannot flatter a weak password", () => {
  it("gives a repeated character nothing, however long", () => {
    assert.equal(assessPassword("a".repeat(24)).score, 0);
    assert.equal(assessPassword("a".repeat(24)).label, "Too weak");
  });

  it("caps a digits-only string and a common word", () => {
    assert.ok(assessPassword("1234567890123456").score <= 1);
    assert.ok(assessPassword("Password123!extra").score <= 1);
    assert.ok(assessPassword("alphaengine2026!").score <= 1);
  });

  it("scores nothing below the minimum it will submit", () => {
    assert.equal(assessPassword("Ab3$xyz").score, 0);
    assert.equal(MIN_PASSWORD_LENGTH, 8);
  });

  it("rewards length and variety together", () => {
    assert.ok(assessPassword("Tr0ubad0ur&Horse").score >= 3);
    assert.ok(assessPassword("kX7#mq").score < assessPassword("kX7#mqPl9$vroom").score);
  });

  it("never promises more than a heuristic can know", () => {
    const strong = assessPassword("Tr0ubad0ur&Horse");
    assert.match(strong.hint, /rough check|breach/i);
    for (const value of ["", "aaaa", "Tr0ubad0ur&Horse"]) {
      assert.doesNotMatch(assessPassword(value).hint, /\bsecure\b|\bsafe\b/i);
    }
  });

  it("stays inside its own scale", () => {
    for (const value of ["", "a", "aB3$", "x".repeat(200), "Tr0ubad0ur&HorseBattery"]) {
      const { score, label } = assessPassword(value);
      assert.ok(score >= 0 && score <= 4, value);
      assert.ok(label.length > 0);
    }
  });

  it("advises rather than enforces, and only length gates the button", () => {
    // A 16-character run of one letter scores 0 and is still submittable. That
    // is deliberate: this is a hand-rolled guess that says so on screen, and a
    // guess that blocks is a guess pretending to be a policy. The project's own
    // password rules are the gate; MIN_PASSWORD_LENGTH is the only local one.
    assert.equal(assessPassword("a".repeat(16)).score, 0);
    assert.match(code(cards.password), /disabled=\{changingPassword \|\| password\.length < MIN_PASSWORD_LENGTH\}/);

    // Scoped to the submit path. The bar's *colour* reads the score, which is
    // presentation; what must never happen is the score gating the action.
    const source = code(cards.password);
    const handler = source.slice(source.indexOf("const onChangePassword"));
    const body = handler.slice(0, handler.indexOf("}, [password, onBanner]);"));
    assert.ok(body.length > 0, "the password handler moved — this assertion is now vacuous");
    assert.doesNotMatch(body, /strength/);
  });

  it("counts sign-in methods without a plural mismatch", () => {
    assert.match(code(screen), /sign-in method\$\{identityCount === 1 \? "" : "s"\}/);
  });

  it("carries a word beside the bar, never colour alone", () => {
    assert.match(code(cards.password), /\{strength\.label\}/);
    // The fill is a --status-* step, which is legal as a fill and 3.0-3.8:1 —
    // below AA for text, which is why the word is the carrier.
    assert.match(code(cards.password), /background:[\s\S]{0,160}var\(--status-good\)/);
    assert.doesNotMatch(code(centre), /color:\s*"?var\(--status-/);
  });
});

describe("unlink is offered only when it can succeed", () => {
  it("needs a second identity", () => {
    assert.equal(canUnlink(0), false);
    assert.equal(canUnlink(1), false);
    assert.equal(canUnlink(2), true);
  });

  it("says why it is disabled rather than just dimming", () => {
    assert.match(code(cards.connections), /aria-describedby=\{canUnlink\(identityCount\)/);
    assert.match(cards.connections, /needs a second method/i);
  });

  it("calls Microsoft by the id GoTrue knows", () => {
    assert.equal(LINKABLE_PROVIDERS.find((p) => p.label === "Microsoft")?.id, "azure");
    assert.equal(providerLabel("azure"), "Microsoft");
    assert.equal(providerLabel("email"), "Email and password");
  });

  it("passes an explicit redirect rather than letting GoTrue choose", () => {
    // An origin that is not allow-listed is silently rewritten to the Site URL,
    // so a link started from an alias would land somewhere else entirely.
    assert.match(code(cards.connections), /linkIdentity\(\{[\s\S]{0,120}options: \{ redirectTo \}/);
    assert.match(code(cards.connections), /\$\{window\.location\.origin\}\/profile/);
  });
});

describe("the avatar is private, and addressed by owner", () => {
  it("keys the path on the user id, which is what every policy compares", () => {
    assert.equal(avatarPath("abc-123"), "abc-123/avatar");
    assert.equal(AVATAR_BUCKET, "avatars");
  });

  it("hardcodes the bucket rather than adding a public env var", () => {
    // A NEXT_PUBLIC_* addition fails deployment-contract.test.ts.
    assert.doesNotMatch(code(centre), /NEXT_PUBLIC_/);
    assert.doesNotMatch(code(read("../lib/profile.ts")), /NEXT_PUBLIC_/);
  });

  it("reads through a signed URL, never a public one", () => {
    assert.match(code(cards.identity), /createSignedUrl\(/);
    assert.doesNotMatch(code(centre), /getPublicUrl/);
  });

  it("uses a plain img with an initials fallback", () => {
    // next.config.mjs declares no images.remotePatterns, so next/image would
    // refuse this host at runtime — green build, broken page.
    assert.match(code(cards.identity), /<img/);
    assert.doesNotMatch(code(centre), /from "next\/image"/);
    assert.match(code(cards.identity), /onError=\{\(\) => setAvatarUrl\(null\)\}/);
  });
});

describe("every panel is allowed to be absent", () => {
  it("classifies a missing function, table or bucket as not-configured", () => {
    assert.ok(isNotConfigured({ message: "Could not find the function public.list_my_sessions" }));
    assert.ok(isNotConfigured({ message: "Bucket not found" }));
    assert.ok(isNotConfigured({ code: "42883", message: "" }));
    assert.ok(isNotConfigured({ message: 'relation "auth.sessions" does not exist' }));
    // A real failure must not be dressed up as a missing feature.
    assert.ok(!isNotConfigured({ message: "network error" }));
    assert.ok(!isNotConfigured(null));
  });

  it("renders that state instead of throwing", () => {
    // One per panel, asserted on the panel that owns it: the avatar bucket, the
    // sessions RPC and the identity-linking API fail independently, and a scan
    // that only proved the three sentences exist somewhere would not notice one
    // panel having lost its own.
    const absences: Array<[string, RegExp, string]> = [
      ["ProfileIdentityCard", /not set up on this project/, cards.identity],
      ["ProfileSessionsCard", /not installed on this project/, cards.sessions],
      ["ProfileConnectionsCard", /not available on this project/, cards.connections],
    ];
    for (const [name, marker, source] of absences) {
      assert.match(source, marker, `${name} lost its not-configured state`);
    }
  });

  it("names reauthentication as a step rather than printing the raw error", () => {
    assert.ok(needsReauthentication({ message: "Reauthentication is needed" }));
    assert.ok(needsReauthentication({ message: "invalid nonce" }));
    assert.ok(!needsReauthentication({ message: "invalid login credentials" }));
    assert.match(cards.password, /too old to change a password with/);
  });

  it("orders the password change before the revoke, and says so", () => {
    assert.match(cards.password, /Change the password first/);
  });
});

describe("the route is a sibling to /login, not a ninth tab", () => {
  it("is its own app route with its own metadata", () => {
    assert.match(route, /export const metadata: Metadata/);
    assert.match(route, /robots: \{ index: false, follow: false \}/);
  });

  it("keeps the interactive half a client component", () => {
    assert.match(screen.slice(0, 40), /^"use client";/);
    // A server component could not read a localStorage session anyway, and
    // would force dynamic rendering.
    assert.doesNotMatch(route, /"use client"/);
  });

  it("does not join the workspace nav", () => {
    const header = read("../components/WorkspaceHeader.tsx");
    assert.doesNotMatch(header, /"profile"/);
  });

  it("is reachable from the account menu", () => {
    const chip = read("../components/header/AccountChip.tsx");
    assert.match(code(chip), /href="\/profile"/);
  });

  it("offers a way back to the desk from every state", () => {
    // Including the signed-out and unconfigured bail-outs, which is why the
    // link lives in the shared shell rather than in the signed-in branch.
    assert.match(code(screen), /function Shell\(/);
    assert.match(code(screen), /Back to the workspace/);
  });
});

describe("a device line reports rather than identifies", () => {
  it("reads the common agents", () => {
    assert.equal(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/151.0 Safari/537.36"), "Chrome on macOS");
    assert.equal(describeDevice("Mozilla/5.0 (Windows NT 10.0) Firefox/130.0"), "Firefox on Windows");
    assert.equal(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/604.1"), "Safari on iOS");
    assert.equal(describeDevice("Mozilla/5.0 (Windows NT 10.0) Chrome/151.0 Safari/537.36 Edg/151.0"), "Edge on Windows");
  });

  it("does not mistake headless Chrome for Safari", () => {
    // \bChrome\/ finds no word boundary in "HeadlessChrome", so the string used
    // to fall through to the Safari token that every agent carries.
    assert.equal(
      describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) HeadlessChrome/151.0.0.0 Safari/537.36"),
      "Headless Chrome on macOS",
    );
  });

  it("says so when it cannot tell", () => {
    assert.equal(describeDevice(null), "Unreported device");
    assert.equal(describeDevice(""), "Unreported device");
    assert.equal(describeDevice("curl/8.4.0"), "Unrecognised browser");
  });

  it("keeps the raw agent available rather than replacing it", () => {
    assert.match(code(cards.sessions), /title=\{row\.user_agent \?\? undefined\}/);
  });
});

describe("the address is shown without a mask it does not have", () => {
  it("strips only the full-width host masks", () => {
    // auth.sessions.ip is inet, and live rows come back as 115.66.103.192/32.
    assert.equal(formatIp("115.66.103.192/32"), "115.66.103.192");
    assert.equal(formatIp("2001:db8::1/128"), "2001:db8::1");
    // A genuine range is information, not noise.
    assert.equal(formatIp("10.0.0.0/24"), "10.0.0.0/24");
    assert.equal(formatIp(null), null);
  });
});
