"use client";

import { useState } from "react";

import type { CoherenceShell } from "@/lib/coherence/types-lab";
import type { LivePoint } from "@/lib/coherence/use-live-series";

import baseStyles from "./MarketStructures.module.css";
import topologyStyles from "./ShellTopology.module.css";
import { useRovingListbox } from "./use-stable-selection-key";

const styles = { ...baseStyles, ...topologyStyles };

type EmptyKind = "always" | "family" | "read";
type BrowseCommand = "ls" | "cat";

/** Computed files and their explicit empty-state semantics. */
export const DERIVED_FILES: ReadonlyArray<{
  name: string;
  reads: string;
  silent: string;
  emptyKind: EmptyKind;
}> = [
  {
    name: "implied_pmf",
    reads: "Probability mass differenced from the strike ladder.",
    silent: "Unavailable when the books build no surface; never coerced to zero.",
    emptyKind: "family",
  },
  {
    name: "survival",
    reads: "The strike ladder's survival function.",
    silent: "Unavailable for interval families without a threshold curve.",
    emptyKind: "family",
  },
  {
    name: "lattice",
    reads: "Market implications from exchange metadata.",
    silent: "Always addressable, even without a quoted book.",
    emptyKind: "always",
  },
  {
    name: "certificate",
    reads: "The coherence test and its proof.",
    silent: "Absent from this read until solved on demand.",
    emptyKind: "read",
  },
  {
    name: "books",
    reads: "Bid ladders and their implied offers.",
    silent: "Always answers; an empty side is a dash, never a zero price.",
    emptyKind: "always",
  },
];

const ARIA = "Connected filesystem namespace from shards through series and events to native and computed files.";

interface TapeMark {
  index: number;
  x: number;
  y: number;
}

function tapeMarks(points: readonly LivePoint[]): Array<TapeMark | null> {
  const readable = points.map((point) => point.value).filter((value): value is number => value != null);
  if (!readable.length) return points.map(() => null);
  const low = Math.min(...readable);
  const high = Math.max(...readable);
  const span = Math.max(1, high - low);
  return points.map((point, index) => {
    if (point.value == null) return null;
    const x = points.length < 2 ? 50 : (index / (points.length - 1)) * 100;
    const y = 28 - ((point.value - low) / span) * 22;
    return { index, x, y };
  });
}

function tapePath(marks: ReadonlyArray<TapeMark | null>): string {
  let connected = false;
  return marks.map((mark) => {
    if (mark == null) {
      connected = false;
      return "";
    }
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${mark.x},${mark.y}`;
  }).filter(Boolean).join(" ");
}

function StageArrow({ vertical = false }: { vertical?: boolean }) {
  return (
    <span className={vertical ? styles.dropArrow : styles.stageArrow} aria-hidden="true">
      <svg viewBox="0 0 40 20" preserveAspectRatio="none">
        <line x1="2" y1="10" x2="31" y2="10" />
        <path d="M27 4 L37 10 L27 16" />
      </svg>
    </span>
  );
}

function SchemaStage({ number, kind, title, note }: {
  number: string;
  kind: string;
  title: string;
  note: string;
}) {
  return (
    <article className={styles.stageCard} data-schema="true">
      <small>{number} — {kind}</small>
      <strong>{title}</strong>
      <span>{note}</span>
    </article>
  );
}

export default function ShellTree({
  root,
  loading = false,
  error = null,
  updatedAt = null,
  points = [],
  onBrowse,
}: {
  root?: CoherenceShell | null;
  loading?: boolean;
  error?: string | null;
  updatedAt?: Date | null;
  points?: readonly LivePoint[];
  onBrowse?: (path: string, command: BrowseCommand) => void;
}) {
  const shards = (root?.entries ?? []).filter((entry) => entry.kind === "dir");
  const [selectedShard, setSelectedShard] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<"root" | "shard">("shard");
  const activeShard = shards.some((entry) => entry.name === selectedShard)
    ? selectedShard
    : shards[0]?.name ?? null;
  const activeShardEntry = shards.find((entry) => entry.name === activeShard) ?? null;
  const shardKeys = shards.map((entry) => entry.name);
  const [, setShardKey, shardOptionProps] = useRovingListbox(
    shardKeys,
    shardKeys[0],
    activeShard,
    setSelectedShard,
  );
  const exactStage = selectedStage === "shard" && activeShard ? "shard" : "root";
  const browsePath = exactStage === "shard" ? `/shards/${activeShard}` : "/shards";
  const command = `ls ${browsePath}`;
  const timestamp = updatedAt ? `${updatedAt.toISOString().slice(11, 19)}Z` : "waiting";
  const rootAvailable = root?.state === "available";
  const rootUnavailable = root != null && !rootAvailable;
  const liveState = error ? "stale" : rootUnavailable ? "unavailable" : rootAvailable ? "live" : loading ? "connecting" : "idle";
  const marks = tapeMarks(points);
  const trace = tapePath(marks);

  const chooseShard = (name: string) => {
    setShardKey(name);
    setSelectedStage("shard");
  };

  return (
    <figure className={styles.instrument} aria-label={ARIA}>
      <figcaption className={styles.head}>
        <span><small>Filesystem lens — live namespace</small>One connected address flow, from watched root to readable files</span>
        <strong data-state={liveState}>{liveState}</strong>
      </figcaption>

      <div className={styles.shellStage}>
        <div className={styles.commandTrace}>
          <span aria-hidden="true">$</span><code>{command}</code>
          <strong>{rootUnavailable ? root.detail || "root unavailable" : rootAvailable ? `${root.entries.length} root entries; ${timestamp}` : error ? "last read failed" : "opening root"}</strong>
        </div>

        <section className={styles.liveRoot} aria-label="Live shard root">
          <header>
            <span><small>Live root</small><strong>/shards</strong></span>
            <span className={styles.livePulse} data-state={liveState}>{timestamp}</span>
          </header>
          <div className={styles.rootWorkbench}>
            <div className={styles.shardRail} role="listbox" aria-label="Choose a live shard">
              {shards.length ? shards.map((entry, index) => {
                const option = shardOptionProps(entry.name, index);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeShard === entry.name}
                    key={entry.name}
                    tabIndex={option.tabIndex}
                    onKeyDown={option.onKeyDown}
                    onFocus={option.onFocus}
                    onClick={() => chooseShard(entry.name)}
                  >
                    <span className="num">{String(index + 1).padStart(2, "0")}</span>
                    <strong>{entry.name}/</strong>
                    <small>{entry.detail || "collateral pool"}</small>
                  </button>
                );
              }) : (
                <p>{rootUnavailable ? root.detail || "Root unavailable" : error ? "Root unavailable" : "Waiting for shard directories…"}</p>
              )}
            </div>
            <div className={styles.rootTape}>
              <span><small>Browser-observed feed</small><strong>{rootAvailable ? root.entries.length : "—"} entries</strong></span>
              <svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="Root entry count over polls seen in this browser">
                <line x1="0" x2="100" y1="28" y2="28" />
                {trace ? <path d={trace} /> : null}
                {marks.map((mark) => mark == null ? null : <circle key={mark.index} cx={mark.x} cy={mark.y} r="1.7" />)}
              </svg>
              <small>{points.length} poll{points.length === 1 ? "" : "s"} retained locally</small>
            </div>
          </div>
        </section>

        <section className={styles.umlDiagram} aria-label="Namespace stages">
          <header><small>UML namespace</small><strong>Address stages and event-owned files</strong></header>
          <div className={styles.primaryFlow}>
            <button
              type="button"
              className={styles.stageCard}
              aria-pressed={exactStage === "root"}
              onClick={() => setSelectedStage("root")}
            >
              <small>01 — root</small><strong>/shards</strong><span>configured live watchlist</span>
            </button>
            <StageArrow />
            {activeShard ? (
              <button
                type="button"
                className={styles.stageCard}
                aria-pressed={exactStage === "shard"}
                onClick={() => setSelectedStage("shard")}
              >
                <small>02 — shard</small><strong>{activeShard}/</strong>
                <span>{activeShardEntry?.detail || "one collateral pool"}</span>
              </button>
            ) : (
              <SchemaStage number="02" kind="shard" title="No live shard" note="waiting for the configured root" />
            )}
            <StageArrow />
            <SchemaStage number="03" kind="series" title="Series directory" note="resolved in Browse under the selected shard" />
          </div>

          <StageArrow vertical />
          <SchemaStage number="04" kind="event" title="Event directory" note="owns native contracts and computed readings" />

          <div className={styles.branchFork} aria-hidden="true">
            <svg viewBox="0 0 100 42" preserveAspectRatio="none">
              <path d="M50 0 V16 H25 V32 M50 16 H75 V32" />
              <path d="M20 27 L25 39 L30 27 M70 27 L75 39 L80 27" />
            </svg>
          </div>
          <div className={styles.branchGrid}>
            <SchemaStage number="05" kind="market" title="Native market file" note="cat returns live quotes, price grid, depth, and activity" />
            <article className={`${styles.stageCard} ${styles.computedStage}`}>
              <small>event fan-out — computed</small>
              <strong>Derived files</strong>
              <span>Each name is resolved beneath an exact event path in Browse.</span>
              <ul>
                {DERIVED_FILES.map((item) => <li key={item.name}><code>{item.name}</code><small>{item.emptyKind}</small></li>)}
              </ul>
            </article>
          </div>
        </section>
      </div>

      <div className={styles.readout}>
        <span><small>Exact Browse target</small><strong>{browsePath}</strong></span>
        <span className={styles.readoutCopy}>The button runs this exact listing. Deeper names appear only after Browse has resolved their real parent path.</span>
        {onBrowse ? (
          <button type="button" className={styles.browseButton} onClick={() => onBrowse(browsePath, "ls")}>
            Browse {exactStage === "shard" ? "selected shard" : "root"} →
          </button>
        ) : null}
      </div>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {command}. Exact Browse target {browsePath}.
      </output>
      <p className="coh-figure__reading">
        This is the configured watchlist, not the whole exchange. A shard fixes the collateral pool;
        Browse supplies the real series, event, and file names beneath it.
      </p>
      <p className={`${styles.instrumentNote} coh-figure__missing`}>
        <span aria-hidden="true">◌</span>
        <span>The map reads only the configured root; Browse resolves deeper paths on demand.</span>
      </p>
    </figure>
  );
}
