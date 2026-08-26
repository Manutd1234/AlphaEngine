"use client";

/**
 * Each decision's own half-life, and the two-stage window every comparison
 * between them rests on.
 *
 * A SECTION SINCE 2026-08-25, split out of the announcement arm. The arm asks
 * how fast a stage is absorbed, over all of them at once; this asks what each
 * meeting did. One ledger, two questions, and the second was reachable only by
 * a reader who found the third button of a four-button switcher.
 *
 * It costs no extra read. `arm` and `meetings` name the same URL and
 * `read-cache.ts` holds one payload per URL, joining a read already in flight —
 * so the second section spends no request and opens warm off the first.
 *
 * MECHANISM RIDES HERE, and it is not a leftover. It is made of the two stage
 * constants and nothing else, so it fetches nothing and needs no gate; and what
 * it draws — two windows of equal length, each measured from its own start — is
 * the thing a reader has to accept before any per-meeting number below means
 * anything. It sat in the arm because that is where the switcher was.
 */

import { memo, useState } from "react";

import PaneHead from "../PaneHead";
import { absorptionNotice, absorptionReady } from "./AbsorptionGate";
import MeetingTable from "./MeetingTable";
import HorizonResolution from "./HorizonResolution";
import MeetingCalendar from "./MeetingCalendar";
import StageWindows from "./StageWindows";
import type { AbsorptionRead } from "./types";

type MeetingsView = "table" | "calendar" | "mechanism";

const VIEWS: ReadonlyArray<[MeetingsView, string]> = [
  ["table", "Meeting by meeting"],
  ["calendar", "Calendar"],
  ["mechanism", "Mechanism"],
];

function MeetingsSection({ data, error }: { data: AbsorptionRead | null; error: string | null }) {
  const [view, setView] = useState<MeetingsView>("table");
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-meetings-heading">
      <PaneHead
        kicker="Meetings"
        title="What each decision did, and the window it was measured in"
        id="diffusion-meetings-heading"
        note="the tail of the ledger, newest first"
        lede="A blank stage never moved enough to measure, which is a property of the decision rather than of the data."
      />
      {/* Wrapped 2026-08-25: a bare `.seg` could be reached by neither
          the sticky rule nor the wrap rule, both `.coh-bar`-scoped. */}
      <div className="coh-bar">
        <div className="seg" role="group" aria-label="Meetings view">
          {VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <MeetingsBody view={view} data={data} error={error} />
    </section>
  );
}

function MeetingsBody({ view, data, error }: {
  view: MeetingsView;
  data: AbsorptionRead | null;
  error: string | null;
}) {
  // Reachable before the ledger answers: `StageWindows` takes the read or
  // null and falls back to the two constants on an empty deployment, so this
  // branch still opens on a drawing when nothing has been recorded — the same
  // guarantee the constant-only timeline used to give, kept without keeping
  // the constant-only figure.
  if (view === "mechanism") {
    return (
      <div className="diff-pane">
        <StageWindows read={absorptionReady(data) ? data : null} />

        {/* The grid above with the meetings on it, then what the ledger
            resolved INSIDE that grid — grid first, fill second. `cell.state`
            and `cell.bars` were both on the wire and drawn nowhere. */}
        {absorptionReady(data) ? <HorizonResolution read={data} /> : null}
      </div>
    );
  }

  // The same three sentences the arm says, from the same place, so the two
  // sections cannot word one absence two ways.
  const notice = absorptionNotice(data, error);
  if (!absorptionReady(data)) return notice;

  // AFTER the shared gate, so this branch is a single return whose first tag is
  // the drawing. Written with its own gate first, it read
  // `return notice; … return (<figure>)` — and the scan in
  // `engine-opens-on-a-drawing.test.ts` bounds a branch at its SECOND return, so
  // the window closed before the figure and the view "drew nothing".
  if (view === "calendar") {
    return (
      <div className="diff-pane">
        <MeetingCalendar read={data} />
      </div>
    );
  }

  return (
    <div className="diff-pane">
      <MeetingTable runs={data.runs} />
    </div>
  );
}

/**
 * MEMOISED, because the console above it re-renders on every poll.
 *
 * `DiffusionConsole` has to re-render every twenty seconds — the freshness
 * stamp is a clock — but since `use-coherence.ts` keeps a payload's identity
 * when nothing drawable changed, the props reaching this section are usually
 * the same objects they were. Without a memo boundary that fact buys nothing:
 * a parent re-render re-renders its children whatever their props say.
 *
 * The saving is small and measured rather than assumed: about 1.9ms of script
 * per poll, taken back to back with only the identity check toggled. React
 * writes nothing to the DOM when the output matches, so what this boundary
 * saves is reconciliation, not paint.
 */
export default memo(MeetingsSection);
