/**
 * One-time deep-link tokens that connect a Telegram chat to a desk identity.
 * =========================================================================
 *
 * Server-only. This module imports `node:crypto` and reads the shared secret,
 * and neither belongs anywhere a browser can reach.
 *
 * ── Why a packed binary token ───────────────────────────────────────────────
 * A `t.me/<bot>?start=<payload>` payload may be at most 64 characters drawn from
 * `[A-Za-z0-9_-]`. That rules out anything JSON-shaped — a bare UUID in text is
 * already 36 of them — so the token is packed and then base64url'd: 38 bytes in,
 * 51 characters out.
 *
 *     version(1) ‖ kind(1) ‖ expiresAt(4, big-endian) ‖ nonce(4) ‖ uuid(16)
 *     ‖ HMAC-SHA256(secret, everything above)[:12]
 *
 * ── Why signed rather than a row in a table ─────────────────────────────────
 * The two ends are different processes on different hosts: this app mints, the
 * Python gateway verifies. They share a secret rather than a database. That also
 * buys the property the gateway's in-process confirmation codes cannot have — a
 * gateway restart between the tap and the `/start` does not silently void a link
 * someone is halfway through.
 *
 * Single use is enforced at redemption, by a persisted ledger in the gateway's
 * audit store. Minting therefore writes nothing at all, which is what makes it
 * safe for the header to mint a fresh token on hover.
 *
 * The format is mirrored in `modules/telegram.py`. Both suites pin the same
 * known-answer vector, so a change to either side that the other did not make
 * fails as a test rather than as a link that will not open.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const LINK_SECRET_ENV = "TELEGRAM_LINK_SECRET";

/**
 * A deep link is tapped seconds after it is minted; the window only has to
 * outlast the tap and Telegram cold-starting. Fifteen minutes is generous for
 * that and short enough that a token caught in a screenshot or a shared browser
 * history is already worthless. Mirrors `TELEGRAM_LINK_TOKEN_TTL_S`.
 */
export const LINK_TOKEN_TTL_S = 900;

const TOKEN_VERSION = 1;
const MAC_BYTES = 12;
const PAYLOAD_BYTES = 26;

export type LinkKind = "account" | "guest";

const KIND_BYTE: Record<LinkKind, number> = { account: 1, guest: 2 };

/** Telegram's own rule for a bot handle, applied to a value that arrives over the network. */
const BOT_HANDLE_RE = /^[A-Za-z0-9_]{5,32}$/;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface DeskIdentity {
  kind: LinkKind;
  /** The desk pass value: a Supabase user id, or a guest's random seed. */
  id: string;
}

/**
 * Read the desk pass into an identity, or refuse it.
 *
 * `guest:` prefixed values are guests; anything else is expected to be the
 * Supabase user id that `/api/auth/session` wrote after validating a JWT.
 * Non-UUID values return null rather than being passed along: the token format
 * carries sixteen raw bytes and has nowhere to put a free-form string, and a
 * cookie that is not one of these two shapes is not a desk pass.
 */
export function parseDeskPass(value: string | undefined | null): DeskIdentity | null {
  if (!value) return null;
  const guest = value.startsWith("guest:");
  const id = guest ? value.slice("guest:".length) : value;
  if (!UUID_RE.test(id)) return null;
  return { kind: guest ? "guest" : "account", id };
}

/**
 * The shared secret, or null when this deployment has not been given one.
 *
 * The 32-character floor matches the gateway's, for the same reason: the
 * verifier is a pure function anyone may call as often as they like, so a short
 * key is guessable offline. Unconfigured is a feature that is absent, never one
 * that quietly accepts unsigned tokens.
 */
export function linkSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env[LINK_SECRET_ENV]?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

export function isBotHandle(value: string | null | undefined): value is string {
  return typeof value === "string" && BOT_HANDLE_RE.test(value);
}

function uuidBytes(id: string): Buffer {
  if (!UUID_RE.test(id)) throw new TypeError("a desk identity must be a UUID");
  return Buffer.from(id.replace(/-/g, ""), "hex");
}

function mac(payload: Buffer, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest().subarray(0, MAC_BYTES);
}

export interface MintedLink {
  token: string;
  /** Unix seconds. The client uses it to decide when to mint another. */
  expiresAt: number;
}

export interface MintOptions {
  /** Unix seconds; injectable so the tests can pin an exact token. */
  now?: number;
  ttlS?: number;
  /** Four bytes; injectable for the same reason. */
  nonce?: Buffer;
}

export function mintLinkToken(
  identity: DeskIdentity,
  secret: string,
  options: MintOptions = {},
): MintedLink {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const expiresAt = now + (options.ttlS ?? LINK_TOKEN_TTL_S);
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload[0] = TOKEN_VERSION;
  payload[1] = KIND_BYTE[identity.kind];
  payload.writeUInt32BE(expiresAt, 2);
  (options.nonce ?? randomBytes(4)).copy(payload, 6, 0, 4);
  uuidBytes(identity.id).copy(payload, 10);
  return {
    token: Buffer.concat([payload, mac(payload, secret)]).toString("base64url"),
    expiresAt,
  };
}

/**
 * Verify a token this app minted. The gateway is the real verifier; this exists
 * so the round trip is testable on one side of the wire, and so nothing here
 * ever hand-rolls a comparison against a signature.
 */
export function verifyLinkToken(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): (DeskIdentity & { expiresAt: number }) | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== PAYLOAD_BYTES + MAC_BYTES || raw[0] !== TOKEN_VERSION) return null;
  const payload = raw.subarray(0, PAYLOAD_BYTES);
  // Constant time, even though this side is not the one under attack: a
  // hand-rolled `===` here is the version someone copies into the verifier.
  if (!timingSafeEqual(raw.subarray(PAYLOAD_BYTES), mac(payload, secret))) return null;
  const kind = (Object.keys(KIND_BYTE) as LinkKind[]).find((name) => KIND_BYTE[name] === payload[1]);
  if (!kind) return null;
  const expiresAt = payload.readUInt32BE(2);
  if (now > expiresAt) return null;
  const hex = payload.subarray(10).toString("hex");
  const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  return { kind, id, expiresAt };
}

/**
 * The deep link itself.
 *
 * The handle is validated rather than trusted: it arrives from the gateway's
 * health payload, over the network, and it is being interpolated into a URL the
 * header hands to a user.
 */
export function deepLink(handle: string, token: string): string {
  if (!isBotHandle(handle)) throw new TypeError("refusing to build a t.me link from a handle that is not one");
  return `https://t.me/${handle}?start=${token}`;
}
