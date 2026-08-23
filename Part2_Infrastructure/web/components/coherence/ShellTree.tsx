"use client";

/**
 * The tree's shape, drawn once, instead of listed one level at a time.
 *
 * `ls` answers a path. That is the right answer to the question it is asked and
 * the wrong shape for the question underneath it: a reader stepping through
 * /shards, a shard, a series and an event sees four listings and never the
 * hierarchy they came out of — shards OR series OR events, never the shape.
 * Two of this section's load-bearing claims live in that shape rather than in
 * any one listing, and both were prose only.
 *
 * The first is the shard boundary. Shard directories are separate exchange
 * instances, collateral is held per shard, and one order group cannot span
 * two — so a basket with legs under different shard directories cannot be
 * protected as a single position. That is a cost of where a market lives, not
 * a naming convention, and it is drawn as a line with the order group that
 * would have crossed it severed on it. The tree's own edge does cross that
 * line, because the filesystem genuinely contains both shards; it is the
 * collateral that does not follow it.
 *
 * The second is that an event directory carries five derived readings. Their
 * names otherwise reach a reader only as an `entry.detail` four levels down,
 * which is no use to someone deciding whether the reading they want exists at
 * all. They are drawn from the same `DERIVED_FILES` table the reference under
 * the listing reads, so the picture cannot drift from the list.
 *
 * Nothing here is measured, and that is the point: the shape is the same at
 * every path, so this view reads nothing at all — `ShellPane` gates its poll on
 * the view not being this one, which is also what makes it the only view that
 * still answers while the venue is unreachable. Angle brackets mark every
 * placeholder, so the drawing cannot be mistaken for a listing of what is
 * watched today.
 *
 * No class here is its own. The tree borrows what the other figures on this tab
 * already paint: the dollar line for the boundary, because it is the reference
 * the reader is asked to judge against and the one thing nothing may occlude,
 * and the implied-offer dash for the order group, because a dash is what this
 * tab already uses for something derived rather than resting. Anything closer
 * to a tree of its own would be new CSS, and new CSS is not this figure's to
 * add.
 */

import Figure, { Plot } from "./Figure";

/**
 * The five readings an event directory carries beyond its markets: the
 * browser's copy of the gateway's own `EVENT_FILES` table. These names and
 * meanings otherwise reach a reader only as an `entry.detail` four directories
 * down, which is no use to someone deciding whether the reading they want
 * exists at all — so they are stated on the views that read them, the tree
 * below and the reference table under a listing.
 */
export const DERIVED_FILES: ReadonlyArray<{ name: string; reads: string; silent: string }> = [
  {
    name: "implied_pmf",
    reads: "The probability mass each interval carries, differenced off the strike ladder.",
    silent: "When the books build no surface. The reason is returned in place of a mass, never a zero.",
  },
  {
    name: "survival",
    reads: "The survival function the strike ladder samples, strike by strike.",
    silent: "When the event quotes intervals rather than sampling a ladder of strikes: no curve to read off it.",
  },
  {
    name: "lattice",
    reads: "Which markets imply which, and why the exchange says so.",
    silent: "Never. It is built from the exchange's own metadata, so it answers with no book quoted.",
  },
  {
    name: "certificate",
    reads: "The coherence test and its proof.",
    silent: "When none was computed in this read. It is solved on demand, not for every event on every listing.",
  },
  {
    name: "books",
    reads: "The two bid ladders and the offers implied from them.",
    silent: "Never. An empty side reads as a dash, never as a price of zero.",
  },
];

/** One line of the drawing: how deep it sits, what it is called, and the note
 *  it carries when there is width for one. */
interface TreeRow {
  depth: number;
  name: string;
  note?: string;
}

/** Two shards, because one shard cannot show a boundary. Everything below the
 *  root is a placeholder: these are the shape of a path, never a watchlist. */
const ROWS: readonly TreeRow[] = [
  { depth: 0, name: "/shards" },
  { depth: 1, name: "<n>/", note: "one collateral pool" },
  { depth: 2, name: "<series>/" },
  { depth: 3, name: "<event>/" },
  { depth: 4, name: "<market>" },
  ...DERIVED_FILES.map((file) => ({ depth: 4, name: file.name })),
  { depth: 1, name: "<m>/", note: "a second pool" },
  { depth: 2, name: "<series>/" },
  { depth: 3, name: "<event>/", note: "the same five readings" },
  { depth: 4, name: "<market>" },
];

const LEFT = 8;
const INDENT = 16;
const TOP = 14;
const ROW_H = 18;
/** The air between the two subtrees: the boundary line and its two labels. */
const BOUNDARY_GAP = 30;
/** Where the notes and the brace begin — clear of the deepest name, which is
 *  `implied_pmf` at eleven characters of 10px chart type. */
const NOTE_X = 146;
/** Under this the note column and the order-group column would sit on top of
 *  each other, so both are dropped. What goes is annotation: every filename,
 *  the boundary and the words on it stay drawn at every width. */
const NARROW = 300;
/** Baselines sit three pixels under the line the connectors run on. */
const MID = 3;
/** The boundary's own words, indented past the edge that runs from /shards down
 *  to the second shard: that edge crosses the boundary at x=14, and words drawn
 *  from the margin would have it struck through them. */
const LABEL_X = 32;

const MARKET_ABOVE = 4;
const FIRST_FILE = MARKET_ABOVE + 1;
const LAST_FILE = FIRST_FILE + DERIVED_FILES.length - 1;
/** Rows above the boundary. Everything from here down is the second shard. */
const ABOVE = LAST_FILE + 1;
const MARKET_BELOW = ROWS.length - 1;

function xOf(depth: number): number {
  return LEFT + depth * INDENT;
}

function rowY(index: number): number {
  return TOP + index * ROW_H + (index >= ABOVE ? BOUNDARY_GAP : 0);
}

/** The row this one hangs off: the nearest row above it a level shallower. */
function parentOf(index: number): number {
  for (let above = index - 1; above >= 0; above -= 1) {
    if (ROWS[above].depth === ROWS[index].depth - 1) return above;
  }
  return 0;
}

const EDGES = ROWS.flatMap((row, index) =>
  index === 0 ? [] : [{ index, depth: row.depth, parent: parentOf(index) }],
);

const HEIGHT = rowY(MARKET_BELOW) + 14;
const BOUNDARY_Y = (rowY(ABOVE - 1) + rowY(ABOVE)) / 2;

const CAPTION =
  "every path in this tree at once: /shards holds shards, a shard holds series, a series holds events, and an " +
  "event holds its markets beside the five readings derived from them. Directories end in a slash the way ls -F " +
  "writes them, and the angle brackets are placeholders rather than tickers.";

const ARIA =
  "A four-level tree. /shards holds two shard directories; each shard holds a series, each series an event, and " +
  "each event holds its markets beside five derived readings named implied_pmf, survival, lattice, certificate " +
  "and books. A line drawn across the middle separates the two shards, and an order group drawn from a market in " +
  "one shard to a market in the other is severed at that line and marked with a cross.";

const READING =
  "The shard boundary is a collateral boundary, not a naming convention: collateral is held per shard, so the " +
  "order group drawn across the line cannot exist, and a basket with legs under both shards cannot be protected " +
  "as a single position.";

const MISSING =
  "The tree is the watchlist, not the venue: Kalshi lists some thirteen thousand series and only the ones " +
  "COHERENCE_SERIES names appear under a shard. Nothing on this drawing was read from the exchange — it is the " +
  "shape a path has, not how many shards, series, events or markets are watched today: only a listing says that.";

/**
 * The four levels, the five readings, and the line an order group stops at.
 *
 * Static at every path, so it takes no props and makes no read.
 */
export default function ShellTree() {
  return (
    <Figure caption={CAPTION} ariaLabel={ARIA} reading={READING} missing={MISSING}>
      <Plot height={HEIGHT}>
        {(width) => {
          const roomy = width >= NARROW;
          // The order group runs in a column of its own, right of the notes and
          // inside the plot at any width where the notes survive at all.
          const groupX = Math.max(NOTE_X + 134, width - 56);
          // Clear of `<market>`, the name on both rows the group would join.
          const stubX = xOf(ROWS[MARKET_ABOVE].depth) + 52;
          return (
            <>
              {EDGES.map(({ index, depth, parent }) => (
                <g key={`edge-${index}`}>
                  <line
                    x1={xOf(depth) - 10}
                    x2={xOf(depth) - 10}
                    y1={rowY(parent) - MID}
                    y2={rowY(index) - MID}
                    className="coh-ladder__axis"
                  />
                  <line
                    x1={xOf(depth) - 10}
                    x2={xOf(depth) - 3}
                    y1={rowY(index) - MID}
                    y2={rowY(index) - MID}
                    className="coh-ladder__axis"
                  />
                </g>
              ))}

              {ROWS.map((row, index) => (
                <text
                  key={`row-${index}-${row.name}`}
                  x={xOf(row.depth)}
                  y={rowY(index)}
                  className="coh-ablation__value"
                >
                  {row.name}
                </text>
              ))}

              {roomy
                ? ROWS.map((row, index) =>
                    row.note ? (
                      <text key={`note-${index}`} x={NOTE_X} y={rowY(index)} className="coh-identity__label">
                        {row.note}
                      </text>
                    ) : null,
                  )
                : null}

              {/* The five readings are braced and counted, so the group reads as
                  one thing an event carries rather than five loose files. */}
              {roomy ? (
                <g>
                  <line
                    x1={NOTE_X - 8}
                    x2={NOTE_X - 8}
                    y1={rowY(FIRST_FILE) - 11}
                    y2={rowY(LAST_FILE) + 1}
                    className="coh-ladder__axis"
                  />
                  <text
                    x={NOTE_X}
                    y={(rowY(FIRST_FILE) + rowY(LAST_FILE)) / 2 + MID}
                    className="coh-identity__label"
                  >
                    five derived readings
                  </text>
                </g>
              ) : null}

              {/* Dashed, because it is the one thing here that does not exist:
                  an order group holding a leg in each shard. */}
              {roomy ? (
                <g>
                  <line
                    x1={stubX}
                    x2={groupX}
                    y1={rowY(MARKET_ABOVE) - MID}
                    y2={rowY(MARKET_ABOVE) - MID}
                    className="coh-ladder__implied"
                  />
                  <line
                    x1={groupX}
                    x2={groupX}
                    y1={rowY(MARKET_ABOVE) - MID}
                    y2={BOUNDARY_Y - 8}
                    className="coh-ladder__implied"
                  />
                  <line
                    x1={groupX}
                    x2={groupX}
                    y1={BOUNDARY_Y + 8}
                    y2={rowY(MARKET_BELOW) - MID}
                    className="coh-ladder__implied"
                  />
                  <line
                    x1={stubX}
                    x2={groupX}
                    y1={rowY(MARKET_BELOW) - MID}
                    y2={rowY(MARKET_BELOW) - MID}
                    className="coh-ladder__implied"
                  />
                </g>
              ) : null}

              {/* Last, and full width: it is the reference the reader is asked to
                  judge against, so nothing on the drawing may cover it. */}
              <line x1={0} x2={width} y1={BOUNDARY_Y} y2={BOUNDARY_Y} className="coh-dollarbar__dollar" />
              <text x={LABEL_X} y={BOUNDARY_Y - 6} className="coh-dollarbar__dollar-label">
                ✕ shard boundary
              </text>
              <text x={LABEL_X} y={BOUNDARY_Y + 13} className="coh-dollarbar__dollar-label">
                one order group cannot cross it
              </text>
              {roomy ? (
                <g>
                  <text x={groupX} y={BOUNDARY_Y + MID} textAnchor="middle" className="coh-dollarbar__dollar-label">
                    ✕
                  </text>
                  <text x={groupX} y={BOUNDARY_Y + 13} textAnchor="middle" className="coh-identity__label">
                    blocked
                  </text>
                </g>
              ) : null}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
