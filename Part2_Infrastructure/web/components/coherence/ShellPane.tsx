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
import SectionFrame from "./SectionFrame";
import { pathOf, segmentsOf } from "./ShellPath";
import { shellRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { useLiveSeries } from "@/lib/coherence/use-live-series";
import ShellBrowser from "./ShellBrowser";
import ShellRouteFlow from "./ShellRouteFlow";
import ShellTree from "./ShellTree";
import styles from "./ShellPane.module.css";

/**
 * THREE SINCE 2026-08-31. `reading` merged into Browse and `commands` into the
 * namespace view because both were answers to questions their parent views
 * already asked; collateral Routing then became its own operational question.
 *
 * `reading` was not a view of its own. Selecting a file in Browse already ran
 * `onView(entry.kind === "dir" ? "tree" : "reading")` — one gesture crossing a
 * view boundary — so a reader walking the tree was switched between two rail
 * entries by clicking, and the switcher underneath them moved on its own. It is
 * one view with two shapes now, and which shape is `mode`, because whether you
 * are looking at a listing or a file is a property of the PATH you opened, not
 * of the question you asked.
 *
 * `commands` folded onto Map. It reads nothing and Map reads nothing, and the
 * two answer one question between them: what this filesystem IS, as opposed to
 * what is in it right now. Nothing was dropped to do it — `CommandReference`
 * already led with a drawing and folded its own table, so it moved whole.
 */
type ShellView = "tree" | "layout" | "route";

/**
 * The switcher's options, in the order they are pressed.
 *
 * MAP IS FIRST AND IS THE LANDING VIEW SINCE 2026-08-25, on the reader's own
 * report: "fix shell since i dont know what it is doing". The section used to
 * open on `Browse`, which answers ONE level at a time — and at the root that is
 * a single row reading `0/  directory  3 watched event(s)`, under a lede about
 * `ls` and `cat`. A reader met the grammar of a filesystem and no reason for
 * one. The Map was the view that answers the question and it was the fourth
 * button along: it draws the whole shape at once, the five derived readings
 * that hang off a market, and the shard boundary with "one order group cannot
 * cross it" written across it. That is the argument the section exists to make,
 * so it is what the section opens on.
 *
 * The labels are what each one DOES, not what it is made of. "Tree" and
 * "Layout" were two words for the same noun and neither said which was the
 * picture; "Reading" and "Browse" both read as verbs for the same act. Map
 * draws the shape, Browse walks it, Read opens one file, Commands is the
 * vocabulary.
 *
 * `commands` split out of Read on the second 2026-08-24 pass: the reference
 * table is static material that is true whatever the venue answered, and
 * stacked under a `cat` body it made the one view with a preformatted block the
 * tallest on the tab. Like Map, it reads nothing and returns before the
 * branches that need a payload.
 */
const VIEWS: ReadonlyArray<[ShellView, string]> = [
  ["layout", "Namespace"],
  ["route", "Routing"],
  ["tree", "Browse"],
];

export default function ShellPane(
  { active, view, onView }: { active: boolean; view: ShellView; onView: (next: ShellView) => void },
) {
  const [path, setPath] = useState("/");
  /**
   * Whether the open path is being LISTED or READ.
   *
   * This was the difference between two rail views until 2026-08-26, which made
   * clicking a file move the switcher. It is a property of what was opened.
   */
  const [mode, setMode] = useState<"ls" | "cat">("ls");
  // One read serves the two views that need one. They are the same URL under a
  // different command, so the view IS the command: `ls` draws the tree, `cat`
  // the reading — and Layout, which is the same at every path, asks for neither.
  const command: "ls" | "cat" = mode;
  const url = shellRoute(path, command);
  // Only the two views that answer FROM a read poll: Layout is the same at
  // every path and Commands is reference material, so neither asks.
  const browserRead = useCoherenceRead<CoherenceShell>(
    url,
    active && view === "tree",
  );
  const { data, error, loading, updatedAt } = browserRead;

  // Map is now a live root instrument rather than a schema-only poster. It
  // reads one bounded listing and never crawls the tree recursively.
  const topology = useCoherenceRead<CoherenceShell>(
    shellRoute("/", "ls"),
    active && (view === "layout" || view === "route"),
  );
  const topologyTape = useLiveSeries(
    "shell:/shards:entries",
    topology.updatedAt,
    topology.data?.state === "available" ? topology.data.entries.length : null,
  );

  /* How many entries sit under the path being walked, poll by poll.
     Keyed on the PATH, so stepping into a directory starts a new series rather
     than drawing a cliff between two different places and calling it a change.
     It is the one reading on this section that moves for a reason a reader
     cares about: the watchlist growing or shrinking under them. */
  const entriesTape = useLiveSeries(
    `shell:${path}:entries`,
    updatedAt,
    command === "ls" && data?.state === "available" ? data.entries.length : null,
  );

  const navigate = (next: string, nextMode: "ls" | "cat" = "ls") => {
    setPath(next);
    setMode(nextMode);
    onView("tree");
  };

  const open = (entry: CoherenceShellEntry) => {
    setPath(pathOf([...segmentsOf(data?.path ?? path), entry.name]));
    setMode(entry.kind === "dir" ? "ls" : "cat");
    onView("tree");
  };

  /**
   * The head, the one control row, and one thing under them.
   *
   * EVERY BRANCH DRAWS THE SWITCHER, which is why it is a helper rather than
   * four copies: Map is reachable only from there, and the reader who most
   * wants the view that reads nothing is the one whose venue could not be read.
   *
   * THE BREADCRUMB IS THE SUBJECT, and putting it in the frame's subject slot
   * is the one thing this section gained from the frame. It is not chrome and
   * it is not a view — it names the PATH every view here is a question about,
   * exactly as the family picker names the family on Lattice and Stake. Drawn
   * inside the body it sat on a row of its own under the switcher, with a chip
   * row under that, so Shell opened on three rows before its first listing
   * while the four sections above it opened on one.
   *
   * It is absent on the two views that read nothing: Map draws the same shape
   * at every path and Commands is the vocabulary, so a path control on either
   * would offer to change something neither view is looking at.
   */
  const framed = (
    note: string,
    body: ReactNode,
  ) => (
    <SectionFrame
      className="coh-shell"
      aria-labelledby="markets-shell-heading"
      head={
        <PaneHead
          kicker="Shell"
          title="The watched universe as a filesystem"
          id="markets-shell-heading"
          note={note}
          lede={
            <>
              A market&rsquo;s path fixes its collateral pool and available derived readings.
            </>
          }
        />
      }
      views={VIEWS}
      view={view}
      onView={onView}
      viewsLabel="Shell view"
    >
      {body}
    </SectionFrame>
  );

  if (view === "layout") {
    return (
      <div className={styles.mapContainment}>
        {framed(
          "the namespace from watched root to derived file",
          <div className={styles.mapStack}>
            <ShellTree
              root={topology.data}
              loading={topology.loading}
              error={topology.error}
              updatedAt={topology.updatedAt}
              points={topologyTape}
              onBrowse={(next, nextCommand) => navigate(next, nextCommand)}
            />
            <details className="disclosure">
              <summary>Command and derived-file reference</summary>
              <CommandReference />
            </details>
          </div>,
        )}
      </div>
    );
  }

  if (view === "route") {
    return framed(
      "the shard decision behind a two-leg route",
      <ShellRouteFlow
        root={topology.data}
        loading={topology.loading}
        error={topology.error}
        updatedAt={topology.updatedAt}
        onBrowse={(next = "/") => navigate(next)}
      />,
    );
  }

  return framed(
    data ? `${data.command} ${data.path}` : `${command} ${path}`,
    <ShellBrowser
      data={data}
      requestedPath={path}
      mode={mode}
      loading={loading}
      error={error}
      points={entriesTape}
      onNavigate={navigate}
      onOpen={open}
      onRetry={browserRead.refresh}
    />,
  );
}
