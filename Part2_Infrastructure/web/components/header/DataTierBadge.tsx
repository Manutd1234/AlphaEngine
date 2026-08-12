"use client";

/**
 * What the numbers on this screen are, said in the header.
 *
 * The desk can now fill itself in when a backend is missing, which creates the
 * obligation this component discharges: if generated data is indistinguishable
 * from measured data, the fallback is a liability rather than a feature. So the
 * provenance is stated once, in the chrome, where it applies to everything
 * below it — not per panel, where it would be twenty-six separate claims a
 * reader has to collate.
 *
 * Glyph and words, never colour alone. The tone is an accent on top of a shape
 * (● ◇ △) and a label, which is the house rule and also what survives
 * forced-colors mode, where every tone collapses to the same system ink.
 *
 * A button, not a chip: the detail behind it — the cause, the age of the last
 * good reading, when the next retry lands — is what turns "Sandbox" from an
 * apology into something a reader can act on, and a manual retry beats waiting
 * out the backoff.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import AnchoredPanel from "@/components/header/AnchoredPanel";
import { describeTier, writesEnabled, type Provenance } from "@/lib/data-tier";

interface DataTierBadgeProps {
  provenance: Provenance;
  /** Seconds until the next automatic attempt, when backing off. */
  retryInSeconds?: number | null;
  /** What failed, in the words the route used. */
  detail?: string | null;
  onRetry: () => void;
}

export default function DataTierBadge({
  provenance,
  retryInSeconds = null,
  detail = null,
  onRetry,
}: DataTierBadgeProps) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /**
   * The badge re-renders on a clock, not only on a state change.
   *
   * `cached` earns its keep by carrying an age, and an age rendered once is a
   * number that silently stops being true — "last good 3s ago" still reading 3s
   * after four minutes is worse than no age at all. Only while cached: nothing
   * else here is time-dependent, and a live desk should not repaint on a timer.
   */
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (provenance.tier !== "cached") return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [provenance.tier]);

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

  const badge = describeTier(provenance);
  const live = provenance.tier === "live";

  return (
    <span ref={wrapper} className="header-anchor">
      <button
        ref={trigger}
        type="button"
        className={`data-tier data-tier--${badge.tone}`}
        onClick={() => (open ? close(true) : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="data-tier-panel"
        aria-label={`Data source: ${badge.label}, ${badge.detail}. Open details.`}
      >
        {/* The pulse marks a feed that is actually arriving. It is decoration
            over a glyph and a word that already say so, and it is clamped by the
            single prefers-reduced-motion block. */}
        <i aria-hidden className={live ? "data-tier__dot is-live" : "data-tier__dot"}>
          {badge.glyph}
        </i>
        <span className="data-tier__label">{badge.label}</span>
      </button>

      {open && (
        <AnchoredPanel id="data-tier-panel" labelledBy="data-tier-title" width={300}>
          <span className="page-kicker">Data source</span>
          <h3 id="data-tier-title" className="mt-0.5 text-[15px]">
            {badge.label}
          </h3>
          <p className="mt-1 text-[11.5px] leading-snug text-text-secondary">{badge.detail}</p>

          {/* The safety statement, and the reason it is safe to fill the desk in
              at all. Shown in every tier so its absence is never the only signal. */}
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-text-secondary">
            <i aria-hidden>{writesEnabled(provenance.tier) ? "○" : "⦸"}</i>
            {writesEnabled(provenance.tier)
              ? "Order entry and operator controls are enabled."
              : "Order entry and operator controls are disabled until live data returns."}
          </p>

          {detail && (
            <p className="mt-2 text-[11px] leading-snug text-text-muted">{detail}</p>
          )}

          {retryInSeconds !== null && (
            <p className="mt-2 text-[11px] text-text-muted">
              Retrying automatically in about {retryInSeconds}s.
            </p>
          )}

          <button
            type="button"
            disabled={retrying}
            className="mt-3 w-full rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-left text-[11.5px] font-semibold text-text-primary transition-[background-color] duration-(--dur-fast) ease-(--ease) hover:bg-surface-2"
            onClick={() => {
              setRetrying(true);
              // The panel stays open so the button can report the outcome; the
              // badge behind it changes on its own when the probe settles.
              void Promise.resolve(onRetry()).finally(() => setRetrying(false));
            }}
          >
            {retrying ? "Checking…" : "Check the gateway now"}
          </button>
        </AnchoredPanel>
      )}
    </span>
  );
}
