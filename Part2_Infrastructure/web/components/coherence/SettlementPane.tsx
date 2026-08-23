"use client";

/**
 * What the contract actually resolves against, which is not the price you watch.
 *
 * A weather contract on this venue settles on the mean of a published index
 * over a window, and the number a screen shows is the latest print of that
 * index. Those are two different quantities and the gap between them —
 * `spot_minus_window` — is the basis a position carries for free. The figure
 * draws it as a bracket and states it in its own reading, which is why no lead
 * paragraph restates it three lines above: two copies of one number are two
 * things to keep in agreement, and the drawn one is the one with the evidence
 * beside it.
 *
 * The pane answers two questions, and they are two views of the section's
 * `.seg` rather than one long scroll. TODAY'S READING is the reading itself:
 * the figure, and the quality-control fields that decide whether the average
 * means anything — how many minutes the feed flagged, how many stations
 * contributed at the thinnest and thickest point, and which QC configuration
 * produced the numbers. The average is shown twice, with and without the
 * flagged minutes, since the only way to find out whether today's flags matter
 * is to see both. FORMATION is the machinery: whether the rule that turns
 * station readings into the published minute still reproduces it, what the
 * stations have reported that the exchange has not published yet, and the two
 * standing facts about the deployment.
 *
 * Those two are stated as facts, not errors. CF Benchmarks is gated on an
 * account ENTITLEMENT rather than on signing, so no demo key opens it and no
 * amount of retrying will; and exactly one city is published, so a request for
 * any other is answered `not_covered` rather than with an empty series.
 *
 * The unreadable states sit outside both views. A feed that could not be read
 * is reported whichever half of it the reader asked for.
 */

import { toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceSettlementFeed } from "@/lib/coherence/types-lab";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import IndexBasisChart from "./IndexBasisChart";
import { StateChip } from "./Figure";

/** The one city the venue publishes. Probed, not assumed — see the driver. */
const PUBLISHED_CITY = "miami";

function ReferenceRate({ state, detail }: { state: string; detail: string }) {
  if (state === "entitlement_required") {
    return (
      <p className="coh-settle__standing">
        <span aria-hidden="true">○</span> Reference rate withheld: the CF Benchmarks passthrough is gated on an
        account entitlement, not on request signing, so a demo key does not open it and retrying cannot — a standing
        property of this deployment, not a fault in this read. {detail ? `${detail}.` : ""}
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

/** The view that answers what today reads: the figure and its quality control. */
function TodayReading({ data }: { data: CoherenceSettlementFeed }) {
  // Compared as exact integers rather than as strings: "87.812" and "87.8120"
  // are the same number and a text comparison would report them as different.
  const average = toCenticents(data.window_average);
  const clean = toCenticents(data.window_average_clean);
  const flagsMatter = average != null && clean != null && average !== clean;
  const contributors =
    data.contributors_min == null || data.contributors_max == null
      ? null
      : data.contributors_min === data.contributors_max
        ? `${data.contributors_min} throughout`
        : `${data.contributors_min} at the thinnest, ${data.contributors_max} at the thickest`;

  return (
    <>
      <h4>Today&rsquo;s reading: the average this contract settles against, not its latest print</h4>

      {/* One chip, because the other four each restated something drawn or
          tabulated within this same view: the average and the flag count are
          rows of the table below, and the latest print and the basis are the
          bracket and the label at the right-hand edge of the figure. */}
      <div className="coh-status__chips">
        <StateChip mark="●" word="City" value={data.city ?? "—"} tone="muted" />
      </div>

      <IndexBasisChart
        samples={data.samples}
        windowMinutes={data.window_minutes}
        windowAverage={data.window_average}
        windowAverageClean={data.window_average_clean}
        latestValue={data.latest_value}
        spotMinusWindow={data.spot_minus_window}
      />

      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Quality control, as the feed publishes it. The two averages are the same quantity computed over the same
            window, once with the flagged minutes and once without.
          </caption>
          <thead>
            <tr>
              <th scope="col">Reading</th>
              <th scope="col" className="num">Value</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Window average</th>
              <td className="num">{data.window_average ?? "—"}</td>
              <td>Every minute in the {data.window_minutes}-minute window, flagged ones included.</td>
            </tr>
            <tr>
              <th scope="row">Window average, flagged excluded</th>
              <td className="num">{data.window_average_clean ?? "—"}</td>
              <td>
                {data.window_average_clean == null
                  ? "Not published for this read; a dash, not a repeat of the figure above."
                  : flagsMatter
                    ? "Different from the figure above, so the flags move the number today."
                    : "The same number as above, so the flags do not move it today."}
              </td>
            </tr>
            <tr>
              <th scope="row">Flagged minutes</th>
              <td className="num">{data.degraded_samples}</td>
              <td>Of {data.sample_count} samples in the read, marked ▲ on the chart.</td>
            </tr>
            <tr>
              <th scope="row">Contributing stations</th>
              <td className="num">
                {data.contributors_min == null || data.contributors_max == null
                  ? "—"
                  : `${data.contributors_min} to ${data.contributors_max}`}
              </td>
              <td>{contributors ? `${contributors}; a thin minute is one few stations agreed on.` : "Not published in this read."}</td>
            </tr>
            <tr>
              <th scope="row">QC configuration</th>
              <td className="num">{data.config_version || "—"}</td>
              <td>The version of the quality-control rules that produced these flags.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The view that answers how the number is made, and what is still owed. */
function Formation({ data }: { data: CoherenceSettlementFeed }) {
  const pending = data.pending ?? [];
  return (
    <>
      <h4>Formation: how this index is formed, and what it has not published yet</h4>

      {/* Four independent measurements, so four rows rather than one run of
          prose that welded them together and could only be read in order. */}
      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            What this read could establish about the machinery behind the published minute.
          </caption>
          <thead>
            <tr>
              <th scope="col">Reading</th>
              <th scope="col" className="num">Value</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Formation rule reproduced</th>
              <td className="num">
                {data.formation_agreed} of {data.formation_checked}
              </td>
              <td>
                Completed minute(s) whose published value this read reproduced as the mean of the member stations
                that cleared quality control — a rule this read tests rather than assumes.
              </td>
            </tr>
            <tr>
              <th scope="row">Does the rule hold</th>
              <td className="num">
                <span aria-hidden="true">{data.formation_holds ? "●" : "▲"}</span>{" "}
                {data.formation_holds ? "Holds" : "Does not hold"}
              </td>
              <td>
                {data.formation_holds
                  ? "It holds here, so the provisional figures below rest on evidence."
                  : `It does not hold here, so nothing below should be traded on: ${data.formation_detail}`}
              </td>
            </tr>
            <tr>
              <th scope="row">Member stations</th>
              <td className="num">{data.stations.length || "—"}</td>
              <td>
                {data.stations.length
                  ? `Stations: ${data.stations.join(", ")}.`
                  : "This read carried no per-station detail."}
              </td>
            </tr>
            <tr>
              <th scope="row">Minutes missing from the series</th>
              <td className="num">{data.quorum_gaps}</td>
              <td>
                {data.quorum_gaps > 0
                  ? "The venue omits a minute whose quorum failed, so these are minutes the index was not computed rather than minutes it went unreported."
                  : "No minute is missing from the series, so the window average is over a continuous window."}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {pending.length === 0 ? (
        <p className="coh-settle__note">
          <span aria-hidden="true">◌</span> No minute is inside the receipt deadline right now, so there is nothing
          the stations have reported that the exchange has not already published.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="coh-table">
            <caption className="coh-table__caption">
              Minutes the stations have reported and the exchange has not published an index for. The index arrives
              in two stages, so inside this window the next value is arithmetic on data already handed over rather
              than a forecast. The spread is how far the stations disagree: a wide one means the mean beside it
              averages readings that do not agree.
            </caption>
            <thead>
              <tr>
                <th scope="col">Minute</th>
                <th scope="col" className="num">Provisional index</th>
                <th scope="col" className="num">Station spread</th>
                <th scope="col" className="num">Stations in</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.ts_ms}>
                  <th scope="row">{new Date(row.ts_ms).toISOString().slice(11, 16)} UTC</th>
                  <td className="num">{row.provisional ?? "—"}</td>
                  <td className="num">{row.spread ?? "—"}</td>
                  <td className="num">{row.stations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="coh-settle__note">
        Figures are in {data.units || "the index\u2019s own units, which this read did not carry"}, as the feed states
        them. Coverage is one city: a request for any other is answered as not covered rather than with an empty
        series, so nothing here should be read as venue-wide.
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
    `/api/gateway/coherence/settlement?city=${PUBLISHED_CITY}`,
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
