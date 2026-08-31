"use client";

import { useMemo } from "react";

import { linearScale, ticks } from "@/components/chart-kit";
import Figure, { Plot } from "@/components/coherence/Figure";
import { compact, fmt } from "@/lib/format";
import type { DepthHistoryFrame } from "@/lib/livebook";

const DESKTOP_HEIGHT = 500;
const MARGIN = { top: 10, right: 18, bottom: 30, left: 72 };

const HEATMAP_LEGEND = (
  <ul className="legend" aria-label="Depth heatmap legend">
    <li><i aria-hidden style={{ background: "var(--diverging-pos)" }} /> bid-dominant bin</li>
    <li><i aria-hidden style={{ background: "var(--diverging-neg)" }} /> ask-dominant bin</li>
    <li><span aria-hidden>●</span> consolidated mid</li>
  </ul>
);

export interface DepthHeatCell {
  frameIndex: number;
  binIndex: number;
  bidUsd: number;
  askUsd: number;
  side: "bid" | "ask" | null;
  intensity: number;
}

export interface DepthHeatmapModel {
  frames: DepthHistoryFrame[];
  cells: DepthHeatCell[];
  low: number;
  high: number;
  bins: number;
  maxUsd: number;
}

/**
 * Aggregate real L2 levels onto one shared price grid. A missing publish tick
 * stays in `frames` with empty cells, so time never closes over a feed gap.
 */
export function buildDepthHeatmap(
  history: readonly DepthHistoryFrame[],
  bins = 24,
): DepthHeatmapModel | null {
  const frames = history.filter((frame) => Number.isFinite(frame.at));
  const binCount = Math.max(4, Math.min(48, Math.floor(Number.isFinite(bins) ? bins : 24)));
  const prices = frames.flatMap((frame) => [...frame.bids, ...frame.asks])
    .map(([price]) => price)
    .filter((price) => Number.isFinite(price) && price > 0);
  if (frames.length < 2 || prices.length < 2) return null;

  let low = Math.min(...prices);
  let high = Math.max(...prices);
  if (low === high) {
    const pad = Math.max(Math.abs(low) * 1e-6, Number.EPSILON);
    low -= pad;
    high += pad;
  }
  const width = (high - low) / binCount;
  const raw: Omit<DepthHeatCell, "side" | "intensity">[] = [];

  frames.forEach((frame, frameIndex) => {
    const rows = Array.from({ length: binCount }, (_, binIndex) => ({
      frameIndex, binIndex, bidUsd: 0, askUsd: 0,
    }));
    const add = (levels: DepthHistoryFrame["bids"], side: "bidUsd" | "askUsd") => {
      for (const [price, size] of levels) {
        if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) continue;
        const at = Math.min(binCount - 1, Math.max(0, Math.floor((price - low) / width)));
        rows[at][side] += price * size;
      }
    };
    add(frame.bids, "bidUsd");
    add(frame.asks, "askUsd");
    raw.push(...rows);
  });

  const maxUsd = Math.max(...raw.map((cell) => Math.max(cell.bidUsd, cell.askUsd)), 0);
  const cells = raw.map((cell): DepthHeatCell => {
    const dominant = Math.max(cell.bidUsd, cell.askUsd);
    return {
      ...cell,
      side: dominant <= 0 ? null : cell.bidUsd >= cell.askUsd ? "bid" : "ask",
      intensity: maxUsd > 0 ? dominant / maxUsd : 0,
    };
  });
  return { frames, cells, low, high, bins: binCount, maxUsd };
}

export default function DepthHeatmap({ history, dp }: { history: readonly DepthHistoryFrame[]; dp: number }) {
  const model = useMemo(() => buildDepthHeatmap(history), [history]);
  /* One coordinate height on every viewport: changing from a server-side
     desktop guess to a client-side compact value moved the whole card after
     hydration. Narrow screens scroll/stack the card; they do not redraw it. */
  const height = DESKTOP_HEIGHT;
  if (!model) {
    return (
      <Figure
        caption="L2 resting depth through time on a fixed price grid"
        ariaLabel="Time by price L2 depth heatmap waiting for at least two consolidated snapshots"
        reading="Columns are publish ticks; price bins retain whichever side has more resting notional."
        missing="Waiting for two consolidated L2 snapshots; no time-by-price surface is inferred from one book."
      >
        <div className="muted depth-heatmap__empty">
          Waiting for two consolidated L2 snapshots.
        </div>
        {HEATMAP_LEGEND}
      </Figure>
    );
  }

  const missing = model.frames.filter((frame) => frame.mid == null).length;
  return (
    <Figure
      caption={`L2 depth through time, ${model.frames.length} bounded snapshots`}
      ariaLabel={`Time by price L2 depth heatmap, ${model.frames.length} consolidated snapshots`}
      reading="Columns are publish ticks; price bins retain whichever side has more resting notional."
      missing={missing ? `${missing} unread ${missing === 1 ? "snapshot remains" : "snapshots remain"} blank.` : null}
    >
      <Plot
        height={height}
        sharedX={(measured) => {
          const x0 = MARGIN.left;
          const x1 = Math.max(x0 + 1, measured - MARGIN.right);
          const columnWidth = (x1 - x0) / model.frames.length;
          return {
            count: model.frames.length,
            x0,
            x1,
            // The heatmap draws one rectangular time bin per frame. Put the
            // readout and crosshair at each bin's centre, rather than evenly
            // spacing the first/last readings onto the outer plot edges.
            positions: model.frames.map((_, index) => x0 + (index + 0.5) * columnWidth),
            arriveAt: "last",
            read: (index) => {
              const frame = model.frames[index];
              const bidUsd = frame.bids.reduce((sum, [price, size]) => sum + price * size, 0);
              const askUsd = frame.asks.reduce((sum, [price, size]) => sum + price * size, 0);
              return {
                title: new Date(frame.at).toLocaleTimeString(),
                rows: [
                  { label: "Mid", value: frame.mid == null ? "not measured" : fmt(frame.mid, dp), raw: frame.mid },
                  { label: "Live venues", value: String(frame.liveVenues), raw: frame.liveVenues },
                  { label: "Bid depth", value: `$${compact(bidUsd)}`, raw: bidUsd },
                  { label: "Ask depth", value: `$${compact(askUsd)}`, raw: askUsd },
                ],
              };
            },
          };
        }}
      >
        {(measured) => {
          const plotW = Math.max(1, measured - MARGIN.left - MARGIN.right);
          const plotH = height - MARGIN.top - MARGIN.bottom;
          const cellW = plotW / model.frames.length;
          const cellH = plotH / model.bins;
          const y = linearScale(model.low, model.high, MARGIN.top + plotH, MARGIN.top);
          return (
            <>
              {ticks(model.low, model.high, 5).map((price) => (
                <g key={price}>
                  <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(price)} y2={y(price)}
                    stroke="var(--grid)" strokeWidth={1} />
                  <text x={MARGIN.left - 8} y={y(price)} textAnchor="end" dominantBaseline="middle"
                    fill="var(--text-muted)" fontFamily="var(--mono)" fontSize={10}>
                    {fmt(price, dp)}
                  </text>
                </g>
              ))}
              {model.cells.map((cell) => cell.side ? (
                <rect
                  key={`${cell.frameIndex}-${cell.binIndex}`}
                  className="heatmap-cell"
                  x={MARGIN.left + cell.frameIndex * cellW}
                  y={MARGIN.top + (model.bins - cell.binIndex - 1) * cellH}
                  width={Math.max(0.5, cellW)}
                  height={Math.max(0.5, cellH)}
                  fill={cell.side === "bid" ? "var(--diverging-pos)" : "var(--diverging-neg)"}
                  opacity={0.12 + cell.intensity * 0.78}
                  aria-hidden="true"
                />
              ) : null)}
              {model.frames.map((frame, index) => frame.mid == null ? null : (
                <circle key={`${frame.at}-mid`} cx={MARGIN.left + (index + 0.5) * cellW}
                  cy={y(frame.mid)} r={1.5} fill="var(--text-primary)" aria-hidden="true" />
              ))}
              <text x={MARGIN.left} y={height - 8} fill="var(--text-muted)" fontSize={10}>older</text>
              <text x={MARGIN.left + plotW} y={height - 8} textAnchor="end"
                fill="var(--text-muted)" fontSize={10}>latest</text>
            </>
          );
        }}
      </Plot>
      {HEATMAP_LEGEND}
    </Figure>
  );
}
