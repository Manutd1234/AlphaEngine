"use client";

/**
 * The one link out of this workspace — to the Telegram companion.
 *
 * The bot is a separate client with its own allow-list; this button opens it,
 * it does not embed it, and nothing about a Telegram identity authenticates
 * anything here. The `?start=auth` payload rides along because Telegram passes
 * it to the bot's /start handler; the gateway accepts it today and answers with
 * its command card, so the link is forward-compatible without claiming a
 * handshake that does not exist yet.
 *
 * Unset means absent. A placeholder username would render a button that opens a
 * t.me 404 — an affordance that lies is worse than one that is missing, and
 * this codebase already treats absent capability as absent everywhere else
 * (the tape, the Oracle panels). Local developers without the variable simply
 * do not see it; `.env.example` says so.
 */

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";

export default function TelegramCta() {
  if (!BOT_USERNAME) return null;

  return (
    <a
      href={`https://t.me/${BOT_USERNAME}?start=auth`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open the AlphaEngine Telegram companion in a new tab"
      title="Alerts, portfolio and market cards in Telegram"
      /* Telegram brand blue mixed into the theme's own surface and border, so
         the wash follows data-theme instead of needing a dark: variant. */
      className="inline-flex items-center gap-2 rounded-[10px] border border-[color-mix(in_srgb,#229ED9_30%,var(--border))] bg-[color-mix(in_srgb,#229ED9_7%,var(--surface-1))] px-2 py-1 text-[11px] font-semibold text-text-primary no-underline hover:bg-[color-mix(in_srgb,#229ED9_14%,var(--surface-1))]"
    >
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
      <span className="max-[1380px]:hidden">Telegram</span>
    </a>
  );
}
