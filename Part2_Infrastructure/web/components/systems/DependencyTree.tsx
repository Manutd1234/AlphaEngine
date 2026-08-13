"use client";

/**
 * The dependency topology, drawn as an outline rather than as a graph.
 *
 * `FailoverGraph` argues that a chain is a list and that a list survives narrow
 * screens and reduced motion. Both true, and both honoured here — but its
 * conclusion is scoped to a chain, and this is not one: a single gateway
 * failure takes out five leaves at once, and that fan-out is the thing this tab
 * exists to show.
 *
 * A nested `<ul>` with CSS connectors gets the shape without the costs. It is
 * an indented outline at any width, so there is no breakpoint to get wrong; the
 * edges are `::before` borders, so there are no coordinates to animate and
 * nothing for reduced motion to remove; and it needs no `forced-color-adjust`
 * exemption, so the high-contrast allow-list stays at the two entries the
 * forced-colors suite pins.
 *
 * Every node carries a glyph, the state word, and the wire field it was read
 * from — colour is the third carrier, never the first.
 */

import { useState } from "react";

import {
  DEPENDENCY_GLYPH,
  DEPENDENCY_WORD,
  deriveDependencyTree,
  summariseTree,
  type DependencyNode,
} from "@/lib/dependency-graph";
import type { SystemHealth } from "@/components/systems/types";

function Node({ node, depth }: { node: DependencyNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const children = node.children ?? [];

  return (
    <li className="dependency-node" data-state={node.health}>
      <div className="dependency-node__row">
        {children.length > 0 ? (
          <button
            type="button"
            className="dependency-node__toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span aria-hidden>{open ? "▾" : "▸"}</span>
            <span className="sr-only">
              {open ? "Collapse" : "Expand"} {node.label}
            </span>
          </button>
        ) : (
          <span className="dependency-node__toggle is-leaf" aria-hidden />
        )}

        <span className="dependency-node__state" title={DEPENDENCY_WORD[node.health]}>
          <span aria-hidden>{DEPENDENCY_GLYPH[node.health]}</span>
          <span className="sr-only">{DEPENDENCY_WORD[node.health]}</span>
        </span>

        <span className="dependency-node__name">
          <strong>{node.label}</strong>
          <span className="dependency-node__role">{node.role}</span>
        </span>

        <span className="dependency-node__word">{DEPENDENCY_WORD[node.health]}</span>
        <span className="dependency-node__detail">{node.detail}</span>
        {/* Provenance on the node itself: the state above is checkable rather
            than merely plausible. */}
        <code className="dependency-node__source">{node.source}</code>
      </div>

      {open && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <Node key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function DependencyTree({
  health,
  healthError,
}: {
  health: SystemHealth | null;
  healthError: string | null;
}) {
  const root = deriveDependencyTree(health, healthError);
  const counts = summariseTree(root);
  const tone = counts.down > 0 ? "critical"
    : counts.degraded > 0 ? "warning"
    : counts.unknown > 0 ? "neutral"
    : "good";

  return (
    <section className="card console-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Topology</span>
          <h2>What this desk depends on</h2>
        </div>
        <span className={`pill is-${tone}`}>
          {counts.down > 0
            ? `${counts.down} down`
            : counts.degraded > 0
              ? `${counts.degraded} degraded`
              : counts.unknown > 0
                ? `${counts.unknown} not observed`
                : `${counts.ok} healthy`}
        </span>
      </div>

      <p className="sub">
        Read top-down: everything indented under a node depends on it. Five states, because{" "}
        <em>not configured</em> and <em>not observed</em> are not faults — and when the gateway
        cannot be reached, everything behind it reports <em>not observed</em> rather than down,
        since one dead transport is not five broken components.
      </p>

      <ul className="dependency-tree" role="tree" aria-label="Service dependencies">
        <Node node={root} depth={0} />
      </ul>
    </section>
  );
}
