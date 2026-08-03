"use client";

/**
 * Live market view — streaming L2 books and execution cost, in the browser.
 *
 * The books arrive over WebSockets opened straight to Binance and Bybit; nothing
 * here goes through the API. The same numbers are available as REST snapshots at
 * `/api/depth` and `/api/tca` for non-browser callers.
 */

import { useState } from "react";

import DepthChart from "@/components/DepthChart";
import StatTile from "@/components/StatTile";
import { liveTca, useLiveBook } from "@/lib/livebook";
import { SYMBOLS, type Side } from "@/lib/venues";
import { compact, fmt, priceDp, usd } from "@/lib/format";

const PROBE_SIZES = [10_000, 50_000, 100_000, 250_000, 1_000_000];

const STATUS_STYLE = {
  live: { color: "var(--status-good)", icon: "●", label: "live" },
  connecting: { color: "var(--text-muted)", icon: "◌", label: "connecting" },
  stale: { color: "var(--status-warning)", icon: "▲", label: "stale" },
  error: { color: "var(--status-critical)", icon: "✕", label: "down" },
} as const;

export default function LiveMarket() {
  const [symbol, setSymbol] = useState<string>(SYMBOLS[0]);
  const [side, setSide] = useState<Side>("BUY");
  const [notional, setNotional] = useState(100_000);

  const snap = useLiveBook(symbol);
  const tca = liveTca(snap, side, notional);
  const dp = snap?.consolidatedMid ? priceDp(snap.consolidatedMid) : 2;

  const ladder = (rows: [number, number][], kind: "bid" | "ask") => {
    const top = rows.slice(0, 12);
    let cum = 0;
    const withCum = top.map(([p, q]) => {
      cum += p * q;
      return { p, q, cum };
    });
    const max = withCum.at(-1)?.cum ?? 1;
    const colour = kind === "bid" ? "var(--diverging-pos)" : "var(--diverging-neg)";
    const rowsOut = kind === "ask" ? [...withCum].reverse() : withCum;

    return rowsOut.map(({ p, q, cum: c }) => (
      <div
        key={`${kind}-${p}`}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          padding: "3px 6px",
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: `${(c / max) * 100}%`,
            background: colour,
            opacity: 0.14,
            borderRadius: 3,
          }}
        />
        <span style={{ position: "relative", color: colour }}>{fmt(p, dp)}</span>
        <span style={{ position: "relative", textAlign: "right", color: "var(--text-secondary)" }}>
          {fmt(q, 4)}
        </span>
        <span style={{ position: "relative", textAlign: "right", color: "var(--text-muted)" }}>
          {compact(c)}
        </span>
      </div>
    ));
  };

  return (
    <>
      <div className="card">
        <h2>Instrument</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              aria-pressed={s === symbol}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                padding: "6px 12px",
                background: s === symbol ? "var(--series-1)" : "var(--surface-2)",
                color: s === symbol ? "#fff" : "var(--text-secondary)",
                borderColor: s === symbol ? "var(--series-1)" : "var(--border)",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
          {(snap?.venues ?? []).map((v) => {
            const st = STATUS_STYLE[v.status];
            return (
              <span key={v.venue} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {/* status = icon + label + colour, never colour alone */}
                <span aria-hidden style={{ color: st.color }}>{st.icon}</span>
                <b>{v.venue}</b>
                <span className="muted">{st.label}</span>
                {v.status === "live" && (
                  <span className="num muted">
                    · {v.updates} upd{v.book.latencyMs ? ` · ${fmt(v.book.latencyMs, 0)}ms` : ""}
                  </span>
                )}
                {v.reconnects > 0 && <span className="num muted">· {v.reconnects} reconnects</span>}
              </span>
            );
          })}
          {!snap && <span className="muted">opening sockets…</span>}
        </div>
      </div>

      <div className="tiles" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <StatTile label="Consolidated mid" value={fmt(snap?.consolidatedMid, dp)} note={`${snap?.venues.filter((v) => v.status === "live").length ?? 0} venues live`} />
        <StatTile
          label="Spread"
          value={snap?.spreadBps == null ? "—" : `${fmt(snap.spreadBps, 2)} bps`}
          note={snap?.spreadBps != null && snap.spreadBps < 0 ? "crossed across venues" : "consolidated"}
          tone={snap?.spreadBps != null && snap.spreadBps < 0 ? "pos" : undefined}
        />
        <StatTile label="Bid depth" value={`$${compact(snap?.depthUsdBid ?? 0)}`} note="within ±10 bps of mid" />
        <StatTile label="Ask depth" value={`$${compact(snap?.depthUsdAsk ?? 0)}`} note="within ±10 bps of mid" />
        <StatTile
          label="Imbalance"
          value={snap?.imbalance == null ? "—" : `${(snap.imbalance * 100).toFixed(1)}%`}
          note={snap?.imbalance == null ? "" : snap.imbalance > 0 ? "bid heavy" : "ask heavy"}
          tone={snap?.imbalance == null ? undefined : snap.imbalance > 0 ? "pos" : "neg"}
        />
      </div>

      <div className="card">
        <h2>Cumulative depth</h2>
        <p className="sub">
          How much size sits between the mid and any price. A near-vertical step is a wall; a
          shallow ramp is a thin book that will cost you to cross.
        </p>
        <DepthChart
          bids={snap?.merged.bids ?? []}
          asks={snap?.merged.asks ?? []}
          mid={snap?.consolidatedMid ?? null}
        />
      </div>

      <div className="card">
        <h2>Consolidated ladder</h2>
        <p className="sub">Every venue&apos;s levels merged and sorted by price — the book a smart router actually walks.</p>
        <div style={{ fontFamily: "var(--mono)" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-muted)",
              padding: "0 6px 6px",
            }}
          >
            <span>Price</span>
            <span style={{ textAlign: "right" }}>Size</span>
            <span style={{ textAlign: "right" }}>Cum $</span>
          </div>
          {snap ? ladder(snap.merged.asks, "ask") : null}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 6px",
              margin: "4px 0",
              borderTop: "1px solid var(--grid)",
              borderBottom: "1px solid var(--grid)",
            }}
          >
            <span className="num" style={{ fontSize: 17, fontWeight: 650 }}>
              {fmt(snap?.consolidatedMid, dp)}
            </span>
            <span className="num muted" style={{ fontSize: 11.5 }}>
              spread {fmt(snap?.spreadBps, 2)} bps
            </span>
          </div>
          {snap ? ladder(snap.merged.bids, "bid") : <div className="muted" style={{ padding: 16, textAlign: "center" }}>waiting for book…</div>}
        </div>
      </div>

      <div className="card">
        <h2>Execution cost probe</h2>
        <p className="sub">
          Walk the live ladder for a target order and see what it would actually cost, plus the
          cross-venue split that minimises it.
        </p>

        <div className="row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1.4 }}>
            <label className="field" htmlFor="probe">Target notional (USD)</label>
            <input
              id="probe"
              type="number"
              min={100}
              step={10000}
              value={notional}
              onChange={(e) => setNotional(Math.max(100, Number(e.target.value) || 0))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field">Side</label>
            <div className="seg">
              {(["BUY", "SELL"] as Side[]).map((s) => (
                <button key={s} aria-pressed={s === side} onClick={() => setSide(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {PROBE_SIZES.map((n) => (
            <button key={n} className="icon" onClick={() => setNotional(n)} style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
              ${compact(n)}
            </button>
          ))}
        </div>

        {tca ? (
          <>
            <div className="table-wrap" style={{ marginBottom: 14 }}>
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
                  {tca.perVenue.map((e) => (
                    <tr key={e.venue}>
                      <th scope="row" style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--grid)" }}>
                        {e.venue}
                      </th>
                      <td>{fmt(e.vwap, dp)}</td>
                      <td className={(e.slippageBps ?? 0) > 10 ? "neg" : ""}>{fmt(e.slippageBps, 2)} bps</td>
                      <td className="muted">{e.levelsConsumed}</td>
                      <td className={e.fillable ? "pos" : "neg"}>
                        {e.fillable ? "yes" : `only $${compact(e.filledNotional)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 12 }}>
              {tca.legs.length ? (
                tca.legs.map((l, i) => (
                  <div
                    key={l.venue}
                    style={{
                      width: `${l.sharePct}%`,
                      background: i === 0 ? "var(--series-1)" : "var(--series-2)",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      fontWeight: 700,
                      /* 2px surface gap rather than a drawn border between fills */
                      boxShadow: i > 0 ? "inset 2px 0 0 var(--surface-1)" : undefined,
                    }}
                  >
                    {l.venue} {l.sharePct.toFixed(0)}%
                  </div>
                ))
              ) : (
                <div style={{ width: "100%", background: "var(--surface-2)", display: "grid", placeItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
                  no routable liquidity
                </div>
              )}
            </div>

            <div className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
              <StatTile label="Blended VWAP" value={fmt(tca.vwap, dp)} note="smart route" />
              <StatTile
                label="Slippage"
                value={tca.slippageBps == null ? "—" : `${fmt(tca.slippageBps, 2)} bps`}
                note="vs consolidated mid"
                tone={(tca.slippageBps ?? 0) > 10 ? "neg" : undefined}
              />
              <StatTile
                label="Saved vs worst venue"
                value={tca.savingUsd == null ? "—" : usd(tca.savingUsd, 2)}
                note="on this order"
                tone={tca.savingUsd && tca.savingUsd > 0 ? "pos" : undefined}
              />
            </div>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Waiting for a live book on both venues…</p>
        )}
      </div>

      <div className="card">
        <h2>How this works</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          The ladders above stream over WebSockets opened directly from your browser to Binance and
          Bybit — a serverless function cannot hold a subscription open between invocations, so
          routing ticks through an API would add a hop and a cost for nothing. The same numbers are
          available as REST snapshots at <code>/api/depth</code> and <code>/api/tca</code> for
          non-browser callers, computed with identical maths. Pre-trade risk checks and the
          execution kill-switch live on the always-on gateway, which is what the Telegram bot talks
          to.
        </p>
      </div>
    </>
  );
}
