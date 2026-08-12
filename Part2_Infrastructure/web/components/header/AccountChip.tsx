"use client";

/**
 * The account control in the header — the only place the workspace admits it
 * now has a notion of "you".
 *
 * Signed out it is a link, not a gate: the desk behind it is fully browsable,
 * and this offers preferences that follow the account rather than the browser.
 * Signed in it opens the same anchored dropdown the kill switch uses
 * (`role="dialog" aria-modal="false"`, Escape or click-away to dismiss, focus
 * never trapped) — the house pattern for panels inside the header, which is a
 * containing block and cannot host fixed-position children.
 *
 * Four states, and the fourth matters: absent when this deployment has no
 * Supabase config, a skeleton while the session probe is still out, a plain
 * link while signed out, and the dropdown once there is an identity to show.
 * Collapsing the probe into "signed out" is what made every page load flash a
 * Sign in button at people who were already signed in.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";

import { signOutUser, useSession } from "@/lib/use-session";
import { flushPendingPrefs } from "@/lib/user-prefs";

export default function AccountChip() {
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

  return (
    <span ref={wrapper} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close(true) : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="account-panel"
        aria-label={`Account menu for ${label}`}
        className="inline-flex items-center gap-1.5 rounded-[9px] border border-transparent px-2 py-1.5 text-[11px] font-semibold text-text-secondary hover:border-border hover:bg-surface-2"
      >
        <UserRound size={14} aria-hidden />
        <span className="max-w-[132px] truncate max-[900px]:hidden">{label}</span>
      </button>

      {open && (
        <div
          id="account-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="account-panel-title"
          className="absolute right-0 top-[calc(100%+10px)] z-[60] w-[min(280px,calc(100vw-28px))] rounded-card border border-border bg-surface-1 p-4 shadow-card"
        >
          <span className="page-kicker">Account</span>
          <h3 id="account-panel-title" className="mt-0.5 text-[13px] break-words">
            {label}
          </h3>
          <p className="mt-1 text-[11px] leading-snug text-text-secondary">
            Workspace preferences follow this account.
          </p>
          <button
            type="button"
            disabled={signingOut}
            className="mt-3 w-full rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-[11.5px] font-semibold text-text-primary hover:bg-surface-2"
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
                // A full document navigation, not a router push: it discards
                // the module-level singletons in use-session and user-prefs,
                // so nothing account-shaped survives as stale UI.
                window.location.assign("/login");
              })();
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </span>
  );
}
