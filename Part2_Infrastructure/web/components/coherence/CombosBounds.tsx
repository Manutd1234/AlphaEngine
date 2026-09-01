"use client";

/**
 * The Bounds view: every structural portfolio against the bound it tests.
 *
 * Split out of `CombosViews.tsx` on 2026-08-25, when that file crossed the
 * four-hundred-line ceiling. The seam is the one the file already had a banner
 * for: Bands and Parlays draw a PARLAY against the band its legs leave it, and
 * Bounds draws the PORTFOLIO those bounds are tested with. Different subject,
 * different table, different figure.
 *
 * WHAT THE FIGURE BECAME, AND WHY. It was a signed bar per row against a zero
 * fixed at 55% of the plot width, drawn for the violated rows or — when there
 * were none, which is the common answer — for the single tightest row. So on an
 * ordinary read the whole figure was one grey rectangle beside an axis labelled
 * `0`, which is what a chart looks like when it has failed rather than when the
 * book it describes is sound. The reader said it read as broken, and it did.
 *
 * It is a dumbbell now, over EVERY structural row: a tick at the bound, a dot at
 * what the portfolio costs, and the span between them IS the slack. That makes
 * the quantity a LENGTH — comparable across rows at a glance, without reading
 * six signed numbers — and it makes the common answer informative, because "how
 * much room is there" is a real question with six real answers where "is it
 * violated" had one and it was no.
 */

import type { CoherenceComboLeg, CoherenceComboRow } from "@/lib/coherence/types-lab";
import { priceLabel } from "@/lib/coherence/fixed-point";
import { DIAGRAM_LABEL_PX, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import { toUnit } from "@/lib/coherence/decimals";
import Figure, { Plot } from "./Figure";
import styles from "./CombosBounds.module.css";
import { useStableSelectionKey } from "./use-stable-selection-key";

/** One dumbbell row. 30 was the bespoke strip's; 26 fits more rows on screen
 *  now that every tested row is drawn rather than only the violated ones. */
const ROW_H = 26;

/** Backward compatible across a rolling gateway deploy: older snapshots have
 * no explicit flag, but nullable arithmetic carried the same fact. */
function isTestable(row: CoherenceComboRow): boolean {
  return row.testable ?? (row.cost != null && row.slack != null);
}

/** Identity fields only: live cost/slack updates must not move the selection. */
function rowKey(row: CoherenceComboRow): string {
  const legs = row.legs.map((leg) => `${leg.ticker}:${leg.side}`).join("|");
  return `${row.scope}\u001f${row.because}\u001f${legs}`;
}

function RowLegs({ legs }: { legs: CoherenceComboLeg[] }) {
  return (
    <div
      className={`table-wrap ${styles.legScrollport}`}
      role="region"
      aria-label="Selected bound portfolio legs"
      tabIndex={0}
    >
      <table className={`coh-table ${styles.legTable}`}>
        <caption className="coh-table__caption">
          A dash means the executable side was unquoted; it is never treated as zero.
        </caption>
        <colgroup>
          <col className={styles.legNameColumn} />
          <col className={styles.directionColumn} />
          <col className={styles.sideColumn} />
          <col className={styles.costColumn} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Leg</th>
            <th scope="col">Direction</th>
            <th scope="col">Side</th>
            <th scope="col" className="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg, index) => (
            <tr key={`${leg.ticker}-${index}`}>
              <th scope="row">{leg.label || leg.ticker}</th>
              <td>{(leg.direction ?? (leg.buy_cost == null ? "sell" : "buy")) === "sell" ? "Sell" : "Buy"}</td>
              <td>
                <span className="coh-combo__side">{leg.side}</span>
              </td>
              <td className="num">{priceLabel(leg.execution_cost ?? leg.buy_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The Bounds view's own drawing: each row joins its bound tick to its cost dot,
 * so slack is visible as length. A cost left of the tick is the violation; the
 * mark and words carry that state without colour. An unmeasured row gets words,
 * never a zero-length span.
 */
function SlackStrip({
  rows,
  selectedKey,
  onSelect,
}: {
  rows: CoherenceComboRow[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const cells = rows.map((row) => ({
    key: rowKey(row),
    bound: toUnit(row.bound),
    cost: toUnit(row.cost),
    slack: toUnit(row.slack),
    violated: row.violated,
    label: `${!isTestable(row) ? "◌" : row.violated ? "▲" : "●"} ${priceLabel(row.bound)} bound, ${row.scope}`,
    row,
  }));
  const testedCount = cells.filter((cell) => isTestable(cell.row)).length;
  const priced = cells.flatMap((cell) => [cell.bound, cell.cost].filter((v): v is number => v != null));
  const lo = priced.length ? Math.min(...priced) : 0;
  const hi = priced.length ? Math.max(...priced) : 1;
  // A hair of padding either side, and never a zero-width span: every row here
  // is satisfied on the common answer, so bound and cost sit close together and
  // an axis fitted exactly to them would draw both ticks on the same pixel.
  const pad = Math.max((hi - lo) * 0.25, 0.02);
  const height = 8 + rows.length * ROW_H + 22;

  return (
    <Figure
      caption="Bound versus portfolio cost"
      ariaLabel={cells
        .map((cell) => `${priceLabel(cell.row.bound)} bound: the portfolio costs ${priceLabel(cell.row.cost)}, `
          + `${cell.slack == null ? "not tested" : `${priceLabel(cell.row.slack)} of slack`}`)
        .join(". ")}
      reading={
        cells.some((cell) => cell.violated)
          ? "Cost left of the bound fails; cost right of it passes."
          : testedCount
            ? `${testedCount} of ${cells.length} structural checks have executable prices; every tested cost passes.`
            : `${cells.length} structural checks are present; missing executable quote sides leave every cost untested.`
      }
      reserveInteractionRow={false}
    >
      {/* HTML, not SVG: the key wraps at narrow widths and can never be
          painted beyond the plot's viewBox. The words also keep all three
          shapes meaningful when colour is unavailable. */}
      <ul className={styles.legend} aria-label="Figure legend">
        <li><span className={styles.boundMark} aria-hidden="true" />Bound</li>
        <li><span className={styles.costMark} aria-hidden="true" />Cost</li>
        <li><span className={styles.slackMark} aria-hidden="true" />Room</li>
      </ul>
      <Plot
        height={height}
        minWidth={560}
        scrollLabel="Portfolio costs and their tested bounds"
        onSelect={(index) => onSelect(cells[index]?.key ?? null)}
      >
        {(width) => {
          const gutter = gutterFor(cells.map((cell) => cell.label), width, DIAGRAM_LABEL_PX, {
            min: 96, maxFraction: 0.34, max: 260,
          });
          const track = Math.max(60, width - gutter - 14);
          const x = (v: number) => gutter + ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * track;

          return (
            <>
              {cells.map((cell, index) => {
                const y = 8 + index * ROW_H;
                const mid = y + 9;
                const boundX = cell.bound == null ? null : x(cell.bound);
                const costX = cell.cost == null ? null : x(cell.cost);
                const tested = boundX != null && costX != null;
                const description = tested
                  ? `${cell.label}: bound ${priceLabel(cell.row.bound)}, cost ${priceLabel(cell.row.cost)}, slack ${priceLabel(cell.row.slack)}${cell.violated ? ", violated before fees" : ", satisfied"}`
                  : `${cell.label}: bound, cost and slack were not testable`;
                return (
                  <g
                    key={cell.key}
                    className={styles.interactiveRow}
                    data-selected={cell.key === selectedKey}
                    onPointerEnter={() => onSelect(cell.key)}
                  >
                    <title>{description}</title>
                    {tested ? (
                      <>
                        {/* The SPAN between the two is the slack: a length,
                            which a reader can compare across rows without
                            arithmetic. */}
                        <line x1={Math.min(boundX, costX)} x2={Math.max(boundX, costX)} y1={mid} y2={mid}
                              className={`coh-slack__span${cell.violated ? " is-violated" : ""}`} />
                        <line x1={boundX} x2={boundX} y1={mid - 8} y2={mid + 8} className="coh-slack__bound" />
                        <circle cx={costX} cy={mid} r={5}
                                className={`coh-slack__cost${cell.violated ? " is-violated" : ""}`} />
                      </>
                    ) : (
                      <text x={gutter + 4} y={mid + 4} className="coh-combo__label">— not tested</text>
                    )}
                    <text x={0} y={y + 13} className="coh-combo__label">
                      {truncateMiddle(cell.label, gutter - 10, DIAGRAM_LABEL_PX)}
                    </text>
                    <rect
                      x={0}
                      y={y}
                      width={width}
                      height={ROW_H}
                      className={styles.rowHitTarget}
                    />
                  </g>
                );
              })}
              {/* `toFixed`, not `priceLabel`. These two are the axis's own
                  ENDS — derived from the data plus padding, not values the
                  exchange sent — and `priceLabel` parses a wire string, so it
                  answered "—" for both and the axis lost its scale entirely. */}
              <text x={gutter} y={height - 4} className="coh-combo__axis">{(lo - pad).toFixed(4)}</text>
              <text x={gutter + track} y={height - 4} textAnchor="end" className="coh-combo__axis">
                {(hi + pad).toFixed(4)}
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

function SelectedRowSummary({ row }: { row: CoherenceComboRow }) {
  const tested = row.cost != null && row.slack != null;
  const status = !tested ? "Not tested" : row.violated ? "Violated" : "Satisfied";
  const state = !tested ? "untested" : row.violated ? "violated" : "satisfied";
  const mark = !tested ? "◌" : row.violated ? "▲" : "●";

  return (
    <article className={styles.summary} aria-label="Selected bound check">
      <div className={styles.summaryReading} role="status" aria-live="polite" aria-atomic="true">
        <header className={styles.summaryHeader}>
          <span className={styles.eyebrow}>Selected check</span>
          <strong className={styles.status} data-state={state}>
            <span aria-hidden="true">{mark}</span> {status}
          </strong>
        </header>
        <dl className={styles.facts}>
          <div>
            <dt>Bound</dt>
            <dd className="num">{priceLabel(row.bound)}</dd>
          </div>
          <div>
            <dt>Portfolio cost</dt>
            <dd className="num">{priceLabel(row.cost)}</dd>
          </div>
          <div>
            <dt>Slack</dt>
            <dd className="num">{priceLabel(row.slack)}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>{row.scope}</dd>
          </div>
        </dl>
        <p className={styles.reason}>
          <strong>Reason</strong>
          <span>{row.because}</span>
        </p>
        {!isTestable(row) && row.untestable_reason ? (
          <p className={styles.reason}>
            <strong>Why untested</strong>
            <span>{row.untestable_reason}</span>
          </p>
        ) : null}
      </div>
      {/* A new selection gets a newly folded portfolio, keeping the main read
          compact while leaving every proving leg one disclosure away. */}
      <details key={rowKey(row)} className={styles.legsDisclosure}>
        <summary>{`Portfolio legs (${row.legs.length})`}</summary>
        <RowLegs legs={row.legs} />
      </details>
    </article>
  );
}


export function BoundsView(
  { rows, violated, tightest }: { rows: CoherenceComboRow[]; violated: CoherenceComboRow[]; tightest: CoherenceComboRow | null },
) {
  // EVERY structural row is drawn, not just the violated/testable ones or the closest.
  // Showing one row made the figure a single mark on an axis, which reads as a
  // chart that failed rather than as a book with nothing wrong in it — and it
  // hid the thing the figure is for: how much room the rest have. Start on a
  // violation, otherwise the tightest row, while keeping a reader's explicit
  // selection through live value updates and row reordering.
  const shown = rows;
  const preferred = violated[0] ?? tightest ?? shown[0] ?? null;
  const [selectedKey, setSelectedKey] = useStableSelectionKey(
    shown.map(rowKey),
    preferred ? rowKey(preferred) : null,
  );
  const selected = shown.find((row) => rowKey(row) === selectedKey) ?? shown[0] ?? null;

  return (
    <section className={styles.root} aria-label="Portfolio bound tests">
      {shown.length && selected ? (
        <>
          <div className={styles.workbench}>
            <SlackStrip rows={shown} selectedKey={selectedKey} onSelect={setSelectedKey} />
            <SelectedRowSummary row={selected} />
          </div>
          <p className={styles.caveat}>
            Negative slack is a pre-fee failure. A dash means untested.
          </p>
        </>
      ) : (
        <div className={styles.empty} role="status">
          <strong>No structural bounds</strong>
          <span>The selected listing did not describe any parlay legs from which a Fréchet row can be built.</span>
        </div>
      )}
    </section>
  );
}
