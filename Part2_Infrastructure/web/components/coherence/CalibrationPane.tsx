"use client";

/**
 * Scorecard — were these prices right? Once settled, and over time.
 *
 * Everything else on this engine tests whether a family of prices is internally
 * consistent. Consistency is cheap: a set of quotes can admit a probability
 * measure exactly and still be wrong about the world. This section asks the
 * other question, and it asks it twice over two different reads:
 *
 *   - SETTLED (Score, Bands, Corpus) — of the contracts priced near a dime,
 *     how many paid? Needs settlement data, so it cannot be asked until markets
 *     close.
 *   - CONTINUOUS (Index series, Index families) — how far the live quotes sit
 *     from the nearest price vector that admits a probability, on every poll.
 *
 * THE INDEX WAS ITS OWN RAIL SECTION UNTIL THE CONSOLIDATION OF 2026-08-24,
 * and folding it in here is the expensive move of that pass rather than
 * tidying: `index` was PUBLISHED on `origin/main`, so `#coherence/index` is a
 * link someone holds. `RELOCATED_SECTIONS` in `lib/workspace-hash.ts` lands it
 * on this section rather than on a rail default; it lands on the SECTION, and
 * which of the five views opens is component state no hash can name. What buys
 * that back is the question: both halves answer "were these prices right", and
 * two sections asked a reader to discover for themselves that they were one.
 * `IndexPane` keeps the read, the chips and the two drawings; the head, the
 * switcher and the `<section>` are here, exactly as `CertificatePane` owns the
 * parlays'.
 *
 * THE SETTLED HALF TURNS ON ONE FIELD a reader will not think to check, and
 * `CalibrationScore`'s `EngineBanner` is where that is said: `engine` names
 * WHEN the price was read, `final_trade` scores a price quoted moments before
 * settlement, and on the live sample that reads as a spectacular forecaster and
 * is nothing of the sort.
 *
 * THE BANNER IS STILL NEVER BEHIND A BUTTON, and the arrival of the index
 * views is the one thing that could have made it so. It stands above the three
 * views it invalidates and below the switcher that also offers two it does not
 * touch — the index is a distance between live quotes, scored against nothing,
 * so a caveat about settlement horizons would be a false warning there.
 * REJECTED: hoisting it over the seg for all five, which is the arrangement the
 * pane had while every view was settled. It would put "these are not forecasts"
 * over a figure that makes no forecast claim.
 *
 * THE SWITCHER IS DRAWN BEFORE EITHER BRANCH, unconditionally, for the reason
 * `CertificatePane` draws its own that way: the index needs no settled corpus,
 * so a reader who arrives while that read is in flight — or has failed — must
 * still be able to reach it. Gating the seg on `data` is how a fold makes two
 * views unreachable for the slowest seconds of a first visit.
 *
 * Five views, one `.seg`, never a nested rail. The two reads are never in
 * flight together: each is gated on the views that draw it, so opening this
 * section costs one call and not two.
 *
 * THE FOURTH REVIEW'S PASS, which changed no structure here: every view draws
 * its numbers and the per-row detail behind each drawing took a `<details>`
 * naming what is inside — the band rows and the isotonic correction, the
 * corpus's per-series shares and slopes, the per-family reading counts.
 *
 * REFUSED on Score: putting the six-row table behind one too. Its third column
 * is COMPUTED — the slope reading names the favourite–longshot shape, the
 * count says how many bands carry a settled market — so it is a finding rather
 * than method, and the same argument that hides Verdict's fixed one-liners
 * says to leave these on screen. A rule applied without reading what it hides
 * is how a summarising pass loses a result.
 *
 * The file is a shell over three renderers because of the 400-line ceiling, and
 * the ceiling's own rule is to split rather than shave prose: `CalibrationScore`
 * (banner, six headline figures, Murphy disclosure), `CalibrationBands` (the
 * reliability diagram and the band table) and `CalibrationCorpus` (what the
 * corpus is made of). None holds state; each reads a different part of one
 * payload, which is what made them the seam.
 */

import { useState } from "react";

import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import { calibrationRoute } from "@/lib/coherence/routes";
import PaneHead from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import CalibrationBands from "./CalibrationBands";
import CalibrationCorpus from "./CalibrationCorpus";
import { EngineBanner, ScoreView, horizonText, scoreFacts } from "./CalibrationScore";
import { StateChip } from "./Figure";
import IndexPane from "./IndexPane";

type CalibrationView = "score" | "bands" | "corpus" | "series" | "families";

/** The two views the index read answers; the other three read the corpus. */
const INDEX_VIEWS = new Set<CalibrationView>(["series", "families"]);

const VIEWS: ReadonlyArray<[CalibrationView, string]> = [
  ["score", "Score"],
  ["bands", "Bands"],
  ["corpus", "Corpus"],
  ["series", "Index series"],
  ["families", "Index families"],
];

export default function CalibrationPane({ active }: { active: boolean }) {
  const [view, setView] = useState<CalibrationView>("score");
  const onIndex = INDEX_VIEWS.has(view);
  const { data, error } = useCoherenceRead<CoherenceCalibration>(
    calibrationRoute(),
    active && !onIndex,
  );

  const head = {
    kicker: "Scorecard",
    title: "Were the prices right, once settled and over time",
    id: "coherence-calibration-heading",
    note: data ? `${data.engine} prices` : "settled corpus & live index",
    lede: (
      <>
        A set of quotes can admit a probability exactly and still be wrong about the world, so this asks the other
        question — of the contracts priced near a dime, how many paid — and it turns on <code>engine</code>, which
        says WHEN the price was read.
      </>
    ),
  };

  return (
    <section className="card console-card coh-calib" aria-labelledby="coherence-calibration-heading">
      <PaneHead {...head} />

      <div className="seg" role="group" aria-label="Calibration view">
        {VIEWS.map(([name, label]) => (
          <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
            {label}
          </button>
        ))}
      </div>

      {onIndex ? (
        <IndexPane active={active && onIndex} view={view === "series" ? "series" : "families"} />
      ) : (
        <SettledViews data={data} error={error} view={view} />
      )}
    </section>
  );
}

/**
 * The three settled views, with the four different absences told apart.
 *
 * A read still in flight looks like reading, a failed read names the failure,
 * a gateway that answered "nothing has settled" says so in its own words, and
 * only then does a number appear. Collapsing any pair of those into one line is
 * how "we do not know" starts reading as "it is fine".
 */
function SettledViews({ data, error, view }: {
  data: CoherenceCalibration | null;
  error: string | null;
  view: CalibrationView;
}) {
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
        <span aria-hidden="true">◌</span>{" "}
        {data.detail || "Nothing has settled yet, so there is nothing to score."}
      </p>
    );
  }

  return (
    <>
      {/* The one chip no figure, note or heading below already says. Settled
          markets, bands quoted and the engine each repeated a neighbour. */}
      <div className="coh-status__chips">
        <StateChip
          mark={data.thin ? "▲" : "●"}
          word={data.thin ? "Thin sample" : "Not flagged thin"}
          value={data.thin ? "too few to conclude from" : null}
          tone={data.thin ? "warn" : "muted"}
        />
      </div>

      <EngineBanner data={data} />

      {view === "score" ? (
        <ScoreView data={data} facts={scoreFacts(data)} />
      ) : view === "bands" ? (
        <CalibrationBands
          data={data}
          horizonNote={
            data.engine === "final_trade"
              ? "last traded prices, so the x axis is what the exchange had already converged on"
              : horizonText(data.median_horizon_s)
          }
        />
      ) : (
        <CalibrationCorpus data={data} />
      )}
    </>
  );
}
