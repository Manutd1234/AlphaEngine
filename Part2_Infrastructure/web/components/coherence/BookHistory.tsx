"use client";

/**
 * What this market HAS been quoted at, off the tape the recorder writes.
 *
 * THE FIRST READ OF WHAT THE RECORDER BOUGHT. `book_snapshots` has held a row
 * per watched market per poll since the recorder was switched on, and until
 * 2026-08-25 nothing read it as a series — `store.latest_books` takes the newest
 * row per ticker and that is what every book pane on the desk draws. Depth is
 * forward-only: a book nobody recorded at 14:32 cannot be recovered at 14:33
 * from any endpoint, which is the whole reason the recorder runs before any
 * strategy code exists. This is the figure that spends it.
 *
 * NOT `LiveTape`, AND THE DIFFERENCE IS THE AXIS. That figure draws what this
 * browser has seen since the tab opened — minutes, gone on reload, and its
 * caption says so on every mount. This draws what the DEPLOYMENT recorded,
 * which runs back as far as the tape does and exists whether or not anyone was
 * looking. Sharing a component would have meant one caption lying about one of
 * them.
 *
 * TWO SERIES, AND ONLY ONE OF THEM IS A QUOTE. The venue sends two BID ladders
 * and no asks, so the bid is drawn solid and the implied ask — a dollar less the
 * NO bid — is drawn dashed, the same treatment this tab gives every derived
 * offer. The band between them is the spread a position crosses, and it is the
 * thing a snapshot of either number cannot show.
 *
 * FOUR EMPTY STATES, EACH DRAWN. An outage, a deployment whose recorder never
 * ran, a market the tape holds nothing for, and a market with one reading are
 * four different answers, and the standing instruction on this desk is that an
 * empty branch gets a figure rather than a grey sentence — the branch a reader
 * meets on a demo deployment IS the view.
 */

import { linePath, linearScale, ticks } from "@/components/chart-kit";
import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";
import type { CoherenceBookHistory } from "@/lib/coherence/types-history";
import { toUnit } from "./FrechetBand";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 190;
const MARGIN = { top: 14, right: 16, bottom: 22, left: 8 };

/**
 * The value range, for a series of PRICES rather than of arbitrary numbers.
 *
 * `chart-kit`'s `extent` pads a flat series by ±0.5, which is right for a
 * general chart and wrong for this one in a way a reader can see: a bid that has
 * sat at 1.0000 all afternoon came out on an axis running 0.6000 to 1.4000, and
 * 1.4000 is not a price this venue can quote. The axis was drawing values that
 * cannot exist beside values that do.
 *
 * So a flat or near-flat series is padded by a CONTRACT-sized amount — two
 * cents, which is a tick a reader recognises — and the whole range is clamped to
 * the dollar a contract lives in. A series that genuinely spans the dollar keeps
 * its own extent.
 */
function priceExtent(values: Array<number | null>): [number, number] {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!finite.length) return [0, 1];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const pad = Math.max((hi - lo) * 0.15, 0.02);
  return [Math.max(0, lo - pad), Math.min(1, hi + pad)];
}

/** "2h 10m", for the span the tape actually covers. */
function spanLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** The sentence each refusal gets, in the four-state vocabulary. */
function refusal(history: CoherenceBookHistory): string {
  if (history.state === "unavailable") {
    return `The tape could not be opened: ${history.notes[0] ?? "no reason given"}. `
      + "That is this deployment's own store failing, not an answer about the market.";
  }
  if (history.state === "unconfigured") {
    return "This deployment has never recorded a book. The recorder is off — COHERENCE_POLL_S "
      + "is unset — so there is no history to read rather than a history that is empty.";
  }
  const held = history.recorded.length;
  return `The tape holds no book for this market. It carries ${held} `
    + `${held === 1 ? "ticker" : "tickers"}, so the recorder has run; this market is not among them.`;
}

export default function BookHistory({ history, error }: {
  history: CoherenceBookHistory | null;
  error: string | null;
}) {
  const caption = "What this market has been quoted at, off the recorded tape";
  const aria = "Best YES bid and implied ask over the recorded tape";

  if (error && !history) {
    return (
      <Figure caption={caption} ariaLabel={aria}>
        <FigureEmpty reason={`The recorded tape could not be read: ${error}. That is a gateway failure, not an answer about the market.`} />
      </Figure>
    );
  }
  if (!history) {
    return (
      <Figure caption={caption} ariaLabel={aria}>
        <FigureEmpty reason="Reading the recorded tape…" />
      </Figure>
    );
  }
  if (history.state !== "ok" || history.points.length < 2) {
    return (
      <Figure
        caption={caption}
        ariaLabel={aria}
        missing={
          history.state === "ok"
            ? "One reading is a dot, and a dot on a time axis reads as a flat line — the tape needs a second poll."
            : null
        }
      >
        <FigureEmpty reason={history.state === "ok" ? "Only one book has been recorded for this market." : refusal(history)} />
      </Figure>
    );
  }

  const points = history.points;
  const bids = points.map((point) => toUnit(point.best_yes_bid));
  const asks = points.map((point) => toUnit(point.implied_yes_ask));
  const first = points[0].ts_ns / 1e6;
  const last = points[points.length - 1].ts_ns / 1e6;
  const [lo, hi] = priceExtent([...bids, ...asks]);
  // COUNTED PER SIDE, because they fail independently and saying "one side" of
  // eleven reads while the bid line runs unbroken across all eleven is a
  // sentence that contradicts the drawing above it. A market with no NO bid on
  // any read has no offer to draw at all, which is a different fact from a
  // series with holes in it.
  const noBid = bids.filter((value) => value == null).length;
  const noAsk = asks.filter((value) => value == null).length;
  const format = (value: number) => value.toFixed(4);

  /* What the figure can honestly claim, given what came back. The spread
     sentence is true only when both series were drawn; with one of them absent
     it describes a gap the reader cannot see. */
  const reading = noAsk === points.length
    ? "Nobody bid the NO side on any recorded read, so this market has no implied offer to draw — "
      + "the solid line is the bid, and there is no price at which you could have bought."
    : noBid === points.length
      ? "Nobody bid the YES side on any recorded read, so the dashed line — the offer implied by the "
        + "NO ladder — is the only price this market carried."
      : "The gap between the two lines is the spread a position crosses; the solid line is what the "
        + "venue sends and the dashed one is read off the opposite ladder.";

  const holes: string[] = [];
  if (noBid && noBid < points.length) holes.push(`${noBid} with no YES bid`);
  if (noAsk && noAsk < points.length) holes.push(`${noAsk} with no NO bid behind the offer`);

  return (
    <Figure
      caption={`${caption} — ${points.length} recorded reads over ${spanLabel(last - first)}`}
      ariaLabel={aria}
      reading={reading}
      missing={holes.length
        ? `Of ${points.length} recorded reads, ${holes.join(" and ")} — drawn as breaks, because a `
          + "market nobody was bidding is not a market at zero."
        : null}
      notes={[
        `Recorded by this deployment, not by the exchange: the series begins where the recorder began, `
        + `which is ${spanLabel(last - first)} of tape here and not the market's whole life.`,
        `Read from ${points[points.length - 1].depth === "full" ? "full ladders" : "top-of-book fields"}; `
        + `the driver that wrote it reports itself as "${points[points.length - 1].source}".`,
      ]}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const right = width - MARGIN.right - advancePx(format(hi), DIAGRAM_LABEL_PX) - 6;
          const x = linearScale(first, last, MARGIN.left, Math.max(MARGIN.left + 1, right));
          const y = linearScale(lo, hi, HEIGHT - MARGIN.bottom, MARGIN.top);
          const at = (i: number) => x(points[i].ts_ns / 1e6);
          const bidPath = linePath(bids.map((v, i) => ({ x: at(i), y: v == null ? null : y(v) })));
          const askPath = linePath(asks.map((v, i) => ({ x: at(i), y: v == null ? null : y(v) })));

          return (
            <g>
              {ticks(lo, hi, 4).map((value) => (
                <g key={value}>
                  <line className="coh-tape__grid" x1={MARGIN.left} x2={Math.max(MARGIN.left + 1, right)} y1={y(value)} y2={y(value)} />
                  <text className="coh-tape__tick" x={Math.max(MARGIN.left + 1, right) + 4} y={y(value) + 4}>{format(value)}</text>
                </g>
              ))}

              <path className="coh-book-tape__ask" d={askPath}>
                <title>Implied YES ask, a dollar less the NO bid</title>
              </path>
              <path className="coh-tape__line" d={bidPath}>
                <title>Best YES bid, as the venue sends it</title>
              </path>

              <text className="coh-tape__tick" x={MARGIN.left} y={HEIGHT - 5}>
                {`${spanLabel(last - first)} of tape`}
              </text>
              <text className="coh-tape__tick coh-tape__tick--end" x={Math.max(MARGIN.left + 1, right)} y={HEIGHT - 5}>
                newest
              </text>
            </g>
          );
        }}
      </Plot>
    </Figure>
  );
}
