"use client";

import { useMemo, useState, type CSSProperties, type FormEvent } from "react";

import type { CoherenceFeeFill } from "@/lib/coherence/types";
import styles from "./MarketInstruments.module.css";

interface FeeScenario {
  id: string;
  label: string;
  price: string;
  contracts: string;
  fills: number;
}

/**
 * A wire amount as a plain number, for BAR GEOMETRY only. Kalshi's own example
 * carries sub-centicent quantities (0.09 × $0.3301 of notional), finer than
 * `toCenticents` accepts, and pixels are not a quantity a reader checks: every
 * number a reader READS is the wire string in the table below.
 */
function toAmount(raw: string | null | undefined): number | null {
  if (raw == null || !/^-?\d*(?:\.\d*)?$/.test(raw.trim()) || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

type FeeSeries = "trade" | "rounding" | "rebate" | "net" | "notional";
type RatioStyle = CSSProperties & { "--fee-ratio": string };

interface CumulativeFill {
  fill: number;
  trade: number | null;
  rounding: number | null;
  rebate: number | null;
  net: number | null;
  notional: number | null;
}

const GRAPH_W = 820;
const GRAPH_H = 250;
const GRAPH_PAD = { left: 48, right: 18, top: 18, bottom: 34 } as const;

function cumulativeFills(fills: readonly CoherenceFeeFill[]): CumulativeFill[] {
  const running: Omit<CumulativeFill, "fill"> = { trade: 0, rounding: 0, rebate: 0, net: 0, notional: 0 };
  const add = (current: number | null, raw: string | null | undefined): number | null => {
    const amount = toAmount(raw);
    return current == null || amount == null ? null : current + amount;
  };
  return fills.map((fill, index) => {
    running.trade = add(running.trade, fill.trade_fee);
    running.rounding = add(running.rounding, fill.rounding_fee);
    running.rebate = add(running.rebate, fill.rebate);
    running.net = add(running.net, fill.net);
    running.notional = add(running.notional, fill.notional);
    return { fill: index + 1, ...running };
  });
}

function seriesPath(points: readonly CumulativeFill[], series: FeeSeries, peak: number): string {
  const spanX = GRAPH_W - GRAPH_PAD.left - GRAPH_PAD.right;
  const spanY = GRAPH_H - GRAPH_PAD.top - GRAPH_PAD.bottom;
  let connected = false;
  return points.map((point, index) => {
    const value = point[series];
    if (value == null) {
      connected = false;
      return "";
    }
    const x = GRAPH_PAD.left + (points.length < 2 ? spanX / 2 : (index / (points.length - 1)) * spanX);
    const y = GRAPH_PAD.top + (1 - Math.max(0, value) / peak) * spanY;
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${x},${y}`;
  }).filter(Boolean).join(" ");
}

/** Editable fee console with a cumulative fill replay and exact component inspector. */
function FeeTotalsBar({
  total,
  share,
  fills,
  example,
  onExample,
}: {
  total: CoherenceFeeFill | null;
  share: string | null;
  fills: CoherenceFeeFill[];
  example: FeeScenario;
  onExample: (next: FeeScenario) => void;
}) {
  const caption = "Fee execution console — component waterfall and fill replay";
  const [selected, setSelected] = useState<Exclude<FeeSeries, "notional">>("rounding");
  const [selectedFill, setSelectedFill] = useState(0);
  const [draft, setDraft] = useState(() => ({ price: example.price, contracts: example.contracts, fills: String(example.fills) }));

  const points = useMemo(() => cumulativeFills(fills), [fills]);
  const activeIndex = Math.min(selectedFill, Math.max(0, fills.length - 1));
  const activeFill = fills[activeIndex] ?? total;
  const trade = toAmount(total?.trade_fee);
  const rounding = toAmount(total?.rounding_fee);
  const rebate = toAmount(total?.rebate);
  const net = toAmount(total?.net);
  const notional = toAmount(total?.notional);
  const shareValue = toAmount(share);
  const geometryValues = points
    .flatMap((point) => [point.trade, point.rounding, point.rebate, point.net, point.notional])
    .filter((value): value is number => value != null);
  const peak = Math.max(0.000001, ...geometryValues);
  const pieces = total && trade != null && rounding != null && rebate != null && net != null ? [
    { id: "trade", label: "Trading", value: total.trade_fee, amount: trade, note: "Price-sensitive venue charge." },
    { id: "rounding", label: "Rounding", value: total.rounding_fee, amount: rounding, note: "Per-fill cent boundary." },
    { id: "rebate", label: "Accumulator return", value: total.rebate, amount: rebate, note: "Whole cents returned across fills." },
    { id: "net", label: "Net fee", value: total.net, amount: net, note: "Charge after the return." },
  ] as const : [];
  const active = pieces.find((piece) => piece.id === selected) ?? pieces[0];
  const exceeds = shareValue != null && shareValue > 1;
  const activeFillValue = activeFill ? {
    trade: activeFill.trade_fee,
    rounding: activeFill.rounding_fee,
    rebate: activeFill.rebate,
    net: activeFill.net,
  }[selected] : null;

  const submit = (event_: FormEvent<HTMLFormElement>) => {
    event_.preventDefault();
    const price = Number(draft.price);
    const contracts = Number(draft.contracts);
    const fillCount = Math.round(Number(draft.fills));
    if (!(price > 0 && price < 1 && contracts > 0 && fillCount >= 1 && fillCount <= 100)) return;
    setSelectedFill(0);
    onExample({ id: "custom", label: "Custom simulation", price: String(price), contracts: String(contracts), fills: fillCount });
  };

  if (total == null || trade == null || rounding == null || rebate == null || net == null || notional == null || !active) {
    return (
      <figure className={styles.instrument} aria-label="No fee total">
        <figcaption>{caption}</figcaption>
        <p className={styles.empty}>◌ No total; partial fills would understate cost.</p>
      </figure>
    );
  }

  return (
    <figure className={`${styles.instrument} ${styles.feeReceipt}`} aria-label={`Trade fee ${total.trade_fee}, rounding fee ${total.rounding_fee}, rebate ${total.rebate}, net ${total.net}, notional ${total.notional}`}>
      <figcaption className={styles.instrumentHead}>
        <span><small>Worked example — paper calculation</small>{caption}</span>
        <strong className={exceeds ? styles.alertValue : undefined}>{share ?? "—"}× notional</strong>
      </figcaption>

      <form className={styles.feeScenario} onSubmit={submit} aria-label="Fee scenario inputs">
        <label><span>Price</span><input required type="number" min="0.0001" max="0.9999" step="0.0001" inputMode="decimal" value={draft.price} onChange={(event_) => setDraft((current) => ({ ...current, price: event_.target.value }))} /></label>
        <label><span>Contracts</span><input required type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.contracts} onChange={(event_) => setDraft((current) => ({ ...current, contracts: event_.target.value }))} /></label>
        <label><span>Fills</span><input required type="number" min="1" max="100" step="1" inputMode="numeric" value={draft.fills} onChange={(event_) => setDraft((current) => ({ ...current, fills: event_.target.value }))} /></label>
        <button type="submit">Run scenario</button>
      </form>

      <div className={styles.feeTerminal}>
        <div className={styles.receiptStack} role="group" aria-label="Inspect a fee component">
          {pieces.map((piece, index) => (
            <button key={piece.id} type="button" aria-pressed={selected === piece.id}
                    onClick={() => setSelected(piece.id)} className={styles.receiptLine}
                    style={{ "--fee-ratio": `${Math.max(3, (piece.amount / peak) * 100)}%` } as RatioStyle}>
              <span>{String(index + 1).padStart(2, "0")} — {piece.label}</span>
              <strong className="num">{piece.value}</strong>
            </button>
          ))}
        </div>

        <div className={styles.feeGraph} role="img" aria-label="Cumulative fee components and notional by fill">
          <svg viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {[0, .5, 1].map((fraction) => (
              <line key={fraction} x1={GRAPH_PAD.left} x2={GRAPH_W - GRAPH_PAD.right}
                    y1={GRAPH_PAD.top + (1 - fraction) * (GRAPH_H - GRAPH_PAD.top - GRAPH_PAD.bottom)}
                    y2={GRAPH_PAD.top + (1 - fraction) * (GRAPH_H - GRAPH_PAD.top - GRAPH_PAD.bottom)} className={styles.feeGrid} />
            ))}
            <path d={seriesPath(points, "notional", peak)} className={styles.feeNotional} />
            <path d={seriesPath(points, selected, peak)} className={styles.feeSelected} />
            {points.map((point, index) => {
              const spanX = GRAPH_W - GRAPH_PAD.left - GRAPH_PAD.right;
              const spanY = GRAPH_H - GRAPH_PAD.top - GRAPH_PAD.bottom;
              const cx = GRAPH_PAD.left + (points.length < 2 ? spanX / 2 : (index / (points.length - 1)) * spanX);
              const selectedValue = point[selected];
              const selectedY = selectedValue == null ? null : GRAPH_PAD.top + (1 - Math.max(0, selectedValue) / peak) * spanY;
              const notionalY = point.notional == null ? null : GRAPH_PAD.top + (1 - Math.max(0, point.notional) / peak) * spanY;
              return (
                <g key={point.fill}>
                  {notionalY == null ? null : <circle cx={cx} cy={notionalY} r={3.5} className={styles.feeNotionalPoint} />}
                  {selectedY == null ? null : <circle cx={cx} cy={selectedY} r={4.5} className={styles.feeSelectedPoint} />}
                </g>
              );
            })}
            {points.length ? (
              <line
                x1={GRAPH_PAD.left + (points.length < 2 ? (GRAPH_W - GRAPH_PAD.left - GRAPH_PAD.right) / 2 : (activeIndex / (points.length - 1)) * (GRAPH_W - GRAPH_PAD.left - GRAPH_PAD.right))}
                x2={GRAPH_PAD.left + (points.length < 2 ? (GRAPH_W - GRAPH_PAD.left - GRAPH_PAD.right) / 2 : (activeIndex / (points.length - 1)) * (GRAPH_W - GRAPH_PAD.left - GRAPH_PAD.right))}
                y1={GRAPH_PAD.top}
                y2={GRAPH_H - GRAPH_PAD.bottom}
                className={styles.feeCursor}
              />
            ) : null}
            <text x={GRAPH_PAD.left} y={12}>cumulative dollars</text>
            <text x={GRAPH_W - GRAPH_PAD.right} y={GRAPH_H - 8} textAnchor="end">fill {activeIndex + 1}/{Math.max(1, fills.length)}</text>
          </svg>
        </div>

        <div className={styles.receiptInspector}>
          <output className="sr-only" aria-live="polite" aria-atomic="true">
            Fill {activeIndex + 1}, {active.label}: {activeFillValue ?? "not reported"}.
          </output>
          <small>Fill {activeIndex + 1} — {active.label}</small>
          <strong>{active.label}</strong>
          <span className="num">{activeFillValue ?? "—"}</span>
          <p>{active.note} Solid line: selected component. Dotted line: notional.</p>
          {activeFill ? (
            <dl className={styles.feeFillFacts}>
              <div><dt>Fill net</dt><dd className="num">{activeFill.net}</dd></div>
              <div><dt>Returned</dt><dd className="num">{activeFill.rebate}</dd></div>
              <div><dt>Notional</dt><dd className="num">{activeFill.notional}</dd></div>
            </dl>
          ) : null}
          <label className={styles.feeScrubber}>
            <span>Inspect fill</span>
            <input type="range" min={0} max={Math.max(0, fills.length - 1)} step={1} value={activeIndex}
                   onChange={(event_) => setSelectedFill(Number(event_.target.value))} />
          </label>
          <button
            type="button"
            className={styles.replayButton}
            disabled={fills.length < 2}
            onClick={() => setSelectedFill((activeIndex + 1) % fills.length)}
          >
            {activeIndex === fills.length - 1 ? "Restart replay" : "Next replay step"}
          </button>
        </div>
      </div>

      <div className={styles.receiptComparison} data-over={exceeds || undefined}>
        <span><small>Position notional</small><strong className="num">{total.notional}</strong></span>
        <span aria-hidden="true">{exceeds ? "≪" : "↔"}</span>
        <span><small>Net fee</small><strong className="num">{total.net}</strong></span>
        <p>{shareValue == null ? "Cost ratio not reported." : exceeds ? "Fee exceeds position notional." : "Fee remains below traded notional."}</p>
      </div>
    </figure>
  );
}

export default FeeTotalsBar;
