"use client";

/**
 * Where each fold's in-sample winner placed out of sample, as a ladder.
 *
 * THE TIMELINE ABOVE ANSWERS "DID THE NUMBER HOLD". This answers the question
 * the fold shape carries and nothing drew: `oosRank` of `combosRanked`. Rank 1
 * of 40 means the choice held up; rank 33 of 40 means the fold selected noise
 * — and a fold can post a respectable out-of-sample Sharpe while placing 33rd,
 * because the whole grid did well that quarter. The rank is what the Sharpe
 * cannot say.
 *
 * ONE RUNG PER FOLD, the rung's height its placing — rank over grid — so the
 * top of the plot is rank 1 and the bottom is last. The reference is the
 * MEDIAN, where a choice no better than chance would land; painted under the
 * rungs by `Plot`, labelled, so "beat chance" is checkable rung by rung.
 *
 * `sharedX`, because folds are uniform — grammar rule 7 — and the reading at
 * any fold is every fact about it in one card.
 *
 * THE EMPTY BRANCH DRAWS TOO. `oosRank` and `combosRanked` are optional on
 * the wire — the seed run carries them on all four folds (74, 39, 40 and 10
 * of 74), so a ranked ladder is the normal case here, but a run that omits
 * them must not be a grey sentence. A withheld rung is drawn hatched at full
 * height with its reason in the mark: the shape the answer takes, and why
 * this one is empty.
 */

import Figure, { Plot } from "@/components/coherence/Figure";
import { linearScale } from "@/components/chart-kit";
import { fmt } from "@/lib/format";
import { foldLadder, ladderReading } from "@/lib/research/fold-ladder";
import type { WalkForwardFold } from "@/lib/types/sweep";

const HEIGHT = 200;
const MARGIN = { top: 14, right: 16, bottom: 34, left: 46 };

export default function FoldLadder({ folds }: { folds: readonly WalkForwardFold[] }) {
  const ladder = foldLadder(folds);
  const { rungs } = ladder;
  const y0 = HEIGHT - MARGIN.bottom;
  const y1 = MARGIN.top;
  // Placing runs 0 (best) to 1 (last); rank 1 draws at the TOP.
  const y = linearScale(0, 1, y1, y0);
  const x0 = MARGIN.left;

  return (
    <Figure
      caption={`Where each fold's winner placed out of sample, ${ladder.scored} of ${rungs.length} folds ranked`}
      ariaLabel={`Out-of-sample rank of each walk-forward fold's chosen parameters, against the median rank of its grid.`}
      reading={ladderReading(ladder)}
      missing={ladder.withheld > 0
        ? `${ladder.withheld} of ${rungs.length} folds carried no out-of-sample rank and are drawn withheld — the wire's rank fields are optional and this run did not fill them.`
        : null}
    >
      <Plot
        height={HEIGHT}
        reference={(width) => ({
          y: y(0.5),
          x0,
          x1: Math.max(x0 + 1, width - MARGIN.right),
          label: "the median — below this line is no better than chance",
        })}
        sharedX={(width) => {
          const x1 = Math.max(x0 + 10, width - MARGIN.right);
          return {
            count: rungs.length,
            x0,
            x1,
            width: 210,
            arriveAt: "first" as const,
            read: (index) => {
              const r = rungs[index];
              return {
                title: `Fold ${r.fold}, ${r.chosenFast}/${r.chosenSlow}`,
                rows: r.rank === null
                  ? [{ label: "Rank", value: "withheld" }, { label: "Why", value: r.withheld ?? "" }]
                  : [
                      { label: "Placed", value: `${r.rank} of ${r.of}` },
                      { label: "OOS Sharpe", value: fmt(r.oosSharpe, 2) },
                      { label: "Beat chance", value: r.beatChance ? "▲ yes" : "no" },
                    ],
              };
            },
          };
        }}
      >
        {(width) => {
          const x1 = Math.max(x0 + 10, width - MARGIN.right);
          const slot = (x1 - x0) / Math.max(1, rungs.length);
          const barW = Math.max(6, Math.min(28, slot * 0.5));
          return (
            <>
              {[0, 0.5, 1].map((v) => (
                <g key={v}>
                  <line className="coh-tape__grid" x1={x0} x2={x1} y1={y(v)} y2={y(v)} />
                  <text className="coh-tape__tick" x={x0 - 6} y={y(v) + 4} textAnchor="end">
                    {v === 0 ? "1st" : v === 1 ? "last" : "median"}
                  </text>
                </g>
              ))}
              {rungs.map((r, i) => {
                const cx = x0 + i * slot + slot / 2;
                const left = cx - barW / 2;
                if (r.placing === null) {
                  return (
                    <rect key={r.fold} x={left} y={y1} width={barW} height={y0 - y1} fill="url(#diff-hatch)" opacity={0.5} rx={2}>
                      <title>{`Fold ${r.fold}: withheld — ${r.withheld}`}</title>
                    </rect>
                  );
                }
                const top = y(r.placing);
                return (
                  <rect
                    key={r.fold}
                    x={left}
                    y={top}
                    width={barW}
                    height={Math.max(2, y0 - top)}
                    fill={r.beatChance ? "var(--series-1)" : "var(--text-muted)"}
                    opacity={r.beatChance ? 0.85 : 0.55}
                    rx={2}
                  >
                    <title>{`Fold ${r.fold}: placed ${r.rank} of ${r.of}${r.beatChance ? " ▲ beat chance" : ", no better than chance"}`}</title>
                  </rect>
                );
              })}
              {rungs.map((r, i) => (
                <text key={`l${r.fold}`} className="coh-tape__tick" x={x0 + i * slot + slot / 2} y={HEIGHT - 12} textAnchor="middle">
                  {r.fold}
                </text>
              ))}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
