"use client";

/**
 * The distribution a family's prices imply, and what it would be right to bet.
 *
 * Three questions about one family, one at a time. A ladder or a bucket family
 * is a probability distribution with prices on it: **Distribution** draws it as
 * the exchange quotes it — the survival function it samples, and the mass
 * differencing leaves between strikes. **Stake** asks what follows: given that
 * measure and those prices, how much of a bankroll does log-optimal growth put
 * on each outcome? **Whole family** is the ranking underneath the plan, every
 * outcome the solver considered rather than only the ones it took.
 *
 * They are a `.seg` switcher and never a nested `<WorkspaceSubtabs>`, which
 * `CoherenceConsole` explains: a second rail fights the first over `--rail-h`.
 * The family picker sits on the same row as the switcher because the two
 * choose different things — the switcher picks the question, the picker picks
 * the noun — and two segmented controls stacked one above the other read as
 * one control with six options.
 *
 * This shell owns what is true of all three views: the family, the reads, the
 * truncation convention every table on the pane obeys, and the closing note.
 * Nothing here sends an order.
 */

import { useState } from "react";

import type { CoherenceEventView, CoherenceUniverse } from "@/lib/coherence/types";
import type { CoherenceKelly, CoherenceSurface } from "@/lib/coherence/types-lab";
import { stakeRoute, surfaceRoute, universeRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import DistributionView from "./surface/DistributionView";
import FamilyView from "./surface/FamilyView";
import StakeView from "./surface/StakeView";

type SurfaceQuestion = "distribution" | "stake" | "family";

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
  const [view, setView] = useState<SurfaceQuestion>("distribution");
  const universe = useCoherenceRead<CoherenceUniverse>(
    universeRoute(),
    active && !eventTicker && !supplied?.length,
  );
  const events = supplied?.length ? supplied : (universe.data?.events ?? []);
  const target = eventTicker ?? picked ?? events[0]?.event_ticker ?? "";
  // The surface read is NOT gated on the view. Both stake views branch on
  // `surface.engine` — a ladder is why the solver declines a family — so the
  // distribution payload is read whichever question is on screen.
  const surface = useCoherenceRead<CoherenceSurface>(
    surfaceRoute(target),
    active && Boolean(target),
  );
  // The stake read IS gated on the view. It is the slower of the two, and a
  // reader asking only what the distribution is should not pay for a solve
  // that is not on their screen.
  const stake = useCoherenceRead<CoherenceKelly>(
    stakeRoute(target),
    active && Boolean(target) && view !== "distribution",
  );

  if (!target) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span>{" "}
        {universe.error
          ? `No family could be read, so there is no distribution to draw: ${universe.error}`
          : "Reading the families this engine prices…"}
      </p>
    );
  }

  return (
    <div className="coh-surface">
      {/* One row, two controls: the question first, then the family it is asked
          about. The row is the chip row's flex box rather than a class of its
          own — `.coh-surface` is a grid, so two segs as its children would
          stack, and a local fix that adds no class leaves dead-CSS untouched. */}
      <div className="coh-status__chips">
        <div className="seg" role="group" aria-label="Which question">
          <button type="button" aria-pressed={view === "distribution"} onClick={() => setView("distribution")}>
            Distribution
          </button>
          <button type="button" aria-pressed={view === "stake"} onClick={() => setView("stake")}>
            Stake
          </button>
          <button type="button" aria-pressed={view === "family"} onClick={() => setView("family")}>
            Whole family
          </button>
        </div>

        {!eventTicker && events.length > 1 ? (
          <div className="seg coh-books__picker" role="group" aria-label="Choose a family to draw">
            {events.map((event) => (
              <button key={event.event_ticker} type="button" aria-pressed={event.event_ticker === target} onClick={() => setPicked(event.event_ticker)}>
                {event.event_ticker}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {surface.error && !surface.data ? (
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The distribution could not be read: {surface.error}
        </p>
      ) : !surface.data ? (
        <p className="console-empty muted">Reading the distribution these prices imply…</p>
      ) : (
        <>
          {view === "distribution" ? (
            <DistributionView surface={surface.data} />
          ) : stake.error && !stake.data ? (
            <p className="console-empty">
              <span aria-hidden="true">✕</span> The stake could not be sized: {stake.error}
            </p>
          ) : !stake.data ? (
            <p className="console-empty muted">Sizing the log-optimal stake…</p>
          ) : view === "stake" ? (
            <StakeView kelly={stake.data} surface={surface.data} />
          ) : (
            <FamilyView kelly={stake.data} />
          )}

          {/* Outside the switcher because every table in all three views prints
              the same ellipsis, and a convention stated in one view is a
              convention the other two readers never see. */}
          <p className="coh-surface__moments-note">
            <span aria-hidden="true">◌</span> Values on this pane are shown truncated, never rounded: a trailing
            ellipsis means digits were cut, not that the number ended there.
          </p>

          <p className="coh-event__note">
            This is a reading of prices, not a forecast. The mass is what one side of each book implies if the quotes
            are taken at face value, and the plan is sized against that measure — fed the market&rsquo;s own mids it
            correctly returns &ldquo;stake nothing&rdquo;, because there is no edge in quoting a price back at itself.
            Nothing on this pane places an order, and no stake here has been traded.
          </p>
        </>
      )}
    </div>
  );
}
