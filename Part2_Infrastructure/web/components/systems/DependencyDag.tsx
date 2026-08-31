"use client";

import Figure, { Plot } from "@/components/coherence/Figure";
import type { SystemHealth } from "@/components/systems/types";
import { metricRow } from "@/lib/format";
import {
  DEPENDENCY_GLYPH,
  DEPENDENCY_WORD,
  deriveDependencyTree,
  type DependencyNode,
} from "@/lib/dependency-graph";
import { LATENCY_MIN_SAMPLES } from "@/lib/overview-state";

export interface FlatDependencyNode {
  node: DependencyNode;
  parentId: string | null;
  depth: number;
  row: number;
}

export function flattenDependencyDag(root: DependencyNode): FlatDependencyNode[] {
  const rows = new Map<number, number>();
  const flat: FlatDependencyNode[] = [];
  const walk = (node: DependencyNode, parentId: string | null, depth: number) => {
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    flat.push({ node, parentId, depth, row });
    for (const child of node.children ?? []) walk(child, node.id, depth + 1);
  };
  walk(root, null, 0);
  return flat;
}

export function dependencyEdgeLatency(
  parentId: string,
  childId: string,
  health: SystemHealth | null,
): { measured: boolean; label: string; p99: number | null } {
  const stats = health?.summary.gatewayHopLatency;
  if (parentId === "web" && childId === "gateway"
      && stats && stats.n >= LATENCY_MIN_SAMPLES && stats.p99 != null && Number.isFinite(stats.p99)) {
    return { measured: true, p99: stats.p99, label: `web to gateway p99 ${Math.round(stats.p99)} ms, n=${stats.n}` };
  }
  return { measured: false, p99: null, label: "edge latency not measured" };
}

const NODE_W = 176;
const NODE_H = 70;
const MARGIN = { top: 18, right: 18, bottom: 18, left: 18 };
export const DEPENDENCY_DAG_TITLE = "Live dependency DAG";

/** Wrap a service label inside a bounded SVG node without changing its full tooltip. */
export function dependencyNodeLabelLines(label: string, maxChars = 21): string[] {
  const words = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      if (word.length <= maxChars) return [word];
      return Array.from(
        { length: Math.ceil(word.length / maxChars) },
        (_, index) => word.slice(index * maxChars, (index + 1) * maxChars),
      );
    });
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > maxChars) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length <= 3) return lines;
  const visible = lines.slice(0, 3);
  visible[2] = `${visible[2].slice(0, Math.max(1, maxChars - 1))}…`;
  return visible;
}

export default function DependencyDag({
  health,
  healthError,
}: {
  health: SystemHealth | null;
  healthError: string | null;
}) {
  const flat = flattenDependencyDag(deriveDependencyTree(health, healthError));
  const depthCount = Math.max(...flat.map((item) => item.depth), 0) + 1;
  const rowsByDepth = Array.from({ length: depthCount }, (_, depth) =>
    flat.filter((item) => item.depth === depth).length);
  const maxRows = Math.max(...rowsByDepth, 1);
  const height = Math.max(280, MARGIN.top + maxRows * 84 + MARGIN.bottom);
  const measuredEdges = flat.filter((item) => item.parentId
    && dependencyEdgeLatency(item.parentId, item.node.id, health).measured).length;
  const edgeCount = Math.max(0, flat.length - 1);
  const caption = "Current service dependency graph";

  return (
    <section className="card console-card dependency-dag-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Observed topology</span>
          <h2>{DEPENDENCY_DAG_TITLE}</h2>
        </div>
        <span className="section-note num">{metricRow([`${flat.length} nodes`, `${edgeCount} directed edges`])}</span>
      </div>
      <Figure
        caption={caption}
        ariaLabel={`Live service dependency directed acyclic graph with ${flat.length} nodes`}
        reading="Read left to right. Every node carries a glyph and state word; arrows mean depends on."
        missing={edgeCount > measuredEdges
          ? `${edgeCount - measuredEdges} edge ${edgeCount - measuredEdges === 1 ? "latency is" : "latencies are"} not measured.`
          : null}
      >
        <Plot height={height} minWidth={520} scrollLabel={caption}>
          {(width) => {
            const plotW = width - MARGIN.left - MARGIN.right;
            const xStep = depthCount > 1 ? (plotW - NODE_W) / (depthCount - 1) : 0;
            const positions = new Map(flat.map((item) => {
              const count = rowsByDepth[item.depth];
              const available = height - MARGIN.top - MARGIN.bottom;
              const y = MARGIN.top + ((item.row + 0.5) / count) * available - NODE_H / 2;
              return [item.node.id, { x: MARGIN.left + item.depth * xStep, y }] as const;
            }));
            return (
              <>
                {flat.filter((item) => item.parentId).map((item) => {
                  const from = positions.get(item.parentId!)!;
                  const to = positions.get(item.node.id)!;
                  const x0 = from.x + NODE_W;
                  const x1 = to.x;
                  const y0 = from.y + NODE_H / 2;
                  const y1 = to.y + NODE_H / 2;
                  const bend = (x0 + x1) / 2;
                  const latency = dependencyEdgeLatency(item.parentId!, item.node.id, health);
                  return (
                    <path key={`${item.parentId}-${item.node.id}`}
                      className={`dependency-dag__edge${latency.measured ? " is-measured" : ""}`}
                      d={`M${x0},${y0}C${bend},${y0} ${bend},${y1} ${x1},${y1}`}
                      fill="none" markerEnd="url(#dependency-arrow)">
                      <title>{`${item.parentId} to ${item.node.label}: ${latency.label}`}</title>
                    </path>
                  );
                })}
                <defs>
                  <marker id="dependency-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                    markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L8 4L0 8Z" fill="var(--axis)" />
                  </marker>
                </defs>
                {flat.map((item) => {
                  const at = positions.get(item.node.id)!;
                  const labelLines = dependencyNodeLabelLines(item.node.label);
                  return (
                    <g key={item.node.id} className="dependency-dag__node" data-state={item.node.health}>
                      <title>{`${item.node.label}: ${DEPENDENCY_WORD[item.node.health]}. ${item.node.detail}`}</title>
                      <rect x={at.x} y={at.y} width={NODE_W} height={NODE_H} rx={7} />
                      <text x={at.x + 9} y={at.y + 16} className="dependency-dag__name">
                        {labelLines.map((line, lineIndex) => (
                          <tspan key={`${lineIndex}-${line}`} x={at.x + 9} dy={lineIndex ? 13 : 0}>
                            {lineIndex === 0 ? `${DEPENDENCY_GLYPH[item.node.health]} ` : "  "}{line}
                          </tspan>
                        ))}
                      </text>
                      <text x={at.x + 9} y={at.y + NODE_H - 9} className="dependency-dag__state">
                        {DEPENDENCY_WORD[item.node.health]}
                      </text>
                    </g>
                  );
                })}
              </>
            );
          }}
        </Plot>
      </Figure>
      <p className="research-note dependency-dag__latency-note">
        {measuredEdges
          ? `Gateway-hop p99 labels use ${health?.summary.gatewayHopLatency?.n ?? 0} real health probes; other edge latency is unmeasured.`
          : "No edge has enough direct observations for a p99; edge latency is unmeasured."}
      </p>
    </section>
  );
}
