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

import Figure from "../Figure";
import PaneHead from "../PaneHead";
import { STAGE_GAP_MIN, STAGE_TERMINAL_MIN, absorptionNotice, absorptionReady } from "./AbsorptionGate";
import MeetingTable from "./MeetingTable";
import StageTimeline from "./StageTimeline";
import type { AbsorptionRead } from "./types";

type MeetingsView = "table" | "mechanism";

const VIEWS: ReadonlyArray<[MeetingsView, string]> = [
  ["table", "Meeting by meeting"],
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
      <div className="seg" role="group" aria-label="Meetings view">
        {VIEWS.map(([name, label]) => (
          <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
            {label}
          </button>
        ))}
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
  // Drawn from constants, so it answers before the ledger does and is reachable
  // on a deployment that has recorded nothing at all.
  if (view === "mechanism") {
    return (
      <div className="diff-pane">
        <Figure
          caption="Why a rate decision can be measured twice"
          ariaLabel={`Two stages ${STAGE_GAP_MIN} minutes apart, each measured over its own ${STAGE_TERMINAL_MIN} minute window`}
          reading="Both windows are the same length and each is measured from its own start, so a difference between them is a difference in absorption, not in the grid."
          missing="Sub-minute horizons are drawn but never measured: no free bar source resolves them."
        >
          <StageTimeline gapMinutes={STAGE_GAP_MIN} terminalMinutes={STAGE_TERMINAL_MIN} />
        </Figure>
      </div>
    );
  }

  // The same three sentences the arm says, from the same place, so the two
  // sections cannot word one absence two ways.
  const notice = absorptionNotice(data, error);
  if (!absorptionReady(data)) return notice;

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
