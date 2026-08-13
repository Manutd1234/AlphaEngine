/**
 * The connect token, and the route that mints it.
 *
 * This token is the only thing standing between a stranger and a claim to be
 * somebody else's desk identity, so what is pinned here is every reason it must
 * be refused — plus the exact bytes, because the verifier lives in another
 * language in another process.
 *
 * ── The cross-language vector ───────────────────────────────────────────────
 * `modules/telegram.py` decodes what this file encodes. Nothing in either build
 * would notice a one-byte layout change until a real person tapped Connect and
 * the bot answered "not in the format this desk issues". So both suites assert
 * the SAME known-answer vector: same secret, same identity, same clock, same
 * nonce, same 51 characters out. Change one side and the other side's test goes
 * red on the next run.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NextRequest } from "next/server";

import { DESK_COOKIE, guestValue } from "../lib/desk-cookie";
import {
  LINK_PROBE_TTL_S,
  LINK_SECRET_ENV,
  deepLink,
  isBotHandle,
  linkProbeSecret,
  linkSecret,
  mintLinkProbe,
  mintLinkToken,
  parseDeskPass,
  verifyLinkToken,
} from "../lib/telegram-link";

/** Shared with `tests/test_telegram_link.py`. Do not adjust one without the other. */
const VECTOR = {
  secret: "x".repeat(40),
  kind: "guest" as const,
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  now: 1_800_000_000,
  ttlS: 900,
  nonce: Buffer.from([1, 2, 3, 4]),
  token: "AQJrSdWEAQIDBD8lBOBPiRHTmgwDBegsMwFgI2xPwQd27wYqtOA",
};

/**
 * The status probe's own vector, also shared with the Python suite. Same
 * layout, same identity, same clock — a different key, so the bytes differ in
 * the MAC and nowhere else.
 */
const PROBE_VECTOR = {
  key: "4c4e93d04e9784d3f70f30f64db5ad02ca0d8df6d816a6f8c6aaf6b423b32470",
  ttlS: 120,
  token: "AQJrSdJ4AQIDBD8lBOBPiRHTmgwDBegsMwGXMR4wmQHfKCNOfrQ",
};

const SECRET = "a-shared-link-secret-of-more-than-32-chars";

describe("the token format is the one the gateway decodes", () => {
  it("produces the vector the Python suite pins", () => {
    const { token, expiresAt } = mintLinkToken(
      { kind: VECTOR.kind, id: VECTOR.id },
      VECTOR.secret,
      { now: VECTOR.now, ttlS: VECTOR.ttlS, nonce: VECTOR.nonce },
    );
    assert.equal(token, VECTOR.token);
    assert.equal(expiresAt, VECTOR.now + VECTOR.ttlS);
  });

  it("fits inside Telegram's start payload", () => {
    // 64 characters from [A-Za-z0-9_-]. A UUID in text is 36 of them on its
    // own, which is why the payload is packed binary rather than JSON.
    const { token } = mintLinkToken({ kind: "account", id: VECTOR.id }, SECRET);
    assert.ok(token.length <= 64, `${token.length} characters`);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  it("round-trips both kinds", () => {
    for (const kind of ["account", "guest"] as const) {
      const { token } = mintLinkToken({ kind, id: VECTOR.id }, SECRET);
      assert.deepEqual(verifyLinkToken(token, SECRET), {
        kind,
        id: VECTOR.id,
        expiresAt: verifyLinkToken(token, SECRET)?.expiresAt,
      });
    }
  });
});

describe("a token that was not issued here is refused", () => {
  it("refuses another deployment's secret", () => {
    const { token } = mintLinkToken({ kind: "guest", id: VECTOR.id }, SECRET);
    assert.equal(verifyLinkToken(token, `${SECRET}-different`), null);
  });

  it("refuses a tampered identity", () => {
    // The whole attack in one assertion: swap the UUID for someone else's and
    // keep the signature. The MAC covers the identity, so it cannot survive.
    const { token } = mintLinkToken({ kind: "guest", id: VECTOR.id }, SECRET);
    const raw = Buffer.from(token, "base64url");
    raw[25] ^= 0xff;
    assert.equal(verifyLinkToken(raw.toString("base64url"), SECRET), null);
  });

  it("refuses a token whose kind was flipped from guest to account", () => {
    const { token } = mintLinkToken({ kind: "guest", id: VECTOR.id }, SECRET);
    const raw = Buffer.from(token, "base64url");
    raw[1] = 1;
    assert.equal(verifyLinkToken(raw.toString("base64url"), SECRET), null);
  });

  it("refuses an expired token", () => {
    const { token, expiresAt } = mintLinkToken({ kind: "guest", id: VECTOR.id }, SECRET);
    assert.ok(verifyLinkToken(token, SECRET, expiresAt));
    assert.equal(verifyLinkToken(token, SECRET, expiresAt + 1), null);
  });

  it("refuses anything that is not the format", () => {
    for (const rubbish of ["", "auth", "not base64!", "AQ", "z".repeat(80)]) {
      assert.equal(verifyLinkToken(rubbish, SECRET), null, rubbish);
    }
  });
});

describe("the secret and the handle are validated, not trusted", () => {
  it("treats a short secret as no secret", () => {
    // The verifier is a pure function anyone may call as often as they like, so
    // a short key is guessable offline. Unconfigured is a feature that is
    // absent, never one that quietly accepts unsigned tokens.
    const envWith = (value: string | undefined): NodeJS.ProcessEnv => {
      const env = { ...process.env };
      if (value === undefined) delete env[LINK_SECRET_ENV];
      else env[LINK_SECRET_ENV] = value;
      return env;
    };
    assert.equal(linkSecret(envWith("too-short")), null);
    assert.equal(linkSecret(envWith(undefined)), null);
    assert.equal(linkSecret(envWith(SECRET)), SECRET);
  });

  it("refuses to build a link from a handle that is not one", () => {
    // The handle arrives from the gateway, over the network, and goes straight
    // into a URL handed to a user.
    assert.equal(isBotHandle("alpha_engine_nussif_bot"), true);
    for (const bad of ["", "no", "has space", "has/slash", "a".repeat(40)]) {
      assert.equal(isBotHandle(bad), false, bad);
    }
    assert.throws(() => deepLink("has/slash", "token"), /handle/);
    assert.equal(
      deepLink("alpha_engine_nussif_bot", VECTOR.token),
      `https://t.me/alpha_engine_nussif_bot?start=${VECTOR.token}`,
    );
  });
});

describe("the status probe is a different token family, not a second use of the same one", () => {
  it("derives the key the Python verifier derives", () => {
    // Domain separation, pinned on both sides: the probe key is
    // HMAC(secret, "alphaengine/telegram-link-probe/v1"). Get this wrong and
    // every chip reads "could not tell" while Connect keeps working, which is
    // the least debuggable possible failure.
    assert.equal(linkProbeSecret(VECTOR.secret), PROBE_VECTOR.key);
    assert.equal(
      mintLinkProbe({ kind: VECTOR.kind, id: VECTOR.id }, VECTOR.secret, {
        now: VECTOR.now,
        nonce: VECTOR.nonce,
      }).token,
      PROBE_VECTOR.token,
    );
  });

  it("cannot be redeemed as a connect code", () => {
    /**
     * The property the whole design rests on. A probe rides on every header
     * load and can land in a proxy log; a connect code BINDS a chat. If one
     * verified as the other, reading a probe in flight would be enough to bind
     * your own Telegram account to somebody else's desk pass.
     */
    const { token } = mintLinkProbe({ kind: "guest", id: VECTOR.id }, SECRET);
    assert.equal(verifyLinkToken(token, SECRET), null);
  });

  it("cannot be satisfied by a connect code either", () => {
    const { token } = mintLinkToken({ kind: "guest", id: VECTOR.id }, SECRET);
    assert.equal(verifyLinkToken(token, linkProbeSecret(SECRET)), null);
  });

  it("expires in one round trip, not one quarter of an hour", () => {
    // It is minted server-side and spent in the same request. The window only
    // has to cover clock skew between two hosts.
    assert.equal(LINK_PROBE_TTL_S, PROBE_VECTOR.ttlS);
    const { expiresAt } = mintLinkProbe({ kind: "guest", id: VECTOR.id }, SECRET, { now: 1_000 });
    assert.equal(expiresAt, 1_000 + LINK_PROBE_TTL_S);
  });

  it("carries the identity inside the signature, so there is nothing to point elsewhere", () => {
    const { token } = mintLinkProbe({ kind: "guest", id: VECTOR.id }, SECRET);
    const raw = Buffer.from(token, "base64url");
    raw[25] ^= 0xff;
    assert.equal(verifyLinkToken(raw.toString("base64url"), linkProbeSecret(SECRET)), null);
  });
});

describe("the desk pass is read for what it is", () => {
  it("tells a guest pass from an account pass", () => {
    assert.deepEqual(parseDeskPass(guestValue(VECTOR.id)), { kind: "guest", id: VECTOR.id });
    assert.deepEqual(parseDeskPass(VECTOR.id), { kind: "account", id: VECTOR.id });
  });

  it("refuses a pass that is not a UUID", () => {
    // The token carries sixteen raw bytes and has nowhere to put a free-form
    // string, so anything else is not a desk pass and must not be guessed at.
    for (const bad of [undefined, "", "guest:", "guest:nope", "an-operator", "../../etc"]) {
      assert.equal(parseDeskPass(bad), null, String(bad));
    }
  });
});

describe("the route proves an account rather than reading it off the cookie", () => {
  const saved = { ...process.env };
  const restore = () => {
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", LINK_SECRET_ENV,
      "TELEGRAM_BOT_USERNAME", "ALPHAENGINE_GATEWAY_URL"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };

  const get = (cookie?: string, authorization?: string) =>
    new NextRequest(new URL("/api/telegram/link", "https://alphaengine.example"), {
      headers: {
        ...(cookie ? { cookie: `${DESK_COOKIE}=${cookie}` } : {}),
        ...(authorization ? { authorization } : {}),
      },
    });

  it("mints for a guest pass and says the link is the gateway's alone", async () => {
    process.env[LINK_SECRET_ENV] = SECRET;
    process.env.TELEGRAM_BOT_USERNAME = "alpha_engine_nussif_bot";
    delete process.env.ALPHAENGINE_GATEWAY_URL;
    const { GET } = await import("../app/api/telegram/link/route");
    const body = await (await GET(get(guestValue(VECTOR.id)))).json();
    restore();

    assert.equal(body.connect.kind, "guest");
    assert.match(body.connect.url, /^https:\/\/t\.me\/alpha_engine_nussif_bot\?start=[A-Za-z0-9_-]+$/);
    assert.equal(body.reason, null);
    assert.match(body.note, /lapses on its own clock/);
    // Never "not linked": this app has no route into the gateway's guest store,
    // and reporting an unread binding as an absent one would invite someone to
    // reconnect a chat they have already connected.
    assert.equal(body.linkStatus, "unknown");
  });

  it("refuses an account pass that arrives without a verified session", async () => {
    // The cookie is httpOnly but unsigned. Trusting the id in it would let a
    // forged cookie bind someone else's Telegram row.
    process.env[LINK_SECRET_ENV] = SECRET;
    process.env.TELEGRAM_BOT_USERNAME = "alpha_engine_nussif_bot";
    const { GET } = await import("../app/api/telegram/link/route");
    const body = await (await GET(get(VECTOR.id))).json();
    restore();

    assert.equal(body.connect, null);
    assert.match(body.reason, /no verified session/);
  });

  it("names its own cause when linking is unconfigured", async () => {
    delete process.env[LINK_SECRET_ENV];
    process.env.TELEGRAM_BOT_USERNAME = "alpha_engine_nussif_bot";
    const { GET } = await import("../app/api/telegram/link/route");
    const body = await (await GET(get(guestValue(VECTOR.id)))).json();
    restore();

    assert.equal(body.connect, null);
    assert.match(body.reason, new RegExp(LINK_SECRET_ENV));
  });

  it("never caches an answer that carries a single-use code", async () => {
    process.env[LINK_SECRET_ENV] = SECRET;
    process.env.TELEGRAM_BOT_USERNAME = "alpha_engine_nussif_bot";
    const { GET } = await import("../app/api/telegram/link/route");
    const response = await GET(get(guestValue(VECTOR.id)));
    restore();
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});
