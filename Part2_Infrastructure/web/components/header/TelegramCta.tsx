"use client";

/**
 * The one link out of this workspace — to the Telegram companion, and now with
 * a way to connect this desk to it.
 *
 * The bot remains a separate client with its own allow-list. This button opens
 * it, it does not embed it, and nothing about a Telegram identity authenticates
 * anything here. What the connect link carries runs the other way: a one-time,
 * short-lived token minted by `/api/telegram/link` for the desk pass this
 * browser is already holding. Redeeming it tells the gateway that this Telegram
 * account may READ what a desk pass already shows — the same shared book — and
 * grants nothing else. The controls stay behind the gateway's own
 * TELEGRAM_CONTROL_USER_IDS, which this app cannot reach.
 *
 * ── Why the handle is fetched, not inlined ──────────────────────────────────
 * It used to come from NEXT_PUBLIC_TELEGRAM_BOT_USERNAME, which Next substitutes
 * at build time: the value could not change without a redeploy, and it could
 * drift from the bot actually running. The route reads it from the gateway's own
 * /telegram/health instead, so this chip names the live bot. The env vars
 * survive as a fallback for a deployment with no gateway attached.
 *
 * ── Why it never renders nothing ────────────────────────────────────────────
 * The first version returned null whenever the handle was unknown, which is the
 * shape `tests/no-dead-ends.test.ts` bans and for a good reason: a chip that
 * vanishes is indistinguishable from a header that failed to mount, and the two
 * want opposite responses from whoever noticed. So every state renders the same
 * chip and says which state it is — resolving, unreachable, connectable,
 * connected. Only the last two are links.
 *
 * ── Why it mints ahead of the click ─────────────────────────────────────────
 * A plain anchor keeps the browser's own affordances — middle-click, copy
 * address, the global :focus-visible ring — and none of them survive an onClick
 * that has to await a fetch before opening a window, which popup blockers stop
 * anyway. So the href is always ready: minted on mount, and again on hover or
 * focus when the current one is close to expiring. Every activation path passes
 * through one of those first. Minting costs one HMAC and writes nothing, which
 * is what makes that affordable.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { authClient, authConfigured } from "@/lib/auth-client";

interface ConnectLink {
  url: string;
  /** Unix seconds. */
  expiresAt: number;
  kind: "account" | "guest";
}

interface LinkState {
  handle: string | null;
  connect: ConnectLink | null;
  linkStatus: "linked" | "not-linked" | "unknown";
  linked: { handle: string | null } | null;
  reason: string | null;
  note: string | null;
}

/** Re-mint this far before expiry, so a click never lands on a dead token. */
const REFRESH_MARGIN_S = 120;

const UNREACHABLE =
  "No Telegram companion is reachable from this deployment — the gateway reports no bot, "
  + "and no bot username is configured here either.";

export default function TelegramCta() {
  const [answer, setAnswer] = useState<LinkState | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // The account path has to prove itself: the route validates this token
      // with Supabase and takes the identity from the answer, never from the
      // cookie. Absent (a guest, or no auth configured) is a normal case.
      let authorization: string | undefined;
      if (authConfigured()) {
        const session = await authClient()?.auth.getSession();
        const accessToken = session?.data.session?.access_token;
        if (accessToken) authorization = `Bearer ${accessToken}`;
      }
      const response = await fetch("/api/telegram/link", {
        cache: "no-store",
        headers: authorization ? { authorization } : undefined,
      });
      if (!response.ok) {
        setAnswer({
          handle: null, connect: null, linkStatus: "unknown", linked: null, note: null,
          reason: `This workspace could not ask its own server about the companion (HTTP ${response.status}).`,
        });
        return;
      }
      setAnswer((await response.json()) as LinkState);
    } catch {
      setAnswer({
        handle: null, connect: null, linkStatus: "unknown", linked: null, note: null,
        reason: "This workspace could not reach its own server to check for the companion.",
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    // A tab left open overnight comes back holding a token minted yesterday.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const refreshIfStale = useCallback(() => {
    const expiresAt = answer?.connect?.expiresAt;
    if (expiresAt == null || expiresAt - Date.now() / 1000 < REFRESH_MARGIN_S) void load();
  }, [load, answer]);

  const resolving = answer === null;
  const handle = answer?.handle ?? null;
  const linked = answer?.linkStatus === "linked";
  const connectedTo = linked ? (answer?.linked?.handle ?? handle) : null;

  /**
   * A link only when there is somewhere real to go. Falls back to the bot's
   * plain address when a token could not be minted: that opens the actual bot,
   * whose own /start card explains what it cannot do, rather than this chip
   * guessing on its behalf.
   */
  const href = answer?.connect?.url ?? (handle ? `https://t.me/${handle}` : null);

  let label: string;
  let description: string;
  if (resolving) {
    label = "Telegram";
    description = "Checking whether a Telegram companion is attached to this desk.";
  } else if (!handle) {
    label = "Unavailable";
    description = answer?.reason ?? UNREACHABLE;
  } else if (linked) {
    label = `@${connectedTo}`;
    description = `Connected to the AlphaEngine Telegram companion as @${connectedTo}. Opens the chat in a new tab.`;
  } else if (answer?.connect) {
    label = "Connect";
    description =
      "Connect this desk to the AlphaEngine Telegram companion — the same reading, never the controls. "
      + (answer.note ?? "Opens in a new tab.");
  } else {
    label = "Telegram";
    description = `${answer?.reason ?? "This desk cannot mint a connect code right now."} Opens the companion in a new tab.`;
  }

  /* Telegram brand blue mixed into the theme's own surface and border, so the
     wash follows data-theme instead of needing a dark: variant. */
  const chrome =
    "inline-flex items-center gap-2 rounded-[10px] border border-[color-mix(in_srgb,#229ED9_30%,var(--border))] "
    + "bg-[color-mix(in_srgb,#229ED9_7%,var(--surface-1))] px-2 py-1 text-[11px] font-semibold text-text-primary no-underline";

  const body = (
    <>
      {/* Fixed #0088cc, not the lighter #229ED9: white on this carries 3.89:1,
          clearing the 3:1 bar for graphical objects in both themes, where the
          lighter brand blue sits at 3.02:1 — a rounding error from failing.
          Same reasoning as the fixed red on .handoff-fire. */}
      <span
        aria-hidden
        className="grid h-[27px] w-[27px] place-items-center rounded-[8px] bg-[#0088cc] text-white"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
          <path d="M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.47-2.27 2.19c-.25.25-.46.46-.95.46l.34-4.8 8.73-7.9c.38-.34-.08-.53-.59-.19L6.98 13.1 2.34 11.6c-1.01-.31-1.03-1.01.21-1.5L20.63 3.1c.84-.31 1.57.19 1.31 1.2Z" />
        </svg>
      </span>
      <span className="max-[1380px]:hidden">{label}</span>
    </>
  );

  if (!href) {
    // Still a chip, still labelled, still says why — just not a link, because
    // there is no address to open. `role="status"` so the reason is announced
    // when it resolves rather than sitting silently in a tooltip.
    return (
      <span
        role="status"
        aria-busy={resolving}
        aria-label={description}
        title={description}
        className={`${chrome} opacity-60`}
      >
        {body}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onPointerEnter={refreshIfStale}
      onFocus={refreshIfStale}
      aria-label={description}
      title={description}
      className={`${chrome} hover:bg-[color-mix(in_srgb,#229ED9_14%,var(--surface-1))]`}
    >
      {body}
    </a>
  );
}
