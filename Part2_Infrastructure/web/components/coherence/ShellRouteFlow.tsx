"use client";

import { useState } from "react";

import type { CoherenceShell } from "@/lib/coherence/types-lab";

import styles from "./ShellRouteFlow.module.css";

/**
 * The collateral rule as an activity diagram.
 *
 * The namespace map answers where an event lives. This diagram answers the
 * next, operational question: whether two legs can share one order group once
 * their shard directories are known. Both branches remain visible so changing
 * the control changes the highlighted decision path rather than replacing the
 * explanation beneath the reader.
 */
export default function ShellRouteFlow({
  root,
  loading = false,
  error = null,
  updatedAt = null,
  onBrowse,
}: {
  root?: CoherenceShell | null;
  loading?: boolean;
  error?: string | null;
  updatedAt?: Date | null;
  onBrowse?: (path?: string) => void;
}) {
  const shards = (root?.entries ?? []).filter((entry) => entry.kind === "dir");
  const [selectedShard, setSelectedShard] = useState<string | null>(null);
  const [route, setRoute] = useState<"same" | "cross">("same");
  const activeShard = shards.some((entry) => entry.name === selectedShard)
    ? selectedShard
    : shards[0]?.name ?? null;
  const secondShard = shards.find((entry) => entry.name !== activeShard)?.name ?? null;
  const crossShard = route === "cross" && Boolean(secondShard);
  const timestamp = updatedAt ? `${updatedAt.toISOString().slice(11, 19)}Z` : "waiting";
  const rootAvailable = root?.state === "available";
  const state = error
    ? rootAvailable ? "stale" : "failed"
    : root != null && !rootAvailable
      ? "unavailable"
      : rootAvailable
        ? "live"
        : loading
          ? "connecting"
          : "idle";
  const sourceLabel = activeShard ? `${activeShard}/` : "waiting";
  const targetLabel = crossShard && secondShard ? `${secondShard}/` : sourceLabel;
  const sameActive = Boolean(activeShard) && !crossShard;
  const crossActive = Boolean(activeShard) && crossShard;
  const result = !activeShard
    ? "Route withheld"
    : crossShard
      ? "Use separate order groups"
      : "One order group can protect both legs";

  return (
    <figure className={styles.instrument} aria-label="Collateral routing activity diagram">
      <figcaption className={styles.head}>
        <span>
          <small>Collateral activity</small>
          Follow the shard decision from two proposed legs to the executable route
        </span>
        <strong data-state={state}>{state}, {timestamp}</strong>
      </figcaption>

      <div className={styles.controls}>
        {shards.length > 1 ? (
          <label>
            <span>Starting shard</span>
            <select value={activeShard ?? ""} onChange={(event) => setSelectedShard(event.target.value)}>
              {shards.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}/</option>)}
            </select>
          </label>
        ) : (
          <div className={styles.fixedShard}>
            <span>Starting shard</span>
            <strong>{activeShard ? `${activeShard}/` : "Waiting for /shards"}</strong>
          </div>
        )}
        <div className={styles.routeChoices} role="group" aria-label="Choose where the second leg lives">
          <button type="button" aria-pressed={sameActive} disabled={!activeShard} onClick={() => setRoute("same")}>
            Same shard
          </button>
          <button type="button" aria-pressed={crossActive} disabled={!secondShard} onClick={() => setRoute("cross")}>
            Cross shard
          </button>
        </div>
      </div>

      <ol className={styles.mobileFlow} aria-label="Collateral routing decision">
        <li className={styles.mobileAction}>
          <small>Step 1: Action</small>
          <strong>Resolve both paths under /shards</strong>
        </li>
        <li className={styles.mobileDecision}>
          <small>Step 2: Decision</small>
          <strong>Do both legs share a shard?</strong>
        </li>
        <li className={styles.mobileOutcome} data-outcome="connected" data-active={sameActive || undefined}>
          <small>Yes</small>
          <strong>Reuse one collateral pool</strong>
          <span>{sourceLabel}, legs A + B, connected</span>
        </li>
        <li className={styles.mobileOutcome} data-outcome="split" data-active={crossActive || undefined}>
          <small>No</small>
          <strong>Use separate order groups</strong>
          <span>{sourceLabel} to {targetLabel}, isolated</span>
        </li>
      </ol>

      <div
        className={styles.canvas}
        role="img"
        tabIndex={0}
        aria-label={!activeShard
          ? "No live shard was returned, so the route decision is withheld."
          : crossShard
            ? `Leg A is on ${activeShard} and leg B is on ${secondShard}; the shard decision is no, so the legs require separate order groups.`
            : `Both legs are on ${activeShard}; the shard decision is yes, so one order group can protect both.`}
      >
        <svg viewBox="0 0 1120 420" aria-hidden="true">
          <defs>
            <marker id="shell-route-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" className={styles.arrowHead} />
            </marker>
          </defs>

          <rect x="20" y="32" width="1080" height="150" rx="12" className={styles.lane} />
          <rect x="20" y="238" width="1080" height="150" rx="12" className={styles.lane} />
          <text x="42" y="58" className={styles.laneLabel}>SAME COLLATERAL POOL</text>
          <text x="42" y="372" className={styles.laneLabel}>SEPARATE COLLATERAL POOLS</text>

          <circle cx="72" cy="210" r="17" className={styles.startNode} />
          <line x1="90" x2="140" y1="210" y2="210" className={styles.connector} markerEnd="url(#shell-route-arrow)" />

          <g className={styles.actionNode}>
            <rect x="150" y="162" width="190" height="96" rx="18" />
            <text x="245" y="194" textAnchor="middle">Resolve both</text>
            <text x="245" y="220" textAnchor="middle">filesystem paths</text>
            <text x="245" y="244" textAnchor="middle" className={styles.nodeMeta}>under /shards</text>
          </g>
          <line x1="340" x2="397" y1="210" y2="210" className={styles.connector} markerEnd="url(#shell-route-arrow)" />

          <g className={styles.decisionNode}>
            <polygon points="480,125 563,210 480,295 397,210" />
            <text x="480" y="202" textAnchor="middle">Same</text>
            <text x="480" y="226" textAnchor="middle">shard?</text>
          </g>

          <path d="M480 125 V108 H650" className={styles.connector} data-outcome="connected" data-active={sameActive || undefined} markerEnd="url(#shell-route-arrow)" />
          <text x="535" y="98" className={styles.edgeLabel}>YES</text>
          <g className={styles.branchNode} data-outcome="connected" data-active={sameActive || undefined}>
            <rect x="665" y="68" width="225" height="80" rx="16" />
            <text x="777" y="99" textAnchor="middle">Reuse one pool</text>
            <text x="777" y="125" textAnchor="middle" className={styles.nodeMeta}>{sourceLabel}, legs A + B</text>
          </g>
          <line x1="890" x2="1014" y1="108" y2="108" className={styles.connector} data-outcome="connected" data-active={sameActive || undefined} markerEnd="url(#shell-route-arrow)" />
          <g className={styles.endNode} data-outcome="connected" data-active={sameActive || undefined}>
            <circle cx="1042" cy="108" r="22" />
            <circle cx="1042" cy="108" r="12" />
            <text x="1042" y="150" textAnchor="middle">CONNECTED</text>
          </g>

          <path d="M480 295 V313 H650" className={styles.connector} data-outcome="split" data-active={crossActive || undefined} markerEnd="url(#shell-route-arrow)" />
          <text x="535" y="338" className={styles.edgeLabel}>NO</text>
          <g className={styles.branchNode} data-outcome="split" data-active={crossActive || undefined}>
            <rect x="665" y="273" width="225" height="80" rx="16" />
            <text x="777" y="304" textAnchor="middle">Split the route</text>
            <text x="777" y="330" textAnchor="middle" className={styles.nodeMeta}>{sourceLabel} to {targetLabel}</text>
          </g>
          <line x1="890" x2="1014" y1="313" y2="313" className={styles.connector} data-outcome="split" data-active={crossActive || undefined} markerEnd="url(#shell-route-arrow)" />
          <g className={styles.endNode} data-outcome="split" data-active={crossActive || undefined}>
            <circle cx="1042" cy="313" r="22" />
            <circle cx="1042" cy="313" r="12" />
            <text x="1042" y="355" textAnchor="middle">ISOLATED</text>
          </g>
        </svg>
      </div>

      <div className={styles.readout} data-route={!activeShard ? "withheld" : crossShard ? "split" : "connected"}>
        <span><small>Decision</small><strong>{!activeShard ? "◌ withheld" : crossShard ? "↔ separate groups" : "✓ same-shard"}</strong></span>
        <p>{result}. Shard directories are exchange instances, so collateral never crosses their boundary.</p>
        {onBrowse && activeShard ? (
          <button type="button" onClick={() => onBrowse(`/shards/${activeShard}`)}>
            Browse {sourceLabel} →
          </button>
        ) : null}
      </div>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {sourceLabel} to {targetLabel}: {result}.
      </output>
    </figure>
  );
}
