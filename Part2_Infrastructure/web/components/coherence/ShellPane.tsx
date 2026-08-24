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
 * The four outcomes that must never collapse into "no data" — no such path, a
 * listed file with no reading in this read, an empty directory, an unreadable
 * venue — are drawn by `ShellListing`, and its header is where that argument
 * now lives.
 *
 * THAT SPLIT WAS A CEILING, NOT A TASTE. This file reached 390 lines against a
 * 400-line one-way ratchet, and the house rule is to split rather than to shave
 * prose. The seam is the one the pane already had: everything that renders ONE
 * listing payload went to `ShellListing`, and the path grammar, the switcher,
 * the poll and the breadcrumb stayed. `atShards` crosses as a prop rather than
 * being re-derived over there, so what a path segment means is decided once.
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
 * the poll is gated on the views that ask; that gate is also why it is the
 * one view that still answers when the venue does not, and why the switcher is
 * rendered above the failure branches rather than after them. Commands is a
 * fourth of the same kind: the reference table used to trail the `cat` body,
 * which made the Reading view a preformatted block AND a table on one screen,
 * and like Layout it is static, reads nothing, and returns early.
 *
 * The tree is the WATCHLIST. Kalshi lists some thirteen thousand series and
 * this holds the handful the recorder is configured to watch; the root says so
 * and the pane repeats it — once. The gateway's root detail and the pane's
 * footer were the same sentence twice; the footer is kept, as it alone names
 * COHERENCE_SERIES.
 *
 * The HEAD is written once. It used to be spelled out twice — a copy in the
 * `framed` helper and a second, differently-worded copy in the drawn branch —
 * which is how the two ledes came to disagree about how much of the shard
 * argument they made. The cost of that duplication was not the lines, it was
 * that the section's opening sentence depended on whether the venue answered.
 * `framed` now takes the note (the only part that varies: the command and the
 * path this answer is for) and every branch returns through it.
 *
 * The lede no longer carries the shard-boundary cost either. That claim is made
 * where it can be acted on — the note over the shard directories in a listing,
 * and `ShellTree`'s reading on the Layout view, which never render together. It
 * was in all three places at once.
 */

import { type ReactNode, useState } from "react";

import type { CoherenceShell, CoherenceShellEntry } from "@/lib/coherence/types-lab";
import CommandReference from "./ShellCommandReference";
import PaneHead from "./PaneHead";
import { shellRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { StateChip } from "./Figure";
import ShellListing, { READ_OK } from "./ShellListing";
import ShellTree from "./ShellTree";

type ShellView = "tree" | "reading" | "commands" | "layout";

/** The switcher's options, in the order they are pressed. `commands` split out
 *  of Reading on the second 2026-08-24 pass: the reference table is static
 *  material that is true whatever the venue answered, and stacked under a
 *  `cat` body it made the one view with a preformatted block the tallest on
 *  the tab. Like Layout, it reads nothing and returns before the branches
 *  that need a payload. */
const VIEWS: ReadonlyArray<[ShellView, string]> = [
  ["tree", "Tree"],
  ["reading", "Reading"],
  ["commands", "Commands"],
  ["layout", "Layout"],
];

function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function pathOf(segments: string[]): string {
  return `/${segments.join("/")}`;
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

function Reading({ data, requested, loading }: {
  data: CoherenceShell;
  requested: string;
  /** True only while a `cat` is actually in flight. */
  loading: boolean;
}) {
  return (
    <>
      {data.command !== "cat" ? (
        // FOUR ABSENCES HERE, NOT ONE, and the fourth was rendering as the
        // first. `cat` on a directory is answered with a LISTING, so this view
        // sat on "Reading /…" for ever at the root — a settled refusal wearing
        // a pending state's clothes. Measured: `markets/shell` → Reading was
        // the only view on either tab that never stopped loading.
        loading ? (
          <p className="console-empty muted">Reading {requested}…</p>
        ) : (
          <p className="console-empty">
            <span aria-hidden="true">○</span> {requested} is a directory, and{" "}
            <code>cat</code> answers for a file — the venue returned its listing instead. Open a file from
            the Tree, or use Tree to walk here.
          </p>
        )
      ) : data.state === "ok" && data.body ? (
        <pre className="coh-shell__body">{data.body}</pre>
      ) : data.state === "missing" ? (
        // The venue's own reason when it has one, and it usually does: asking to
        // read `/` answers "a readable file lives at /shards/<n>/<series>/
        // <event>/<name>", which tells a reader where to go. The generic line
        // below it said "no file of that name here" about a path that is not a
        // file name at all, and threw away the more useful sentence the gateway
        // had already sent.
        <p className="console-empty">
          <span aria-hidden="true">○</span>{" "}
          {data.detail
            ? `${requested} has no reading: ${data.detail}.`
            : "No file of that name here: another read returns the same answer."}
        </p>
      ) : (
        <p className="console-empty">
          <span aria-hidden="true">◌</span> The file is listed and this read produced no body: the path exists, the
          reading does not, in this read.
        </p>
      )}
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
  // Only the two views that answer FROM a read poll: Layout is the same at
  // every path and Commands is reference material, so neither asks.
  const { data, error, loading } = useCoherenceRead<CoherenceShell>(
    url,
    active && (view === "tree" || view === "reading"),
  );

  const navigate = (next: string) => {
    setPath(next);
    setView("tree");
  };

  const open = (entry: CoherenceShellEntry) => {
    setPath(pathOf([...segmentsOf(data?.path ?? path), entry.name]));
    setView(entry.kind === "dir" ? "tree" : "reading");
  };

  // The head, the switcher, and one thing under them. Every branch draws the
  // switcher: Layout is reachable only from there, and the reader who most wants
  // the view that reads nothing is the one whose venue could not be read.
  const framed = (note: string, body: ReactNode) => (
    <section className="card console-card coh-shell" aria-labelledby="markets-shell-heading">
      <PaneHead
        kicker="Shell"
        title="The watched universe as a filesystem"
        id="markets-shell-heading"
        note={note}
        lede={
          <>
            Shards hold series, series hold events, events hold markets, so <code>ls</code> a path and{" "}
            <code>cat</code> a derived reading.
          </>
        }
      />
      <ViewSwitch view={view} onView={setView} />
      {body}
    </section>
  );

  if (view === "layout") return framed("every path at once", <ShellTree />);
  if (view === "commands") return framed("every command it answers", <CommandReference />);
  if (error && !data)
    return framed(
      `${command} ${path}`,
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The tree could not be read: {error}. That is a gateway failure, not an
        answer about the path.
      </p>,
    );
  if (!data) return framed(`${command} ${path}`, <p className="console-empty muted">Listing the watched universe…</p>);

  // The root request is `/` and the gateway answers `/shards`, so a mismatch is
  // only stale-payload evidence away from the root. A command mismatch says the
  // same thing: the switcher has moved and this answer is the other one.
  // `loading` and not merely "the two commands differ": asking to `cat` a
  // directory is answered with a listing every time, so the command mismatch is
  // permanent there and this banner claimed a read was under way for ever.
  const stale = loading && ((path !== "/" && data.path !== path) || data.command !== command);
  // `/shards` is the root listing's own path and its detail is the footer's sentence in other words. Suppressing it
  // there leaves every other path's detail, and the outage detail, which is answered at the path as requested.
  const repeatsFooter = data.command === "ls" && data.path === "/shards" && READ_OK.has(data.state);

  return framed(
    `${data.command} ${data.path}`,
    <>
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
        <Reading data={data} requested={path} loading={loading} />
      ) : data.command !== "ls" ? (
        <p className="console-empty muted">Listing {path}…</p>
      ) : !data.exists ? (
        <p className="console-empty">
          <span aria-hidden="true">○</span> No such path: {path}. Nothing is there to read — which is a different
          answer from a read that failed.
        </p>
      ) : (
        <ShellListing data={data} atShards={segmentsOf(data.path).length === 1} onOpen={open} />
      )}

      <p className="coh-shell__note">
        This tree is the watchlist, not the exchange: Kalshi lists some thirteen thousand series, and only the set{" "}
        <code>COHERENCE_SERIES</code> names has been read.
      </p>
      {error ? (
        <p className="coh-shell__note">
          <span aria-hidden="true">✕</span> The last refresh failed: {error}. What is above is the previous answer.
        </p>
      ) : null}
    </>,
  );
}
