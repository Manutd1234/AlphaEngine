"use client";

/**
 * The account control in the header — the only place the workspace admits it
 * now has a notion of "you".
 *
 * Signed out it is a link to the sign-in page. The desk is behind a routing
 * guard now, so the old sentence here — "not a gate: the desk behind it is fully
 * browsable" — is no longer true as written; what remains true is that nobody is
 * turned away, because the sign-in page offers a guest pass. An account buys
 * preferences that follow you between devices rather than the browser.
 * Signed in it opens `AnchoredPanel` — the shared header dropdown, which owns
 * position, width and elevation for all three of these controls. Dismissal
 * stays here: Escape or click-away, focus returned to the trigger, and the
 * panel deliberately left open while signing out so the button can narrate.
 *
 * Four states, and the fourth matters: absent when this deployment has no
 * Supabase config, a skeleton while the session probe is still out, a plain
 * link while signed out, and the dropdown once there is an identity to show.
 * Collapsing the probe into "signed out" is what made every page load flash a
 * Sign in button at people who were already signed in.
 *
 * The avatar is a monogram, not an image. Provider avatars and uploads arrive
 * with the profile page that can actually manage them; until then there is no
 * URL to render and a broken-image glyph would be worse than initials.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";

import AnchoredPanel from "@/components/header/AnchoredPanel";
import { dropDeskPass } from "@/lib/desk-pass";
import { signOutUser, useSession } from "@/lib/use-session";
import { flushPendingPrefs } from "@/lib/user-prefs";

/**
 * Initials from the display name if there is one, otherwise from the address.
 * `ian.wangsa@x.com` → IW; `desk@x.com` → D. Never more than two characters,
 * because the circle is 22px and a third is unreadable rather than informative.
 */
export function initialsFrom(name: string | null, email: string | null): string {
  const source = (name ?? email ?? "").trim();
  if (!source) return "?";
  const local = source.includes("@") ? source.slice(0, source.indexOf("@")) : source;
  const parts = local.split(/[.\-_+\s]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 1) : `${parts[0][0]}${parts[1][0]}`;
  return letters.toLocaleUpperCase();
}

export default function AccountChip({ onOpenPreferences }: { onOpenPreferences: () => void }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // A deployment without Supabase config has no account story at all. An
  // affordance that cannot work is worse than its absence.
  if (session.status === "unconfigured") return null;

  /**
   * The probe has not answered yet, and we must not guess.
   *
   * This branch used to fall through to "Sign in", so every page load flashed
   * a signed-out control at someone who was signed in — the reading that made
   * sign-out feel unreliable even when it worked. The placeholder occupies the
   * same box as the control that replaces it, so nothing reflows when the
   * answer arrives, and it is bounded by SESSION_PROBE_TIMEOUT_MS so it can
   * never shimmer forever.
   */
  if (session.status === "loading") {
    return (
      <span
        aria-hidden
        className="inline-flex items-center gap-1.5 rounded-[9px] border border-transparent px-2 py-1.5"
      >
        <span className="skeleton block h-[14px] w-[14px] rounded-[50%]" />
        <span className="skeleton block h-[11px] w-[52px] max-[520px]:hidden" />
      </span>
    );
  }

  if (session.status === "signed-out") {
    return (
      <a
        href="/login"
        className="inline-flex items-center gap-1.5 rounded-[9px] border border-transparent px-2 py-1.5 text-[11px] font-semibold text-text-secondary no-underline hover:border-border hover:bg-surface-2"
      >
        <UserRound size={14} aria-hidden />
        <span className="max-[520px]:hidden">Sign in</span>
      </a>
    );
  }

  const label = session.email ?? "Signed in";
  const initials = initialsFrom(null, session.email);

  return (
    <span ref={wrapper} className="header-anchor">
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close(true) : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="account-panel"
        aria-label={`Account menu for ${label}`}
        /* Monogram only. The address is up to 132px of the most crowded row in
           the app, and it is already the panel's heading — carrying it twice
           cost the Settings gear its place on screen. aria-label still names
           the account, so nothing is lost to a screen reader. */
        className="inline-flex items-center rounded-[9px] border border-transparent p-1 text-[11px] font-semibold text-text-secondary transition-[background-color,border-color] duration-(--dur-fast) ease-(--ease) hover:border-border hover:bg-surface-2"
      >
        <span
          aria-hidden
          className="grid h-[22px] w-[22px] place-items-center rounded-[50%] bg-[color-mix(in_srgb,var(--series-1)_16%,var(--surface-2))] text-[9.5px] font-bold tracking-[0.02em] text-series-1"
        >
          {initials}
        </span>
      </button>

      {open && (
        <AnchoredPanel id="account-panel" labelledBy="account-panel-title" width={280}>
          <span className="page-kicker">Account</span>
          <h3 id="account-panel-title" className="mt-0.5 text-[13px] break-words">
            {label}
          </h3>
          {/*
            Dot AND word. A coloured dot on its own carries no meaning for
            anyone who cannot see the colour, and the house rule forbids it —
            which is also why this cannot join the forced-colors allow-list.
            "Session active" is the honest claim: it says this browser holds a
            live session, not that the person is present.
          */}
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-text-secondary">
            <i
              aria-hidden
              className="block h-[6px] w-[6px] rounded-[50%] bg-status-good shadow-[0_0_0_3px_color-mix(in_srgb,var(--status-good)_14%,transparent)]"
            />
            Session active · preferences follow this account
          </p>

          {/* A link, not a button: it is a destination, and middle-click and
              open-in-new-tab should both work. Covered by the 44px touch rule
              because `#account-panel a` was added to the single existing
              `pointer: coarse` block rather than a second one. */}
          <a
            href="/profile"
            className="mt-3 block w-full rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-left text-[11.5px] font-semibold text-text-primary no-underline transition-[background-color] duration-(--dur-fast) ease-(--ease) hover:bg-surface-2"
          >
            Account and security
          </a>

          <button
            type="button"
            className="mt-2 w-full rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-left text-[11.5px] font-semibold text-text-primary transition-[background-color] duration-(--dur-fast) ease-(--ease) hover:bg-surface-2"
            onClick={() => {
              close(false);
              onOpenPreferences();
            }}
          >
            Preferences
          </button>

          <button
            type="button"
            disabled={signingOut}
            /* Destructive, and it reads as destructive without relying on the
               colour alone: the label says Log out and the border carries the
               critical token, which survives forced-colors as a real border. */
            className="mt-2 w-full rounded-[9px] border border-[color-mix(in_srgb,var(--status-critical)_45%,var(--border))] bg-surface-1 px-3 py-2 text-left text-[11.5px] font-semibold text-critical-text transition-[background-color] duration-(--dur-fast) ease-(--ease) hover:bg-[color-mix(in_srgb,var(--status-critical)_8%,var(--surface-1))]"
            onClick={() => {
              if (signingOut) return;
              setSigningOut(true);
              // The panel stays open so the button can say what is happening;
              // the page is leaving in a moment anyway.
              void (async () => {
                // Before the token dies. A preference changed in the last
                // PUSH_DEBOUNCE_MS is still behind the debounce, and signing
                // out drops that timer — the write would be lost silently.
                await flushPendingPrefs();
                // Awaited, and that is the whole point: GoTrue clears the
                // stored session only after its server round-trip, so
                // navigating first can unload the document mid-flight and
                // leave the token behind. The browser would come back signed
                // in while this menu had just said otherwise.
                await signOutUser();
                /**
                 * And the desk pass, before leaving.
                 *
                 * Without this the cookie outlived the session: the guard kept
                 * admitting a signed-out visitor on a pass that claimed an
                 * account, while this menu had just told them they were signed
                 * out. Awaited for the same reason `signOutUser()` is — a
                 * navigation that races it can unload the document before the
                 * request leaves.
                 */
                await dropDeskPass();
                // A full document navigation, not a router push: it discards
                // the module-level singletons in use-session and user-prefs,
                // so nothing account-shaped survives as stale UI.
                window.location.assign("/login");
              })();
            }}
          >
            {signingOut ? "Signing out…" : "Log out"}
          </button>
        </AnchoredPanel>
      )}
    </span>
  );
}
