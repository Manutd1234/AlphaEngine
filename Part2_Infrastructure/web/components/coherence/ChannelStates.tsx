"use client";

/**
 * The four answers the RFQ channel can give, drawn as one path with this
 * read's answer marked.
 *
 * Added on the third 2026-08-24 review: the Channel view was a table and
 * chips, and the fact the table defends — that the four no-quote outcomes are
 * DIFFERENT facts — is a picture: four stations on one line, ordered by how
 * far the request got (never asked, refused, read and empty, quotes in hand),
 * with the line under this read's own station. The table below stays as the
 * proof; hovering a station gives its meaning.
 *
 * A state the pane has not been taught is drawn as a fifth station named for
 * itself, exactly as the table rows it.
 */

import Figure, { Plot } from "./Figure";

export interface ChannelStateRow {
  state: string;
  mark: string;
  word: string;
  means: string;
}

const BOX_H = 34;
const TOP = 8;
const GAP = 26;
const PAD = 7;

function fit(text: string, boxWidth: number): string {
  // 7.37px/char: the 13px diagram-label rung (14r) x the face's ~0.567
  // advance. 2026-08-24 the rung moved 12 -> 13, so 6.8 became 7.37.
  const budget = Math.max(4, Math.floor((boxWidth - PAD * 2) / 7.37));
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}…`;
}

export default function ChannelStates({ states, current, openRequests }: {
  states: ReadonlyArray<ChannelStateRow>;
  current: string;
  openRequests: number;
}) {
  const known = states.some((row) => row.state === current);
  const drawn: ChannelStateRow[] = known
    ? [...states]
    : [...states, { state: current, mark: "◌", word: `State ${current}`, means: "Not yet taught to this pane." }];
  const height = TOP + BOX_H + 34;
  const at = drawn.find((row) => row.state === current);

  return (
    <Figure
      caption="How far the request got, and where it stopped"
      ariaLabel={`The channel's answers in order: ${drawn.map((row) => row.word).join(", ")}. This read: ${at?.word ?? current}, with ${openRequests} open requests.`}
    >
      <Plot height={height}>
        {(width) => {
          const count = drawn.length;
          const boxW = Math.max(88, (width - (count - 1) * GAP) / count);
          return (
            <>
              {drawn.map((row, index) => {
                const x = index * (boxW + GAP);
                const midY = TOP + BOX_H / 2;
                const here = row.state === current;
                return (
                  <g key={row.state}>
                    <rect x={x} y={TOP} width={boxW} height={BOX_H} rx={6} className="coh-form__box">
                      <title>{row.means}</title>
                    </rect>
                    <text x={x + PAD} y={TOP + 21} className="coh-form__title">
                      <tspan aria-hidden="true">{row.mark}</tspan> {fit(row.word, boxW)}
                      <title>{row.word}</title>
                    </text>
                    {here ? (
                      <>
                        <line x1={x} x2={x + boxW} y1={TOP + BOX_H + 8} y2={TOP + BOX_H + 8}
                              className="coh-dollarbar__dollar" />
                        <text x={x} y={TOP + BOX_H + 24} className="coh-figure__key">this read</text>
                      </>
                    ) : null}
                    {index < count - 1 ? (
                      <g className="coh-form__arrow">
                        <line x1={x + boxW + 3} x2={x + boxW + GAP - 7} y1={midY} y2={midY} strokeWidth="1.5" />
                        <polygon points={`${x + boxW + GAP - 7},${midY} ${x + boxW + GAP - 13},${midY - 4} ${x + boxW + GAP - 13},${midY + 4}`} />
                      </g>
                    ) : null}
                  </g>
                );
              })}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
