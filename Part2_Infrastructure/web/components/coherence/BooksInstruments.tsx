"use client";

import { useId, useState, type CSSProperties } from "react";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";

import {
  contractsLabel,
  mirrorBookLevels,
  percentOf,
  priceWindow,
  scenarioBookLevels,
  sweepBook,
  verticalPosition,
  type ScenarioBookLevel,
} from "@/lib/coherence/book-instrument-model";
import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceBookHistory } from "@/lib/coherence/types-history";
import type { LadderLevel } from "./LadderChart";
import { useRovingListbox } from "./use-stable-selection-key";
import styles from "./BooksInstruments.module.css";

type BookSide = "yes" | "no";
type SweepSide = "buy" | "sell";
type VisualStyle = CSSProperties & Record<`--${string}`, string>;

function depthScopeLabel(depth: string): string {
  if (depth === "full") return "full ladder";
  if (depth === "top_of_book") return "top of book";
  const readable = depth.trim().replace(/_/g, " ");
  return readable || "not reported";
}

export function InstrumentHead({ eyebrow, title, status, scope }: {
  eyebrow: string;
  title: string;
  status: string;
  scope?: { label: string; value: string };
}) {
  return (
    <figcaption className={styles.head}>
      <span><small>{eyebrow}</small><strong>{title}</strong></span>
      {scope ? (
        <span className={styles.headStatus}>
          <span><small>{scope.label}</small><strong>{scope.value}</strong></span>
          <b>{status}</b>
        </span>
      ) : <b>{status}</b>}
    </figcaption>
  );
}

function LevelRail({ side, rows, selectedKey, setSelectedKey, optionProps, offset, maxDepth, sweptKeys, draggingKey, dropSide, setDropSide, setDraggingKey, onMove }: {
  side: BookSide; rows: ScenarioBookLevel[]; selectedKey: string | null; setSelectedKey: (key: string | null) => void;
  optionProps: ReturnType<typeof useRovingListbox>[2]; offset: number; maxDepth: number; sweptKeys: ReadonlySet<string>; draggingKey: string | null;
  dropSide: BookSide | null; setDropSide: (side: BookSide | null) => void; setDraggingKey: (key: string | null) => void;
  onMove: (key: string, side: BookSide) => void;
}) {
  const drop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    const key = event.dataTransfer.getData("text/plain") || draggingKey;
    if (key) onMove(key, side);
    setDropSide(null);
  };
  return (
    <section className={styles.rail} data-side={side} data-drop={dropSide === side ? true : undefined} role="group" aria-label={`${side.toUpperCase()} bid ladder, drop zone`}
      onDragEnter={(event) => { event.preventDefault(); setDropSide(side); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDragLeave={(event) => { const next = event.relatedTarget as Node | null; if (!next || !event.currentTarget.contains(next)) setDropSide(null); }} onDrop={drop}>
      <header><span className={styles.sideMark}>{side === "yes" ? "Y" : "N"}</span><span><strong>{side.toUpperCase()} bids</strong><small>native — drop here</small></span><b>{rows.length}</b></header>
      <div className={styles.railLevels}>
        {rows.length ? rows.map((row, index) => {
          const roving = optionProps(row.key, offset + index);
          const target: BookSide = side === "yes" ? "no" : "yes";
          const swept = sweptKeys.has(row.key);
          return (
            <button type="button" key={row.key} role="option" draggable aria-selected={selectedKey === row.key}
              aria-label={`${side.toUpperCase()} bid ${fromCenticents(row.nativePrice)}, ${contractsLabel(row.size)} contracts.${swept ? " The simulated sweep reaches this level." : ""} Drag across or press Enter to turn into ${target.toUpperCase()}.`}
              className={styles.level} data-moved={row.originSide !== row.side ? true : undefined} data-swept={swept ? true : undefined} data-dragging={draggingKey === row.key ? true : undefined}
              style={{ "--depth": percentOf(row.depth, maxDepth) } as VisualStyle} {...roving} onClick={() => setSelectedKey(row.key)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onMove(row.key, target); return; } roving.onKeyDown(event); }}
              onDragStart={(event) => { event.dataTransfer.setData("text/plain", row.key); event.dataTransfer.effectAllowed = "move"; setSelectedKey(row.key); setDraggingKey(row.key); setDropSide(target); }}
              onDragEnd={() => { setDraggingKey(null); setDropSide(null); }}>
              <span className={styles.depthFill} aria-hidden="true" /><strong className="num">{fromCenticents(row.nativePrice)}</strong><span className="num">{contractsLabel(row.size)}</span><small>Y-axis {fromCenticents(row.yesPrice)}</small>
            </button>
          );
        }) : <p className={styles.emptyRail}>Drop a level here</p>}
      </div>
    </section>
  );
}

export function BookLadderConsole({ yesBids, noBids, depth, caption, unquotedReason }: {
  yesBids: LadderLevel[];
  noBids: LadderLevel[];
  depth: string;
  caption: string;
  unquotedReason?: string | null;
}) {
  const live = mirrorBookLevels(yesBids, noBids);
  const [sideByKey, setSideByKey] = useState<Record<string, BookSide>>({});
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<BookSide | null>(null);
  const [announcement, setAnnouncement] = useState("Live ladder loaded");
  const [sweepSide, setSweepSide] = useState<SweepSide>(live.no.length ? "buy" : "sell");
  const [requestedSweep, setRequestedSweep] = useState(() => Math.max(1, Math.min(10, live.no[0]?.size ?? live.yes[0]?.size ?? 1)));
  const { yes, no, ordered } = scenarioBookLevels(live.ordered, sideByKey);
  const keys = ordered.map((row) => row.key);
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(keys, yes[0]?.key ?? no[0]?.key);
  const active = ordered.find((row) => row.key === selectedKey) ?? ordered[0] ?? null;
  const bestBid = yes[0]?.yesPrice ?? null;
  const bestOffer = no[0]?.yesPrice ?? null;
  const spread = bestBid != null && bestOffer != null ? bestOffer - bestBid : null;
  const maxDepth = Math.max(1, ...ordered.map((row) => row.depth));
  const moveCount = live.ordered.filter((row) => sideByKey[row.key] != null).length;
  const sweepQueue = sweepSide === "buy" ? no : yes;
  const availableDepth = sweepQueue.reduce((total, row) => total + row.size, 0);
  const sweepLimit = Math.max(1, Math.ceil(availableDepth * 1.2));
  const sweepQuantity = sweepQueue.length ? Math.min(requestedSweep, sweepLimit) : 0;
  const sweep = sweepBook(sweepQueue, sweepQuantity);
  const sweptKeys = new Set(sweep.consumedKeys);
  const sweepStep = Math.max(0.01, Math.min(1, sweepLimit / 100));
  const instructionsId = useId();
  const moveLevel = (key: string, target: BookSide) => {
    const source = live.ordered.find((row) => row.key === key);
    if (!source) return;
    setSideByKey((current) => { const next = { ...current }; if (source.side === target) delete next[key]; else next[key] = target; return next; });
    setSelectedKey(key); setDraggingKey(null);
    const targetPrice = target === "yes" ? source.yesPrice : DOLLAR_CC - source.yesPrice;
    setAnnouncement(`Turned ${source.side.toUpperCase()} ${fromCenticents(source.nativePrice)} into ${target.toUpperCase()} ${fromCenticents(targetPrice)}`);
  };
  return (
    <figure className={styles.instrument} aria-label={`${ordered.length} bid levels in an interactive mirrored order book; ${depthScopeLabel(depth)} depth read`}>
      <InstrumentHead eyebrow="Flip ladder" title={caption} scope={{ label: "Depth read", value: depthScopeLabel(depth) }} status={moveCount ? `${moveCount} local ${moveCount === 1 ? "move" : "moves"}` : spread == null ? "One-sided" : `Spread ${fromCenticents(spread)}`} />
      <p id={instructionsId} className={styles.quickGuide}><span aria-hidden="true">↔</span> Sweep the book to trace market impact. Drag a resting level across, or select it and press <kbd>Enter</kbd>, for a local quote what-if.</p>
      <section className={styles.sweepPanel} data-sweep-side={sweepSide} aria-label="YES market-order sweep simulation">
        <div className={styles.sweepSide} role="group" aria-label="Sweep direction">
          <button type="button" data-action="buy" aria-pressed={sweepSide === "buy"} disabled={!no.length} onClick={() => setSweepSide("buy")}>Buy YES</button>
          <button type="button" data-action="sell" aria-pressed={sweepSide === "sell"} disabled={!yes.length} onClick={() => setSweepSide("sell")}>Sell YES</button>
        </div>
        <label className={styles.sweepControl}>
          <span><small>Sweep size</small><strong className="num">{contractsLabel(sweepQuantity)} contracts</strong></span>
          <input type="range" min={0} max={sweepLimit} step={sweepStep} value={sweepQuantity} disabled={!sweepQueue.length}
            aria-label={`${sweepSide === "buy" ? "Buy" : "Sell"} YES sweep size`}
            aria-valuetext={`${contractsLabel(sweepQuantity)} contracts; ${contractsLabel(sweep.filled)} filled across ${sweep.levelsReached} levels`}
            onChange={(event) => setRequestedSweep(Number(event.target.value))} />
        </label>
        <output className={styles.sweepReadout} aria-live="polite" aria-atomic="true">
          <span><small>Filled</small><strong className="num">{contractsLabel(sweep.filled)} / {contractsLabel(sweep.requested)}</strong></span>
          <span><small>VWAP / worst</small><strong className="num">{sweep.vwap == null ? "—" : fromCenticents(sweep.vwap)} / {sweep.worstPrice == null ? "—" : fromCenticents(sweep.worstPrice)}</strong></span>
          <span><small>Levels / unfilled</small><strong className="num">{sweep.levelsReached} / {contractsLabel(sweep.unfilled)}</strong></span>
        </output>
      </section>
      <div className={styles.ladderStage}>
        <div className={styles.railListbox} role="listbox" aria-label="Movable YES and NO bid levels" aria-describedby={instructionsId}>
          <LevelRail side="yes" rows={yes} selectedKey={selectedKey} setSelectedKey={setSelectedKey} optionProps={optionProps} offset={0} maxDepth={maxDepth} sweptKeys={sweptKeys} draggingKey={draggingKey} dropSide={dropSide} setDropSide={setDropSide} setDraggingKey={setDraggingKey} onMove={moveLevel} />
          <LevelRail side="no" rows={no} selectedKey={selectedKey} setSelectedKey={setSelectedKey} optionProps={optionProps} offset={yes.length} maxDepth={maxDepth} sweptKeys={sweptKeys} draggingKey={draggingKey} dropSide={dropSide} setDropSide={setDropSide} setDraggingKey={setDraggingKey} onMove={moveLevel} />
        </div>
        <div className={styles.mirrorCore} data-measured={spread != null ? true : undefined}>
          <small>1 − price</small><div><span>Bid</span><strong className="num">{bestBid == null ? "—" : fromCenticents(bestBid)}</strong></div>
          <button type="button" disabled={!active} onClick={() => active && moveLevel(active.key, active.side === "yes" ? "no" : "yes")}><span aria-hidden="true">⇄</span>{active ? `Turn to ${active.side === "yes" ? "NO" : "YES"}` : "Select level"}</button>
          <div><span>Offer</span><strong className="num">{bestOffer == null ? "—" : fromCenticents(bestOffer)}</strong></div>
          {moveCount ? <button type="button" className={styles.resetAction} onClick={() => { setSideByKey({}); setAnnouncement("Restored the live ladder"); }}>Reset</button> : <small>Local what-if</small>}
        </div>
      </div>
      {active ? <output className={styles.readout} data-side={active.side} aria-live="polite" aria-atomic="true"><span><small>Selected</small><strong>{active.side.toUpperCase()} {fromCenticents(active.nativePrice)}</strong></span><span><small>Size / depth</small><strong className="num">{contractsLabel(active.size)} / {contractsLabel(active.depth)}</strong></span><span><small>Mirror</small><strong className="num">Y {fromCenticents(active.yesPrice)}</strong></span></output> : <p className={styles.empty}>No resting order on either side.</p>}
      <p className={styles.reading}><span aria-live="polite">{announcement}.</span> Changes are local; the recorded book is untouched.</p>
      {unquotedReason ? <p className={styles.missing}>Live book: {unquotedReason}</p> : null}
      {ordered.length ? <details className={styles.ledger}><summary>Exact working ledger — {ordered.length} levels</summary><p className={styles.ledgerNote}>Kalshi publishes two bid ladders, not asks; each offer mirrors the opposite ladder.</p><div role="region" tabIndex={0} aria-label={`Exact level ledger, ${ordered.length} rows`} className="table-wrap table-wrap--clamped"><table className="coh-table"><caption className="coh-table__caption">Exact native and mirrored book levels</caption><thead><tr><th scope="col">Side</th><th scope="col" className="num">Native</th><th scope="col" className="num">YES axis</th><th scope="col" className="num">At level</th><th scope="col" className="num">At or better</th></tr></thead><tbody>{ordered.map((row) => <tr key={row.key}><th scope="row">{row.side.toUpperCase()}</th><td className="num">{fromCenticents(row.nativePrice)}</td><td className="num">{fromCenticents(row.yesPrice)}</td><td className="num">{contractsLabel(row.size)}</td><td className="num">{contractsLabel(row.depth)}</td></tr>)}</tbody></table></div></details> : null}
    </figure>
  );
}

function iso(ns: number): string { return new Date(ns / 1e6).toISOString(); }
function timeLabel(ns: number): string { return iso(ns).replace("T", " ").replace(/\.\d{3}Z$/, " UTC"); }
function axisTimeLabel(ns: number, includeDate: boolean): string { const value = iso(ns); return includeDate ? `${value.slice(5, 10)} ${value.slice(11, 16)}` : value.slice(11, 16); }
function sampledIndices(length: number, selected: number): number[] { const count = Math.min(48, length); const indices = Array.from({ length: count }, (_, i) => Math.round((i / Math.max(1, count - 1)) * (length - 1))); return [...new Set([...indices, selected])].sort((a, b) => a - b); }

export function BookHistoryFlipbook({ history }: { history: CoherenceBookHistory }) {
  const keys = history.points.map((point) => `${history.ticker ?? point.ticker}:${point.ts_ns}`);
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const selectedKey = requestedKey != null && keys.includes(requestedKey) ? requestedKey : keys.at(-1)!;
  const index = Math.max(0, keys.indexOf(selectedKey));
  const active = history.points[index];
  const bid = toCenticents(active.best_yes_bid); const ask = toCenticents(active.implied_yes_ask);
  const parsed = history.points.map((point) => ({ bid: toCenticents(point.best_yes_bid), ask: toCenticents(point.implied_yes_ask) }));
  const { low, high } = priceWindow(parsed.flatMap((point) => [point.bid, point.ask]));
  const firstTs = history.points[0].ts_ns; const lastTs = history.points.at(-1)!.ts_ns;
  const sameDay = iso(firstTs).slice(0, 10) === iso(lastTs).slice(0, 10);
  const priceTicks = Array.from({ length: 5 }, (_, tick) => Math.round(high - ((high - low) * tick) / 4));
  const timeTicks = Array.from({ length: 5 }, (_, tick) => Math.round(firstTs + ((lastTs - firstTs) * tick) / 4));
  const setIndex = (next: number) => setRequestedKey(keys[Math.max(0, Math.min(keys.length - 1, next))]);
  const inspectPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    const targetTs = firstTs + (lastTs - firstTs) * ratio;
    let nearest = 0; let distance = Number.POSITIVE_INFINITY;
    for (let pointIndex = 0; pointIndex < history.points.length; pointIndex += 1) { const nextDistance = Math.abs(history.points[pointIndex].ts_ns - targetTs); if (nextDistance < distance) { nearest = pointIndex; distance = nextDistance; } }
    setIndex(nearest);
  };
  const valueText = `Snapshot ${index + 1} of ${history.points.length}, ${timeLabel(active.ts_ns)}, YES bid ${active.best_yes_bid ?? "unquoted"}, implied YES ask ${active.implied_yes_ask ?? "unquoted"}`;
  return (
    <figure className={styles.instrument} aria-label={`${history.points.length} recorded book snapshots`}>
      <InstrumentHead eyebrow="Quote timeline" title="Bid, ask and spread" status={`${index + 1} / ${history.points.length}`} />
      <div className={styles.historyStage}>
        <div className={styles.historyLegend}><span data-mark="bid">YES bid, native</span><span data-mark="ask">YES ask, implied</span><small>{iso(firstTs).slice(0, 10)} — UTC</small></div>
        <div className={styles.ribbonFrame}><div className={styles.priceScale} aria-hidden="true">{priceTicks.map((value) => <span key={value} className="num">{fromCenticents(value)}</span>)}</div><div className={styles.plotColumn}>
          <div className={styles.ribbonCanvas} role="img" aria-label={`${history.points.length} recorded quote snapshots. Use the Snapshot control below to inspect every point.`} onPointerDown={inspectPointer}>
            {sampledIndices(history.points.length, index).map((pointIndex) => { const point = history.points[pointIndex]; const values = parsed[pointIndex]; const x = `${((point.ts_ns - firstTs) / Math.max(1, lastTs - firstTs)) * 100}%`; const top = values.bid == null || values.ask == null ? "50%" : verticalPosition(Math.max(values.bid, values.ask), low, high); const bottom = values.bid == null || values.ask == null ? "50%" : verticalPosition(Math.min(values.bid, values.ask), low, high); return <span key={keys[pointIndex]} className={styles.historyPoint} data-selected={pointIndex === index ? true : undefined} aria-hidden="true" style={{ "--x": x, "--bid-y": verticalPosition(values.bid, low, high), "--ask-y": verticalPosition(values.ask, low, high), "--band-top": top, "--band-bottom": bottom } as VisualStyle}>{values.bid != null && values.ask != null ? <i className={styles.spreadStitch} /> : null}{values.bid != null ? <span className={styles.bidPoint} /> : null}{values.ask != null ? <span className={styles.askPoint} /> : null}</span>; })}
          </div><div className={styles.timeAxis} aria-hidden="true">{timeTicks.map((value, tick) => <span key={value} style={{ "--tick-x": `${tick * 25}%` } as VisualStyle}>{axisTimeLabel(value, !sameDay)}</span>)}</div>
        </div></div>
      </div>
      <div className={styles.scrubber}><button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0} aria-label="Previous recorded snapshot">←</button><label><span><small>Snapshot {index + 1}</small><strong>{iso(active.ts_ns).slice(11, 19)} UTC</strong></span><input type="range" min={0} max={history.points.length - 1} value={index} onChange={(event) => setIndex(Number(event.target.value))} aria-label="Recorded book snapshot" aria-valuetext={valueText} /><i><span>Oldest</span><span>Newest</span></i></label><button type="button" onClick={() => setIndex(index + 1)} disabled={index === history.points.length - 1} aria-label="Next recorded snapshot">→</button></div>
      <output className={styles.historyReadout} aria-live="polite" aria-atomic="true"><span><small>Recorded — UTC</small><strong>{iso(active.ts_ns).slice(0, 10)}</strong><i>{iso(active.ts_ns).slice(11, 19)}</i></span><span><small>Native bid → implied ask</small><strong className="num">{active.best_yes_bid ?? "—"} → {active.implied_yes_ask ?? "—"}</strong><i>{ask == null ? "No NO bid behind the ask" : "Ask read off the NO rail"}</i></span><span><small>Spread</small><strong className="num">{bid == null || ask == null ? "—" : fromCenticents(ask - bid)}</strong><i>{bid == null || ask == null ? "One side is absent, never zero." : `${active.source}; ${active.depth}`}</i></span></output>
    </figure>
  );
}
