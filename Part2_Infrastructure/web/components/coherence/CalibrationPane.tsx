"use client";

/**
 * Were the prices right? — the settled corpus, scored.
 *
 * Everything else on this tab tests whether a family of prices is internally
 * consistent. Consistency is cheap: a set of quotes can admit a probability
 * measure exactly and still be wrong about the world. This section asks the
 * other question, which needs settlement data and therefore could not be asked
 * until markets closed — of the contracts priced near a dime, how many paid?
 *
 * The whole section turns on one field, and it is the field a reader will not
 * think to check. `engine` says WHEN the price was read.
 *
 *  - `tape` reads a price quoted an hour before close and scores it against
 *    what happened. That is a forecast test.
 *  - `final_trade` reads the LAST TRADED price. A last trade happens moments
 *    before settlement, when the answer is largely known already, so the score
 *    is a measurement of how fast this exchange converges on an answer that is
 *    in plain sight — not of whether it saw anything coming.
 *
 * On the live sample the second engine returns a Brier of 0.00010533 and a
 * skill of 0.99935238, which reads as a spectacular forecaster and is nothing
 * of the sort. So the caveat is not a footnote here: it is a banner above the
 * numbers, it is repeated in the cell beside every figure it invalidates, and
 * `median_horizon_s` — zero, meaning the price was read AT settlement — is
 * printed as the tell rather than buried.
 *
 * The composition table is disclosure of the same kind. A corpus is not a
 * random sample of forecasts; it is whatever the watched series happened to
 * settle, and when one ticker is most of it the score is mostly a score of that
 * ticker.
 */

import { pct } from "@/lib/format";
import { priceLabel } from "@/lib/coherence/fixed-point";
import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { StateChip } from "./Figure";
import MurphyBars from "./MurphyBars";
import ReliabilityDiagram, { decimalLabel, statValue } from "./ReliabilityDiagram";

const PLACES = 8;
/** A weighted least-squares line through two points is fitted, not measured. */
const SLOPE_MINIMUM_BANDS = 3;

interface Fact {
  label: string;
  value: string;
  note: string;
}

function horizonText(seconds: number | null): string {
  if (seconds == null) return "the horizon was not recorded";
  if (seconds === 0) return "the median price was read at settlement";
  if (seconds < 120) return `the median price was read ${seconds}s before close`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `the median price was read ${minutes} minutes before close`;
  return `the median price was read ${Math.round(minutes / 60)} hours before close`;
}

/** What a fitted slope says about the shape of the mispricing, in words. */
function slopeReading(slope: string | null, populated: number, bands: number): string {
  if (slope == null) {
    return populated < SLOPE_MINIMUM_BANDS
      ? `withheld: only ${populated} of the ${bands} bands carry a settled market, and a weighted least-squares line needs at least ${SLOPE_MINIMUM_BANDS} points before it is a measurement rather than a drawing through whatever is there`
      : "withheld by the engine; it is not being shown as one";
  }
  const value = statValue(slope);
  if (value == null) return "the engine sent a slope this pane could not read, so it is not shown";
  if (value > 1.02) {
    return "steeper than the diagonal, which is the classic favourite–longshot shape: longshots are overbet, so they happen LESS often than their price says, and favourites are underbet, so they happen MORE often. The line through those points tilts up harder than the 45°";
  }
  if (value < 0.98) {
    return "flatter than the diagonal — the reverse of the favourite–longshot shape. The outcomes spread less than the prices did, so the prices were more confident than the world turned out to be";
  }
  return "indistinguishable from 1 at two decimal places, which is the shape a well calibrated venue has";
}

export default function CalibrationPane({ active }: { active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceCalibration>("/api/gateway/coherence/calibration", active);

  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The settled corpus could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Scoring the settled markets…</p>;
  if (data.state !== "available") {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> {data.detail || "Nothing has settled yet, so there is nothing to score."}
      </p>
    );
  }

  const convergence = data.engine === "final_trade";
  const forecast = data.engine === "tape";
  const populated = data.bins.filter((bin) => bin.count > 0).length;
  const corpus = data.composition.reduce((sum, row) => sum + row.count, 0);
  const heaviest = data.composition.reduce<{ series_ticker: string; count: number } | null>(
    (carry, row) => (carry == null || row.count > carry.count ? row : carry),
    null,
  );

  const facts: Fact[] = [
    {
      label: "Brier score",
      value: decimalLabel(data.brier, PLACES),
      note: convergence
        ? "Not a forecast score. These are last traded prices, so this measures how close the exchange had already come to the answer."
        : "Mean squared error of the price against the outcome. Lower is better, and it is not comparable to a Brier score from a different set of questions.",
    },
    {
      label: "Skill against the base rate",
      value: decimalLabel(data.skill, PLACES),
      note: convergence
        ? "The fraction of the question's uncertainty these prices removed — but they were read at settlement, so almost all of it was removed by time, not by judgement."
        : "The fraction of the question's uncertainty the prices removed, against always quoting the base rate. Negative would mean worse than knowing nothing.",
    },
    {
      label: "Base rate",
      value: decimalLabel(data.base_rate),
      note: `How often YES happened across all ${data.count} settled markets. Uncertainty in the decomposition is this times one minus this, and it belongs to the questions rather than to the exchange.`,
    },
    {
      label: "Favourite–longshot slope",
      value: decimalLabel(data.bias_slope),
      note: `1 is perfect. Here it is ${slopeReading(data.bias_slope, populated, data.bins.length)}.`,
    },
    {
      label: "Settled markets scored",
      value: String(data.count),
      note: `${populated} of the ${data.bins.length} price bands carry at least one of them; the other ${data.bins.length - populated} were never quoted.`,
    },
    {
      label: "Median horizon",
      value: data.median_horizon_s == null ? "—" : `${data.median_horizon_s}s`,
      note:
        data.median_horizon_s === 0
          ? "Zero. This is the tell: the price was read at settlement, so nothing here is a forecast."
          : `${horizonText(data.median_horizon_s)}, which is how far ahead of the answer these prices were standing.`,
    },
  ];

  return (
    <div className="coh-calib">
      <div className="coh-status__chips">
        <StateChip
          mark={convergence ? "▲" : forecast ? "✓" : "◌"}
          word="Engine"
          value={data.engine}
          tone={convergence ? "warn" : forecast ? "good" : "muted"}
        />
        <StateChip mark="●" word="Settled markets" value={String(data.count)} tone="muted" />
        <StateChip
          mark={populated < SLOPE_MINIMUM_BANDS ? "◌" : "●"}
          word="Bands quoted"
          value={`${populated} of ${data.bins.length}`}
          tone={populated < SLOPE_MINIMUM_BANDS ? "warn" : "muted"}
        />
        <StateChip
          mark={data.thin ? "▲" : "●"}
          word={data.thin ? "Thin sample" : "Sample not flagged thin"}
          value={data.thin ? "too few to conclude from" : null}
          tone={data.thin ? "warn" : "muted"}
        />
      </div>

      <section className={`coh-calib__engine ${convergence ? "is-warn" : forecast ? "is-good" : "is-muted"}`}>
        <h3 className="coh-calib__engine-head">
          <span aria-hidden="true">{convergence ? "▲" : forecast ? "✓" : "◌"}</span>{" "}
          {convergence
            ? "Not a forecast test — these are last traded prices"
            : forecast
              ? "A forecast test — prices quoted before the answer was known"
              : `Unrecognised engine: ${data.engine}`}
        </h3>
        {convergence ? (
          <p className="coh-calib__engine-body">
            A last trade happens moments before settlement, when the answer is largely in plain sight, and{" "}
            {horizonText(data.median_horizon_s)}. So the Brier score of {decimalLabel(data.brier, PLACES)} and the
            skill of {decimalLabel(data.skill, PLACES)} below say how quickly this exchange converges on an answer it
            can already see. They do not say the market forecasts well, they are not evidence that it does, and they
            must not be quoted as though they were. Run the score on the <code>tape</code> engine — prices quoted an
            hour before close — to ask the forecasting question.
          </p>
        ) : forecast ? (
          <p className="coh-calib__engine-body">
            Prices were read from the recorded tape before close and scored against what settled, so{" "}
            {horizonText(data.median_horizon_s)}. This is a real forecast test: the score below is about foresight
            rather than about how fast the exchange converges.
          </p>
        ) : (
          <p className="coh-calib__engine-body">
            This pane knows two engines. <code>tape</code> scores prices quoted before close and is a forecast test;{" "}
            <code>final_trade</code> scores last traded prices and is not. It cannot tell which of those{" "}
            <code>{data.engine}</code> is, so nothing below should be read as a forecast score until it can.
          </p>
        )}
      </section>

      <dl className="coh-calib__facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              <b className="coh-calib__figurevalue">{fact.value}</b>
              <span className="coh-calib__caveat">{fact.note}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="coh-calib__figures">
        <ReliabilityDiagram
          bins={data.bins}
          map={data.isotonic_map}
          baseRate={data.base_rate}
          horizonNote={
            convergence
              ? "last traded prices, so the x axis is what the exchange had already converged on"
              : horizonText(data.median_horizon_s)
          }
        />
        <MurphyBars
          brier={data.brier}
          reliability={data.reliability}
          resolution={data.resolution}
          uncertainty={data.uncertainty}
          binning={data.binning}
          bandCount={data.bins.length}
        />
      </div>

      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Every price band. A band with no settled market has no outcome rate, and its cells are dashed rather than
            zeroed — nobody quoted there, which is a different fact from nothing happening there.
          </caption>
          <thead>
            <tr>
              <th scope="col">Band</th>
              <th scope="col" className="num">Settled</th>
              <th scope="col" className="num">Mean price</th>
              <th scope="col" className="num">Happened</th>
              <th scope="col" className="num">Outcome minus price</th>
              <th scope="col">Reading</th>
            </tr>
          </thead>
          <tbody>
            {data.bins.map((bin) => {
              const deviation = statValue(bin.deviation);
              return (
                <tr key={bin.label}>
                  <th scope="row">{`${priceLabel(bin.low)} to ${priceLabel(bin.high)}`}</th>
                  <td className="num">{bin.count}</td>
                  <td className="num">{decimalLabel(bin.mean_forecast)}</td>
                  <td className="num">{decimalLabel(bin.outcome_rate)}</td>
                  <td className="num">{decimalLabel(bin.deviation)}</td>
                  <td>
                    {bin.count === 0 ? (
                      <>
                        <span aria-hidden="true">◌</span> nobody quoted this band
                      </>
                    ) : deviation == null ? (
                      <>
                        <span aria-hidden="true">◌</span> no deviation was computed
                      </>
                    ) : deviation > 0 ? (
                      "happened more often than priced"
                    ) : deviation < 0 ? (
                      "happened less often than priced"
                    ) : (
                      "priced exactly"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="coh-calib__composition">
        <h3 className="coh-calib__engine-head">What was scored, and what that leaves out</h3>
        <p className="coh-event__note">
          A corpus is not a random sample of forecasts. These {data.count} markets are whatever the watched series
          happened to settle over the recorded window, so every number above is a score of THIS mixture and does not
          carry to the rest of the exchange.
          {heaviest && corpus > 0
            ? ` ${heaviest.series_ticker} alone is ${heaviest.count} of ${corpus} (${pct(heaviest.count / corpus)}), so this is mostly a score of that series.`
            : ""}
        </p>
        {data.composition.length ? (
          <div className="table-wrap">
            <table className="coh-table">
              <caption className="coh-table__caption">Which series the settled markets came from</caption>
              <thead>
                <tr>
                  <th scope="col">Series</th>
                  <th scope="col" className="num">Settled markets</th>
                  <th scope="col" className="num">Share of the corpus</th>
                  <th scope="col" className="num">Its own slope</th>
                </tr>
              </thead>
              <tbody>
                {data.composition.map((row) => {
                  // The aggregate slope averages series that are not the same
                  // question, so two of them can point opposite ways and still
                  // sit at one together. A series without enough settled
                  // markets to populate three price bands has no slope, and
                  // gets a dash rather than the corpus figure standing in.
                  const own = (data.bias_by_series ?? []).find(
                    (item) => item.series_ticker === row.series_ticker,
                  );
                  return (
                    <tr key={row.series_ticker}>
                      <th scope="row">{row.series_ticker}</th>
                      <td className="num">{row.count}</td>
                      <td className="num">{corpus > 0 ? pct(row.count / corpus) : "—"}</td>
                      <td className="num">{own ? own.slope.slice(0, 6) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="coh-event__note">
            <span aria-hidden="true">◌</span> The engine did not say which series these markets came from, so the
            selection behind the score cannot be checked from here.
          </p>
        )}
      </section>

      {data.isotonic_map.length ? (
        <p className="coh-event__note">
          The isotonic correction drawn on the diagram is the recalibration this data supports: {data.isotonic_map.length}{" "}
          step(s), non-decreasing by construction, because a higher price that mapped to a lower probability would make
          the corrected prices incoherent in exactly the way the rest of this tab tests for. It repairs the reliability
          term and nothing else; resolution is not recoverable by relabelling prices.
        </p>
      ) : (
        <p className="coh-event__note">
          <span aria-hidden="true">◌</span> No isotonic correction was returned, so the diagram carries the raw bands
          only.
        </p>
      )}

      <p className="coh-event__note">
        <span aria-hidden="true">◌</span> What the engine says about this run, in its own words: {data.detail}
      </p>
    </div>
  );
}
