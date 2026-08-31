"use client";

/**
 * What the numbers on this screen are, said in the header.
 *
 * The desk can show a chosen sandbox when a backend is missing, which creates
 * the obligation this component discharges: if generated data is indistinguishable
 * from measured data, the sandbox is a liability rather than a feature. So the
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

import { memo, useCallback, useEffect, useRef, useState } from "react";

import AnchoredPanel from "@/components/header/AnchoredPanel";
import { describeTier, writesEnabled, type Provenance } from "@/lib/data-tier";

interface DataTierBadgeProps {
  provenance: Provenance;
  /** Seconds until the next automatic attempt, when backing off. */
  retryInSeconds?: number | null;
  /** What failed, in the words the route used. */
  detail?: string | null;
  onRetry: () => void | Promise<void>;
}

function DataTierBadge({
  provenance,
  retryInSeconds = null,
  detail = null,
  onRetry,
}: DataTierBadgeProps) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  /**
   * What the last manual check found, so the button reports something rather
   * than settling in a single frame with nothing on screen. Read at render
   * from the freshly-refreshed `provenance`, keyed by the moment the check
   * finished so a re-check replays the line.
   */
  const [lastCheck, setLastCheck] = useState<{ at: number; ms: number } | null>(null);
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
          <h3 id="data-tier-title" className="mt-0.5 text-fs-title">
            {badge.label}
          </h3>
          <p className="mt-1 text-fs-body leading-snug text-text-secondary">{badge.detail}</p>

          {/* The safety statement, and the reason it is safe to fill the desk in
              at all. Shown in every tier so its absence is never the only signal.

              It used to read "Order entry and operator controls are disabled
              until live data returns" for every non-live tier, and that was not
              what the desk does. In sandbox the ticket stays fully operable and
              judges each order in the browser against the gateway's own gate
              logic — it simply sends nothing. And the operator controls are not
              tier-gated at all: the kill switch answers to the guard mode and to
              the gateway answering a probe. A badge that describes a lockout
              nobody performs teaches the reader to distrust the badge. */}
          <p className="mt-3 flex items-start gap-1.5 text-fs-sm leading-snug text-text-secondary">
            <i aria-hidden>{writesEnabled(provenance.tier) ? "○" : "⦸"}</i>
            {writesEnabled(provenance.tier)
              ? "Orders submitted from this desk reach the gateway."
              : provenance.tier === "sandbox"
                ? "The ticket stays open and judges every order in this browser using the gateway's own gate logic, against the generated book. Nothing is sent."
                : "The ticket is closed while no gateway is answering, rather than ending a click in an error it could not explain."}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-fs-sm leading-snug text-text-muted">
            <i aria-hidden>○</i>
            Operator controls answer to the guard mode and to the gateway, not to
            this tier.
          </p>

          {detail && (
            <p className="mt-2 text-fs-sm leading-snug text-text-muted">{detail}</p>
          )}

          {retryInSeconds !== null && (
            <p className="mt-2 text-fs-sm text-text-muted">
              Retrying automatically in about {retryInSeconds}s.
            </p>
          )}

          <button
            type="button"
            disabled={retrying}
            className="mt-3 w-full rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-left text-fs-body font-semibold text-text-primary transition-[background-color] duration-(--dur-fast) ease-(--ease) hover:bg-surface-2"
            onClick={() => {
              setRetrying(true);
              const started = performance.now();
              // The panel stays open so the button can report the outcome; the
              // badge behind it changes on its own when the probe settles.
              void Promise.resolve(onRetry()).finally(() => {
                setLastCheck({ at: Date.now(), ms: Math.round(performance.now() - started) });
                setRetrying(false);
              });
            }}
          >
            {retrying ? "Checking…" : "Check the gateway now"}
          </button>

          {/* The outcome, read from the now-refreshed provenance so success is
              not silent: a live gateway answered, anything else names the tier
              and (when the route sent one) why. Keyed by the check time so a
              repeat check re-plays the line. */}
          {lastCheck && !retrying && (
            <p key={lastCheck.at} className="mount-fade mt-2 flex items-start gap-1.5 text-fs-sm leading-snug text-text-secondary">
              {provenance.tier === "live" ? (
                <>
                  <i aria-hidden>✓</i>
                  Gateway answered in {lastCheck.ms} ms at {new Date(lastCheck.at).toLocaleTimeString()}
                </>
              ) : (
                <>
                  <i aria-hidden>✕</i>
                  No live answer in {lastCheck.ms} ms{detail ? `; ${detail}` : ""}
                </>
              )}
            </p>
          )}
        </AnchoredPanel>
      )}
    </span>
  );
}

/**
 * Memoised. Provenance changes when the desk changes what it is made of, which
 * is a rare event, and this badge has no reason to re-render between them —
 * least of all on the decision chip's clock two controls along. The header
 * hands it the fields rather than the `dataSource` object the dashboard builds
 * inline, so the comparison sees a stable provenance and a stable `onRetry`
 * and skips; passing the wrapper object straight through would not.
 *
 * The cached tier's own 5s clock lives inside, in state, and is untouched by
 * this: a component always re-renders for its own state.
 */
export default memo(DataTierBadge);
