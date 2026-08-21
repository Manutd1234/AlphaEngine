"use client";

/**
 * How much — the question the verdict never answers.
 *
 * The research lab ends by saying a candidate passed or failed. Both answers
 * leave a researcher holding a strategy and no allocation, and "how much" is
 * not a smaller question than "does it work" — it is where most of the damage
 * actually happens. A real edge sized at full Kelly still blows up.
 *
 * So this reads the sweep's own win rate and payoff and turns them into a
 * fraction of the book, with the two adjustments that make Kelly usable:
 *
 *  - **Quarter Kelly, not full.** `f*` is optimal *given W and R are known
 *    exactly*. They never are — they are estimates from a parameter search that
 *    has already been optimised once, which biases them upward. Over-betting
 *    punishes super-linearly while under-betting merely grows slower, so the
 *    asymmetry is the whole argument for a fraction.
 *  - **A hard ceiling.** Even a quarter of a large Kelly can exceed what any
 *    single strategy should hold, so it is capped and the cap is named.
 *
 * A negative Kelly returns zero rather than an inverted position. The
 * arithmetic would happily suggest shorting the signal, and an edge that only
 * appears when you flip it is a fitting artefact, not a discovery.
 */

import { useState } from "react";

import { fmt, pct, usd } from "@/lib/format";
import { MIN_TRADES_FOR_SIZING, kellySizing } from "@/lib/quant";
import type { ParamResult, PromotionGate } from "@/lib/types";

interface SizingPanelProps {
  best: ParamResult;
  gate: PromotionGate;
  /** Book equity the fraction is applied to. */
  equity: number;
}

/** Fractions a researcher actually chooses between. */
const FRACTIONS = [
  { label: "Full", value: 1, note: "growth-optimal only if W and R are exact" },
  { label: "Half", value: 0.5, note: "~75% of the growth at ~half the volatility" },
  { label: "Quarter", value: 0.25, note: "default — the inputs came from a search" },
  { label: "Eighth", value: 0.125, note: "for a thin sample or a fragile edge" },
];

export default function SizingPanel({ best, gate, equity }: SizingPanelProps) {
  const [fraction, setFraction] = useState(0.25);

  // Payoff ratio from the sweep's own realised trades, not asserted: the engine
  // accumulates win and loss magnitudes because they cannot be recovered from
  // the summary statistics afterwards.
  const sizing = kellySizing({
    winRate: best.winRate,
    avgWin: best.avgWin,
    avgLoss: best.avgLoss,
    trades: best.trades,
    fraction,
    equity,
  });

  const blocked = !gate.eligible;

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Allocation</span>
          <h2>Position sizing</h2>
        </div>
        <span className="section-note">
          from {best.trades} trades at {pct(best.winRate, 0)} win rate
        </span>
      </div>

      {blocked && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>This candidate has not cleared the promotion gate</strong> ({gate.passed}/{gate.total}).
            The sizing below is arithmetic on the sweep&apos;s own numbers, not advice.
          </div>
        </div>
      )}

      <div className="seg research-seg" role="group" aria-label="Kelly fraction">
        {FRACTIONS.map((f) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={fraction === f.value}
            onClick={() => setFraction(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="tiles stability-tiles">
        <div className="stability-tile">
          <span>Full Kelly</span>
          <strong
            className="num"
            style={{ color: sizing.fullKelly > 0 ? "var(--text-primary)" : "var(--critical-text)" }}
          >
            {pct(sizing.fullKelly, 1)}
          </strong>
          <small>W − (1−W) ÷ R</small>
        </div>
        <div className="stability-tile">
          <span>Recommended</span>
          <strong className="num" style={{ color: "var(--series-1)" }}>
            {pct(sizing.recommendedFraction, 1)}
          </strong>
          <small>{FRACTIONS.find((f) => f.value === fraction)?.label} Kelly</small>
        </div>
        <div className="stability-tile">
          <span>Notional</span>
          <strong className="num">{usd(sizing.recommendedNotional, 0)}</strong>
          <small>on {usd(equity, 0)} of equity</small>
        </div>
        <div className="stability-tile">
          <span>Payoff ratio</span>
          <strong className="num">
            {sizing.payoffRatio > 0 ? fmt(sizing.payoffRatio, 2) : "—"}
          </strong>
          <small>
            {pct(best.avgWin, 2)} win ÷ {pct(best.avgLoss, 2)} loss
          </small>
        </div>
      </div>

      {/* Ordered before the cap notice deliberately. A capped fraction is a
          limit doing its job; a fraction estimated from nine trades is a number
          that should not have been believed in the first place. */}
      {sizing.thinSample && sizing.recommendedFraction > 0 && (
        <div className="banner warn" role="status" style={{ marginTop: 12 }}>
          <span aria-hidden>!</span>
          <div>
            <strong>
              {pct(sizing.recommendedFraction, 1)} of the book from {best.trades} trade
              {best.trades === 1 ? "" : "s"}.
            </strong>{" "}
            Below {MIN_TRADES_FOR_SIZING} trades the standard error on R is wide enough that the
            honest reading is &ldquo;directionally positive&rdquo;, not {usd(sizing.recommendedNotional, 0)}.
          </div>
        </div>
      )}

      {sizing.cappedBy && (
        <div className="banner warn" role="status" style={{ marginTop: 12 }}>
          <span aria-hidden>!</span>
          <div>
            {sizing.cappedBy === "no_edge" && sizing.payoffRatio === 0 ? (
              <>
                <strong>Payoff ratio is undefined, not infinite.</strong> No losing trades to
                measure against ({best.trades} trade{best.trades === 1 ? "" : "s"}), so it is sized
                to zero until a loss exists to divide by.
              </>
            ) : sizing.cappedBy === "no_edge" ? (
              <>
                {/* The odds themselves are not restated here: the section note
                    carries the trade count and win rate, and the Payoff ratio
                    tile carries the average win against the average loss. */}
                <strong>Negative Kelly — no edge at these odds.</strong> Sized to zero rather
                than inverted: a signal that only works when flipped is a fitting artefact.
              </>
            ) : (
              <>
                <strong>Capped at the single-strategy ceiling.</strong> {FRACTIONS.find((f) => f.value === fraction)?.label}{" "}
                Kelly would allocate {pct(sizing.uncappedFraction, 1)}; no one strategy should hold
                more than {pct(sizing.maxFraction, 0)} of the book.
              </>
            )}
          </div>
        </div>
      )}

      {/* The paragraph is split at the seam it already had. The first half is a
          live caption for the fraction the reader just pressed — decision
          support for an active control — so it stays where the control is. The
          second is an estimation caveat about where the odds came from, which
          is this file's own header argument restated for the reader, and it
          folds. Nothing that qualifies the recommended fraction directly moves:
          the notional, the thin-sample banner and both cap banners are above
          and stay above, each rendering only in the state it describes. */}
      <p className="research-note">
        {FRACTIONS.find((f) => f.value === fraction)?.note}.
      </p>
      <details className="disclosure">
        <summary>How reliable are the odds behind this fraction?</summary>
        <p className="research-note">
          These odds are estimates from an
          already-optimised search, so they are biased upward and over-betting hurts super-linearly.
        </p>
      </details>
    </div>
  );
}
