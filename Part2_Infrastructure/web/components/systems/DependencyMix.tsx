"use client";

/**
 * The topology as composition rather than as shape, beside the marks that say
 * which technologies are actually in it.
 *
 * WHY THE STATE RING EARNS ITS PLACE. It draws the module's central invariant.
 * When the gateway stops answering, `deriveDependencyTree` flips every
 * component behind it to `unknown` — never `down` — because you cannot read a
 * component's health through a dead transport. So a gateway outage paints a
 * large GREY wedge here, not a large red one, and the difference between "one
 * transport died" and "six components failed" is legible without reading a
 * single row. That is the whole argument of `lib/dependency-graph.ts`, drawn.
 *
 * NOT AN AVAILABILITY FIGURE. This is one snapshot of a live poll, not a ratio
 * over time. Nothing in this system publishes uptime as a percentage — only
 * durations — so the caption says composition and never implies a period.
 *
 * The five states use the STATUS roles rather than the series palette: there
 * are only three `--series-*` colours, and a fourth and fifth state would have
 * to reuse one, which is how "down" ends up rendering blue.
 */

import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import TechMark from "@/components/common/TechMark";
import {
  DEPENDENCY_WORD,
  deriveDependencyTree,
  summariseTree,
  type DependencyNode,
} from "@/lib/dependency-graph";
import type { SystemHealth } from "@/components/systems/types";

interface StripEntry {
  id: string;
  label: string;
  state: DependencyNode["health"];
  hint?: string | null;
}

/** Depth-first collection, since the shape is a tree. */
function walk(node: DependencyNode, out: DependencyNode[] = []): DependencyNode[] {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}

export default function DependencyMix({
  health,
  healthError,
}: {
  health: SystemHealth | null;
  healthError: string | null;
}) {
  const root = deriveDependencyTree(health, healthError);
  const counts = summariseTree(root);
  const nodes = walk(root);

  const platform = health?.platform;
  const hintFor = (id: string): string | null =>
    id === "audit" ? platform?.audit?.backend ?? null
      : id === "queue" ? platform?.queue?.backend ?? null
        : null;

  const pick = (test: (node: DependencyNode) => boolean): StripEntry[] =>
    nodes.filter(test).map((node) => ({
      id: node.id,
      label: node.label,
      state: node.health,
      hint: hintFor(node.id),
    }));

  const groups: Array<{ label: string; entries: StripEntry[] }> = [
    { label: "Providers", entries: pick((n) => n.id.startsWith("provider:")) },
    { label: "Venues", entries: pick((n) => n.id.startsWith("venue:")) },
    {
      label: "Platform",
      entries: pick((n) =>
        ["web", "gateway", "registry", "feeds", "risk", "audit", "queue", "mirror"].includes(n.id)),
    },
  ].filter((group) => group.entries.length > 0);

  const total = counts.ok + counts.degraded + counts.down + counts.absent + counts.unknown;
  const stateSlices: DonutSlice[] = [
    { label: DEPENDENCY_WORD.ok, value: counts.ok, colour: "var(--status-good)" },
    { label: DEPENDENCY_WORD.degraded, value: counts.degraded, colour: "var(--status-warning)" },
    { label: DEPENDENCY_WORD.down, value: counts.down, colour: "var(--status-critical)" },
    { label: DEPENDENCY_WORD.unknown, value: counts.unknown, colour: "var(--axis)" },
    { label: DEPENDENCY_WORD.absent, value: counts.absent, colour: "var(--text-muted)" },
  ];

  const providers = health?.providers ?? [];
  const ready = providers.filter((p) => p.ready).length;
  const tripped = providers.filter((p) => p.configured && p.circuitOpen).length;
  const unconfigured = providers.filter((p) => !p.configured).length;
  // Configured, no open circuit, and still not ready — held out by quota or by
  // a failed readiness probe. Reported rather than folded into "ready".
  const heldBack = Math.max(0, providers.length - ready - tripped - unconfigured);

  const providerSlices: DonutSlice[] = [
    { label: "routable", value: ready, colour: "var(--status-good)" },
    { label: "circuit open", value: tripped, colour: "var(--status-critical)" },
    { label: "held back", value: heldBack, colour: "var(--status-warning)" },
    { label: "not configured", value: unconfigured, colour: "var(--text-muted)" },
  ];

  return (
    <section className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Composition</span>
          <h2>What this desk runs on</h2>
        </div>
        <span className="section-note">{total} components</span>
      </div>

      <div className="tech-mark-strip">
        {groups.map((group) => (
          <div key={group.label} className="tech-mark-strip__group">
            <span className="tech-mark-strip__label">{group.label}</span>
            {group.entries.map((entry) => (
              <TechMark
                key={entry.id}
                nodeId={entry.id}
                label={entry.label}
                state={entry.state}
                backendHint={entry.hint}
                size="md"
              />
            ))}
          </div>
        ))}
      </div>

      <div className="dependency-charts">
        <div>
          <span className="field">By observed state</span>
          <DonutChart
            slices={stateSlices}
            total={total}
            centreValue={String(total)}
            centreLabel="components"
            ariaLabel="Dependency components by observed state"
            emptyNote="No health snapshot yet, so there is no topology to compose."
          />
        </div>
        <div>
          <span className="field">Provider APIs</span>
          <DonutChart
            slices={providerSlices}
            total={providers.length}
            centreValue={providers.length ? `${ready}/${providers.length}` : "—"}
            centreLabel="routable"
            ariaLabel="Provider APIs by whether they can currently be routed to"
            emptyNote="The provider registry has not been observed."
          />
        </div>
      </div>

      <details className="disclosure">
        <summary>What these rings count, and why they are not an uptime figure</summary>
        <p className="research-note">
          A snapshot of one poll, not a ratio over time. Nothing here publishes availability as a
          percentage — only durations — so a green ring means every component answered when it was
          last asked, and says nothing about the hour before.
        </p>
        <p className="research-note">
          <strong>Grey is not red.</strong> When the gateway cannot be reached, everything behind it
          reports <em>not observed</em> rather than <em>down</em>: one dead transport is not six
          broken components, and painting them red would send someone hunting outages that never
          happened. <em>Not configured</em> is likewise not a fault — it is a component this
          deployment was never given.
        </p>
        <p className="research-note">
          <strong>The marks are identifiers, not vendor assets.</strong> Where a technology&rsquo;s
          own mark is not carried here, the tile shows a house initialism — an approximation of a
          logo is recognisably wrong to anyone who knows the brand, and tinting a vendor mark by
          health status is the recolouring their guidelines prohibit. A hollow, dashed tile is a
          component that is not configured at all.
        </p>
      </details>
    </section>
  );
}
