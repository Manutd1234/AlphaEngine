"use client";

/**
 * The header's viewing preferences, in one place.
 *
 * They used to be two unlabelled buttons side by side — a sun and a word that
 * said "Standard". Neither announced itself as a setting, and "Standard" in a
 * row of workspace tabs read as a ninth destination rather than a density
 * control. Both are settings about how this browser renders the desk and
 * neither changes what the system can do, so they belong behind one gear that
 * says so.
 *
 * Anchored dropdown, not a modal: the same pattern as KillSwitchControl —
 * `role="dialog" aria-modal="false"`, Escape or click-away, focus never
 * trapped. Dialog rather than menu is deliberate; the panel holds a toggle
 * button, a pressed-state group, a disabled control and a link, and menuitem
 * semantics fit none of those.
 *
 * The system-status row is a mirror, not a move. The standalone health button
 * stays in the header because it is the only always-visible signal that a data
 * provider is degraded, and a warning that lives behind a gear is a warning
 * nobody sees.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";

import ComplexityToggle from "@/components/ComplexityToggle";
import ThemeToggle from "@/components/ThemeToggle";

interface QuickSettingsProps {
  healthLabel: string;
  healthNeedsAttention: boolean;
  onOpenReliability: () => void;
}

export default function QuickSettings({
  healthLabel,
  healthNeedsAttention,
  onOpenReliability,
}: QuickSettingsProps) {
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

  return (
    <span ref={wrapper} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        className="icon header-settings"
        onClick={() => (open ? close(true) : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="quick-settings-panel"
        aria-label="Open quick settings: theme, detail level, formatting and system status"
        title="Theme, detail level, formatting, system status"
      >
        <Settings2 size={14} aria-hidden />
        <span>Settings</span>
      </button>

      {open && (
        <div
          id="quick-settings-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="quick-settings-title"
          className="absolute right-0 top-[calc(100%+10px)] z-[60] w-[min(320px,calc(100vw-28px))] rounded-card border border-border bg-surface-1 p-4 shadow-card"
        >
          <span className="page-kicker">Viewing preferences</span>
          <h3 id="quick-settings-title" className="mt-0.5 text-[15px]">
            Quick settings
          </h3>
          <p className="mt-1 text-[11px] leading-snug text-text-secondary">
            All four are about this browser. None of them change what the desk can do.
          </p>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold text-text-secondary">Theme</span>
            <ThemeToggle />
          </div>

          <div className="mt-3 border-t border-grid pt-3">
            <span className="text-[11px] font-semibold text-text-secondary">Detail level</span>
            <div className="mt-1.5">
              <ComplexityToggle />
            </div>
          </div>

          <div className="mt-3 border-t border-grid pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold text-text-secondary">Formatting</span>
              {/*
                Disabled, not absent, and not a working selector that changes
                nothing. There is no i18n layer here: lib/format.ts hardwires
                en-US numbers and en-GB dates through several dozen memoised
                call sites, so a persisted locale preference would be a control
                that remembers a choice it cannot act on. Dimmed and explained
                is the honest version — the same reasoning as the stress panel's
                fifth segment.
              */}
              <button
                type="button"
                disabled
                aria-describedby="quick-settings-locale-note"
                className="rounded-[8px] border border-border bg-surface-2 px-2 py-1 text-[11px] font-semibold text-text-secondary opacity-[0.55]"
              >
                English (US)
              </button>
            </div>
            <p id="quick-settings-locale-note" className="mt-1.5 text-[10.5px] leading-snug text-text-muted">
              Numbers format as en-US and dates as en-GB throughout. Other locales are not
              implemented yet, so this is fixed rather than offered.
            </p>
          </div>

          <div className="mt-3 border-t border-grid pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold text-text-secondary">System status</span>
              <span className={`system-health ${healthNeedsAttention ? "is-warn" : ""}`}>
                <i aria-hidden />
                {healthLabel}
              </span>
            </div>
            <button
              type="button"
              className="mt-2 w-full rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-[11.5px] font-semibold text-text-primary hover:bg-surface-2"
              onClick={() => {
                close(false);
                onOpenReliability();
              }}
            >
              Open reliability
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
