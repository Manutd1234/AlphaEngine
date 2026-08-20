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
 * nobody sees. In here the mirror is itself the door — one chip that both
 * reads the status and opens Reliability. It used to be a read-only chip with
 * a full-width "Open reliability" button beneath it, which was a second door
 * to the room the header's always-visible button already opens, drawn on the
 * same bar at the same moment.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Settings2 } from "lucide-react";

import ComplexityToggle from "@/components/ComplexityToggle";
import TextSizeToggle from "@/components/TextSizeToggle";
import AnchoredPanel from "@/components/header/AnchoredPanel";
import ThemeToggle from "@/components/ThemeToggle";

interface QuickSettingsProps {
  healthLabel: string;
  healthNeedsAttention: boolean;
  onOpenReliability: () => void;
  /**
   * A counter, not a boolean. The account menu's Preferences item asks this
   * panel to open, and asking twice in a row must work — a boolean would be
   * already-true the second time. The panel keeps owning `open`, so its own
   * dismissal logic and its aria-expanded binding are untouched.
   */
  openSignal?: number;
  /**
   * Reopens the account menu this panel was launched from.
   *
   * Optional, and the control that uses it is conditional, because there are two
   * ways in here: the gear in the header, and Preferences inside the account
   * menu. Offering "Back to account" to someone who pressed the gear would be a
   * trail back to somewhere they have never been.
   */
  onBackToAccount?: () => void;
}

function QuickSettings({
  healthLabel,
  healthNeedsAttention,
  onOpenReliability,
  openSignal = 0,
  onBackToAccount,
}: QuickSettingsProps) {
  const [open, setOpen] = useState(false);
  /** Whether THIS opening came from the account menu, not the header gear. */
  const [fromAccount, setFromAccount] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  // Zero is the initial value and means "nobody has asked yet", so it must not
  // pop the panel open on first render.
  useEffect(() => {
    if (openSignal > 0) {
      setFromAccount(true);
      setOpen(true);
    }
  }, [openSignal]);

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
    <span ref={wrapper} className="header-anchor">
      <button
        ref={trigger}
        type="button"
        className="icon header-settings"
        onClick={() => {
          if (open) {
            close(true);
            return;
          }
          // Opened from the header itself, so there is no account menu behind
          // this one to go back to.
          setFromAccount(false);
          setOpen(true);
        }}
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
        /* `scroll` is not cosmetic here. This panel is absolutely positioned
           inside a *sticky* header, so anything past the bottom of the viewport
           cannot be scrolled to — the page scrolls, the header does not, and
           the content is simply unreachable. Measured at 844x390 the System
           status row and its Open reliability button sat 253px below the fold.
           It is the only one of the three panels tall enough to need it. */
        <AnchoredPanel
          id="quick-settings-panel"
          labelledBy="quick-settings-title"
          width={320}
          scroll
        >
          {/* Only when there is somewhere to go back TO. Preferences closes the
              account menu on its way here, so without this the way back is to
              dismiss the panel and press the avatar again — which is how it
              read as a dead end rather than as a second page of one menu. */}
          {fromAccount && onBackToAccount && (
            <button
              type="button"
              className="panel-back"
              onClick={() => {
                close(false);
                onBackToAccount();
              }}
            >
              <ArrowLeft size={12} aria-hidden />
              Account
            </button>
          )}
          <span className="page-kicker">Viewing preferences</span>
          <h3 id="quick-settings-title" className="mt-0.5 text-fs-title">
            Quick settings
          </h3>
          <p className="mt-1 text-fs-sm leading-snug text-text-secondary">
            All five are about this browser. None of them change what the desk can do.
          </p>

          {/* Stacked, like Detail level below it. The theme control grew from a
              two-state button to three segments with a sentence under them, and
              a three-segment group sharing a row with its own label is 288px of
              panel doing two jobs badly. */}
          <div className="mt-3">
            <span className="text-fs-sm font-semibold text-text-secondary">Theme</span>
            <div className="mt-1.5">
              <ThemeToggle />
            </div>
          </div>

          <div className="mt-3 border-t border-grid pt-3">
            <span className="text-fs-sm font-semibold text-text-secondary">Detail level</span>
            <div className="mt-1.5">
              <ComplexityToggle />
            </div>
          </div>

          <div className="mt-3 border-t border-grid pt-3">
            <span className="text-fs-sm font-semibold text-text-secondary">Text size</span>
            <div className="mt-1.5">
              <TextSizeToggle />
            </div>
          </div>

          <div className="mt-3 border-t border-grid pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-fs-sm font-semibold text-text-secondary">Formatting</span>
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
                className="rounded-[8px] border border-border bg-surface-2 px-2 py-1 text-fs-sm font-semibold text-text-secondary opacity-[0.55]"
              >
                English (US)
              </button>
            </div>
            <p id="quick-settings-locale-note" className="mt-1.5 text-fs-xs leading-snug text-text-muted">
              Numbers format as en-US and dates as en-GB throughout. Other locales are not
              implemented yet, so this is fixed rather than offered.
            </p>
          </div>

          <div className="mt-3 border-t border-grid pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-fs-sm font-semibold text-text-secondary">System status</span>
              {/* The mirrored chip IS the door — the base button rule supplies
                  the house chrome, .system-health the dot and the label voice.
                  Not .system-health-action: its narrow-width rules collapse the
                  header's copy to a 44px dot, which inside a 320px panel would
                  hide the very label this mirror exists to show. */}
              <button
                type="button"
                className={`system-health px-2.5 ${healthNeedsAttention ? "is-warn" : ""}`}
                aria-label={`Open reliability. ${healthLabel}`}
                onClick={() => {
                  close(false);
                  onOpenReliability();
                }}
              >
                <i aria-hidden />
                {healthLabel}
                <span aria-hidden>→</span>
              </button>
            </div>
          </div>
        </AnchoredPanel>
      )}
    </span>
  );
}

/**
 * Memoised. The panel mounts four preference controls, and none of them has an
 * opinion that changes at feed rate; `healthLabel` is the one prop that moves,
 * and it moves when the health snapshot lands rather than when the workspace
 * around it re-renders.
 */
export default memo(QuickSettings);
