"use client";

/**
 * Capacity, at the top, before anything else.
 *
 * A PM about to size an order needs one question answered first: is there room?
 * That question was answerable here only by reading a card further down the
 * page, which is the wrong place for the constraint that vetoes everything
 * below it.
 *
 * Gross, net and largest-position are capacity. The drawdown gauge is a *stop*:
 * crossing it does not reject an order, it halts trading entirely, so it is
 * labelled as distance-to-halt rather than as another utilisation percentage.
 *
 * The binding constraint is named on its own gauge rather than left to be
 * inferred from bar lengths — whichever is tightest is the only one that decides
 * anything, and a reader comparing bars by eye picks the wrong one when two are
 * close. If the gateway ever names a constraint none of these gauges covers, one
 * is appended for it rather than letting the tightest limit go unshown.
 */

import { fmt, pct, usd } from "@/lib/format";
import { limitTone } from "@/lib/portfolio";

interface Gauge {
  id: string;
  label: string;
  /** Rendered as the headline figure. */
  value: string;
  /** Right-hand limit text. */
  limit: string;
  /** 0–1. Values above 1 are clamped for the bar but shown honestly in text. */
  utilisation: number;
  detail: string;
  /** True when this is the constraint that binds first. */
  binding: boolean;
}

interface HeadroomBarProps {
  grossUsed: number;
  grossLimit: number;
  net: number;
  equity: number;
  drawdownUsedPct: number;
  drawdownLimitPct: number;
  cushionUsd: number;
  bindingConstraint: string;
  /** The gateway's own utilisation for whatever binds first. */
  bindingUtilisation: number;
  /**
   * Largest single-symbol exposure.
   *
   * Carried separately because the payload exposes structured headroom only for
   * gross and drawdown, while `binding_constraint` can name symbol exposure —
   * and it frequently does. A bar that showed gross at 72% and drawdown at 0%
   * while the real binder sat at 90% would read as "plenty of room" at exactly
   * the moment there is none.
   */
  largestPosition: { symbol: string; utilisation: number; remaining: number } | null;
}

/* One threshold table, in lib/portfolio.ts, shared with the book status chip and
   the limits table. Three local copies of 0.9/0.7 were three chances to
   disagree about whether 0.9 is a breach. */
const tone = limitTone;

export default function HeadroomBar({
  grossUsed,
  grossLimit,
  net,
  equity,
  drawdownUsedPct,
  drawdownLimitPct,
  cushionUsd,
  bindingConstraint,
  bindingUtilisation,
  largestPosition,
}: HeadroomBarProps) {
  const grossUtil = grossLimit > 0 ? grossUsed / grossLimit : 0;
  const drawdownUtil = drawdownLimitPct > 0 ? drawdownUsedPct / drawdownLimitPct : 0;
  // Net has no hard limit in the gateway's budget, so it is shown against gross:
  // the question net answers is "how directional is this book", not "how much
  // room is left". Inventing a limit to draw a bar against would be worse.
  const netShare = grossUsed > 0 ? Math.abs(net) / grossUsed : 0;

  const gauges: Gauge[] = [
    {
      id: "gross_exposure",
      label: "Gross exposure",
      value: usd(grossUsed, 0),
      limit: usd(grossLimit, 0),
      utilisation: grossUtil,
      detail: `${usd(Math.max(0, grossLimit - grossUsed), 0)} of capacity left`,
      binding: bindingConstraint === "gross_exposure",
    },
    {
      id: "net_exposure",
      label: "Net exposure",
      value: `${net >= 0 ? "+" : "−"}${usd(Math.abs(net), 0)}`,
      limit: `${pct(netShare, 0)} of gross`,
      utilisation: netShare,
      detail: netShare < 0.2
        ? "close to market-neutral"
        : net >= 0
          ? "directionally long"
          : "directionally short",
      binding: false,
    },
    ...(largestPosition
      ? [{
          id: "symbol_exposure",
          label: "Largest position",
          value: pct(largestPosition.utilisation, 1),
          limit: largestPosition.symbol,
          utilisation: largestPosition.utilisation,
          detail: `${usd(largestPosition.remaining, 0)} of symbol headroom left`,
          binding: bindingConstraint === "symbol_exposure",
        } as Gauge]
      : []),
    {
      id: "daily_drawdown",
      label: "Drawdown to halt",
      value: pct(drawdownUsedPct, 2),
      limit: pct(drawdownLimitPct, 1),
      utilisation: drawdownUtil,
      detail: `${usd(cushionUsd, 0)} of equity before trading stops`,
      binding: bindingConstraint === "daily_drawdown",
    },
  ];

  const covered = gauges.some((g) => g.binding);
  if (!covered && bindingUtilisation > 0) {
    // Never silently drop the constraint that decides everything.
    gauges.push({
      id: bindingConstraint,
      label: bindingConstraint.replace(/_/g, " "),
      value: pct(bindingUtilisation, 1),
      limit: "of limit",
      utilisation: bindingUtilisation,
      detail: "reported by the gateway as the tightest constraint",
      binding: true,
    });
  }

  return (
    <section className="headroom-bar" aria-label="Risk headroom">
      {gauges.map((g) => {
        const t = tone(g.utilisation);
        return (
          <div key={g.id} className={`headroom-card is-${t}${g.binding ? " is-binding" : ""}`}>
            <div className="headroom-card__head">
              <span>
                {g.label}
                {/* Named, not inferred from bar lengths. */}
                {g.binding && <em className="headroom-binding">binds first</em>}
              </span>
              <strong className="num">
                {g.value}
                <span className="muted"> / {g.limit}</span>
              </strong>
            </div>
            <div
              className={`headroom-track is-${t}`}
              role="img"
              aria-label={`${g.label}: ${fmt(Math.max(0, g.utilisation) * 100, 0)} percent of limit used. ${g.detail}.`}
            >
              <i style={{ width: `${Math.min(100, Math.max(0, g.utilisation * 100))}%` }} aria-hidden />
            </div>
            <small>
              {/* Icon + word, never colour alone. */}
              {t === "critical" && <span aria-hidden>▲ </span>}
              {g.detail}
            </small>
          </div>
        );
      })}
    </section>
  );
}
