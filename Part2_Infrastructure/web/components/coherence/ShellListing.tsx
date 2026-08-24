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
 * THE MARKETS ARE FOLDED, and the parallel is deliberate. An event directory
 * on a bucket family holds five derived readings and up to a hundred and
 * eighty-eight markets, which is the same hundred and eighty-eight rows
 * `UniversePane` puts behind "Every outcome as quoted, 188 rows". A reader
 * walking the tree is choosing between the readings and the leaves; the
 * readings are what `cat` answers and the leaves are what they scroll past. So
 * the leaves open on request, counted in their own summary, and the two groups
 * a reader navigates BY stay open.
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
import { DERIVED_FILES } from "./ShellTree";

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

function EntryRow({ entry, onOpen }: { entry: CoherenceShellEntry; onOpen: () => void }) {
  return (
    <li className="coh-shell__entry">
      <button type="button" className="coh-shell__open" onClick={onOpen}>
        <span className="coh-shell__name">{displayName(entry)}</span>
        <span className="coh-shell__kind">{entry.kind === "dir" ? "directory" : "file"}</span>
        <span className="coh-shell__detail">{entry.detail}</span>
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

  return (
    <div className="coh-shell__listing">
      {directories.length ? (
        <section className="coh-shell__group">
          <h4 className="coh-shell__group-head">
            {directories.length} {directories.length === 1 ? "directory" : "directories"}
          </h4>
          {/* The consequence for legs is spelled once, on the Layout view's
              reading — this note keeps the rule and the pinned phrase. */}
          {atShards ? (
            <p className="coh-shell__note">
              Each directory is a separate exchange instance: collateral is held per shard, so one order group cannot
              span two.
            </p>
          ) : null}
          <ul className="coh-shell__entries">
            {directories.map((entry) => (
              <EntryRow key={entry.name} entry={entry} onOpen={() => onOpen(entry)} />
            ))}
          </ul>
        </section>
      ) : null}

      {derived.length ? (
        <section className="coh-shell__group">
          <h4 className="coh-shell__group-head">{derived.length} derived readings</h4>
          <p className="coh-shell__note">
            Computed from the books at read time, not attributes the event carries — so each can answer that it has no
            answer.
          </p>
          <ul className="coh-shell__entries">
            {derived.map((entry) => (
              <EntryRow key={entry.name} entry={entry} onOpen={() => onOpen(entry)} />
            ))}
          </ul>
        </section>
      ) : null}

      {markets.length ? (
        <section className="coh-shell__group">
          {/* No `.coh-shell__group-head` over this one: the summary states the
              count, and a heading saying "188 markets" above a summary saying
              "188 files" is the same number twice in eight pixels. */}
          <details className="disclosure">
            <summary>
              Every market in this directory, {markets.length} {markets.length === 1 ? "file" : "files"}
            </summary>
            <ul className="coh-shell__entries is-dense">
              {markets.map((entry) => (
                <li key={entry.name} className="coh-shell__entry">
                  <button
                    type="button"
                    className="coh-shell__open"
                    onClick={() => onOpen(entry)}
                    aria-label={`${entry.name}, ${entry.detail}`}
                  >
                    <span className="coh-shell__name">{entry.name}</span>
                    <span className="coh-shell__detail">{entry.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}

      {data.entries.length === 0 ? (
        READ_OK.has(data.state) ? (
          <p className="coh-shell__note">
            <span aria-hidden="true">◌</span> This directory is empty. It exists; nothing watched is currently under
            it.
          </p>
        ) : (
          <p className="coh-shell__note">
            <span aria-hidden="true">✕</span> The venue could not be read in this refresh, so nothing was listed.
            That is an outage and not an empty directory — the one outcome here worth retrying.
          </p>
        )
      ) : null}
    </div>
  );
}
