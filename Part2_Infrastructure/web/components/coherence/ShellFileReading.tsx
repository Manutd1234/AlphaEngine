"use client";

/**
 * One derived file, as `cat` answers it.
 *
 * Split out of `ShellPane` on 2026-08-26, when merging Read into Browse took
 * that file past the 400-line ceiling. The seam is real rather than convenient:
 * everything here renders ONE path's contents and everything left behind routes
 * between a listing and a reading. The pane decides what is open; this decides
 * what an open file looks like.
 */

import type { CoherenceShell } from "@/lib/coherence/types-lab";

import ShellReadings from "./ShellReadings";

export default function FileReading({ data, requested, loading }: {
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
          <>
            <p className="console-empty">
              <span aria-hidden="true">○</span> {requested} is a directory, and{" "}
              <code>cat</code> answers for a file — the venue returned its listing instead. Open a reading from
              Browse, or use the Map to see where they hang.
            </p>
            {/* THE DRAWING A READER STANDING ON A DIRECTORY ACTUALLY NEEDS, added
                2026-08-25. This branch was one sentence, and it is the branch a
                reader lands on every time they press Read without having opened
                a file — including on arrival, where the path is `/`. The
                question it leaves them with is "so what CAN I read", and that is
                exactly what this figure answers: the five readings, grouped by
                whether an empty one is worth asking again. Same component the
                Commands view leads with, so the two views agree by construction
                rather than by being kept in step. */}
            <ShellReadings />
          </>
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
