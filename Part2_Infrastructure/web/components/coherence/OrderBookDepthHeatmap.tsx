"use client";

import { useState, type CSSProperties } from "react";

import { DOLLAR_CC, fromCenticents } from "@/lib/coherence/fixed-point";
import {
  buildBookDepthHeatmap,
  type BookDepthLevel,
  type HeatQuote,
} from "@/lib/coherence/book-depth-heatmap";

import styles from "./OrderBookDepthHeatmap.module.css";

type HeatStyle = CSSProperties & { "--book-depth-wash": string };
type HeatSelection = { side: "yes" | "no"; yesPriceCc: number };

function QuoteCell({
  quote,
  side,
  yesPriceCc,
  formatContracts,
  selected,
  onInspect,
}: {
  quote: HeatQuote | null;
  side: "yes" | "no";
  yesPriceCc: number;
  formatContracts: (value: number) => string;
  selected: boolean;
  onInspect: () => void;
}) {
  const sideLabel = side === "yes" ? "YES bid" : "NO bid";
  if (!quote) {
    return (
      <td className={styles.emptyCell} data-side={side} data-quoted="false">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No {sideLabel} at this observed YES-axis price.</span>
      </td>
    );
  }

  const nativePriceCc = side === "yes" ? yesPriceCc : DOLLAR_CC - yesPriceCc;
  const depth = formatContracts(quote.depth);
  const size = formatContracts(quote.size);
  const style = { "--book-depth-wash": `${quote.wash}%` } as HeatStyle;
  return (
    <td
      className={styles.depthCell}
      data-side={side}
      data-quoted="true"
      style={style}
      title={`${sideLabel} ${fromCenticents(nativePriceCc)}: ${size} contracts at level; ${depth} at or better`}
    >
      <button
        type="button"
        className={styles.cellButton}
        aria-pressed={selected}
        aria-label={`${sideLabel} ${fromCenticents(nativePriceCc)}: ${size} contracts at level; ${depth} at or better`}
        onFocus={onInspect}
        onPointerEnter={onInspect}
        onClick={onInspect}
      >
        <span className={styles.sideMark} aria-hidden="true">{side === "yes" ? "Y" : "N"}</span>
        <strong className="num">{depth}</strong>
        <span>at or better</span>
        <small className="num">{size} @ {fromCenticents(nativePriceCc)}</small>
      </button>
    </td>
  );
}

export default function OrderBookDepthHeatmap({
  levels,
  formatContracts,
}: {
  levels: readonly BookDepthLevel[];
  formatContracts: (value: number) => string;
}) {
  const model = buildBookDepthHeatmap(levels);
  const [selection, setSelection] = useState<HeatSelection | null>(null);
  if (!model.quotedCells) return null;
  const selectedColumn = selection ? model.columns.find((level) => level.cc === selection.yesPriceCc) : null;
  const selectedQuote = selection && selectedColumn ? selectedColumn[selection.side] : null;

  return (
    <figure className={styles.figure} data-quant-surface="book-depth-heatmap">
      <figcaption className={styles.heading}>
        <span>
          <span className={styles.kicker}>Depth heatmap</span>
          <strong>Resting contracts at every observed price</strong>
        </span>
        <span className={styles.legend} aria-label="Heatmap legend">
          <span><i data-side="yes" aria-hidden="true">Y</i> YES bid</span>
          <span><i data-side="no" aria-hidden="true">N</i> NO bid</span>
          <span><i aria-hidden="true">Σ</i> depth at or better</span>
        </span>
      </figcaption>
      <p className={styles.note}>
        Columns are quoted levels only. NO bids are mirrored onto the YES-price axis; shade and the printed figure both encode cumulative contracts.
      </p>
      <output className={styles.readout} aria-live="polite">
        <span>
          <span className="sr-only">Point to a quoted cell or focus it with the keyboard for its exact price, native size, and cumulative depth.</span>
          <small>Selected side</small>
          <strong>{selection && selectedQuote ? `${selection.side.toUpperCase()} bid` : "Point or focus a cell"}</strong>
        </span>
        <span>
          <small>Native level</small>
          <strong className="num">
            {selection && selectedQuote
              ? `${formatContracts(selectedQuote.size)} @ ${fromCenticents(selection.side === "yes" ? selection.yesPriceCc : DOLLAR_CC - selection.yesPriceCc)}`
              : "—"}
          </strong>
        </span>
        <span>
          <small>Depth at or better</small>
          <strong className="num">{selection && selectedQuote ? `Σ ${formatContracts(selectedQuote.depth)}` : "—"}</strong>
        </span>
      </output>
      <div
        className="table-wrap"
        data-depth-scroll
        role="region"
        aria-label={`Recorded order-book depth by observed price, ${model.columns.length} prices`}
        tabIndex={0}
      >
        <table className="coh-table" data-depth-table>
          <caption className="coh-table__caption sr-only">
            YES and NO cumulative bid depth at each observed YES-axis price; blank cells mean that side did not quote that price.
          </caption>
          <colgroup>
            <col className={styles.axisColumn} />
            {model.columns.map((level) => <col className={styles.priceColumn} key={`col-${level.cc}`} />)}
          </colgroup>
          <thead>
            <tr>
              <th className={styles.axisHead} scope="col">Side</th>
              {model.columns.map((level) => (
                <th className={`num ${styles.priceHead}`} scope="col" key={level.cc}>
                  <span>YES px</span>
                  <strong className="num">{fromCenticents(level.cc)}</strong>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["yes", "no"] as const).map((side) => (
              <tr key={side}>
                <th className={styles.rowHead} data-side={side} scope="row">
                  <span aria-hidden="true">{side === "yes" ? "Y" : "N"}</span>
                  {side === "yes" ? "YES bids" : "NO bids"}
                </th>
                {model.columns.map((level) => (
                  <QuoteCell
                    key={`${side}-${level.cc}`}
                    quote={level[side]}
                    side={side}
                    yesPriceCc={level.cc}
                    formatContracts={formatContracts}
                    selected={selection?.side === side && selection.yesPriceCc === level.cc}
                    onInspect={() => setSelection({ side, yesPriceCc: level.cc })}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
