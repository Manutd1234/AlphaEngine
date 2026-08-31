"use client";

/**
 * What was scored, and what that leaves out.
 *
 * Split out of `CalibrationPane` with `CalibrationBands` on 2026-08-24, for the
 * same reason: the pane crossed the 400-line ceiling and the ceiling's rule is
 * to split rather than shave.
 *
 * This view is disclosure, not analysis. A corpus is not a random sample of
 * forecasts — it is whatever the watched series happened to settle over the
 * recorded window — so when one ticker is most of it, every figure on the Score
 * view is mostly a score of that ticker, and a reader who cannot see the mixture
 * cannot know that.
 *
 * Two denominators are deliberately kept apart. The shares divide by the
 * COMPOSITION total, which need not equal the scored count, so the caption names
 * which number it is dividing by. And the per-series slope is a dash, never the
 * corpus figure standing in: the aggregate averages series that are not the same
 * question, so two of them can point opposite ways and still sit at one
 * together.
 */

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { pct } from "@/lib/format";
import type { CoherenceCalibration } from "@/lib/coherence/types-lab";

import CorpusShares from "./CorpusShares";
import { ChosenStatus, useChosen } from "@/lib/coherence/use-chosen";
import { corpusRows, type CorpusRow } from "@/lib/coherence/corpus-rows";
import { decimalLabel } from "@/lib/coherence/decimals";
import { HotSource, useHot } from "@/lib/coherence/use-hot";

export default function CalibrationCorpus({ data }: { data: CoherenceCalibration }) {
  return (
    <>
      <section className="coh-calib__composition">
        {/* No heading here. It read "What was scored, and what that leaves
            out", which is the view's own name on the switcher and this file's
            first line — and the two peer views, Score and Bands, draw none.
            The strip's caption says what is being counted. */}
        {data.composition.length ? (
          // THE PROVIDER SCOPES THE HOT INDEX TO THIS PAIR, and that scope is
          // the whole reason it is here rather than around the section: a row
          // hover redraws the figure and its table, not every figure on the
          // view. The child below holds both halves, so the index they share
          // is an index into one array.
          <HotSource>
            <Composition data={data} />
          </HotSource>
        ) : (
          <p className="coh-event__note">
            <span aria-hidden="true">◌</span> The engine did not say which series these came from, so the selection
            behind the score cannot be checked from here.
          </p>
        )}
      </section>

      {/* FOLDED 2026-08-25. `data.detail` is composed by the gateway, is not
          length-bounded by anything, and was rendered raw under a heading that
          gave it more rank than the two drawings above it. It is provenance —
          worth having, never the reading — so it goes where provenance goes.
          The empty case draws nothing rather than an empty paragraph under a
          heading, which is what the raw render did. */}
      {data.detail ? (
        <details className="disclosure">
          <summary>Where these numbers came from, in the engine&rsquo;s own words</summary>
          <p>{data.detail}</p>
        </details>
      ) : null}
    </>
  );
}

/**
 * The figure and the table that explains it, over ONE sorted array.
 *
 * Both halves map `corpusRows`, so a mark's index and a row's index name the
 * same series — the condition every link on this engine is built on. Two
 * directions, and they are different questions: HOT is where the reader's hand
 * is (either half publishes it, neither speaks it, and it is gone when the
 * hand moves), CHOSEN is a decision (Enter or a click on a mark), which opens
 * the fold, marks the row, moves focus to it and says so once.
 *
 * A CHOICE HAS TO OPEN THE FOLD. The rows live behind a summary, so choosing a
 * bar while it is shut would scroll a reader to nothing and read as a dead
 * control. The fold is controlled from here and still closes by hand, because
 * `onToggle` hands its own state back.
 */
function Composition({ data }: { data: CoherenceCalibration }) {
  const { hot, setHot } = useHot();
  const { chosen, choose, announced } = useChosen<string>();
  const [open, setOpen] = useState(false);
  const { rows, corpus } = corpusRows(data);

  const pick = useCallback((row: CorpusRow) => {
    setOpen(true);
    choose(
      row.ticker,
      `${row.ticker}: ${row.count} settled markets, `
      + `${row.share == null ? "share not known" : `${pct(row.share)} of the corpus`}`
      + `, ${row.slope == null ? "no slope of its own" : `slope ${row.slopeText}`}. Its row is open below.`,
    );
    // AFTER the commit that opens the fold and marks the row, never during it:
    // a row inside a shut `<details>` cannot take focus.
    requestAnimationFrame(() => {
      document.getElementById(`coh-corpus-${row.ticker}`)?.focus();
    });
  }, [choose]);

  return (
    <>
      <CorpusShares data={data} onSelect={pick} hot={hot} />
      {/* OUTSIDE the figure's `role="img"`, which is presentational to
          assistive technology — a sentence placed inside it would be drawn and
          announced to nobody. */}
      <ChosenStatus announced={announced} />

      <details className="disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          Every series in the corpus, its share and its own slope
          <span className="sr-only">{`, ${rows.length} rows`}</span>
        </summary>
        <div className="table-wrap" role="region" aria-label="Calibration corpus series" tabIndex={0}>
          <table className="coh-table">
            <caption className="coh-table__caption">
              Shares divide by the {corpus} in this composition, not the {data.count} scored. A series with no
              slope of its own shows a dash; the corpus figure never stands in for it, because the aggregate
              averages series that are not the same question.
            </caption>
            <thead>
              <tr>
                <th scope="col">Series</th>
                <th scope="col" className="num">Settled markets</th>
                <th scope="col" className="num">Share of the corpus</th>
                <th scope="col" className="num">Its own slope</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.ticker}
                  id={`coh-corpus-${row.ticker}`}
                  tabIndex={-1}
                  className={[row.ticker === chosen ? "is-chosen" : null, index === hot ? "is-hot" : null]
                    .filter(Boolean)
                    .join(" ") || undefined}
                  onPointerEnter={() => setHot(index)}
                  onPointerLeave={() => setHot(null)}
                  onFocus={() => setHot(index)}
                  onBlur={() => setHot(null)}
                >
                  <th scope="row">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-pressed={row.ticker === chosen}
                      onClick={() => pick(row)}
                    >
                      {row.ticker}
                    </Button>
                  </th>
                  <td className="num">{row.count}</td>
                  <td className="num">{row.share == null ? "—" : pct(row.share)}</td>
                  <td className="num">{decimalLabel(row.slopeRaw, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
