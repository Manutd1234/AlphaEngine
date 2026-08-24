"use client";

/**
 * The watched universe as a filesystem: `ls` a path, `cat` a derived reading.
 *
 * A Kalshi universe already has the shape a filesystem has — shards hold
 * series, series hold events, events hold markets — and naming it that way
 * makes two facts unavoidable that a dashboard hides.
 *
 * The first is that where a market lives is a cost. Two events under different
 * shard directories sit on different exchange instances and a position spanning
 * them cannot be protected by one order group, so it is said where the shard
 * directories are listed, not in a footnote nobody reaches.
 *
 * The second is that a derived number is a file, and files can be missing.
 * `implied_pmf` is not an attribute an event has; it is computed from its
 * books, and on an event without a strike ladder the computation has no answer.
 * So four outcomes are kept apart here and never collapsed into "no data": a
 * path that does not exist, a file whose reading could not be produced in this
 * read, a directory that is genuinely empty, and a venue that could not be read
 * at all. The first is never worth reading again, the second can come out of a
 * later read — the certificate is solved on demand — and the last always is.
 * The empty directory is the one that had been stating more than it knew: the
 * gateway answers `state="unavailable"` with `exists` true and no entries on a
 * venue outage, and rendering that as "this directory is empty" turns a fact
 * about the read into a fact about the tree. So it is gated on the read having
 * come back — a listing answers `available`, a file body `ok`.
 *
 * Tree and Reading are one read under two commands, so they are a `.seg` and
 * not two panes: `cat` used to REPLACE the listing, and the only way back was
 * the breadcrumb, which re-runs `ls` and loses the file. The breadcrumb stays
 * outside the switcher — it is this surface's command line, setting the path
 * and, through what it lands on, the command.
 *
 * Layout is a third view on that same control, and it reads nothing. The other
 * two answer one level at a time, so a reader sees shards OR series OR events
 * and never the shape they came out of — and the shape is where the shard
 * boundary and the five derived readings live. It is the same at every path, so
 * the poll is gated on the view not being it; that gate is also why it is the
 * one view that still answers when the venue does not, and why the switcher is
 * rendered above the failure branches rather than after them.
 *
 * The tree is the WATCHLIST. Kalshi lists some thirteen thousand series and
 * this holds the handful the recorder is configured to watch; the root says so
 * and the pane repeats it — once. The gateway's root detail and the pane's
 * footer were the same sentence twice; the footer is kept, as it alone names
 * COHERENCE_SERIES.
 */

import { type ReactNode, useState } from "react";

import type { CoherenceShell, CoherenceShellEntry } from "@/lib/coherence/types-lab";
import CommandReference from "./ShellCommandReference";
import PaneHead from "./PaneHead";
import { shellRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { StateChip } from "./Figure";
import ShellTree, { DERIVED_FILES } from "./ShellTree";

type ShellView = "tree" | "reading" | "layout";

/** The switcher's options, in the order they are pressed. */
const VIEWS: ReadonlyArray<[ShellView, string]> = [
  ["tree", "Tree"],
  ["reading", "Reading"],
  ["layout", "Layout"],
];

const DERIVED = new Set(DERIVED_FILES.map((file) => file.name));

/** The two states that mean the read itself came back — `available` from a listing, `ok` from a file body.
 *  Anything else, on a payload that still says the path exists, is the venue speaking rather than the path. */
const READ_OK = new Set(["ok", "available"]);

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
              Each directory is a separate exchange instance. Collateral is held per shard and one order group
              cannot span two, so legs under different shard directories cannot be protected as a single position:
              a real cost, not a naming convention.
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
            Not attributes the event carries: each is computed from the books at read time, and each can answer
            that it has no answer. Reading one runs <code>cat</code>.
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
        READ_OK.has(data.state) ? (
          <p className="coh-shell__note">
            <span aria-hidden="true">◌</span> This directory is empty. It exists; nothing the recorder watches is
            currently under it.
          </p>
        ) : (
          <p className="coh-shell__note">
            <span aria-hidden="true">✕</span> The venue could not be read in this refresh, so nothing was listed.
            That is an outage and not an empty directory — a statement about the read, not about this path, and the
            one outcome here worth retrying.
          </p>
        )
      ) : null}
    </div>
  );
}

/** The commands and the derived files, in one place instead of four levels down. */
function ViewSwitch({ view, onView }: { view: ShellView; onView: (next: ShellView) => void }) {
  return (
    <div className="seg" role="group" aria-label="Shell view">
      {VIEWS.map(([name, label]) => (
        <button key={name} type="button" aria-pressed={view === name} onClick={() => onView(name)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Reading({ data, requested }: { data: CoherenceShell; requested: string }) {
  return (
    <>
      {data.command !== "cat" ? (
        <p className="console-empty muted">Reading {requested}…</p>
      ) : data.state === "ok" && data.body ? (
        <pre className="coh-shell__body">{data.body}</pre>
      ) : data.state === "missing" ? (
        <p className="console-empty">
          <span aria-hidden="true">○</span> No file of that name here. The path names nothing to read, so another
          read returns the same answer.
        </p>
      ) : (
        <p className="console-empty">
          <span aria-hidden="true">◌</span> The file is listed and this read produced no body: the path exists, the
          reading does not, in this read. A later read can still produce it.
        </p>
      )}
      <CommandReference />
    </>
  );
}

export default function ShellPane({ active }: { active: boolean }) {
  const [path, setPath] = useState("/");
  const [view, setView] = useState<ShellView>("tree");
  // One read serves the two views that need one. They are the same URL under a
  // different command, so the view IS the command: `ls` draws the tree, `cat`
  // the reading — and Layout, which is the same at every path, asks for neither.
  const command: "ls" | "cat" = view === "reading" ? "cat" : "ls";
  const url = shellRoute(path, command);
  const { data, error } = useCoherenceRead<CoherenceShell>(url, active && view !== "layout");

  const navigate = (next: string) => {
    setPath(next);
    setView("tree");
  };

  const open = (entry: CoherenceShellEntry) => {
    setPath(pathOf([...segmentsOf(data?.path ?? path), entry.name]));
    setView(entry.kind === "dir" ? "tree" : "reading");
  };

  // The switcher, and one thing under it. Every branch below draws it: Layout is
  // reachable only from there, and the reader who most wants the view that reads
  // nothing is the one whose venue could not be read.
  const framed = (body: ReactNode) => (
    <section className="card console-card coh-shell" aria-labelledby="markets-shell-heading">
      <PaneHead
        kicker="Shell"
        title="The watched universe as a filesystem"
        id="markets-shell-heading"
        note={`ls ${path}`}
        lede={
          <>
            Shards hold series, series hold events, events hold markets — so <code>ls</code> a path and{" "}
            <code>cat</code> a derived reading. Where a market lives is a cost: two shards are two exchange
            instances, and one order group cannot span them.
          </>
        }
      />
      <ViewSwitch view={view} onView={setView} />
      {body}
    </section>
  );

  if (view === "layout") return framed(<ShellTree />);
  if (error && !data)
    return framed(
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The tree could not be read: {error}. That is a gateway failure, not an
        answer about the path.
      </p>,
    );
  if (!data) return framed(<p className="console-empty muted">Listing the watched universe…</p>);

  // The root request is `/` and the gateway answers `/shards`, so a mismatch is
  // only stale-payload evidence away from the root. A command mismatch says the
  // same thing: the switcher has moved and this answer is the other one.
  const stale = (path !== "/" && data.path !== path) || data.command !== command;
  // `/shards` is the root listing's own path and its detail is the footer's sentence in other words. Suppressing it
  // there leaves every other path's detail, and the outage detail, which is answered at the path as requested.
  const repeatsFooter = data.command === "ls" && data.path === "/shards" && READ_OK.has(data.state);

  return (
    <section className="card console-card coh-shell" aria-labelledby="markets-shell-heading">
      <PaneHead
        kicker="Shell"
        title="The watched universe as a filesystem"
        id="markets-shell-heading"
        note={`${data.command} ${data.path}`}
        lede={
          <>
            Shards hold series, series hold events, events hold markets — so <code>ls</code> a path and{" "}
            <code>cat</code> a derived reading. Where a market lives is a cost: two events under different shard
            directories sit on different exchange instances and one order group cannot protect a position across them.
          </>
        }
      />
      <ViewSwitch view={view} onView={setView} />

      <div className="coh-status__chips">
        <StateChip
          mark={data.exists ? "✓" : "○"}
          word={data.exists ? "Path exists" : "No such path"}
          tone={data.exists ? "good" : "warn"}
        />
      </div>

      {/* The command line, and it belongs to every view: it sets the path, and through what it lands on, the command. */}
      <Breadcrumb path={data.path} command={data.command} onNavigate={navigate} />

      {stale ? (
        <p className="coh-shell__note">
          <span aria-hidden="true">◌</span> Still showing <code>{data.command}</code> {data.path} while <code>{command}</code>{" "}
          {path} is read.
        </p>
      ) : null}

      {data.detail && !repeatsFooter ? <p className="coh-shell__detail-line">{data.detail}.</p> : null}

      {view === "reading" ? (
        <Reading data={data} requested={path} />
      ) : data.command !== "ls" ? (
        <p className="console-empty muted">Listing {path}…</p>
      ) : !data.exists ? (
        <p className="console-empty">
          <span aria-hidden="true">○</span> No such path: {path}. Nothing is there to read — which is a different
          answer from a read that failed.
        </p>
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
    </section>
  );
}
