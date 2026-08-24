"use client";

/**
 * What the contract actually resolves against, which is not the price you watch.
 *
 * A weather contract on this venue settles on the MEAN of a published index over
 * a window, and the number a screen shows is the latest print of that index.
 * Those are two different quantities and the gap between them —
 * `spot_minus_window` — is the basis a position carries for free.
 *
 * THREE VIEWS OF UNIVERSE AGAIN, after a few hours as a rail section of its
 * own. Promotion bought this subject a URL — the only route to it had been a
 * control the URL does not carry and `desk-sweep.mjs` never pressed — and the
 * price was a rail entry of its own on an already long rail. That was reversed
 * the same day and has stayed reversed through the split that followed:
 * Settlement is a view of Universe, on Quotes, and `#coherence/settlement`
 * resolves to it through `RELOCATED_SECTIONS` rather than by being a section.
 * What is not lost with the rail entry is the READ: this pane owns its own
 * poll, gated on `view` rather than on a section, so leaving Settlement for
 * Baskets ends the call exactly as leaving the section used to.
 *
 * It draws no head. `UniverseSection` draws the one head this section has, and
 * `coherence-pane-head.test.ts` is what holds that to one per section; the
 * sentence that used to be this pane's lede is the paragraph below the
 * switcher, because the claim it makes is the whole point of the subject.
 *
 * REBUILT 2026-08-24 on the reported complaint: "no figures and a lot of words".
 * Half of that was fair and half was worse than it looked. TODAY'S READING did
 * draw one chart, but the chart sat under a heading and a chip row and above a
 * five-row table of prose, so the reader met three paragraphs of explanation
 * before a number. FORMATION drew nothing at all: it was two tables whose
 * subject is a PIPELINE — stations, quality control, a published minute, a
 * sixty-minute mean — and a table cannot show that the figure a contract settles
 * on is four transformations away from a thermometer.
 *
 * So both halves lead with a drawing and the prose is the caption under it.
 * `FormationDiagram` carries the chain and its measurements; `PendingMinutes`
 * draws the station DISAGREEMENT as the bar, because a provisional index built
 * from readings 3.6 apart is a different object from the same figure built from
 * readings that agree — and that was a column in a table nobody scanned.
 *
 * Two facts are stated rather than drawn, because they are properties of the
 * deployment and not measurements: CF Benchmarks is gated on an account
 * ENTITLEMENT rather than on signing, so no demo key opens it and no amount of
 * retrying will; and exactly one city is published, so a request for any other
 * is answered `not_covered` rather than with an empty series. Each is said once,
 * in one line — the entitlement fact used to run to three sentences saying the
 * same thing about retrying.
 *
 * The three views are peers on Universe's own switcher rather than a switcher
 * of their own: two `.seg` controls in a column read as one broken control, and
 * "Pending" earned its place on the second 2026-08-24 pass — it was the second
 * drawing on a view that already had one, and it is the one genuinely tradeable
 * figure the subject produces.
 *
 * The lead sentence is drawn on EVERY branch, including the ones with no
 * payload, so a reader whose feed failed still knows what they were looking at.
 */

import { type ReactNode } from "react";

import { toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceSettlementFeed } from "@/lib/coherence/types-lab";
import { settlementRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import FormationDiagram, { type FormationStage } from "./FormationDiagram";
import IndexBasisChart from "./IndexBasisChart";
import PendingMinutes from "./PendingMinutes";
import { StateChip } from "./Figure";

/** The one city the venue publishes. Probed, not assumed — see the driver. */
export const PUBLISHED_CITY = "miami";

/** Three views since the second 2026-08-24 pass: Formation stacked two figures
 *  — the chain and the pending-minutes bars — which is one more than a view
 *  may hold, so the provisional minutes are their own view. Named here and
 *  imported by `UniverseSection`, which owns which of the five is pressed. */
export type SettlementView = "reading" | "formation" | "pending";

function ReferenceRate({ state, detail }: { state: string; detail: string }) {
  if (state === "entitlement_required") {
    return (
      <p className="coh-settle__standing">
        <span aria-hidden="true">○</span> Reference rate withheld: the CF Benchmarks passthrough is gated on an account
        entitlement, not on request signing, so a demo key does not open it and retrying cannot.
      </p>
    );
  }
  if (state === "available") {
    return (
      <p className="coh-settle__standing">
        <span aria-hidden="true">✓</span> Reference rate readable on this deployment. {detail ? `${detail}.` : ""}
      </p>
    );
  }
  return (
    <p className="coh-settle__standing">
      <span aria-hidden="true">◌</span> Reference rate state: {state}. {detail ? `${detail}.` : ""}
    </p>
  );
}

/** The view that answers what today reads: the figure, then its quality control. */
function TodayReading({ data }: { data: CoherenceSettlementFeed }) {
  // Compared as exact integers rather than as strings: "87.812" and "87.8120"
  // are the same number and a text comparison would report them as different.
  const average = toCenticents(data.window_average);
  const clean = toCenticents(data.window_average_clean);
  const flagsMatter = average != null && clean != null && average !== clean;
  const thin = data.contributors_min != null && data.contributors_max != null
    && data.contributors_min !== data.contributors_max;

  return (
    <>
      <IndexBasisChart
        samples={data.samples}
        windowMinutes={data.window_minutes}
        windowAverage={data.window_average}
        windowAverageClean={data.window_average_clean}
        latestValue={data.latest_value}
        spotMinusWindow={data.spot_minus_window}
      />

      {/* The quality control that decides whether the average above means
          anything, as chips rather than as a five-row table of prose. Each is a
          measurement, and the chip words carry the verdict, so the sentence
          that used to restate all four underneath them is gone. */}
      {/* The city chip is gone: the head's note names the city on every
          view, and a chip restating the head is the wordiness under review. */}
      <div className="coh-status__chips">
        <StateChip
          mark={data.degraded_samples ? "▲" : "●"}
          word="Flagged minutes"
          value={`${data.degraded_samples} of ${data.sample_count}`}
          tone={data.degraded_samples ? "warn" : "good"}
        />
        <StateChip
          mark={flagsMatter ? "▲" : "●"}
          word={flagsMatter ? "Flags move the settled number" : "Flags do not move it"}
          value={data.window_average_clean ?? "—"}
          tone={flagsMatter ? "warn" : "good"}
        />
        <StateChip
          mark={thin ? "▲" : "●"}
          word="Stations in"
          value={
            data.contributors_min == null || data.contributors_max == null
              ? "—"
              : thin
                ? `${data.contributors_min} to ${data.contributors_max}`
                : `${data.contributors_min} throughout`
          }
          tone={thin ? "warn" : "good"}
        />
        <StateChip mark="●" word="QC rules" value={data.config_version || "—"} tone="muted" />
      </div>

      <p className="coh-settle__note">
        Both averages are the same {data.window_minutes}-minute mean, once with the flagged minutes and once without
        {data.window_average_clean == null
          ? "; the clean figure is unpublished for this read, so it shows a dash."
          : "."}
      </p>
    </>
  );
}

/** The view that answers how the number is made, and what is still owed. */
function Formation({ data }: { data: CoherenceSettlementFeed }) {
  const stages: FormationStage[] = [
    {
      title: "Stations",
      value: data.stations.length ? `${data.stations.length} members` : "—",
      note: data.stations.length ? data.stations.join(" ") : "no per-station detail",
      holds: data.stations.length ? true : null,
    },
    {
      title: "Quality control",
      value: data.config_version || "—",
      note: `${data.degraded_samples} of ${data.sample_count} flagged`,
      holds: data.config_version ? true : null,
    },
    {
      title: "Published minute",
      value: `${data.formation_agreed} of ${data.formation_checked}`,
      note: data.formation_holds ? "rule reproduced" : "rule does not hold",
      holds: data.formation_holds,
    },
    {
      title: "Settlement window",
      value: `${data.window_minutes} min`,
      note: data.quorum_gaps > 0 ? `${data.quorum_gaps} minutes missing` : "continuous, no gaps",
      holds: data.quorum_gaps > 0 ? false : true,
    },
  ];

  return (
    <>
      <FormationDiagram
        stages={stages}
        caption="How the settlement index is formed, stage by stage"
        reading={
          data.formation_holds
            ? // The mean-of-QC-stations rule is what the stages above draw; the
              // reading keeps the verdict and the count.
              `This read reproduced the published value on all ${data.formation_checked} completed minutes; Pending's provisional figures rest on that.`
            : `The rule did not reproduce the published value here, so nothing on Pending should be traded on: ${data.formation_detail}`
        }
        missing={
          data.quorum_gaps > 0
            ? `${data.quorum_gaps} minutes are missing: the venue omits a minute whose quorum failed — `
              + "not computed rather than unreported."
            : null
        }
      />

      {/* The station list is the one measurement on this view the DRAWING
          cannot carry: SVG text neither wraps nor clips, so `FormationDiagram`
          elides it at the box edge and five nine-character names become
          "MIAMI-INT…". Folded here it is complete, counted in its own summary,
          and it costs the view nothing when nobody asks. */}
      {data.stations.length ? (
        <details className="disclosure">
          <summary>
            Every station in the mean, {data.stations.length}{" "}
            {data.stations.length === 1 ? "member" : "members"}
          </summary>
          <ul className="coh-notes">
            {data.stations.map((station) => (
              <li key={station}>{station}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="coh-settle__note">
        Figures are in {data.units || "the index’s own units, which this read did not carry"}. Coverage is one city.
      </p>

      <ReferenceRate state={data.reference_rate_state} detail={data.reference_rate_detail} />
    </>
  );
}

/** The view that answers what the stations have handed over that the exchange
 *  has not yet published — its own view, because it is the one genuinely
 *  tradeable figure on the section and it was the second drawing on a view
 *  that already had one. */
function Pending({ data }: { data: CoherenceSettlementFeed }) {
  return <PendingMinutes rows={data.pending ?? []} units={data.units || "index units"} />;
}

export default function SettlementPane({ view, active }: { view: SettlementView; active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceSettlementFeed>(settlementRoute(PUBLISHED_CITY), active);

  /** The lead sentence, then one thing under it. */
  const framed = (body: ReactNode) => (
    <div className="coh-settle">
      <p className="sub">
        A contract settles on the mean of a published index over a window, never on the price on screen; the gap
        between the two is basis a position carries for free
        {data ? ` — ${data.window_minutes}-minute window, ${data.city ?? PUBLISHED_CITY}.` : "."}
      </p>
      {body}
    </div>
  );

  if (error && !data) {
    return framed(
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The settlement feed could not be read: {error}.
      </p>,
    );
  }
  if (!data) return framed(<p className="console-empty muted">Reading the settlement index…</p>);

  if (data.state === "not_covered") {
    return framed(
      <>
        <p className="console-empty">
          <span aria-hidden="true">○</span> {data.city ?? "That city"} is not covered: the venue publishes this index
          for one city and answers any other request by naming the one it has. {data.detail ? `${data.detail}.` : ""}
        </p>
        <ReferenceRate state={data.reference_rate_state} detail={data.reference_rate_detail} />
      </>,
    );
  }

  if (data.state !== "available" || !data.samples.length) {
    return framed(
      <>
        <p className="console-empty">
          <span aria-hidden="true">◌</span> No samples in this read ({data.state}). {data.detail ? `${data.detail}.` : ""}
        </p>
        <ReferenceRate state={data.reference_rate_state} detail={data.reference_rate_detail} />
      </>,
    );
  }

  return framed(
    <>
      {view === "reading" ? <TodayReading data={data} /> : view === "formation" ? <Formation data={data} /> : <Pending data={data} />}
      {/* Outside the switch: a refresh that failed left BOTH halves showing the
          previous answer, so both halves say so. */}
      {error ? (
        <p className="coh-settle__note">
          <span aria-hidden="true">✕</span> The last refresh failed: {error}. The readings above are the previous
          answer.
        </p>
      ) : null}
    </>,
  );
}
