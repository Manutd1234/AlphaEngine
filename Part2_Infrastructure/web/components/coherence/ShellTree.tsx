"use client";

import { useState } from "react";

import type { CoherenceShell } from "@/lib/coherence/types-lab";
import type { LivePoint } from "@/lib/coherence/use-live-series";

import baseStyles from "./MarketStructures.module.css";
import topologyStyles from "./ShellTopology.module.css";
import { useRovingListbox } from "./use-stable-selection-key";

const styles = { ...baseStyles, ...topologyStyles };

type EmptyKind = "always" | "family" | "read";

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

const LEVELS = [
  { name: "/shards", type: "root", note: "live watchlist root" },
  { name: "<shard>/", type: "shard", note: "one collateral pool" },
  { name: "<series>/", type: "series", note: "one watched series" },
  { name: "<event>/", type: "event", note: "market and computed files" },
  { name: "<market>", type: "market", note: "native contract" },
] as const;

const ARIA = "Live filesystem namespace from shards through series, events, markets, and computed files.";

function topologyPath(level: number, shard: string | null): string {
  const names = LEVELS.slice(1, level + 1).map((item, index) => {
    if (index === 0 && shard) return shard;
    return item.name.replace(/\/$/, "");
  });
  return ["/shards", ...names].join("/");
}

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
  onBrowse?: (path?: string) => void;
}) {
  const shards = (root?.entries ?? []).filter((entry) => entry.kind === "dir");
  const [selectedShard, setSelectedShard] = useState<string | null>(null);
  const [level, setLevel] = useState(3);
  const [file, setFile] = useState<number | null>(null);
  const activeShard = shards.some((entry) => entry.name === selectedShard) ? selectedShard : shards[0]?.name ?? null;
  const shardKeys = shards.map((entry) => entry.name);
  const levelKeys = LEVELS.map((item) => item.name);
  const fileKeys = DERIVED_FILES.map((item) => item.name);
  const [, setShardKey, shardOptionProps] = useRovingListbox(shardKeys, shardKeys[0], activeShard, setSelectedShard);
  const [, setLevelKey, levelOptionProps] = useRovingListbox(levelKeys, levelKeys[3]);
  const [, setFileKey, fileOptionProps] = useRovingListbox(fileKeys);
  const activeLevel = LEVELS[level];
  const activeFile = file == null ? null : DERIVED_FILES[file];
  const eventPath = topologyPath(3, activeShard);
  const command = activeFile ? `cat ${eventPath}/${activeFile.name}` : `ls ${topologyPath(level, activeShard)}`;
  const timestamp = updatedAt ? `${updatedAt.toISOString().slice(11, 19)}Z` : "waiting";
  const rootAvailable = root?.state === "available";
  const rootUnavailable = root != null && !rootAvailable;
  const liveState = error ? "stale" : rootUnavailable ? "unavailable" : rootAvailable ? "live" : loading ? "connecting" : "idle";
  const marks = tapeMarks(points);
  const trace = tapePath(marks);

  const chooseLevel = (index: number) => {
    setLevel(index);
    setLevelKey(levelKeys[index]);
    setFile(null);
  };

  const chooseFile = (index: number) => {
    setLevel(3);
    setLevelKey(levelKeys[3]);
    setFile(index);
    setFileKey(fileKeys[index]);
  };

  return (
    <figure className={styles.instrument} aria-label={ARIA}>
      <figcaption className={styles.head}>
        <span><small>Filesystem lens — live namespace</small>Follow one address from the watched root to its native and computed files</span>
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
                    onClick={() => setShardKey(entry.name)}
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

        <div className={styles.pathTopology} role="listbox" aria-label="Inspect the address schema">
          {LEVELS.map((item, index) => {
            const props = levelOptionProps(levelKeys[index], index);
            const display = index === 1 && activeShard ? `${activeShard}/` : item.name;
            return (
              <span className={styles.pathStep} key={item.name} data-active={level === index || undefined}
                    data-traversed={index < level || undefined}>
                <button type="button" role="option" className={styles.nodeButton} aria-selected={level === index}
                        tabIndex={props.tabIndex} onKeyDown={props.onKeyDown}
                        onFocus={() => { props.onFocus(); chooseLevel(index); }} onClick={() => chooseLevel(index)}>
                  <small>{String(index + 1).padStart(2, "0")} — {item.type}</small><strong>{display}</strong><span>{item.note}</span>
                </button>
              </span>
            );
          })}
        </div>

        <section className={styles.fileBranch} aria-label="Computed files beneath an event">
          <header><span><small>Event fan-out</small><strong>Computed files</strong></span><em>{level < 3 ? "Select the event node first" : "Select a file to form its cat command"}</em></header>
          <div className={styles.fileFan} role="listbox" aria-label="Inspect an event's computed files">
            <span className={styles.fanHub} aria-hidden="true"><strong>&lt;event&gt;/</strong><small>compute</small></span>
            {DERIVED_FILES.map((item, index) => {
              const props = fileOptionProps(fileKeys[index], index);
              return (
                <button type="button" role="option" key={item.name} className={styles.fileButton}
                        aria-selected={file === index} disabled={level < 3}
                        tabIndex={props.tabIndex} onKeyDown={props.onKeyDown}
                        onFocus={() => { props.onFocus(); chooseFile(index); }} onClick={() => chooseFile(index)}>
                  <span aria-hidden="true">{item.name === "books" ? "↔" : "◇"}</span><strong>{item.name}</strong><small>{item.emptyKind}</small>
                </button>
              );
            })}
          </div>
        </section>

      </div>

      <div className={styles.readout}>
        <span><small>Topology probe</small><strong>{activeFile?.name ?? activeLevel.name}</strong></span>
        <span className={styles.readoutCopy}>{activeFile ? `${activeFile.reads} ${activeFile.silent}` : `${activeLevel.note}. ${level < 4 ? "Follow the line to inspect the next address level." : "Native bid ladders live here."}`}</span>
        {onBrowse ? (
          <button type="button" className={styles.browseButton} onClick={() => onBrowse(activeShard ? `/shards/${activeShard}` : "/")}>
            Browse live shard →
          </button>
        ) : null}
      </div>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {command}. {activeFile ? `${activeFile.reads} ${activeFile.silent}` : activeLevel.note}.
      </output>
      <p className="coh-figure__reading">
        This is the configured watchlist, not the whole exchange. The highlighted address is one traversable path;
        Routing shows what its shard boundary means for a two-leg order.
      </p>
      <p className="coh-figure__missing">
        <span aria-hidden="true">◌</span>
        <span>The map reads only the configured root; Browse resolves deeper paths on demand.</span>
      </p>
    </figure>
  );
}
