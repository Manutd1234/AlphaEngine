"use client";

/**
 * The cost probe's answer: what the walk found, per venue and as a route.
 *
 * Split out of the probe card so the controls a trader operates and the
 * estimate they read are separate files. Nothing here holds state — every
 * figure is derived from the `tca` the probe passes down, so the table, the
 * route bar, the legend and the tiles cannot disagree about the same walk.
 *
 * `capBps` and `whatIfActive` come with it because the shortfall prose has to
 * name which constraint produced it: a cap the trader typed and an empty venue
 * set are different answers, and "no routable liquidity" would be wrong for
 * both.
 */

import DislocationStrip from "@/components/DislocationStrip";
import StatTile from "@/components/StatTile";
import { compact, fmt, usd } from "@/lib/format";
import type { liveTca } from "@/lib/livebook";

interface RouteEstimateProps {
  /** The walk itself — null until a live book exists on at least one venue. */
  tca: ReturnType<typeof liveTca>;
  dp: number;
  /** The typed slippage cap, in bps; undefined means uncapped. */
  capBps?: number;
  /** True when a venue set or a cap is narrowing the estimate. */
  whatIfActive: boolean;
}

export default function RouteEstimate({ tca, dp, capBps, whatIfActive }: RouteEstimateProps) {
  return (
    <>
      {tca ? (
        <>
          <div className="table-wrap" tabIndex={0} style={{ marginBottom: 14 }}>
            <table>
              <caption className="sr-only">Execution estimate per venue</caption>
              <thead>
                <tr>
                  <th scope="col">Venue</th>
                  <th scope="col">VWAP</th>
                  <th scope="col">Slippage</th>
                  <th scope="col">Levels</th>
                  <th scope="col">Fillable</th>
                </tr>
              </thead>
              <tbody>
                {tca.perVenue.map((e) => {
                  const excluded = tca.excludedVenues.includes(e.venue);
                  return (
                    <tr key={e.venue}>
                      <th scope="row" style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--grid)" }}>
                        {e.venue}
                        {excluded ? <span className="pill pill--info" style={{ marginLeft: 6 }}>excluded</span> : null}
                      </th>
                      <td>{fmt(e.vwap, dp)}</td>
                      <td className={(e.slippageBps ?? 0) > 10 ? "neg" : ""}>{fmt(e.slippageBps, 2)} bps</td>
                      <td className="muted">{e.levelsConsumed}</td>
                      <td className={e.fillable ? "pos" : "neg"}>
                        {e.fillable ? "yes" : `only $${compact(e.filledNotional)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Labels live in the legend below, not inside the segments: white
              text on the orange series-2 fill was ~3.2:1 — an AA failure the
              bar's size never left room to fix in place. */}
          <div
            role="img"
            aria-label={tca.legs.length
              ? `Route split: ${tca.legs.map((l) => `${l.venue} ${l.sharePct.toFixed(0)}%`).join(", ")}`
              : "No routable liquidity"}
            style={{ display: "flex", height: 18, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 4 }}
          >
            {tca.legs.length ? (
              <>
                {tca.legs.map((l, i) => (
                  <div
                    key={l.venue}
                    aria-hidden
                    style={{
                      /* Sized against the REQUEST, not the fill, so a capped
                         route visibly falls short of the bar. */
                      width: `${(l.notional / tca.requestedNotional) * 100}%`,
                      background: i === 0 ? "var(--series-1)" : "var(--series-2)",
                      /* 2px surface gap rather than a drawn border between fills */
                      boxShadow: i > 0 ? "inset 2px 0 0 var(--surface-1)" : undefined,
                    }}
                  />
                ))}
                {tca.cappedBy ? (
                  <div
                    aria-hidden
                    style={{
                      flex: 1,
                      background: "var(--surface-2)",
                      boxShadow: "inset 2px 0 0 var(--surface-1)",
                      borderLeft: "1px dashed var(--border)",
                    }}
                  />
                ) : null}
              </>
            ) : (
              <div style={{ width: "100%", background: "var(--surface-2)", display: "grid", placeItems: "center", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                {whatIfActive ? "no venue included in this what-if" : "no routable liquidity"}
              </div>
            )}
          </div>
          {tca.legs.length > 0 && (
            <div className="legend" aria-hidden>
              {tca.legs.map((l, i) => (
                <span key={l.venue}>
                  <i style={{ background: i === 0 ? "var(--series-1)" : "var(--series-2)" }} />
                  {l.venue} {l.sharePct.toFixed(0)}%
                </span>
              ))}
              {tca.cappedBy ? (
                <span>
                  <i style={{ background: "var(--surface-2)", border: "1px dashed var(--border)" }} />
                  {tca.cappedBy === "slippage" ? "capped" : "no depth"} ${compact(tca.requestedNotional - tca.filledNotional)}
                </span>
              ) : null}
            </div>
          )}
          {tca.cappedBy ? (
            <p className="muted" style={{ fontSize: "var(--fs-body)", marginBottom: 10 }}>
              Routable ${compact(tca.filledNotional)} of ${compact(tca.requestedNotional)}
              {tca.cappedBy === "slippage"
                ? ` — the remainder would breach the ${capBps} bps cap.`
                : " — the remainder finds no depth on the included venues."}
            </p>
          ) : null}

          <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <StatTile label="Blended VWAP" value={fmt(tca.vwap, dp)} note="aggressive: pay the spread, fill now" />
            <StatTile
              label="Slippage"
              value={tca.slippageBps == null ? "—" : `${fmt(tca.slippageBps, 2)} bps`}
              note="vs consolidated mid"
              tone={(tca.slippageBps ?? 0) > 10 ? "neg" : undefined}
            />
            <StatTile
              label="Passive (join touch)"
              value={tca.passive == null ? "—" : fmt(tca.passive.price, dp)}
              note={tca.passive?.spreadCaptureBps == null
                ? "no touch to join"
                : `earns ${fmt(tca.passive.spreadCaptureBps, 2)} bps — if filled; no guarantee`}
            />
            <StatTile
              label="Saved vs worst venue"
              value={tca.savingUsd == null ? "—" : usd(tca.savingUsd, 2)}
              note="on this order"
              tone={tca.savingUsd && tca.savingUsd > 0 ? "pos" : undefined}
            />
          </div>

          <DislocationStrip
            dislocation={tca.dislocation}
            venuesOnline={tca.perVenue.map((e) => e.venue)}
          />
        </>
      ) : (
        /* NOT "waiting for a live book on both venues", which is what this
           said and which the code has never required. `liveTca` bails only on
           an empty live set — `lib/livebook.ts`: `const live = snap.venues
           .filter(v => v.status === "live" && v.book.ok); if (!live.length)
           return null` — so the estimate appears with ONE venue streaming and
           this line is only ever on screen when NO venue is. Naming two of
           them told a reader watching a single-venue outage that the probe was
           still waiting on the other feed, when in fact both were dark.
           Rejected: "waiting for at least one live book", which states the
           threshold but not the state the reader is in. The wording below is
           the venue toggles' own, a few lines up in `RoutingProbe` ("No venue
           is streaming yet, so there is nothing to include or exclude"), so
           the two absences on this panel read as one voice. */
        <p className="muted" style={{ fontSize: "var(--fs-xl)" }}>
          No venue has a live book yet, so there is nothing to walk.
        </p>
      )}
    </>
  );
}
