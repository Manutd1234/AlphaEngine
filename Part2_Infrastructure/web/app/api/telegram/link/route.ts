import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { DESK_COOKIE } from "@/lib/desk-cookie";
import { callGateway } from "@/lib/gateway";
import {
  LINK_SECRET_ENV,
  deepLink,
  isBotHandle,
  linkSecret,
  mintLinkProbe,
  mintLinkToken,
  parseDeskPass,
  type DeskIdentity,
} from "@/lib/telegram-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/telegram/link — the Connect button's entire server side.
 *
 * Answers three questions in one round trip, because the header asks all three
 * at once and none of them is worth its own request: which bot is live, whether
 * this desk has already connected a chat, and a fresh one-time deep link.
 *
 * ── Why the second question needs two authorities ───────────────────────────
 * It used to be answerable only for an account, from the `telegram_link` row in
 * Supabase. A GUEST binding is held in the gateway's DuckDB and nowhere else,
 * so a guest tapped Connect, the bot said "Connected", and this route kept
 * answering `linkStatus: "unknown"` forever — the chip never turned green, for
 * the majority of visitors, which defeats the feature. The gateway now publishes
 * a read-only `POST /telegram/link/status` that answers for one signed identity,
 * and `gatewayLinkStatus` below is how this route asks it.
 *
 * ── The identity is proved, not read off a cookie ───────────────────────────
 * The token binds a desk identity, so whoever mints it is claiming to *be* that
 * identity. For an account that claim is verified the way `/api/auth/session`
 * verifies it: `getUser(jwt)` against Supabase's auth server, and the id comes
 * from the answer rather than from the request. The desk cookie is httpOnly and
 * page scripts cannot write it, but it is not signed, and a forged one would
 * otherwise let somebody bind their Telegram account to another person's row.
 *
 * A GUEST identity is taken from the cookie, and that is sound for the opposite
 * reason: a guest pass is a random seed minted by `POST /api/auth/guest` to
 * anyone who asks, it claims nothing about anybody, and forging one gains
 * exactly what asking for one gains.
 *
 * ── What the token grants ───────────────────────────────────────────────────
 * Read parity with a desk pass, over Telegram. Not the controls: the gateway's
 * /halt, /resume, /flatten, /reduceonly and /resetbook read
 * TELEGRAM_CONTROL_USER_IDS from deployment config, and nothing in this file can
 * reach it. Nothing here runs in the other direction either — no Telegram
 * identity is ever accepted as a credential by this app.
 *
 * Minting writes nothing anywhere: the token is signed, and single use is
 * enforced by the gateway's ledger when it is redeemed. So a GET that returns
 * one is still idempotent, and the header may mint on hover without cost.
 */

/** Never cached anywhere: the body carries a short-lived, single-use token. */
const NO_STORE = { "Cache-Control": "no-store" } as const;

interface TelegramHealth {
  enabled?: unknown;
  username?: unknown;
}

/**
 * The live bot handle, from the gateway that is actually running it.
 *
 * Preferred over any environment variable because it cannot go stale against
 * the real bot, and because a build-time value needs a redeploy to change. The
 * env vars remain as a fallback for a deployment with no gateway attached, and
 * an unknown handle renders no button at all — a Connect link to a t.me 404
 * would be an affordance that lies.
 */
let handleMemo: { handle: string | null; readAt: number } | null = null;
const HANDLE_MEMO_MS = 60_000;

async function botHandle(): Promise<string | null> {
  const now = Date.now();
  if (handleMemo && now - handleMemo.readAt < HANDLE_MEMO_MS) return handleMemo.handle;

  let handle: string | null = null;
  const result = await callGateway<TelegramHealth>("/telegram/health", {
    timeoutMs: 4_000,
    subject: "the Telegram companion",
  });
  // `enabled: false` means the gateway holds no bot token, so whatever username
  // it reports is a leftover rather than a live bot.
  if (result.ok && result.data?.enabled !== false && isBotHandle(result.data?.username as string)) {
    handle = result.data.username as string;
  }
  if (!handle) {
    const configured =
      process.env.TELEGRAM_BOT_USERNAME?.trim()
      || process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim()
      || "";
    handle = isBotHandle(configured) ? configured : null;
  }
  handleMemo = { handle, readAt: now };
  return handle;
}

function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

function requestScoped(url: string, anonKey: string, accessToken?: string) {
  return createClient(url, anonKey, {
    // Request-scoped: no browser storage to read here, and nothing to refresh.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}

function bearer(request: NextRequest): string {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export type LinkStatus = "linked" | "not-linked" | "unknown";

/**
 * Where the answer above came from. Never null and never absent: a state with
 * no provenance is the shape this codebase keeps getting wrong, and "we could
 * not ask" has to be a nameable answer rather than the absence of one.
 */
export type LinkSource = "account-record" | "gateway" | "none";

interface LinkedChat {
  handle: string | null;
  chatId: string | null;
  linkedAt: string | null;
}

/**
 * The account's existing binding, read under RLS as the account itself.
 *
 * The user's own JWT rather than a service key, deliberately: the policy on
 * `telegram_link` is the boundary, and a service-role read here would make this
 * route the boundary instead.
 */
async function existingLink(
  url: string,
  anonKey: string,
  accessToken: string,
  userId: string,
): Promise<{ status: LinkStatus; chat: LinkedChat | null }> {
  const { data, error } = await requestScoped(url, anonKey, accessToken)
    .from("telegram_link")
    .select("telegram_username, telegram_chat_id, linked_at")
    .eq("user_id", userId)
    .maybeSingle();

  // A deployment that has not run the migration yet, or a transient failure.
  // "Unknown" rather than "not linked": reporting an unread row as an absent one
  // would invite someone to connect a chat they have already connected.
  if (error) return { status: "unknown", chat: null };
  if (!data) return { status: "not-linked", chat: null };
  return {
    status: "linked",
    chat: {
      handle: (data.telegram_username as string | null) ?? null,
      chatId: (data.telegram_chat_id as string | null) ?? null,
      linkedAt: (data.linked_at as string | null) ?? null,
    },
  };
}

interface GatewayLinkStatus {
  link_status?: unknown;
}

/**
 * Ask the gateway whether the identity this request already proved is bound.
 *
 * This is the only way a GUEST can ever be told they are connected: the guest
 * binding lives in the gateway's DuckDB and there is no Supabase row to read.
 * It is also the honest fallback for an account whose durable mirror was never
 * written — the gateway's own store is what actually authorises, so it is the
 * better authority on "is this working", and the Supabase row is the better
 * authority on "as whom".
 *
 * ── What is sent, and why it cannot ask about anyone else ───────────────────
 * A probe, signed with a key derived from the shared secret. The identity is
 * INSIDE the signed payload, so there is no field an arbitrary user id could be
 * placed in, and a flipped byte invalidates the MAC. The identity itself was
 * established before we got here: an account by `getUser(jwt)` against
 * Supabase's auth server, a guest by a cookie that claims nothing about anybody
 * and that `POST /api/auth/guest` hands to whoever asks.
 *
 * The probe is not a connect token and cannot be redeemed as one — different
 * key, see `mintLinkProbe`. That matters because this one travels on every
 * header load rather than once per tap.
 */
async function gatewayLinkStatus(
  identity: DeskIdentity,
  secret: string,
): Promise<{ status: LinkStatus; reason: string | null }> {
  const probe = mintLinkProbe(identity, secret);
  const result = await callGateway<GatewayLinkStatus>("/telegram/link/status", {
    method: "POST",
    body: { probe: probe.token },
    timeoutMs: 4_000,
    subject: "the Telegram connection status",
  });

  if (!result.ok) {
    // 403 is the one failure worth translating: the gateway verified the
    // signature and refused it, which in practice means the two deployments
    // hold different secrets — and that breaks connecting too, not just this.
    const reason =
      result.failure.upstreamStatus === 403
        ? `The gateway refused this desk's status probe. That usually means ${LINK_SECRET_ENV} `
          + "differs between this deployment and the gateway, which would also stop Connect from working."
        : result.failure.error;
    return { status: "unknown", reason };
  }

  const reported = result.data?.link_status;
  if (reported === "linked" || reported === "not-linked") return { status: reported, reason: null };
  // Including the gateway's own "unknown" — it has no store to read, and that
  // is a different fact from "no binding". It must not become one here.
  return {
    status: "unknown",
    reason: "The gateway could not say whether this desk is connected, so this workspace will not guess.",
  };
}

export async function GET(request: NextRequest) {
  const handle = await botHandle();
  const secret = linkSecret();
  const pass = parseDeskPass(request.cookies.get(DESK_COOKIE)?.value);
  const env = supabaseEnv();
  const token = bearer(request);

  /**
   * A signed-in identity, proved. Falls back to the guest pass rather than to
   * the account id in the cookie — see the header.
   */
  let identity: DeskIdentity | null = null;
  let account: { id: string; email: string | null } | null = null;
  if (token && env) {
    const { data, error } = await requestScoped(env.url, env.anonKey).auth.getUser(token);
    if (!error && data.user) {
      account = { id: data.user.id, email: data.user.email ?? null };
      identity = { kind: "account", id: data.user.id };
    }
  }
  if (!identity && pass?.kind === "guest") identity = pass;

  // Every refusal names its own cause. "Connect is unavailable" with no reason
  // is a support ticket; each of these is a different thing to go and fix.
  let reason: string | null = null;
  if (!handle) {
    reason = "No Telegram companion is reachable from this deployment, so there is nothing to connect to.";
  } else if (!secret) {
    reason = `Connecting is not configured here — ${LINK_SECRET_ENV} is unset or shorter than 32 characters.`;
  } else if (!identity) {
    reason = pass
      ? "This desk pass claims an account, but the request carried no verified session to prove it. Sign in again, then reconnect."
      : "This browser holds no desk pass, so there is no identity to connect a chat to.";
  }

  const minted = handle && secret && identity ? mintLinkToken(identity, secret) : null;

  /**
   * Two authorities, asked in the order of what each is actually good for.
   *
   * The Supabase row is the only one that knows the Telegram *handle*, so an
   * account that reads back as linked is answered from there and the gateway is
   * left alone. Everything else — every guest, and any account whose durable
   * mirror is missing or unreadable — is asked of the gateway, whose own store
   * is what grants the Telegram read in the first place and is therefore the
   * authority on whether the connection is live at all.
   */
  let status: LinkStatus = "unknown";
  let chat: LinkedChat | null = null;
  let source: LinkSource = "none";
  let linkReason: string | null = null;
  if (account && env && token) {
    ({ status, chat } = await existingLink(env.url, env.anonKey, token, account.id));
    if (status === "linked") source = "account-record";
  }
  if (status !== "linked" && identity && secret) {
    const asked = await gatewayLinkStatus(identity, secret);
    if (asked.status === "unknown") linkReason = asked.reason;
    else {
      status = asked.status;
      source = "gateway";
    }
  }

  return NextResponse.json(
    {
      handle,
      connect:
        minted && handle && identity
          ? { url: deepLink(handle, minted.token), expiresAt: minted.expiresAt, kind: identity.kind }
          : null,
      reason,
      /**
       * Three states, never two. "Not connected" and "cannot tell from here"
       * stay distinct even now that the gateway can be asked, because the ask
       * itself can fail — and a failed ask reported as "not connected" invites
       * someone to reconnect a chat that is already connected.
       */
      linkStatus: status,
      /** Which authority answered, so the chip can say so rather than imply it. */
      linkSource: source,
      /** Why the answer is "unknown", when it is. Null when it is not. */
      linkReason,
      linked: chat,
      note:
        identity?.kind === "guest"
          ? "A guest link is held by the gateway alone and lapses on its own clock. Sign in and connect again to keep it."
          : null,
    },
    { headers: NO_STORE },
  );
}
