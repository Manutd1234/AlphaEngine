"use client";

/**
 * What the contract actually resolves against, which is not the price you watch.
 *
 * A weather contract on this venue settles on the mean of a published index
 * over a window, and the number a screen shows is the latest print of that
 * index. Those are two different quantities and the gap between them —
 * `spot_minus_window` — is the basis a position carries for free. It is the
 * headline of this pane for that reason, and it is drawn as well as printed.
 *
 * The quality-control fields are shown beside it rather than under a
 * disclosure, because they decide whether the average means anything: how many
 * minutes the feed flagged, how many stations contributed at the thinnest and
 * thickest point, and which QC configuration produced the numbers. The average
 * is shown twice, with and without the flagged minutes, since the only way to
 * find out whether today's flags matter is to see both.
 *
 * Two facts about the deployment are stated as facts, not errors. CF
 * Benchmarks is gated on an account ENTITLEMENT rather than on signing, so no
 * demo key opens it and no amount of retrying will; and exactly one city is
 * published, so a request for any other is answered `not_covered` rather than
 * with an empty series.
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
        account entitlement, not on request signing, so a demo key does not open it and retrying cannot. That is a
        standing property of this deployment rather than a fault in this read. {detail ? `${detail}.` : ""}
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

function Formation({ data }: { data: CoherenceSettlementFeed }) {
  const pending = data.pending ?? [];
  return (
    <section className="coh-settle__formation">
      <h4>How this index is formed, and what it has not published yet</h4>
      <p className="coh-settle__note">
        The published minute is the mean of the member stations that cleared quality control. That is a rule this
        read TESTS rather than assumes: it reproduced the published value on{" "}
        {data.formation_agreed} of {data.formation_checked} completed minute(s).{" "}
        {data.formation_holds ? (
          <>
            <span aria-hidden="true">●</span> It holds here, so the provisional figures below rest on evidence.
          </>
        ) : (
          <>
            <span aria-hidden="true">▲</span> It does not hold here, so nothing below should be traded on:{" "}
            {data.formation_detail}
          </>
        )}{" "}
        {data.stations.length
          ? `Stations: ${data.stations.join(", ")}.`
          : "This read carried no per-station detail."}{" "}
        {data.quorum_gaps > 0
          ? `${data.quorum_gaps} minute(s) are missing from the series entirely — the venue omits a minute whose quorum failed, so those are minutes the index was not computed rather than minutes it went unreported.`
          : "No minute is missing from the series, so the average above is over a continuous window."}
      </p>
      {pending.length === 0 ? (
        <p className="coh-settle__note">
          <span aria-hidden="true">◌</span> No minute is inside the receipt deadline right now, so there is nothing
          the stations have reported that the exchange has not already published.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="coh-table">
            <caption className="coh-table__caption">
              Minutes the stations have reported and the exchange has not published an index for. The index arrives in
              two stages, so inside this window the next value is arithmetic on data already handed over rather than a
              forecast. The spread is how far the stations disagree: a wide one means the mean beside it is a mean of
              readings that do not agree.
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
    </section>
  );
}

export default function SettlementPane({ active }: { active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceSettlementFeed>(
    `/api/gateway/coherence/settlement?city=${PUBLISHED_CITY}`,
    active,
  );

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
    <div className="coh-settle">
      <div className="coh-status__chips">
        <StateChip mark="●" word="City" value={data.city ?? "—"} tone="muted" />
        <StateChip mark="◇" word="Latest print" value={data.latest_value ?? "—"} tone="muted" />
        <StateChip
          mark="✓"
          word={`${data.window_minutes}-minute average`}
          value={data.window_average ?? "—"}
          tone="good"
        />
        <StateChip
          mark={data.spot_minus_window == null ? "◌" : "▲"}
          word="Basis, latest minus average"
          value={data.spot_minus_window ?? "—"}
          tone={data.spot_minus_window == null ? "muted" : "warn"}
        />
        <StateChip
          mark={data.degraded_samples ? "▲" : "✓"}
          word="Flagged minutes"
          value={String(data.degraded_samples)}
          tone={data.degraded_samples ? "warn" : "good"}
        />
      </div>

      <p className="coh-settle__lead">
        {data.spot_minus_window == null ? (
          <>
            The basis could not be computed for this read, so it is shown as a dash rather than as zero — a missing
            difference and a difference of nothing are not the same claim.
          </>
        ) : (
          <>
            This contract resolves against the mean of the last {data.window_minutes} minutes of the published index,
            not against its latest print. Today those two readings are {data.spot_minus_window} apart, and anyone
            trading the print is carrying that difference whether they priced it or not.
          </>
        )}
      </p>

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
              <td>Every minute in the window, flagged ones included.</td>
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

      <Formation data={data} />

      <p className="coh-settle__note">
        Figures are in {data.units || "the index\u2019s own units, which this read did not carry"}, as the feed states
        them. Coverage is one city: a request for any other is answered as not covered rather than with an empty
        series, so nothing here should be read as venue-wide.
      </p>

      <ReferenceRate state={data.reference_rate_state} detail={data.reference_rate_detail} />

      {error ? (
        <p className="coh-settle__note">
          <span aria-hidden="true">✕</span> The last refresh failed: {error}. The readings above are the previous
          answer.
        </p>
      ) : null}
    </div>
  );
}
