"use client";

/**
 * What the makers disagree about, where the public book shows nothing.
 *
 * A book publishes one number, the best bid, and that is the most aggressive
 * opinion on it rather than the typical one. For a combo there is usually no
 * book at all. The request-for-quote channel is the one place the venue
 * exposes several professionals pricing the same joint probability
 * independently, and the spread between their answers is a quantity nothing
 * else here can produce.
 *
 * Reading it requires signing, so this pane's job is mostly to keep four
 * outcomes apart that a single "no data" would flatten into one:
 *
 *   - `signing_unavailable` — nothing was asked. No key, or no signing
 *     library. That is NO VIEW of the channel, which is a fact about this
 *     deployment, not about the market.
 *   - `refused` — the request was signed and the venue said no. The channel
 *     answered; this deployment is not admitted to it.
 *   - `empty` — the read succeeded and there is nothing on it. Makers do not
 *     quote a sandbox, so on demo this is the expected state and it is a
 *     measurement, not an absence.
 *   - `available` — quotes in hand.
 *
 * Two quantities in the table are routinely conflated and are kept apart:
 * `spread` is the disagreement BETWEEN makers, `median_width` is one maker's
 * own bid-offer. A wide panel of tight makers and a tight panel of wide makers
 * are opposite situations and would read identically if either number stood
 * alone.
 */

import type { CoherenceDispersion, CoherenceRfqPanel } from "@/lib/coherence/types-lab";
import { rfqRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { StateChip } from "./Figure";

/** Below this many independent makers a spread is an anecdote, not a distribution. */
const THIN_PANEL = 3;

function StateExplanation({ panel }: { panel: CoherenceRfqPanel }) {
  const detail = panel.detail ? `${panel.detail}.` : "";
  if (panel.state === "signing_unavailable") {
    return (
      <div className="coh-rfq__state">
        <p className="coh-rfq__lead">
          <span aria-hidden="true">○</span> No view of the channel at all. The RFQ endpoints are signed-only, and this
          deployment has no demo key configured or no signing library present, so the request was never made.
        </p>
        <p className="coh-rfq__note">
          This is not an empty market. An empty market is a fact about what makers are quoting; this is a fact about
          this deployment&rsquo;s credentials, and the two would look the same only if both were reported as nothing.
          {detail ? ` The gateway says: ${detail}` : ""}
        </p>
      </div>
    );
  }
  if (panel.state === "refused") {
    return (
      <div className="coh-rfq__state">
        <p className="coh-rfq__lead">
          <span aria-hidden="true">✕</span> Signed and rejected. The request carried a signature and the venue turned
          it down — a wrong key, a key for another environment, or a host that does not know it.
        </p>
        <p className="coh-rfq__note">
          The channel answered, which is stronger than silence: it exists, it is reachable, and this deployment is
          not admitted to it. The same credential will be refused again.
          {detail ? ` The gateway says: ${detail}` : ""}
        </p>
      </div>
    );
  }
  if (panel.state === "empty") {
    return (
      <div className="coh-rfq__state">
        <p className="coh-rfq__lead">
          <span aria-hidden="true">◌</span> Read successfully, and there is nothing on it. Zero open requests is what
          the channel returned, not what happened when it could not be read.
        </p>
        <p className="coh-rfq__note">
          Makers do not quote a sandbox, so an empty demo channel is the expected state rather than a quiet market.
          The zero here is a measurement.{detail ? ` The gateway says: ${detail}` : ""}
        </p>
      </div>
    );
  }
  if (panel.state !== "available") {
    // A fifth state would be the gateway saying something this pane has not been
    // taught. It is named rather than folded into the nearest of the four.
    return (
      <div className="coh-rfq__state">
        <p className="coh-rfq__lead">
          <span aria-hidden="true">◌</span> The gateway answered with a state this pane does not know:{" "}
          {panel.state}. It is shown as itself rather than read as one of the four.
        </p>
        {detail ? <p className="coh-rfq__note">{detail}</p> : null}
      </div>
    );
  }
  return (
    <div className="coh-rfq__state">
      <p className="coh-rfq__lead">
        <span aria-hidden="true">●</span> Quotes in hand. {panel.open_requests} open request
        {panel.open_requests === 1 ? "" : "s"}, {panel.dispersions.length} market
        {panel.dispersions.length === 1 ? "" : "s"} with a dispersion to report.
      </p>
      {detail ? <p className="coh-rfq__note">{detail}</p> : null}
    </div>
  );
}

function Row({ row }: { row: CoherenceDispersion }) {
  const band = row.lowest == null || row.highest == null ? "—" : `${row.lowest} to ${row.highest}`;
  return (
    <tr>
      <th scope="row">{row.market_ticker}</th>
      <td className="num">{row.quotes}</td>
      <td className="num">{row.usable}</td>
      <td className="num">{row.median ?? "—"}</td>
      <td className="num">{band}</td>
      <td className="num">{row.spread ?? "—"}</td>
      <td className="num">{row.median_width ?? "—"}</td>
      <td className="num">{row.crossed}</td>
      <td className="num">{row.band_width ?? "—"}</td>
      <td className="num">{row.band_fraction ?? "—"}</td>
      <td>
        {row.thin ? (
          <span>
            <span aria-hidden="true">▲</span> thin, fewer than {THIN_PANEL} makers
          </span>
        ) : (
          <span>
            <span aria-hidden="true">●</span> {THIN_PANEL} makers or more
          </span>
        )}
      </td>
      <td>{row.detail}</td>
    </tr>
  );
}

export default function RfqPane({ active }: { active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceRfqPanel>(rfqRoute(), active);

  // A co-equal half of the section deserves a title of its own. Without one the
  // dispersion view opened on a chip row, and a reader arriving from the ladder
  // had nothing telling them the subject had changed.
  const heading = <h4 className="coh-event__title">Maker dispersion</h4>;

  if (error && !data) {
    return (
      <div className="coh-rfq">
        {heading}
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The RFQ panel could not be read: {error}. That is this desk failing to
          reach its own gateway, not the venue answering.
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="coh-rfq">
        {heading}
        <p className="console-empty muted">Asking what the makers disagree about…</p>
      </div>
    );
  }

  const available = data.state === "available";

  return (
    <div className="coh-rfq">
      {heading}

      {/* Only the chips the table cannot say. The row count, the thin panels and
          the crossed quotes are the Panel and Crossed columns read twice. */}
      <div className="coh-status__chips">
        <StateChip
          mark={
            available ? "●" : data.state === "refused" ? "✕" : data.state === "signing_unavailable" ? "○" : "◌"
          }
          word={
            available
              ? "Quotes in hand"
              : data.state === "refused"
                ? "Signed and refused"
                : data.state === "empty"
                  ? "Read, and empty"
                  : data.state === "signing_unavailable"
                    ? "No view, unsigned"
                    : `State ${data.state}`
          }
          tone={available ? "good" : data.state === "refused" ? "critical" : "muted"}
        />
        <StateChip mark="◇" word="Open requests" value={String(data.open_requests)} tone="muted" />
      </div>

      <StateExplanation panel={data} />

      {available && data.dispersions.length ? (
        <>
          <div className="table-wrap">
            <table className="coh-table">
              <caption className="coh-table__caption">
                One row per market a panel answered on. The Frechet band is how far the parlay could move with no
                leg price moving; the share is how much of that room the makers disagree over. A small share means
                professionals agree, a share near one means the legs are the only constraint, and neither is a
                mispricing. Both are blank where no combo reading covers the market: an unmeasured ratio is not a
                ratio of zero. Spread is the disagreement between makers, median width is one maker&rsquo;s own
                bid-offer — opposite situations that read the same if only one is shown.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Market</th>
                  <th scope="col" className="num">Quotes</th>
                  <th scope="col" className="num">Usable</th>
                  <th scope="col" className="num">Median</th>
                  <th scope="col" className="num">Lowest to highest</th>
                  <th scope="col" className="num">Spread between makers</th>
                  <th scope="col" className="num">Median maker width</th>
                  <th scope="col" className="num">Crossed</th>
                  <th scope="col" className="num">Band the legs leave</th>
                  <th scope="col" className="num">Share of it used</th>
                  <th scope="col">Panel</th>
                  <th scope="col">Reading</th>
                </tr>
              </thead>
              <tbody>
                {data.dispersions.map((row) => (
                  <Row key={row.market_ticker} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="coh-rfq__note">
            Crossed quotes are counted and excluded, never averaged in: a quote whose two sides bid to more than a
            dollar between them was priced at two different moments, and treating it as one view would move the median
            toward a price nobody held. A dash is a quantity the panel could not produce — a single-quote market has a
            median and no spread — and it is never shown as zero.
          </p>
        </>
      ) : null}

      {error ? (
        <p className="coh-rfq__note">
          <span aria-hidden="true">✕</span> The last refresh failed: {error}. What is above is the previous answer.
        </p>
      ) : null}
    </div>
  );
}
