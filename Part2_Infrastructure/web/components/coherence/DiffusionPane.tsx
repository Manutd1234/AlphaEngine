"use client";

/**
 * How fast this market absorbs information — the honest gate on the engine.
 *
 * Every coherence violation is an episode: the prices admitted a Dutch book,
 * then they did not. The distribution of those lifetimes decides whether any of
 * this is a trading system or a screenshot. If the median is under the round
 * trip, the opportunity was never available and the race was lost before it was
 * entered — and that is worth knowing before an executor is built, not after.
 *
 * The survival curve is drawn from closed episodes only. An episode still
 * running is a lower bound on a lifetime, not a measurement, and mixing bounds
 * with measurements pulls the curve down by exactly the long tail it exists to
 * show.
 *
 * This section is also where the information-diffusion work lands. The samples
 * here and the samples from an earnings or rate-decision window are the same
 * shape — `lib/coherence/absorption.ts` is the contract — so one estimator runs
 * over both and the comparison between venues is the interesting part.
 *
 * One flat switcher, six peers, rather than a venue control with a per-arm
 * control stacked under it: two `.seg` controls in a column read as one broken
 * control, so the arm lives in the button's own words ("Kalshi survival")
 * instead of in a level of its own.
 *
 * FOUR PEERS UNTIL 2026-08-24, THEN THREE, THEN SIX, NOW SEVEN — every move
 * inside one day, and the last one is a return. Findings left in the morning to
 * be the `findings` rail section, because the study's verdict was the one result
 * on this engine a reader could not link to from behind a `.seg`; the merge that
 * afternoon brought it here as the seventh view, and `FindingsSection` — a
 * wrapper that existed only to give it a head — is deleted.
 * `RELOCATED_SECTIONS` is what still resolves `#coherence/findings`, and it
 * still resolves to this section: the split that evening left Diffusion on the
 * Proofs rail, where an absorption estimate is one of the things this engine
 * argues rather than one of the things the venue quotes.
 *
 * The second pass ("every single one of these tabs are so cluttered … i dont
 * want to keep scrolling") split what remained by the rule that one view is one
 * figure or one table: Absorption stacked the curve, the attrition bars and the
 * meetings table — three screens — and Kalshi episodes stacked the survival
 * curve over the episode table. Each stacked unit is a peer, and the reads did
 * not multiply: the ledger feeds Absorption, Noise floor and Meetings off one
 * gate, the episodes feed the two Kalshi views off another, Findings owns its
 * own and gates it on itself, and Mechanism still reads nothing at all.
 *
 * THE FOURTH REVIEW, and the one thing it changed about this section's shape:
 * nothing. Seven views, each already one figure or one table, so the pass was
 * the drawings and the hiding — every mark on the two custom SVGs here and on
 * the announcement arm's three now carries its own hover line, and the two
 * long tables (the meetings, the closed episodes) sit behind a `<details>`
 * whose summary counts their rows. The strips above them draw each table's
 * decisive column, which is what makes hiding the rest honest.
 *
 * SEVEN VIEWS IS THE WIDEST SWITCHER ON THE DESK — wider than Dutch book's six
 * — and `14r` says so at the wrap rule, which it did not until this pass: that
 * block named `.coh-certificate` and `.coh-calib` by hand and had been calling
 * six the widest since the hour it was written. It now wraps every
 * section-level seg on this tab by role.
 *
 * Findings keeps a switcher of its own — the dot plot, the findings table and
 * the instrument audit — because those three are readings of ONE study rather
 * than peers of the two arms, and flattening them would put ten buttons on this
 * section's rail with three of them belonging to a different question.
 */

import { useMeasuredWidth } from "@/components/chart-kit";
import { useState } from "react";

import { episodesToSamples } from "@/lib/coherence/absorption";
import type { CoherenceEpisodes } from "@/lib/coherence/types";
import { absorptionRoute, episodesRoute } from "@/lib/coherence/routes";
import PaneHead from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, StateChip } from "./Figure";
import ValueStrip from "./ValueStrip";
import FindingsPane from "./diffusion/FindingsPane";
import InformationDiffusionPane from "./diffusion/InformationDiffusionPane";
import type { AbsorptionRead } from "./diffusion/types";

const HEIGHT = 160;
const MARGIN = { top: 12, right: 6, bottom: 22, left: 6 };

function SurvivalChart({ data }: { data: CoherenceEpisodes }) {
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);
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

  const longest = Math.max(...points.map((point) => point.t), 1);
  const plotWidth = plotW - MARGIN.left - MARGIN.right;
  const base = HEIGHT - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + (t / longest) * plotWidth;
  const y = (s: number) => base - s * (base - MARGIN.top);

  // A step, not a line: survival is constant between observed lifetimes, and a
  // smooth curve would draw episodes ending at times nothing was measured.
  let path = `M${MARGIN.left},${y(1).toFixed(2)}`;
  let previous = 1;
  for (const point of points) {
    path += `L${x(point.t).toFixed(2)},${y(previous).toFixed(2)}L${x(point.t).toFixed(2)},${y(point.s).toFixed(2)}`;
    previous = point.s;
  }

  const median = data.median_s ? Number(data.median_s) : null;

  return (
    <Figure
      caption="How long a violation survives, from recorded episodes"
      ariaLabel={`Survival curve over ${data.episodes.length} closed episodes, longest ${longest} seconds`}
      reading={data.verdict}
      missing={data.median_withheld_reason}
    >
      <div ref={plotRef} style={{ width: "100%" }}>
        <svg viewBox={`0 0 ${plotW} ${HEIGHT}`} width={plotW} height={HEIGHT} className="coh-survival">
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
        <text x={plotW - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="coh-ladder__tick">
          {longest}s
        </text>
        </svg>
      </div>
    </Figure>
  );
}

/** The Kalshi arm, one view at a time: the survival curve under its chips, or
 *  the episode table with its half-life note. One `episodes` read feeds both. */
function KalshiEpisodes({ data, error, view }: {
  data: CoherenceEpisodes | null;
  error: string | null;
  view: "survival" | "episodes";
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
          <StateChip mark="→" word="Round trip assumed" value={`${data.round_trip_s}s`} tone="muted" />
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
          <summary>{`Each closed episode's family, constraint, peak and half-life, ${data.episodes.length} rows`}</summary>
        <div className="table-wrap">
          <table className="coh-table">
            <caption className="coh-table__caption">
              Every closed episode, with the time it took the dislocation to halve
            </caption>
            <thead>
              <tr>
                <th scope="col">Family</th>
                <th scope="col">Constraint</th>
                <th scope="col" className="num">Lifetime</th>
                <th scope="col" className="num">Peak distance</th>
                <th scope="col" className="num">Peak net edge</th>
                <th scope="col" className="num">Half-life</th>
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

type DiffusionView =
  | "absorption" | "floor" | "meetings" | "mechanism" | "survival" | "episodes" | "findings";

/** The announcement arm's three views, drawn by `InformationDiffusionPane`. */
const LEDGER_VIEWS: ReadonlyArray<DiffusionView> = ["absorption", "floor", "meetings"];

export default function DiffusionPane({ active }: { active: boolean }) {
  const [view, setView] = useState<DiffusionView>("absorption");
  const episodes = useCoherenceRead<CoherenceEpisodes>(
    episodesRoute(),
    active && (view === "survival" || view === "episodes"),
  );
  // Mechanism reads nothing: its drawing is made of two constants. So the
  // absorption ledger and the episodes are the only two gates left here, and
  // each is shared by every view it feeds rather than gated per view.
  const absorption = useCoherenceRead<AbsorptionRead>(
    absorptionRoute(),
    active && LEDGER_VIEWS.includes(view),
  );

  return (
    <section className="card console-card coh-diffusion" aria-labelledby="coherence-diffusion-heading">
      <PaneHead
        kicker="Diffusion"
        title="How fast information is absorbed"
        id="coherence-diffusion-heading"
        note="two arms, one estimator, one verdict"
        lede="Both arms measure how long until the move is finished — Kalshi over a published mispricing, the announcement arm over timestamped news."
      />

      <div className="seg" role="group" aria-label="Diffusion view">
        <button type="button" aria-pressed={view === "absorption"} onClick={() => setView("absorption")}>
          Absorption
        </button>
        <button type="button" aria-pressed={view === "floor"} onClick={() => setView("floor")}>
          Noise floor
        </button>
        <button type="button" aria-pressed={view === "meetings"} onClick={() => setView("meetings")}>
          Meetings
        </button>
        <button type="button" aria-pressed={view === "mechanism"} onClick={() => setView("mechanism")}>
          Mechanism
        </button>
        <button type="button" aria-pressed={view === "survival"} onClick={() => setView("survival")}>
          Kalshi survival
        </button>
        <button type="button" aria-pressed={view === "episodes"} onClick={() => setView("episodes")}>
          Kalshi episodes
        </button>
        <button type="button" aria-pressed={view === "findings"} onClick={() => setView("findings")}>
          Findings
        </button>
      </div>

      {view === "findings" ? (
        <>
          {/* The verdict the study returned, said once, here. It was this view's
              lede while it was a rail section and it is a sentence a reader has
              to meet before the dot plot means anything. */}
          <p className="sub">
            The absorption clock is predictable without the text at all — R² +0.14 out of sample — and the
            statement&rsquo;s spectrum adds nothing to it, a sharper and falsifiable claim, not &ldquo;nothing
            predicts anything&rdquo;.
          </p>
          <FindingsPane active={active && view === "findings"} />
        </>
      ) : view === "survival" || view === "episodes" ? (
        <KalshiEpisodes data={episodes.data} error={episodes.error} view={view} />
      ) : (
        <InformationDiffusionPane view={view} read={absorption.data} error={absorption.error} />
      )}
    </section>
  );
}
