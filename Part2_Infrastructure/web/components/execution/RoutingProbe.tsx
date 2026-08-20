"use client";

/**
 * The execution cost probe, and the what-if constraints that narrow it.
 *
 * Split out of `LiveMarket` whole: the research hand-off, the target-notional
 * controls, the client-side what-if panel and the methodology disclosure. The
 * estimate they produce renders in `RouteEstimate` below them.
 *
 * The what-if state lives here rather than a level up because nothing else
 * reads it. A null include-list means every venue and an empty cap string means
 * uncapped, so the default call is opts-free and stays on the gateway-parity
 * path — a probe that quietly applied a constraint would be answering a
 * different question from the one `/api/tca` answers.
 */

import { useState } from "react";

import { compact } from "@/lib/format";
import { liveTca, type LiveSnapshot } from "@/lib/livebook";
import { STRATEGY_LABELS, type SweepResponse } from "@/lib/types";
import type { Side } from "@/lib/venues";

import RouteEstimate from "./RouteEstimate";

const PROBE_SIZES = [10_000, 50_000, 100_000, 250_000, 1_000_000];

interface RoutingProbeProps {
  symbol: string;
  snap: LiveSnapshot | null;
  dp: number;
  side: Side;
  onSideChange: (side: Side) => void;
  notional: number;
  onNotionalChange: (notional: number) => void;
  research: SweepResponse | null;
  onOpenResearch: () => void;
  onOpenData: () => void;
}

export default function RoutingProbe({
  symbol,
  snap,
  dp,
  side,
  onSideChange,
  notional,
  onNotionalChange,
  research,
  onOpenResearch,
  onOpenData,
}: RoutingProbeProps) {
  // What-if constraints for the probe only: null include-list means every
  // venue, and an empty cap string means uncapped, so the default call is
  // opts-free and stays on the gateway-parity path.
  const [includedVenues, setIncludedVenues] = useState<string[] | null>(null);
  const [capText, setCapText] = useState("");
  const capBps = Number.isFinite(parseFloat(capText)) ? parseFloat(capText) : undefined;
  const whatIfActive = includedVenues !== null || capBps !== undefined;
  const tca = liveTca(
    snap,
    side,
    notional,
    whatIfActive ? { venues: includedVenues ?? undefined, maxSlippageBps: capBps } : undefined,
  );

  const costVsModel = tca?.slippageBps == null || !research
    ? null
    : tca.slippageBps - research.request.slippageBps;

  return (
    <>
      {research?.request.symbol === symbol && (
        <div className="workflow-handoff execution-handoff">
          <div>
            <span className="page-kicker">Research context attached</span>
            <strong>{STRATEGY_LABELS[research.request.strategy]} {research.best.fast}/{research.best.slow}, {research.verdict.level.toUpperCase()}</strong>
            <small>
              Model budget {research.request.slippageBps} bps
              {costVsModel == null
                ? "; live impact pending"
                : `; live impact is ${Math.abs(costVsModel).toFixed(2)} bps ${costVsModel <= 0 ? "inside" : "above"} budget`}
            </small>
          </div>
          <div>
            <button onClick={onOpenResearch}>Review evidence</button>
            <button onClick={onOpenData}>Verify feed</button>
          </div>
        </div>
      )}

    <div className="card">
      <h2>Execution cost probe</h2>
      {/* "see what it would actually cost" was the h2 above it in a longer
          form. What the heading does not say is that the walk is over the
          live ladder rather than a model, and that the split comes with it. */}
      <p className="sub">
        Walks the live ladder for a target order, and the cross-venue split
        that minimises it.
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
            onChange={(e) => onNotionalChange(Math.max(100, Number(e.target.value) || 0))}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field">Side</label>
          {/* The only `.seg` in the app that carried neither `role="group"`
              nor a name, so a screen reader met two loose buttons rather than
              a two-way choice. Not `seg--side`: this is the cost probe's
              input, not an order ticket — nothing here can be submitted, so
              it takes the same quiet selection as every other filter. */}
          <div className="seg" role="group" aria-label="Probe side">
            {(["BUY", "SELL"] as Side[]).map((s) => (
              <button key={s} type="button" aria-pressed={s === side} onClick={() => onSideChange(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Shortcuts into the notional field above, and now they say so.
          They were five loose buttons in a bare flex div — no group, no name,
          and no `aria-pressed`, so a screen reader met five unrelated actions
          and could not tell which size the probe was actually running.

          Not a `.seg`: five options against that control's two-or-three
          budget, and `.seg button` is `flex: 1`, so a fifth segment buys the
          grouping by abbreviating every label. A named group of toggles keeps
          the full amounts.

          The pressed state is carried by a mark rather than by a fill,
          because `.icon` has no selected treatment and inventing one would
          need a rule in globals.css. `aria-pressed` and the ✓ say the same
          thing, so neither audience is reading state off colour — and when
          the trader types an amount by hand, none is marked, which is honest:
          the input, not this row, holds the value. */}
      <div
        role="group"
        aria-label="Target notional shortcuts"
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}
      >
        {PROBE_SIZES.map((n) => (
          <button
            key={n}
            type="button"
            className="icon"
            aria-pressed={notional === n}
            title={`Set the target notional to $${compact(n)}`}
            onClick={() => onNotionalChange(n)}
            style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-body)" }}
          >
            {notional === n ? <span aria-hidden>✓ </span> : null}
            ${compact(n)}
          </button>
        ))}
      </div>

      {/* A div with role="group", not a <fieldset>/<legend>. The legend's UA
          rendering places it IN the border, straddling it — and nothing in
          this sheet overrides that, because app/tailwind.css deliberately
          ships no preflight and a preflight is what normally neutralises it.
          A heading inside the box is what was wanted, and this also drops
          fieldset's `min-width: min-content`, which fights flex children. */}
      <div
        className="whatif-constraints"
        role="group"
        aria-labelledby="whatif-constraints-title"
      >
        <p className="page-kicker" id="whatif-constraints-title">
          What-if constraints — client-side only
        </p>
        {/* Urgency presets. The probe's honest levers are the venue set and
            the slippage cap, so that is all a preset writes — into the same
            visible inputs, never hidden state. Passive accepts only cheap
            liquidity; aggressive takes the book as it comes. */}
        <div className="whatif-constraints__row">
          <div>
            <span className="field">Routing strategy</span>
            <div className="seg" role="group" aria-label="What-if routing urgency preset">
              {([
                { label: "Passive", cap: "1" },
                { label: "Balanced", cap: "3" },
                { label: "Aggressive", cap: "" },
              ] as const).map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={capText === preset.cap && includedVenues === null}
                  disabled={snap?.consolidatedMid == null && preset.cap !== ""}
                  onClick={() => {
                    setCapText(preset.cap);
                    setIncludedVenues(null);
                  }}
                  title={preset.cap === "" ? "All venues, uncapped" : `All venues, max slippage ${preset.cap} bps`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          {/* Same row as the strategy that these two qualify; flex-wrap still
              drops them under it when the panel cannot hold all three. */}
          <div>
            <span className="field">Route through</span>
            {/* Deliberately NOT a `.seg`, and that is a correction rather
                than a preference. Venue inclusion is a multi-select —
                `aria-pressed` is independent per venue, and every venue can be
                on at once — but it was rendered in the same segmented shell as
                the twenty-odd exclusive pickers beside it, including the
                routing preset directly above. A control that looks like a
                one-of-three teaches that turning Bybit on turns Binance off,
                which is the opposite of what it does.

                Same treatment as the notional shortcuts above this fieldset:
                a named group of independent toggles, each carrying its own
                state as a mark. ✓ included, ✕ excluded — the two readings
                are both spelled out, so the row reads as a set of switches at
                a glance and nothing rests on the raised-surface fill that
                makes a seg look exclusive. */}
            <div
              role="group"
              aria-label="Venues included in the what-if route"
              style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
            >
              {(snap?.venues ?? []).map((v) => {
                const on = includedVenues === null || includedVenues.includes(v.venue);
                return (
                  <button
                    key={v.venue}
                    type="button"
                    className="icon"
                    aria-pressed={on}
                    title={on
                      ? `Exclude ${v.venue} from the what-if route`
                      : `Include ${v.venue} in the what-if route`}
                    style={{ fontSize: "var(--fs-body)" }}
                    onClick={() => {
                      const all = (snap?.venues ?? []).map((x) => x.venue);
                      const current = includedVenues ?? all;
                      const next = on
                        ? current.filter((x) => x !== v.venue)
                        : [...current, v.venue];
                      setIncludedVenues(next.length === all.length ? null : next);
                    }}
                  >
                    <span aria-hidden>{on ? "✓" : "✕"}</span> {v.venue}
                  </button>
                );
              })}
              {/* The seg rendered as an empty pill box before the first book
                  arrived, which reads as a control with its options missing
                  rather than as a probe with nothing to route yet. */}
              {(snap?.venues ?? []).length === 0 && (
                <span className="muted" style={{ fontSize: "var(--fs-body)" }}>
                  No venue is streaming yet, so there is nothing to include or exclude.
                </span>
              )}
            </div>
          </div>
          <div>
            <label className="field" htmlFor="probe-cap">Max slippage (bps)</label>
            <input
              id="probe-cap"
              type="number"
              min={0}
              step={1}
              value={capText}
              placeholder="uncapped"
              disabled={snap?.consolidatedMid == null}
              title={snap?.consolidatedMid == null ? "A cap needs a reference mid" : undefined}
              onChange={(e) => setCapText(e.target.value)}
            />
          </div>
        </div>
      </div>


      <RouteEstimate tca={tca} dp={dp} capBps={capBps} whatIfActive={whatIfActive} />
    </div>

      <details className="card execution-methodology">
        <summary>How the live routing feed works</summary>
        <p className="sub">
          The ladders stream over WebSockets opened from your browser to Binance and Bybit. The
          same maths serves REST snapshots at <code>/api/depth</code> and <code>/api/tca</code>{" "}
          for non-browser callers. Pre-trade risk checks and the kill-switch stay on the gateway.
        </p>
      </details>
    </>
  );
}
