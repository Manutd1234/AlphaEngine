"use client";

/**
 * The probability mass the prices imply, bin by bin.
 *
 * On a bucket family each market IS a bin and its price is the mass directly.
 * On a ladder there are no bins in the book at all: the mass between two
 * strikes is what their survival prices differ by, so every bar here is a
 * subtraction of two quotes rather than a quote.
 *
 * Which is why a bar can point DOWN. If the ladder is quoted so that a higher
 * strike survives more than a lower one, the difference between them is
 * negative, and a negative mass is not a probability — it is a monotonicity
 * violation, the same one the certificate turns into a portfolio. It is drawn
 * below the axis, hatched, marked ▽ and named "negative mass" in words, and it
 * is never clipped to zero: clipping would hide the fault and leave a picture
 * of a distribution that nobody is quoting.
 *
 * A ladder can carry a hundred bins of which most are empty — a strike pair
 * quoted at the same survival prices nothing between them. Those are drawn as
 * flat stubs on the axis rather than as gaps, because a gap reads as "no bin
 * here" and the truth is "a bin here, worth nothing". Nothing is dropped; only
 * the LABELS thin out, and the figure says so.
 */

import { priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 208;
const MARGIN = { top: 24, right: 12, bottom: 34, left: 12 };
/** Above this many bins, only the ends and the heaviest bin are named. */
const LABEL_EVERY_BIN_UP_TO = 10;
const CAPTION = "The probability mass each interval carries, as the quotes imply it";

interface Bar {
  label: string;
  /** Mass in centicents of a dollar, or null where it could not be parsed. */
  mass: number | null;
  raw: string;
  negative: boolean;
}

function clip(text: string, chars: number): string {
  if (chars < 3) return "";
  return text.length <= chars ? text : `${text.slice(0, chars - 1)}…`;
}

function readBins(surface: CoherenceSurface): { bars: Bar[]; unreadable: number } {
  let unreadable = 0;
  const bars = surface.bins.map((bin) => {
    const mass = toCenticents(bin.mass);
    if (mass == null) unreadable += 1;
    return { label: bin.label, mass, raw: bin.mass, negative: bin.negative };
  });
  return { bars, unreadable };
}

export default function PmfChart({ surface }: { surface: CoherenceSurface }) {
  const { bars, unreadable } = readBins(surface);
  const hatchId = `coh-surface-hatch-${surface.event_ticker.replace(/[^A-Za-z0-9]/g, "") || "bins"}`;

  if (!bars.length) {
    return (
      <Figure caption={CAPTION} ariaLabel="No implied distribution: this family priced no intervals" missing={surface.detail}>
        <FigureEmpty reason="No interval of this family is quoted." />
      </Figure>
    );
  }

  const readable = bars.filter((bar) => bar.mass != null) as Array<Bar & { mass: number }>;
  const negatives = readable.filter((bar) => bar.mass < 0);
  const empties = readable.filter((bar) => bar.mass === 0);
  const maxPositive = Math.max(...readable.map((bar) => bar.mass), 1);
  const maxNegative = negatives.length ? Math.max(...negatives.map((bar) => Math.abs(bar.mass))) : 0;
  const heaviest = readable.reduce<(Bar & { mass: number }) | null>(
    (best, bar) => (best == null || bar.mass > best.mass ? bar : best),
    null,
  );
  const labelAll = bars.length <= LABEL_EVERY_BIN_UP_TO;

  const thinning = labelAll
    ? null
    : `All ${bars.length} bins are drawn; only the ends and the heaviest are named, because ${bars.length} labels will not fit.`;
  const emptyNote = empties.length
    ? `${empties.length} of ${readable.length} readable bin(s) carry no mass — strikes either side quote the same survival; drawn as flat stubs, not gaps.`
    : null;
  const unreadableNote = unreadable
    ? `${unreadable} bin(s) carried a mass this desk could not parse exactly, marked ◌ unread rather than drawn as zero.`
    : null;

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`Implied probability mass across ${bars.length} intervals${negatives.length ? `, ${negatives.length} of them negative` : ""}${heaviest ? `, heaviest ${heaviest.label} at ${priceLabel(heaviest.raw)}` : ""}`}
      reading={`${heaviest ? `The heaviest interval is ${heaviest.label} at ${priceLabel(heaviest.raw)}. ` : ""}${
        negatives.length
          ? `${negatives.length} interval(s) price to LESS than nothing and are drawn below the axis, marked ▽. A negative mass is not a small probability, it is a quoted contradiction: the higher strike is priced as more likely than the lower one.`
          : "No interval prices to less than nothing: the quoted ladder is monotone across every pair read."
      }`}
      missing={[surface.detail, thinning, emptyNote, unreadableNote].filter(Boolean).join(" ")}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
          const floor = HEIGHT - MARGIN.bottom;
          const drawHeight = floor - MARGIN.top;
          // Room below the axis only when something is actually negative, and
          // never more than a third of the panel: the positive mass is the
          // subject and a violation should not be able to squash it flat.
          const share = maxNegative ? Math.min(0.32, Math.max(0.15, maxNegative / (maxPositive + maxNegative))) : 0;
          const base = MARGIN.top + drawHeight * (1 - share);
          const slot = plotWidth / bars.length;
          const barWidth = Math.max(0.8, slot * 0.78);
          const up = (mass: number) => (mass / maxPositive) * (base - MARGIN.top);
          const down = (mass: number) => (maxNegative ? (Math.abs(mass) / maxNegative) * (floor - base) : 0);
          const centre = (index: number) => MARGIN.left + slot * (index + 0.5);
          const chars = Math.floor(slot / 5.2);
          return (
            <>
              <defs>
                <pattern id={hatchId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="4" height="4" className="coh-surface__hatch-ground" />
                  <line x1="0" y1="0" x2="0" y2="4" className="coh-surface__hatch-line" />
                </pattern>
              </defs>
              {bars.map((bar, index) => {
                const key = `${index}-${bar.label}`;
                const x = centre(index) - barWidth / 2;
                if (bar.mass == null) {
                  return (
                    <text key={key} x={centre(index)} y={base - 3} textAnchor="middle" className="coh-surface__unread">
                      ◌
                      <title>{`${bar.label}: mass "${bar.raw}" could not be parsed exactly, so it is not drawn as any number`}</title>
                    </text>
                  );
                }
                if (bar.mass < 0) {
                  return (
                    <g key={key}>
                      <rect
                        x={x}
                        y={base}
                        width={barWidth}
                        height={Math.max(1, down(bar.mass))}
                        fill={`url(#${hatchId})`}
                        className="coh-surface__bar-negative"
                      >
                        <title>{`${bar.label}: ${priceLabel(bar.raw)} — negative mass, a monotonicity violation in the quotes`}</title>
                      </rect>
                      <text x={centre(index)} y={base + down(bar.mass) + 11} textAnchor="middle" className="coh-surface__down-mark">
                        ▽
                      </text>
                    </g>
                  );
                }
                if (bar.mass === 0) {
                  return (
                    <rect key={key} x={x} y={base - 1.2} width={barWidth} height={1.2} className="coh-surface__bar-zero">
                      <title>{`${bar.label}: no mass — strikes either side quote the same survival`}</title>
                    </rect>
                  );
                }
                return (
                  <rect key={key} x={x} y={base - up(bar.mass)} width={barWidth} height={Math.max(0.8, up(bar.mass))} className="coh-surface__bar">
                    <title>{`${bar.label}: mass ${priceLabel(bar.raw)}`}</title>
                  </rect>
                );
              })}
              {labelAll
                ? bars.map((bar, index) => (
                    <g key={`label-${index}-${bar.label}`}>
                      <text x={centre(index)} y={floor + 13} textAnchor="middle" className="coh-surface__tick">
                        {clip(bar.label, chars)}
                      </text>
                      {bar.mass != null && bar.mass > 0 ? (
                        <text x={centre(index)} y={base - up(bar.mass) - 4} textAnchor="middle" className="coh-surface__value">
                          {priceLabel(bar.raw)}
                        </text>
                      ) : null}
                    </g>
                  ))
                : null}
              {!labelAll && heaviest ? (
                <text
                  x={Math.min(Math.max(centre(bars.indexOf(heaviest)), MARGIN.left + 40), width - MARGIN.right - 40)}
                  y={MARGIN.top - 10}
                  textAnchor="middle"
                  className="coh-surface__value"
                >
                  {`heaviest ${clip(heaviest.label, 26)} at ${priceLabel(heaviest.raw)}`}
                </text>
              ) : null}
              {!labelAll ? (
                <>
                  <text x={MARGIN.left} y={floor + 13} className="coh-surface__tick">
                    {clip(bars[0].label, 22)}
                  </text>
                  <text x={width - MARGIN.right} y={floor + 13} textAnchor="end" className="coh-surface__tick">
                    {clip(bars[bars.length - 1].label, 22)}
                  </text>
                </>
              ) : null}
              {/* The zero line goes over the bars: it is the reference that
                  decides whether a bar is a probability or a contradiction. */}
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} className="coh-surface__axis" />
              {negatives.length ? (
                <text x={MARGIN.left} y={HEIGHT - 4} className="coh-surface__down-word">
                  {`▽ negative mass: ${negatives.length} interval(s) below the axis`}
                </text>
              ) : null}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
