"use client";

/**
 * The Kalshi arm: how long a coherence violation survives, and the tape of them.
 *
 * Split out of `DiffusionPane` when Diffusion's seven flat views became three
 * groups. The pane was 346 lines against a 400 ceiling, and the house rule is to
 * SPLIT rather than shave prose — the seam is the one the section already had,
 * since these two views are the only ones fed by the `episodes` read and neither
 * needs anything the announcement arm holds.
 *
 * THE SURVIVAL CURVE IS DRAWN FROM CLOSED EPISODES ONLY. An episode still
 * running is a lower bound on a lifetime, not a measurement, and mixing bounds
 * with measurements pulls the curve down by exactly the long tail it exists to
 * show. That is why the chips count "still open" separately rather than folding
 * them in, and why the tape below can report a half-life for some episodes and
 * refuse it for others: one that jumped straight to coherent never halved, and a
 * half-life read off the final interval would invent a decay nobody observed.
 *
 * Why any of it matters: if the median lifetime is under the round trip, the
 * opportunity was never available and the race was lost before it was entered.
 * That is worth knowing before an executor is built, not after.
 */

import { episodesToSamples } from "@/lib/coherence/absorption";
import type { CoherenceEpisodes, CoherenceIndexSeries, CoherenceStatus } from "@/lib/coherence/types";
import Figure, { FigureEmpty, Plot, StateChip } from "../Figure";
import EpisodeTape from "./EpisodeTape";
import EpisodeWatch from "./EpisodeWatch";
import ValueStrip from "../ValueStrip";

const HEIGHT = 178;
// `top` carries the round-trip label's own baseline: it sets at the 14px note
// rung, so anything less than that draws the word above y=0 and the viewBox
// cuts it off. HEIGHT rose by the same amount, so the plot area is unchanged.
const MARGIN = { top: 30, right: 6, bottom: 22, left: 6 };

function SurvivalChart({ data }: { data: CoherenceEpisodes }) {
  const points = data.survival.map((point) => ({ t: Number(point.t_s), s: Number(point.surviving) }));
  if (points.length < 2) {
    return (
      <Figure
        caption="How long a violation survives"
        ariaLabel="Not enough closed episodes to draw a survival curve"
        missing={data.median_withheld_reason}
      >
        <FigureEmpty reason="A curve needs at least two closed episodes." />
      </Figure>
    );
  }

  const median = data.median_s ? Number(data.median_s) : null;
  const roundTrip = Number(data.round_trip_s);
  // The axis has to reach the round trip even when every episode is shorter
  // than it, or the rule that says "never available" would be drawn off the
  // plot exactly when it is most worth seeing.
  const longest = Math.max(...points.map((point) => point.t), Number.isFinite(roundTrip) ? roundTrip : 0, 1);
  const base = HEIGHT - MARGIN.bottom;
  const y = (s: number) => base - s * (base - MARGIN.top);

  return (
    <Figure
      caption="How long a violation survives, from recorded episodes"
      ariaLabel={`Survival curve over ${data.episodes.length} closed episodes, longest ${longest} seconds`}
      reading={data.verdict}
      missing={data.median_withheld_reason}
    >
      <Plot height={HEIGHT}>
        {(plotW) => {
          const plotWidth = Math.max(1, plotW - MARGIN.left - MARGIN.right);
          const x = (t: number) => MARGIN.left + (t / longest) * plotWidth;
          // A step, not a line: survival is constant between observed lifetimes,
          // and a smooth curve would draw episodes ending at times nothing was
          // measured.
          let path = `M${MARGIN.left},${y(1).toFixed(2)}`;
          let previous = 1;
          for (const point of points) {
            path += `L${x(point.t).toFixed(2)},${y(previous).toFixed(2)}L${x(point.t).toFixed(2)},${y(point.s).toFixed(2)}`;
            previous = point.s;
          }
          return (
            <>
        <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
        <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={y(0.5)} y2={y(0.5)} className="coh-survival__half">
          <title>Half the recorded violations were still open at this height</title>
        </line>
        {/* A hover line on the three marks (fourth review of 2026-08-24). The
            step is one mark, not a row of them, so its title carries the whole
            curve's shape rather than a point on it — a per-point hit target
            would need invisible rects over a curve whose x is time, and the
            episode table behind the next view's summary is where a reader
            goes for one episode. */}
        <path d={path} className="coh-survival__step" fill="none">
          <title>{`${data.episodes.length} closed episodes, longest ${longest}s; the step holds between observed lifetimes because nothing was measured in between`}</title>
        </path>
        {median != null ? (
          <line x1={x(median)} x2={x(median)} y1={MARGIN.top} y2={base} className="coh-survival__median">
            <title>{`Median lifetime ${median}s, against a ${data.round_trip_s}s round trip`}</title>
          </line>
        ) : null}
        {/* A reference line's own words, not a tick numeral: 13px note rung
            (coh-svg-note, 14r). The terminal "{longest}s" stays a tick. */}
        <text x={MARGIN.left} y={y(0.5) - 2} className="coh-svg-note">
          half still open
        </text>
        {/* THE ROUND TRIP, DRAWN. It was a chip and a tooltip, while the file's
            own argument is that a median lifetime under the round trip means
            the race was lost before it was entered — a comparison the figure
            could not make because only one of the two was on it. */}
        {Number.isFinite(roundTrip) ? (
          <>
            <line x1={x(roundTrip)} x2={x(roundTrip)} y1={MARGIN.top} y2={base} className="coh-survival__median">
              <title>
                {`Round trip ${data.round_trip_s}s — a lifetime left of this rule was over before a taker could reach it`}
              </title>
            </line>
            <text x={x(roundTrip)} y={MARGIN.top - 3} textAnchor="middle" className="coh-svg-note">
              round trip
            </text>
          </>
        ) : null}
        <text x={plotW - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="coh-ladder__tick">
          {longest}s
        </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

/** The Kalshi arm, one view at a time: the survival curve under its chips, or
 *  the episode table with its half-life note. One `episodes` read feeds both. */
export default function KalshiArm({ data, error, view, status, index }: {
  data: CoherenceEpisodes | null;
  error: string | null;
  view: "survival" | "episodes";
  /** The recorder behind the tape; drawn when the tape has nothing closed. */
  status: CoherenceStatus | null;
  /** The coherence index the episode ledger is downstream of. */
  index: CoherenceIndexSeries | null;
}) {
  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> Episodes could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Reading the episodes…</p>;

  const samples = episodesToSamples(data.episodes);
  const withHalfLife = samples.filter((sample) => sample.half_life_s != null);

  // NOTHING CLOSED IS THE LIVE CASE, and it is a property of the tape rather
  // than of the view. Both views used to fall through to the SAME watch figure
  // when the tape was empty, which is two buttons for one drawing — a broken
  // control. They answer different questions and now draw different things
  // even with nothing closed: Survival reports the watch and the window an
  // episode must outlive to be seen at all, Episodes reports the coherence
  // index the episode ledger is downstream of, which is live.
  if (!data.episodes.length) {
    return view === "survival"
      // `index` reaches this branch from 2026-08-26. It was already fetched by
      // the section and already in these props, and was handed only to the
      // Episodes branch — so the biggest live dataset on the section was one
      // line away from the view that had nothing live to draw.
      ? <EpisodeWatch data={data} status={status} points={index?.points ?? []} />
      : <EpisodeTape points={index?.points ?? []} series={index?.series ?? []} />;
  }

  if (view === "survival") {
    return (
      <>
        {/* The chips ride with the curve, not the table: they are the arm's
            headline state and the curve is its headline drawing. */}
        <div className="coh-status__chips">
          <StateChip mark="●" word="Closed episodes" value={String(data.episodes.length)} tone="muted" />
          <StateChip mark="◌" word="Still open" value={String(data.open_episodes)} tone="muted" />
          <StateChip
            mark={data.median_s ? "✓" : "◌"}
            word="Median lifetime"
            value={data.median_s ? `${data.median_s}s` : "withheld"}
            tone={data.median_s ? "good" : "muted"}
          />
          {/* MEASURED OR ASSUMED, said in the chip's own word rather than left
              to the reader. It was hard-coded to "assumed" because it always
              was one: the gateway echoed a query parameter's default back and
              nothing had timed it. The gateway measures its own read round trip
              now, so the chip reports which of the two this payload carries —
              and a measured READ is a lower bound on an ORDER, which is why
              even the measured word is not "round trip measured" but names the
              read it came from. */}
          <StateChip
            mark="→"
            word={data.round_trip_source === "measured" ? "Round trip, timed reads" : "Round trip assumed"}
            value={data.round_trip_source === "measured"
              ? `${data.round_trip_s}s over ${data.round_trip_samples ?? 0} reads`
              : `${data.round_trip_s}s`}
            tone="muted"
          />
        </div>

        <SurvivalChart data={data} />
      </>
    );
  }

  return (
    <>
      {data.episodes.length ? (
        <>
        {/* The lifetime column drawn (third review, 2026-08-24): the section's
            whole question is how long these lived. */}
        <ValueStrip
          caption="How long each closed episode lived"
          ariaLabel={`Lifetime in seconds for ${data.episodes.length} closed episodes`}
          rows={data.episodes.map((episode) => ({
            label: episode.event_ticker,
            value: episode.lifetime_s == null ? null : Number(episode.lifetime_s),
            text: episode.lifetime_s ? `${episode.lifetime_s}s` : "—",
            title: `${episode.event_ticker}${episode.family ? ` (${episode.family})` : ""}: peak distance ${episode.peak_ci ?? "—"}, peak net edge ${episode.peak_net_edge_dollars ?? "—"}`,
            noBar: episode.lifetime_s == null ? "no lifetime recorded" : undefined,
          }))}
        />
        {/* The strip draws the lifetimes, which is the section's whole
            question, so the five other columns go behind a summary (fourth
            review of 2026-08-24). They are per-episode detail — which family,
            which constraint, the peak distance, the peak edge and the
            half-life — and a reader asking "was any of this available for
            long enough to trade" is answered by the bars alone. */}
        <details className="disclosure">
          <summary>Each closed episode’s event, family, peak and half-life</summary>
        {/* Focusable, like the findings table's wrap. Six columns with four
            mono numerals is the widest table on the tab, so it is the one most
            likely to scroll — and until 2026-08-25 it was the only scrolling
            region here with no keyboard route into it. */}
        <div className="table-wrap" tabIndex={0}>
          <table className="coh-table table-fixed">
            <caption className="coh-table__caption">
              Every closed episode, with the time it took the dislocation to halve
            </caption>
            <thead>
              {/* THE FIRST TWO WERE WRONG UNTIL 2026-08-25, and the counts
                  matching is why nothing caught it: six headers over six cells,
                  shifted by one. Column one is the row header and holds
                  `event_ticker`, so it is the Event; column two holds `family`.
                  "Constraint" named no field in the payload at all. Measured
                  against the live episode row rather than reasoned about. */}
              <tr>
                <th scope="col" className="w-3/12">Event</th>
                <th scope="col" className="w-2/12">Family</th>
                <th scope="col" className="num w-2/12">Lifetime</th>
                <th scope="col" className="num w-2/12">Peak distance</th>
                <th scope="col" className="num w-2/12">Peak net edge</th>
                <th scope="col" className="num w-1/12">Half-life</th>
              </tr>
            </thead>
            <tbody>
              {data.episodes.map((episode, index) => (
                <tr key={`${episode.component_id}-${episode.opened_ts_ns}`}>
                  <th scope="row">{episode.event_ticker}</th>
                  <td>{episode.family || "—"}</td>
                  <td className="num">{episode.lifetime_s ? `${episode.lifetime_s}s` : "—"}</td>
                  <td className="num">{episode.peak_ci ?? "—"}</td>
                  <td className="num">{episode.peak_net_edge_dollars ?? "—"}</td>
                  <td className="num">
                    {samples[index]?.half_life_s != null ? `${samples[index].half_life_s}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </details>
        </>
      ) : (
        <p className="console-empty">
          <span aria-hidden="true">◌</span> {data.notes[0] ?? "No violation has opened and closed yet."}
        </p>
      )}

      {data.episodes.length && withHalfLife.length < data.episodes.length ? (
        <p className="coh-event__note">
          <span aria-hidden="true">◌</span> {data.episodes.length - withHalfLife.length} of{" "}
          {data.episodes.length} episodes have no half-life: they jumped straight to coherent, and a half-life read
          off the final interval would invent a decay nobody observed.
        </p>
      ) : null}
    </>
  );
}
