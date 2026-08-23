"use client";

/**
 * The watched universe as a filesystem: `ls` a path, `cat` a derived reading.
 *
 * A Kalshi universe already has the shape a filesystem has — shards hold
 * series, series hold events, events hold markets — and naming it that way
 * makes two facts unavoidable that a dashboard hides.
 *
 * The first is that where a market lives is a cost. Two events under different
 * shard directories sit on different exchange instances, and a position
 * spanning them cannot be protected by one order group, so the boundary is a
 * real constraint rather than a labelling detail. It is said where the shard
 * directories are listed, not in a footnote nobody reaches.
 *
 * The second is that a derived number is a file, and files can be missing.
 * `implied_pmf` is not an attribute an event has; it is computed from its
 * books, and on an event without a strike ladder the computation has no
 * answer. So three outcomes are kept apart here and never collapsed into "no
 * data": a path that does not exist, a file that exists whose reading could
 * not be produced in this read, and a gateway that could not be reached at
 * all. Only the last is worth retrying.
 *
 * The tree is the WATCHLIST. Kalshi lists some thirteen thousand series and
 * this holds the handful the recorder is configured to watch; the root says so
 * and the pane repeats it, because a shell that lists a fraction of what
 * exists without saying which fraction is worse than one that refuses.
 */

import { useState } from "react";

import type { CoherenceShell, CoherenceShellEntry } from "@/lib/coherence/types-lab";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { StateChip } from "./Figure";

/** The five readings an event directory carries beyond its markets. */
const DERIVED = new Set(["implied_pmf", "survival", "lattice", "certificate", "books"]);

function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function pathOf(segments: string[]): string {
  return `/${segments.join("/")}`;
}

/** A trailing slash marks a directory the way `ls -F` does — typography, not colour. */
function displayName(entry: CoherenceShellEntry): string {
  return entry.kind === "dir" ? `${entry.name}/` : entry.name;
}

function Breadcrumb({
  path,
  command,
  onNavigate,
}: {
  path: string;
  command: string;
  onNavigate: (next: string) => void;
}) {
  const segments = segmentsOf(path);
  // On a `cat` the last segment is the file being read, so it is a label
  // rather than a link: clicking it would re-run the read it is already showing.
  const last = command === "cat" ? segments.length - 1 : -1;
  return (
    <nav className="coh-shell__crumbs" aria-label="Current path">
      <button type="button" className="coh-shell__crumb" onClick={() => onNavigate("/")}>
        /
      </button>
      {segments.map((segment, index) =>
        index === last ? (
          <span key={`${segment}-${index}`} className="coh-shell__crumb is-current">
            {segment}
          </span>
        ) : (
          <button
            key={`${segment}-${index}`}
            type="button"
            className="coh-shell__crumb"
            onClick={() => onNavigate(pathOf(segments.slice(0, index + 1)))}
          >
            {segment}
          </button>
        ),
      )}
    </nav>
  );
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

function Listing({ data, onOpen }: { data: CoherenceShell; onOpen: (entry: CoherenceShellEntry) => void }) {
  const derived = data.entries.filter((entry) => entry.kind === "file" && DERIVED.has(entry.name));
  const directories = data.entries.filter((entry) => entry.kind === "dir");
  const markets = data.entries.filter((entry) => entry.kind === "file" && !DERIVED.has(entry.name));
  const atShards = segmentsOf(data.path).length === 1;

  return (
    <div className="coh-shell__listing">
      {directories.length ? (
        <section className="coh-shell__group">
          <h4 className="coh-shell__group-head">
            {directories.length} {directories.length === 1 ? "directory" : "directories"}
          </h4>
          {atShards ? (
            <p className="coh-shell__note">
              Each directory here is a separate exchange instance. Collateral is held per shard and an order group
              cannot span two of them, so a basket whose legs sit under different shard directories cannot be
              protected as one position — crossing this boundary is a real cost, not a naming convention.
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
            These are not attributes the event carries; each is computed from the books at the moment it is read, and
            each can answer that it has no answer. Reading one runs <code>cat</code> on it.
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
          <h4 className="coh-shell__group-head">{markets.length} markets</h4>
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
        </section>
      ) : null}

      {data.entries.length === 0 ? (
        <p className="coh-shell__note">
          <span aria-hidden="true">◌</span> This directory is empty. It exists; nothing the recorder watches is
          currently under it.
        </p>
      ) : null}
    </div>
  );
}

export default function ShellPane({ active }: { active: boolean }) {
  const [path, setPath] = useState("/");
  const [command, setCommand] = useState<"ls" | "cat">("ls");
  const url = `/api/gateway/coherence/shell?path=${encodeURIComponent(path)}&command=${command}`;
  const { data, error } = useCoherenceRead<CoherenceShell>(url, active);

  const navigate = (next: string) => {
    setPath(next);
    setCommand("ls");
  };

  const open = (entry: CoherenceShellEntry) => {
    const next = pathOf([...segmentsOf(data?.path ?? path), entry.name]);
    setPath(next);
    setCommand(entry.kind === "dir" ? "ls" : "cat");
  };

  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The tree could not be read: {error}. That is a gateway failure, not an
        answer about the path.
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Listing the watched universe…</p>;

  // The root request is `/` and the gateway answers `/shards`, so a mismatch is
  // only stale-payload evidence away from the root.
  const stale = path !== "/" && data.path !== path;

  return (
    <div className="coh-shell">
      <div className="coh-status__chips">
        <StateChip mark="●" word="Command" value={`${data.command} ${data.path}`} tone="muted" />
        <StateChip
          mark={data.exists ? "✓" : "○"}
          word={data.exists ? "Path exists" : "No such path"}
          tone={data.exists ? "good" : "warn"}
        />
        {data.command === "ls" ? (
          <StateChip mark="◇" word="Entries" value={String(data.entries.length)} tone="muted" />
        ) : null}
      </div>

      <Breadcrumb path={data.path} command={data.command} onNavigate={navigate} />

      {stale ? (
        <p className="coh-shell__note">
          <span aria-hidden="true">◌</span> Still showing {data.path} while {path} is read.
        </p>
      ) : null}

      {data.detail ? <p className="coh-shell__detail-line">{data.detail}.</p> : null}

      {!data.exists ? (
        <p className="console-empty">
          <span aria-hidden="true">○</span> No such path: {path}. Nothing is there to read — which is a different
          answer from a read that failed.
        </p>
      ) : data.command === "cat" ? (
        data.state === "ok" && data.body ? (
          <pre className="coh-shell__body">{data.body}</pre>
        ) : (
          <p className="console-empty">
            <span aria-hidden="true">◌</span> The file is listed here and this read produced no body for it. The path
            exists; the reading does not, in this read.
          </p>
        )
      ) : (
        <Listing data={data} onOpen={open} />
      )}

      <p className="coh-shell__note">
        This tree is the watchlist, not the exchange. Kalshi lists some thirteen thousand series; what is listed here
        is the set <code>COHERENCE_SERIES</code> names, and no part of the venue outside it has been read.
      </p>
      {error ? (
        <p className="coh-shell__note">
          <span aria-hidden="true">✕</span> The last refresh failed: {error}. What is above is the previous answer.
        </p>
      ) : null}
    </div>
  );
}
