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
 * Three states only: absent when this deployment has no Supabase config, a
 * plain link while signed out, and the dropdown once there is an identity to
 * show.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";

import { signOutUser, useSession } from "@/lib/use-session";

export default function AccountChip() {
  const session = useSession();
  const [open, setOpen] = useState(false);
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

  if (session.status === "loading" || session.status === "signed-out") {
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
            className="mt-3 w-full rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-[11.5px] font-semibold text-text-primary hover:bg-surface-2"
            onClick={() => {
              close(false);
              void signOutUser();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </span>
  );
}
