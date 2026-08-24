"use client";

/**
 * What the contract actually resolves against, which is not the price you watch.
 *
 * A weather contract on this venue settles on the MEAN of a published index
 * over a window, and the number a screen shows is the latest print of that
 * index. Those are two different quantities and the gap between them —
 * `spot_minus_window` — is the basis a position carries for free.
 *
 * REBUILT 2026-08-24 on the reported complaint: "no figures and a lot of
 * words". Half of that was fair and half was worse than it looked. TODAY'S
 * READING did draw one chart, but the chart sat under a heading and a chip row
 * and above a five-row table of prose, so the reader met three paragraphs of
 * explanation before a number. FORMATION drew nothing at all: it was two tables
 * whose subject is a PIPELINE — stations, quality control, a published minute,
 * a sixty-minute mean — and a table cannot show that the figure a contract
 * settles on is four transformations away from a thermometer.
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
 * is answered `not_covered` rather than with an empty series.
 *
 * The unreadable states sit outside both views. A feed that could not be read
 * is reported whichever half of it the reader asked for.
 */

import { toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceSettlementFeed } from "@/lib/coherence/types-lab";
import { settlementRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import FormationDiagram, { type FormationStage } from "./FormationDiagram";
import IndexBasisChart from "./IndexBasisChart";
import PendingMinutes from "./PendingMinutes";
import { StateChip } from "./Figure";

/** The one city the venue publishes. Probed, not assumed — see the driver. */
const PUBLISHED_CITY = "miami";

function ReferenceRate({ state, detail }: { state: string; detail: string }) {
  if (state === "entitlement_required") {
    return (
      <p className="coh-settle__standing">
        <span aria-hidden="true">○</span> Reference rate withheld: the CF Benchmarks passthrough is gated on an
        account entitlement, not on request signing, so a demo key does not open it and retrying cannot. A standing
        property of this deployment, not a fault in this read.
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
          anything, as chips rather than as a five-row table of prose. Each is
          a measurement; the sentence under them is the only one needed. */}
      <div className="coh-status__chips">
        <StateChip mark="●" word="City" value={data.city ?? "—"} tone="muted" />
        <StateChip
          mark={data.degraded_samples ? "▲" : "●"}
          word="Flagged minutes"
          value={`${data.degraded_samples} of ${data.sample_count}`}
          tone={data.degraded_samples ? "warn" : "good"}
        />
        <StateChip
          mark={flagsMatter ? "▲" : "●"}
          word={flagsMatter ? "Flags move it" : "Flags do not move it"}
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
        Both averages are the same quantity over the same {data.window_minutes}-minute window, once with the flagged
        minutes and once without;{" "}
        {data.window_average_clean == null
          ? "the clean figure is not published for this read, so it is a dash rather than a repeat of the other."
          : flagsMatter
            ? "they differ, so today's flags move the number a contract settles on."
            : "they agree, so today's flags do not move the number a contract settles on."}{" "}
        A thin minute is one few stations agreed on.
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
            ? `This read reproduced the published value as the mean of its quality-controlled stations on all `
              + `${data.formation_checked} completed minutes, so the provisional figures below rest on evidence.`
            : `The rule did not reproduce the published value here, so nothing below should be traded on: ${data.formation_detail}`
        }
        missing={
          data.quorum_gaps > 0
            ? `${data.quorum_gaps} minutes are missing from the series. The venue omits a minute whose quorum failed, `
              + "so these are minutes the index was not computed rather than minutes it went unreported."
            : null
        }
      />

      <PendingMinutes rows={data.pending ?? []} units={data.units || "index units"} />

      <p className="coh-settle__note">
        Figures are in {data.units || "the index’s own units, which this read did not carry"}, as the feed states
        them. Coverage is one city: any other is answered as not covered rather than with an empty series, so nothing
        here is venue-wide.
      </p>

      <ReferenceRate state={data.reference_rate_state} detail={data.reference_rate_detail} />
    </>
  );
}

export interface SettlementPaneProps {
  /** False while another tab or another section is in front. */
  active: boolean;
  /** Which half the section is showing, or null on a view that shows neither. */
  view: "settlement" | "formation" | null;
}

export default function SettlementPane({ active, view }: SettlementPaneProps) {
  const { data, error } = useCoherenceRead<CoherenceSettlementFeed>(
    settlementRoute(PUBLISHED_CITY),
    active && (view === "settlement" || view === "formation"),
  );

  // The Baskets view asks nothing of this feed, so the pane neither polls nor
  // speaks: a "Reading the index…" line under the baskets would describe a read
  // that is not happening.
  if (view === null) return null;

  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The settlement feed could not be read: {error}.
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Reading the index the contract settles on…</p>;

  if (data.state === "not_covered") {
    return (
      <div className="coh-settle">
        <p className="console-empty">
          <span aria-hidden="true">○</span> {data.city ?? "That city"} is not covered. The venue publishes this index
          for one city only and answers any other request by naming the ones it has. {data.detail ? `${data.detail}.` : ""}
        </p>
        <ReferenceRate state={data.reference_rate_state} detail={data.reference_rate_detail} />
      </div>
    );
  }

  if (data.state !== "available" || !data.samples.length) {
    return (
      <div className="coh-settle">
        <p className="console-empty">
          <span aria-hidden="true">◌</span> No samples in this read ({data.state}). {data.detail ? `${data.detail}.` : ""}
        </p>
        <ReferenceRate state={data.reference_rate_state} detail={data.reference_rate_detail} />
      </div>
    );
  }

  return (
    <div className="coh-settle">
      {view === "settlement" ? <TodayReading data={data} /> : <Formation data={data} />}
      {/* Outside the switch: a refresh that failed left BOTH halves showing the
          previous answer, so both halves say so. */}
      {error ? (
        <p className="coh-settle__note">
          <span aria-hidden="true">✕</span> The last refresh failed: {error}. The readings above are the previous
          answer.
        </p>
      ) : null}
    </div>
  );
}
