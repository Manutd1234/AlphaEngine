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
  /** Which authority answered. "none" when nobody could be asked. */
  linkSource: "account-record" | "gateway" | "none";
  /** Why `linkStatus` is "unknown", when it is. */
  linkReason: string | null;
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
          handle: null, connect: null, linkStatus: "unknown", linkSource: "none",
          linkReason: null, linked: null, note: null,
          reason: `This workspace could not ask its own server about the companion (HTTP ${response.status}).`,
        });
        return;
      }
      setAnswer((await response.json()) as LinkState);
    } catch {
      setAnswer({
        handle: null, connect: null, linkStatus: "unknown", linkSource: "none",
        linkReason: null, linked: null, note: null,
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
  /* The bot's own handle is NOT a fallback here. `?? handle` used to close this
     expression and rendered the bot's username as though it were the reader's,
     for every binding whose Telegram username was never captured — which is
     every guest. A handle we do not have is a handle we do not print. */
  const connectedTo = linked ? (answer?.linked?.handle ?? null) : null;

  /**
   * A link only when there is somewhere real to go. Falls back to the bot's
   * plain address when a token could not be minted: that opens the actual bot,
   * whose own /start card explains what it cannot do, rather than this chip
   * guessing on its behalf.
   *
   * Already connected goes to the plain address too. A connect code is a
   * single-use credential that BINDS a chat, and handing one to somebody whose
   * chat is already bound offers a write they did not ask for; the affordance
   * they want is "open the chat I connected".
   */
  const href = linked && handle
    ? `https://t.me/${handle}`
    : answer?.connect?.url ?? (handle ? `https://t.me/${handle}` : null);

  let label: string;
  let description: string;
  /**
   * A typographic mark that sits OUTSIDE the collapsing label, so the connected
   * state is still carried by something other than colour at the widths where
   * the word is hidden. House vocabulary, never an emoji: it inherits the text
   * colour and renders in the app's own font.
   */
  let mark: string | null = null;
  if (resolving) {
    label = "Telegram";
    description = "Checking whether a Telegram companion is attached to this desk.";
  } else if (!handle) {
    label = "Unavailable";
    description = answer?.reason ?? UNREACHABLE;
  } else if (linked) {
    // The word the state is named by. The handle rides in the description
    // rather than the label: the header collapses labels below 1380px, and
    // "Connected · @somebody" is a chip wide enough to move the nav.
    label = "Connected";
    mark = "✓";
    const who = connectedTo ? ` as @${connectedTo}` : "";
    // Provenance, because the two are not the same promise: an account binding
    // is recorded against the account, a guest binding is the gateway's alone.
    const where =
      answer?.linkSource === "account-record"
        ? "Recorded against your desk account."
        : answer?.note ?? "Held by the gateway for this desk pass.";
    description = `Connected to the AlphaEngine Telegram companion${who}. ${where} Opens the chat in a new tab.`;
  } else if (answer?.connect) {
    label = "Connect";
    description =
      "Connect this desk to the AlphaEngine Telegram companion — the same reading, never the controls. "
      + (answer.note ?? "Opens in a new tab.")
      // "Not connected" and "could not tell" are different things to say, and
      // the second one names its own cause rather than reading as the first.
      + (answer.linkReason ? ` ${answer.linkReason}` : "");
  } else {
    label = "Telegram";
    description = `${answer?.reason ?? "This desk cannot mint a connect code right now."} Opens the companion in a new tab.`;
  }

  /* Telegram brand blue mixed into the theme's own surface and border, so the
     wash follows data-theme instead of needing a dark: variant.

     Sized to the utility row's 32px / 9px norm. An anchor escapes the global
     button rule that normalises the rest of the row, and at a 27px tile plus
     py-1 this chip stood ~37px tall with a 10px radius — the same standing-
     proud defect the latency chip's own fix narrates in globals.css. */
  const chrome =
    "inline-flex min-h-[32px] items-center gap-2 rounded-[9px] border px-2 py-0.5 text-fs-chrome-chip font-semibold no-underline "
    + (linked
      /* Connected wears the house green, and green is never the only carrier:
         the word changes to "Connected", a ✓ appears beside the mark, and the
         border changes with it, so the state survives a colour-blind reader, a
         greyscale screenshot and Windows High Contrast.

         6% of --status-good over --surface-1 keeps --success-text at 5.34:1 in
         light and 4.54:1 in dark — both clear of AA. 8% would put dark at
         4.38:1, which is why the wash is this shallow and why hover moves the
         BORDER rather than the background: a hover that repaints the plane
         under the word changes the word's contrast with it. */
      ? "border-[color-mix(in_srgb,var(--status-good)_38%,var(--border))] "
        + "bg-[color-mix(in_srgb,var(--status-good)_6%,var(--surface-1))] text-success-text"
      : "border-[color-mix(in_srgb,#229ED9_30%,var(--border))] "
        + "bg-[color-mix(in_srgb,#229ED9_7%,var(--surface-1))] text-text-primary");

  const hover = linked
    ? "hover:border-[color-mix(in_srgb,var(--status-good)_62%,var(--border))]"
    : "hover:bg-[color-mix(in_srgb,#229ED9_14%,var(--surface-1))]";

  const body = (
    <>
      {/* Fixed #0088cc, not the lighter #229ED9: white on this carries 3.89:1,
          clearing the 3:1 bar for graphical objects in both themes, where the
          lighter brand blue sits at 3.02:1 — a rounding error from failing.
          Same reasoning as the fixed red on .handoff-fire. The mark stays brand
          blue when connected: it identifies Telegram, and Telegram is not the
          thing whose state changed. 24px with a 7px radius, matching
          .latency-chip__icon's tile two controls along. */}
      <span
        aria-hidden
        className="grid h-6 w-6 place-items-center rounded-[7px] bg-[#0088cc] text-white"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
          <path d="M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.47-2.27 2.19c-.25.25-.46.46-.95.46l.34-4.8 8.73-7.9c.38-.34-.08-.53-.59-.19L6.98 13.1 2.34 11.6c-1.01-.31-1.03-1.01.21-1.5L20.63 3.1c.84-.31 1.57.19 1.31 1.2Z" />
        </svg>
      </span>
      {mark ? <span aria-hidden className="text-fs-chrome-tab leading-none">{mark}</span> : null}
      <span className="max-[1580px]:hidden">{label}</span>
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
      className={`${chrome} ${hover}`}
    >
      {body}
    </a>
  );
}
