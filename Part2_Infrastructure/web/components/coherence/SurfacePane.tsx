"use client";

/**
 * Lattice — the measure a family's prices imply, and nothing about betting it.
 *
 * A ladder or a bucket family is a probability distribution with prices on it.
 * This section draws it: the survival function the strikes sample, the mass
 * differencing leaves between them, and the moments of that mass. What follows
 * from the measure — how much of a bankroll log-optimal growth puts on each
 * outcome — is the `stake` section, and it is a different read.
 *
 * THE FIFTH RESTRUCTURE OF 2026-08-24 SPLIT THIS SECTION IN TWO, and the reason
 * is worth stating plainly rather than being discovered from a diff. This pane
 * carried five views on one seg and then, on the fifth, a SECOND seg of three —
 * Plan, Capital, Method — plus a family picker. A reader met three rows of
 * controls before any drawing, and on the family the section opens on the thing
 * under them was one grey sentence. The controls were the ugliness; the sentence
 * was correct. So the bet went to its own section with its own head, and what
 * is left here is one question, one read and one control row.
 *
 * ONE SECTION, ONE READ, and that is now the seam rather than a coincidence.
 * Lattice reads `/surface`; Stake reads `/stake`. The old arrangement had this
 * file gating a second read on two of its five views, which is what made "which
 * views are in flight" a question the section had to answer at all. It no longer
 * has one to answer.
 *
 * WHOLE FAMILY WENT WITH THE BET, against the first sketch of the split, and
 * measured rather than argued: that view renders `StakeTable` over `/stake`'s
 * own ranking. Left here it would have kept a `/stake` read on the distribution
 * section, and on a strike ladder — which is the family this watchlist opens on
 * — it would have died with no explanation of its own, because `FamilyView`
 * never reaches the branch that explains a declined solve. It is the fourth view
 * of Stake.
 *
 * THE FOUR PROVENANCE CHIPS ARE A KPI ROW NOW. They rode the Survival view
 * alone, so pressing Mass or Moments lost the numbers that say what is being
 * looked at. As a `<dl className="coh-status__facts">` — the plane's own
 * 140px auto-fit tile grid, already drawn by `StatusPane` and `FeesPane` — they
 * answer on all three views and cost less height than the chips did.
 *
 * The family picker rides the control row on every view, because every view here
 * is a question ABOUT a family and none is answerable without choosing one. It
 * is the shared `FamilyPicker` and no longer a row of pills: five families whose
 * tickers run to forty glyphs wrapped the row to two lines, and a section is
 * allowed exactly one row of chrome before its drawing. The closed control names
 * the count — "KXBTCD-26AUG2517, 1 of 5" — so it hides the roster's SIZE from
 * nobody, which was the whole of the old argument for pills.
 *
 * It is never a nested `<WorkspaceSubtabs>` either: a second rail instance fights
 * the first over the `--rail-h` publisher, as `ReliabilityConsole` records.
 *
 * NO VERDICT IS PASSED, and the omission is deliberate rather than unfinished.
 * `FamilyPicker` will draw one beside a ticker, and the two Proofs sections that
 * own `/certify` do pass it. This section reads `/surface`, which answers what
 * measure the prices imply and says nothing about coherence, so a verdict here
 * would be a figure borrowed from a read this section never makes.
 */

import { type ReactNode, useState } from "react";

import type { CoherenceEventView, CoherenceUniverse } from "@/lib/coherence/types";
import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import { surfaceRoute, universeRoute } from "@/lib/coherence/routes";
import FamilyPicker from "./FamilyPicker";
import PaneHead, { PaneHeadEmpty } from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import DistributionView, { decimalLabel } from "./surface/DistributionView";
import TruncationNote from "./surface/TruncationNote";

/** The three readings of one payload. `stake` and `family` left on the fifth
 *  2026-08-24 pass, to the section that owns the read they were drawn from. */
type LatticeView = "survival" | "mass" | "moments";
const LATTICE_VIEWS: ReadonlyArray<[LatticeView, string]> = [
  ["survival", "Survival"],
  ["mass", "Mass"],
  ["moments", "Moments"],
];

const HEAD = {
  kicker: "Lattice",
  title: "The measure these prices imply",
  id: "markets-lattice-heading",
  // No mention of a stake, and that is the split doing its work: the log-optimal
  // plan is a different section with a head of its own, and a lede that promised
  // it here would send a reader looking for a view that is not on this control.
  lede: "A family's quoted strikes are a probability distribution, and this is the mass, the moments and the intervals differencing leaves behind.",
} as const;

/** One reading of the payload, as a label and a value the dl can print. */
interface Reading {
  label: string;
  value: string;
}

/**
 * The six numbers that say what is being looked at, before any drawing.
 *
 * Every one is either a count the payload states or a decimal `decimalLabel`
 * cut; nothing here is derived arithmetic, so nothing here can disagree with
 * the figures below it. A value the read did not carry prints a dash AND the
 * reason — `basis` is null when neither side of the book was quoted, and
 * "no side" alone would read as a side called "no".
 */
function readings(surface: CoherenceSurface): Reading[] {
  return [
    { label: "Family shape", value: surface.engine === "ladder" ? "strike ladder" : `${surface.engine} family` },
    { label: "Strikes probed", value: String(surface.probes.length) },
    { label: "Intervals", value: String(surface.bins.length) },
    { label: "Priced from", value: surface.basis ?? "— neither side of the book was quoted" },
    { label: "Total quoted mass", value: decimalLabel(surface.total_mass, 4) },
    {
      label: "Negative mass",
      value: surface.negative_bins.length
        ? `${surface.negative_bins.length} interval(s)`
        : "none on this read",
    },
  ];
}

export default function SurfacePane({
  active,
  eventTicker,
  events: supplied,
}: {
  active: boolean;
  /** Pins one family. Absent, the pane picks the first the universe returns. */
  eventTicker?: string;
  /** The console's own universe read, reused so this is not a third live one. */
  events?: CoherenceEventView[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<LatticeView>("survival");
  const universe = useCoherenceRead<CoherenceUniverse>(
    universeRoute(),
    active && !eventTicker && !supplied?.length,
  );
  const events = supplied?.length ? supplied : (universe.data?.events ?? []);
  const target = eventTicker ?? picked ?? events[0]?.event_ticker ?? "";
  const surface = useCoherenceRead<CoherenceSurface>(surfaceRoute(target), active && Boolean(target));

  const head = {
    ...HEAD,
    note: `${events.length} ${events.length === 1 ? "family" : "families"} to choose from`,
  };

  /** The card, labelled by the heading it draws. */
  const framed = (body: ReactNode) => (
    <section className="card console-card coh-surface" aria-labelledby="markets-lattice-heading">
      {body}
    </section>
  );

  if (!target) {
    return framed(
      <PaneHeadEmpty head={head} mark={universe.error ? "✕" : "◌"}>
        {universe.error
          ? `No family could be read: ${universe.error}. Universe reads the same list and says what the exchange answered.`
          : "Reading the watched families…"}
      </PaneHeadEmpty>,
    );
  }

  return framed(
    <>
      <PaneHead {...head} />

      {/* ONE control row. It is the chip row's flex box rather than a class of
          its own — `.coh-surface` is a grid, so two segs as its children would
          stack, and a local fix that adds no class leaves dead-CSS untouched. */}
      <div className="coh-status__chips">
        <div className="seg" role="group" aria-label="Which question">
          {LATTICE_VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>

        {!eventTicker && events.length > 1 ? (
          <FamilyPicker
            options={events.map((event) => ({ ticker: event.event_ticker, shard: event.exchange_index }))}
            selected={target}
            onSelect={setPicked}
            label="Choose a family"
          />
        ) : null}
      </div>

      {surface.error && !surface.data ? (
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The distribution could not be read: {surface.error}. That is a gateway
          failure, not an answer about this family.
        </p>
      ) : !surface.data ? (
        <p className="console-empty muted">Reading the implied distribution…</p>
      ) : (
        <>
          {/* The KPI row before the drawing, on every view. */}
          <dl className="coh-status__facts">
            {readings(surface.data).map((reading) => (
              <div key={reading.label}>
                <dt>{reading.label}</dt>
                <dd>{reading.value}</dd>
              </div>
            ))}
          </dl>

          {surface.data.bins.length ? (
            <DistributionView surface={surface.data} view={view} />
          ) : (
            <p className="console-empty">
              <span aria-hidden="true">○</span> No interval could be differenced out of {surface.data.event_ticker}:{" "}
              {surface.data.detail}. Press another family above, or read the quotes themselves on Universe.
            </p>
          )}

          <TruncationNote />
        </>
      )}
    </>,
  );
}
