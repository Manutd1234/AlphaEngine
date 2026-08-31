"use client";

import { useState } from "react";

import { DIAGRAM_LABEL_PX, glyphClassOf, glyphsWithin } from "@/lib/coherence/label-metrics";
import Figure, { Plot } from "./Figure";
import styles from "./ChannelStates.module.css";

export interface ChannelStateRow {
  state: string;
  mark: string;
  word: string;
  means: string;
}

const HEIGHT = 262;
const UNKNOWN_HEIGHT = 326;
const MIN_WIDTH = 720;
const TRUNK_Y = 132;
const TOP_Y = 48;
const BOTTOM_Y = 194;
const NODE_R = 16;
const PAD = 12;

interface NodePosition {
  x: number;
  y: number;
}

interface CircuitGeometry {
  start: number;
  sign: number;
  transport: number;
  venue: number;
  read: number;
  nodes: Record<string, NodePosition>;
}

function fit(text: string, width: number): string {
  const budget = Math.max(4, glyphsWithin(width - PAD, DIAGRAM_LABEL_PX, glyphClassOf(text)));
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}…`;
}

function circuitGeometry(width: number, height: number): CircuitGeometry {
  const sign = 74;
  const transport = 244;
  const venue = 414;
  const read = width - 150;
  return {
    start: 30,
    sign,
    transport,
    venue,
    read,
    nodes: {
      signing_unavailable: { x: sign + 66, y: TOP_Y },
      unavailable: { x: transport + 66, y: TOP_Y },
      refused: { x: venue + 66, y: TOP_Y },
      empty: { x: read - 80, y: BOTTOM_Y },
      // Keep the 126px interaction target inside the minimum-width viewBox.
      available: { x: read + 82, y: BOTTOM_Y },
      unknown: { x: read, y: height - 68 },
    },
  };
}

function activePath(state: string, geometry: CircuitGeometry): string {
  const { start, sign, transport, venue, read, nodes } = geometry;
  if (state === "signing_unavailable") {
    return `M${start},${TRUNK_Y} H${sign} V${TOP_Y} H${nodes.signing_unavailable.x}`;
  }
  if (state === "unavailable") {
    return `M${start},${TRUNK_Y} H${transport} V${TOP_Y} H${nodes.unavailable.x}`;
  }
  if (state === "refused") {
    return `M${start},${TRUNK_Y} H${venue} V${TOP_Y} H${nodes.refused.x}`;
  }
  if (state === "empty" || state === "available") {
    const node = nodes[state];
    return `M${start},${TRUNK_Y} H${read} V${BOTTOM_Y} H${node.x}`;
  }
  return `M${start},${TRUNK_Y} H${read} V${nodes.unknown.y}`;
}

function liveReading(state: string, openRequests: number | null) {
  if (openRequests != null) return { label: "Open requests", value: String(openRequests), numeric: true };
  if (state === "signing_unavailable") return { label: "Connection", value: "setup required", numeric: false };
  if (state === "refused") return { label: "Connection", value: "credentials refused", numeric: false };
  return { label: "Connection", value: "offline", numeric: false };
}

/** An inspectable branch map: each terminal answer is an alternative, not a step. */
export default function ChannelStates({ states, current, openRequests }: {
  states: ReadonlyArray<ChannelStateRow>;
  current: string;
  openRequests: number | null;
}) {
  const known = states.some((row) => row.state === current);
  const drawn: ChannelStateRow[] = known
    ? [...states]
    : [...states, { state: current, mark: "◌", word: `State ${current}`, means: "Not yet taught to this pane." }];
  const height = known ? HEIGHT : UNKNOWN_HEIGHT;
  const currentIndex = Math.max(0, drawn.findIndex((row) => row.state === current));
  const [inspection, setInspection] = useState({ read: current, state: current });
  const selectedState = inspection.read === current ? inspection.state : current;
  const selected = drawn.find((row) => row.state === selectedState) ?? drawn[currentIndex];
  const readout = liveReading(current, openRequests);

  return (
    <Figure
      caption="Private-channel outcome map"
      ariaLabel={`The private request branches at signing, transport, venue response and quote reading. This read ended at ${drawn[currentIndex].word}.`}
      readout={<span className="num">{drawn[currentIndex].word}</span>}
      reading={`The live trace followed one branch to ${drawn[currentIndex].word}; the other nodes are alternative outcomes, not earlier steps.`}
    >
      <Plot
        height={height}
        minWidth={MIN_WIDTH}
        scrollLabel="Scroll the private-channel outcome map horizontally"
        onSelect={(index) => setInspection({ read: current, state: drawn[index]?.state ?? current })}
      >
        {(width) => {
          const geometry = circuitGeometry(width, height);
          const { start, sign, transport, venue, read, nodes } = geometry;
          const unknown = drawn.find((row) => !nodes[row.state]);
          return (
            <>
              <path d={`M${start},${TRUNK_Y} H${read}`} className={styles.channelRail} />
              <path d={`M${sign},${TRUNK_Y} V${TOP_Y} H${nodes.signing_unavailable.x}`} className={styles.channelRail} />
              <path d={`M${transport},${TRUNK_Y} V${TOP_Y} H${nodes.unavailable.x}`} className={styles.channelRail} />
              <path d={`M${venue},${TRUNK_Y} V${TOP_Y} H${nodes.refused.x}`} className={styles.channelRail} />
              <path d={`M${read},${TRUNK_Y} V${BOTTOM_Y} H${nodes.empty.x} M${read},${BOTTOM_Y} H${nodes.available.x}`} className={styles.channelRail} />
              {unknown ? <path d={`M${read},${TRUNK_Y} V${nodes.unknown.y}`} className={styles.channelRail} /> : null}
              <path d={activePath(current, geometry)} className={styles.channelProgress} />

              <circle cx={start} cy={TRUNK_Y} r="5" className={styles.startNode} />
              <text x={start} y={TRUNK_Y - 13} textAnchor="middle" className={styles.stageLabel}>REQUEST</text>
              {[
                [sign, "SIGN"],
                [transport, "TRANSPORT"],
                [venue, "VENUE"],
                [read, "PRIVATE READ"],
              ].map(([x, label]) => (
                <g key={label}>
                  <circle cx={Number(x)} cy={TRUNK_Y} r="4" className={styles.branchHub} />
                  <text x={Number(x)} y={TRUNK_Y + 24} textAnchor="middle" className={styles.stageLabel}>{label}</text>
                </g>
              ))}

              {drawn.map((row, index) => {
                const here = index === currentIndex;
                const chosen = row.state === selected.state;
                const point = nodes[row.state] ?? nodes.unknown;
                const title = `${row.word}. ${row.means}${here ? ` This read; ${openRequests == null ? "open-request count not measured" : `${openRequests} open requests`}.` : ""}`;
                return (
                  <g key={row.state} className={`${styles.channelNode}${here ? ` ${styles.current}` : ""}${chosen ? ` ${styles.selected}` : ""}`}>
                    {chosen ? <circle cx={point.x} cy={point.y} r={NODE_R + 8} className={styles.selectionHalo} /> : null}
                    {here ? <circle cx={point.x} cy={point.y} r={NODE_R + 4} className={styles.currentRing} /> : null}
                    <circle cx={point.x} cy={point.y} r={NODE_R} className={styles.nodeDisk} />
                    <text x={point.x} y={point.y + 5} textAnchor="middle" className={styles.nodeMark}>{row.mark}</text>
                    <text x={point.x} y={point.y + 35} textAnchor="middle" className={styles.nodeWord}>
                      {fit(row.word, 126)}
                    </text>
                    {here ? <text x={point.x} y={point.y + 54} textAnchor="middle" className={styles.hereLabel}>THIS READ</text> : null}
                    <rect x={point.x - 63} y={point.y - 22} width="126" height="78" rx="8" className={styles.nodeHit}>
                      <title>{title}</title>
                    </rect>
                  </g>
                );
              })}
            </>
          );
        }}
      </Plot>
      <output className={styles.channelReadout} aria-live="polite" aria-atomic="true">
        <span><small>Inspected outcome</small><strong>{selected.word}</strong></span>
        <span className={styles.channelMeaning}>{selected.means}</span>
        <span>
          <small>{selected.state === current ? readout.label : "Live read"}</small>
          <strong className={selected.state === current && readout.numeric ? "num" : undefined}>
            {selected.state === current ? readout.value : drawn[currentIndex].word}
          </strong>
        </span>
      </output>
    </Figure>
  );
}
