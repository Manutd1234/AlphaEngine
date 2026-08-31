"use client";

/**
 * One `ls` answer, drawn: the directories, the derived readings, the markets.
 *
 * SPLIT OUT OF `ShellPane` ON 2026-08-24, at 390 lines against a 400-line
 * ceiling that is a one-way ratchet. The house rule is to split rather than to
 * shave prose, and this is the seam the pane already had: everything here
 * renders ONE listing payload and nothing here knows about the path grammar,
 * the view switcher, the poll or the breadcrumb. `ShellPane` keeps all four,
 * which is why `atShards` arrives as a prop rather than being re-derived from
 * `data.path` — one file owns what a path segment means.
 *
 * An event directory can hold five derived readings and up to a hundred and
 * eighty-eight markets. The explorer keeps those entries in one sortable-style
 * list with explicit folder, computed-file and market types, plus local
 * scrolling so a long strike ladder does not lengthen the whole page.
 *
 * Four outcomes are kept apart here and never collapsed into "no data": a path
 * that does not exist, a file whose reading could not be produced in this read,
 * a directory that is genuinely empty, and a venue that could not be read at
 * all. The empty directory is the one that had been stating more than it knew —
 * the gateway answers `state="unavailable"` with `exists` true and no entries
 * on a venue outage, and rendering that as "this directory is empty" turns a
 * fact about the read into a fact about the tree. So it is gated on the read
 * having come back: a listing answers `available`, a file body `ok`.
 */

import type { CoherenceShell, CoherenceShellEntry } from "@/lib/coherence/types-lab";
import { ChevronRight, FileText, Folder, Sigma } from "lucide-react";
import { DERIVED_FILES } from "./ShellTree";
import styles from "./ShellBrowser.module.css";

const DERIVED = new Set(DERIVED_FILES.map((file) => file.name));

/** The two states that mean the read itself came back — `available` from a listing, `ok` from a file body.
 *  Anything else, on a payload that still says the path exists, is the venue speaking rather than the path.
 *  Exported because `ShellPane` reads it too, to decide whether the gateway's
 *  root detail is the footer's sentence in other words. */
export const READ_OK = new Set(["ok", "available"]);

/** A trailing slash marks a directory the way `ls -F` does — typography, not colour. */
function displayName(entry: CoherenceShellEntry): string {
  return entry.kind === "dir" ? `${entry.name}/` : entry.name;
}

function EntryRow({ entry, derived, onOpen }: { entry: CoherenceShellEntry; derived: boolean; onOpen: () => void }) {
  const Icon = entry.kind === "dir" ? Folder : derived ? Sigma : FileText;
  return (
    <li className={styles.fileRow}>
      <button type="button" onClick={onOpen} title={`${displayName(entry)} — ${entry.detail}`}>
        <span className={styles.fileName}><Icon aria-hidden="true" /><strong>{displayName(entry)}</strong></span>
        <span className={styles.fileType}>{entry.kind === "dir" ? "Folder" : derived ? "Computed" : "Market"}</span>
        <span className={styles.fileDetail}>{entry.detail}</span>
        <ChevronRight aria-hidden="true" className={styles.openMark} />
      </button>
    </li>
  );
}

export default function ShellListing({
  data,
  atShards,
  onOpen,
}: {
  data: CoherenceShell;
  /** True at `/shards`, where the directories are separate exchange instances. */
  atShards: boolean;
  onOpen: (entry: CoherenceShellEntry) => void;
}) {
  const derived = data.entries.filter((entry) => entry.kind === "file" && DERIVED.has(entry.name));
  const directories = data.entries.filter((entry) => entry.kind === "dir");
  const markets = data.entries.filter((entry) => entry.kind === "file" && !DERIVED.has(entry.name));
  const entries = [...directories, ...derived, ...markets];

  return (
    <div className={styles.listing}>
      {atShards ? (
        <p className={styles.listHint}>
          <span aria-hidden="true">◇</span>
          <span>Each top-level folder is one exchange instance and one collateral pool.</span>
        </p>
      ) : derived.length ? (
        <p className={styles.listHint}>
          <span aria-hidden="true">Σ</span>
          <span>Computed files are derived from the books at read time; an unavailable reading is never coerced to zero.</span>
        </p>
      ) : null}

      {entries.length ? (
        <div className={styles.fileTable} role="region" aria-label={`${entries.length} filesystem entries`} tabIndex={0}>
          <div className={styles.fileHeader} aria-hidden="true">
            <span>Name</span><span>Type</span><span>Details</span><span />
          </div>
          <ul className={styles.fileRows}>
            {entries.map((entry) => (
              <EntryRow key={`${entry.kind}:${entry.name}`} entry={entry} derived={DERIVED.has(entry.name)} onOpen={() => onOpen(entry)} />
            ))}
          </ul>
        </div>
      ) : null}

      {data.entries.length === 0 ? (
        READ_OK.has(data.state) ? (
          <p className={styles.emptyDirectory}>
            <span aria-hidden="true">◌</span> This directory is empty. It exists; nothing watched is currently under
            it.
          </p>
        ) : (
          <p className={styles.emptyDirectory}>
            <span aria-hidden="true">✕</span> The venue could not be read in this refresh, so nothing was listed.
            That is an outage and not an empty directory — the one outcome here worth retrying.
          </p>
        )
      ) : null}
    </div>
  );
}
