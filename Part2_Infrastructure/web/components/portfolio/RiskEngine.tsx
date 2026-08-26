"use client";

/**
 * What the book is actually risking.
 *
 * Two numbers are shown for the same quantity on purpose. Parametric VaR assumes
 * normality; historical VaR replays the current book over real returns and
 * assumes nothing. In crypto the second is routinely worse, and the gap between
 * them *is* the fat tail. Reporting only the parametric figure would be the
 * tidier screen and the more dangerous one.
 *
 * Three cards, split by question rather than by widget: this one answers *how
 * much can this book lose*, RiskContributions answers *who is causing it*, and
 * CorrelationMatrix answers *why does it all move together*. They were one card
 * holding a whole page.
 *
 * This component calls no hooks, which is what makes its three early returns
 * safe. Keep it that way — anything needing state belongs in a child.
 */

import CorrelationMatrix from "@/components/portfolio/CorrelationMatrix";
import RiskContributions from "@/components/portfolio/RiskContributions";
import StatTile from "@/components/StatTile";
import { pct, usd } from "@/lib/format";
import VarBacktestChart from "@/components/portfolio/VarBacktestChart";
import ExceedanceCalendar from "@/components/risk/ExceedanceCalendar";
import type { CovarianceModel, PortfolioRisk, VarBacktest, VarSeries } from "@/lib/portfolio-risk";

interface RiskEngineProps {
  risk: PortfolioRisk | null;
  model: CovarianceModel | null;
  loading: boolean;
  /** Symbols whose history could not be fetched — excluded from every figure. */
  missing: string[];
  /**
   * Kupiec back-test of the VaR figure above.
   *
   * Without it every number on this card is an unverified claim: a model that
   * has never been scored against realised losses is an opinion with a
   * confidence interval printed on it.
   */
  validation?: VarBacktest | null;
  /**
   * The per-observation series behind `validation`.
   *
   * The chart IS a sibling in the workspace now — it has its own subtab — so
   * the reason this comment used to give for the layout ("one card fed by one
   * prop source") describes a card that no longer exists. The invariant it was
   * protecting survives on a different footing: `RiskWorkspace.riskEngine(part)`
   * is the single call site and hands every part one snapshot, so the forecast
   * and the scorecard that grades it still cannot describe different data.
   * Rejected alternative: mounting `VarBacktestChart` straight from the
   * workspace, which is fewer lines and gives the chart a second prop path —
   * turning a guarantee held by construction into one held by convention.
   */
  varSeries?: VarSeries | null;
  /** True when the notionals came from the generated sandbox book. */
  sandbox?: boolean;
  /**
   * Which third of the risk engine to render.
   *
   * One component, three subtabs, because all three read the same `risk`,
   * `model` and `varSeries` props and splitting them into three components
   * would mean three call sites that could be handed different snapshots. Same
   * shape as `DeveloperOverview`'s `part`. The id behind `model` did not move
   * when its rail label became "Risk engine" — ids are deep links, labels are
   * prose, and only one of the two is allowed to change.
   */
  part?: "model" | "diagram" | "drivers";
}

const ZONE_STYLE: Record<string, { glyph: string; label: string; tone: string }> = {
  green: { glyph: "✓", label: "validated", tone: "var(--success-text)" },
  yellow: { glyph: "▲", label: "on watch", tone: "var(--warning-text)" },
  red: { glyph: "✕", label: "rejected", tone: "var(--critical-text)" },
};

/**
 * One heading per part, so the two early returns below refuse in the name of
 * the subtab the reader actually opened.
 *
 * A heading map ALONE would make things worse, which is why the bodies branch
 * too: the covariance floor is 20 aligned observations and the diagram's is 80
 * bars, and heading the covariance refusal "Risk diagram" would pair one
 * subtab's name with the other subtab's threshold — a wrong number stated
 * confidently, which is worse than the wrong heading it replaced.
 */
const HEADING: Record<"model" | "diagram" | "drivers", string> = {
  model: "Risk engine",
  diagram: "Risk diagram",
  drivers: "Risk drivers",
};

export default function RiskEngine({
  risk,
  model,
  loading,
  missing,
  validation,
  // `varSeries` and `sandbox` were declared, documented at length, and then
  // left out of this destructure — so VarBacktestChart, 361 lines of it, was
  // never mounted by anything in the app. The scalars beside it answered "did
  // the model fail more often than it should" while the one component that
  // could answer "when" sat unreferenced.
  varSeries,
  sandbox = false,
  part = "model",
}: RiskEngineProps) {
  const showModel = part === "model";
  const showDiagram = part === "diagram";
  const showDrivers = part === "drivers";

  if (loading) {
    return (
      <div className="card" aria-busy="true" aria-live="polite">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Quantitative risk</span>
            <h2>{HEADING[part]}</h2>
          </div>
        </div>
        <div className="skeleton" style={{ height: 150 }} aria-hidden />
        <span className="sr-only">
          {showDiagram
            ? "Replaying this book over its own history to score the forecast."
            : "Measuring portfolio volatility and loss estimates."}
        </span>
      </div>
    );
  }

  if (!risk || !model) {
    return (
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Quantitative risk</span>
            <h2>{HEADING[part]}</h2>
          </div>
        </div>
        {showDiagram ? (
          <p className="sub">
            No risk snapshot for this book, so there is no forecast to draw a diagram of. The band
            and the realised losses under it are built from the same aligned history the covariance
            needs, and none was available. Nothing is drawn rather than an axis with no series on it.
          </p>
        ) : (
          <p className="sub">
            Not enough price history for a covariance: this needs at least 20 aligned observations per
            instrument. Nothing is shown rather than a figure built on an assumed correlation.
          </p>
        )}
      </div>
    );
  }

  const tailGap = risk.historicalVar95 !== null ? risk.historicalVar95 - risk.var95 : null;

  return (
    <>
    {showModel && (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Quantitative risk</span>
          <h2>Risk engine</h2>
        </div>
        <span>{risk.observations} daily observations</span>
      </div>

      {/* The shared StatTile, not the hand-rolled span/strong/small dialect:
          two markup systems for the identical visual object had grown side by
          side in this workspace, and the inline critical-text colour is what
          the tile's data-tone="neg" already says. */}
      <div className="tiles stability-tiles">
        <StatTile
          label="Book volatility"
          value={pct(risk.annualisedVolatility, 1)}
          note={`annualised; ${pct(risk.volatility, 2)} per day`}
        />
        <StatTile
          label="VaR 95, 1 day"
          value={usd(risk.var95, 0)}
          note="parametric, normal assumption"
          tone="neg"
        />
        <StatTile
          label="Historical VaR 95"
          value={risk.historicalVar95 === null ? "—" : usd(risk.historicalVar95, 0)}
          note="this book replayed over real returns"
          tone="neg"
        />
        <StatTile
          label="Expected shortfall 95"
          value={risk.historicalCvar95 === null ? usd(risk.cvar95, 0) : usd(risk.historicalCvar95, 0)}
          note={risk.historicalCvar95 === null ? "parametric" : "average loss beyond VaR"}
          tone="neg"
        />
      </div>

      {tailGap !== null && tailGap > risk.var95 * 0.15 && (
        <div className="banner warn" role="status" style={{ marginTop: 12 }}>
          <span aria-hidden>!</span>
          <div>
            <strong>Realised losses are fatter than the normal model.</strong> Historical VaR is{" "}
            {usd(tailGap, 0)} worse than parametric ({pct(tailGap / Math.max(1, risk.var95), 0)} more).
            Size against the historical figure.
          </div>
        </div>
      )}

      {validation && (
        <div className="var-validation">
          <div className="var-validation__head">
            <span>VaR model backtest</span>
            {/* icon + word + colour, never colour alone */}
            <strong style={{ color: ZONE_STYLE[validation.zone].tone }}>
              <span aria-hidden>{ZONE_STYLE[validation.zone].glyph}</span>{" "}
              {ZONE_STYLE[validation.zone].label}
            </strong>
          </div>
          <p>
            {validation.exceptions} exceptions in {validation.observations} observations, against{" "}
            {validation.expectedExceptions} expected at 95%. Kupiec p ={" "}
            {validation.kupiecPValue.toFixed(3)}.
          </p>
          <p className="research-note">
            {validation.verdict} Scored on the next bar, never on data it was fitted to.
          </p>
        </div>
      )}

      {missing.length > 0 && (
        <p className="research-note">
          Excluded for want of price history: {missing.join(", ")}. Total risk is understated by
          whatever those carry.
        </p>
      )}

    </div>
    )}

    {showDiagram && (varSeries ? (
      <>
        <VarBacktestChart
          series={varSeries}
          validation={validation ?? null}
          sandbox={sandbox}
          missing={missing}
        />
        {/* The other half of the verdict. The band above says whether the model
            was tight; this says whether its breaches came at the promised rate
            and whether they bunched — which Kupiec, scoring the count alone,
            cannot tell apart. Same series, same validation, drawn once each. */}
        <ExceedanceCalendar series={varSeries} validation={validation ?? null} />
      </>
    ) : (
      /* The null state is not optional. `rollingVarSeries` refuses twice
         (var-validation.ts:176, :179) and only the second refusal is reachable
         from here: a non-null `risk` already proves one held instrument cleared
         the covariance's own 20-bar floor, so `usable` cannot be empty and what
         is left is the 80-bar window. Naming that reachable reason with its
         number is what separates "this book is too new" from "this is broken".
         REJECTED: rendering nothing, which is what shipped before the split.
         There the missing chart hid behind four populated tiles in the same
         card; on a subtab of its own it is a kicker over blank space, which is
         the exact shape disclosure-risk.test.ts:20 was written against. */
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Quantitative risk</span>
            <h2>Risk diagram</h2>
          </div>
          <span>{risk.observations} daily observations</span>
        </div>
        <p className="sub">
          No diagram: the rolling band needs 80 daily bars from the shortest history it aligns
          over — 60 to fit the first sigma and 20 more to score that forecast against what
          actually happened — and this book is under that floor. The covariance above aligned{" "}
          {risk.observations} daily observations.
          {missing.length > 0
            && ` ${missing.join(", ")} carried too little history to enter even that count.`}
          {" "}Nothing is drawn rather than a band fitted to a window that never closed.
        </p>
      </div>
    ))}

    {showDrivers && (
      /* Two cards, one row, on a panel of their own. Sharing a row with the
         backtest chart gave the contribution table a third of the width and a
         horizontal scrollbar inside its own card; here each gets ~570px, which
         the six columns and the heatmap both fit with room over. */
      <div className="compact-grid-2col">
        <RiskContributions contributions={risk.contributions} />
        <CorrelationMatrix model={model} worst={risk.worstCorrelation} observations={risk.observations} />
      </div>
    )}
    </>
  );
}
