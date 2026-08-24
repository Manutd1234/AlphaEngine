"use client";

/**
 * The views inside one Dutch-book group, and the control that moves between them.
 *
 * WHY THIS FILE EXISTS. Dutch book had six views on one flat `.seg` — Verdict,
 * Proof, Certificate, Bands, Parlays, Bounds — and `14r` had a rule whose only
 * job was to let that control wrap onto a second row rather than shrink its
 * type. A wrap rule is what a switcher needs when it has stopped being a row a
 * reader can take in, and the reader said so: "too many fragmented, flat
 * subtabs causing horizontal visual clutter."
 *
 * So the section's own seg carries three GROUPS and this file carries the views
 * inside the chosen one. The shape is not new here: `SurfacePane` nests a Stake
 * switcher inside its Lattice one on the other rail, and `FindingsPane` keeps
 * its own three views inside `.diff-results` for the same reason — three
 * readings of ONE study are not peers of the arms beside them.
 *
 * THE GROUPS ARE THE READ SEAM, WHICH IS WHY THEY FALL WHERE THEY DO. `certify`
 * is a 25-second gateway call behind a 28-second browser deadline; a `combos`
 * read is a book call per leg on top of its own. The section has always been
 * gated so opening it costs one slow call and never two, and the three parlay
 * views ARE that second read. Grouping on any other line — by subject, by how
 * much of the maths each shows — would put two views of one call in different
 * groups and re-arm a call a reader had already paid for.
 *
 *   Coherence test  Verdict, Proof              one `certify` read
 *   Basket          Certificate                 the same read, drawn as a portfolio
 *   Parlays         Bands, Parlays, Bounds      one `combos` read
 *
 * BASKET DRAWS NO SECOND CONTROL, and that is a decision rather than an
 * oversight. It holds one view, so a switcher there would be a single segment
 * that cannot be pressed — a control that says nothing and cannot do anything.
 * The seg below is conditional on the group having more than one view, and the
 * reader meets the portfolio directly.
 *
 * THE VIEW RESETS WITH THE GROUP, and it resets by remount rather than by an
 * effect: the parent renders this component with `key={group}`, so a group
 * change is a new instance with a new initial view. An effect watching `group`
 * would render the old group's view for one frame first, which on the parlay
 * side is a frame of a figure drawn from the wrong read.
 *
 * `.coh-views` IS LOAD-BEARING AND IS NOT DECORATION. `14r` wraps every
 * section-level switcher on this tab with `.coherence-plane.proofs-plane
 * .console-card > .seg` — a CHILD combinator, chosen so `FindingsPane`'s nested
 * seg stays out of it. Returning a fragment here would make this control a
 * direct child of the section too: it would take the wrap treatment meant for
 * the group row, and two segs would sit in the section's own grid as siblings,
 * which is the "two `.seg` controls in a column read as one broken control"
 * that `DiffusionPane`'s header rejected. Inside a wrapper it is a second
 * level, drawn under the group it belongs to.
 */

import { useState } from "react";

import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import CombosPane, { type ComboView } from "./CombosPane";
import { ProofView, VerdictView } from "./CertificateViews";
import PortfolioPane from "./PortfolioPane";

export type CertificateGroup = "test" | "basket" | "parlays";

type CertificateView = "verdict" | "proof" | "certificate" | ComboView;

/**
 * Which views each group holds, in the order the reader meets them.
 *
 * The table is the type: a group cannot exist without views and a view cannot
 * belong to two groups, so the switcher below cannot offer an option the branch
 * does not draw. `LessonsPane` keeps its group list in the DATA for the same
 * reason — a list maintained beside the thing it describes is a list that drifts
 * from it.
 */
export const GROUP_VIEWS: Record<CertificateGroup, ReadonlyArray<[CertificateView, string]>> = {
  test: [["verdict", "Verdict"], ["proof", "Proof"]],
  basket: [["certificate", "Certificate"]],
  parlays: [["bands", "Bands"], ["parlays", "Parlays"], ["bounds", "Bounds"]],
};

export default function CertificateGroups({ group, active, data, target, chosen }: {
  group: CertificateGroup;
  active: boolean;
  /** The certify answer. Null on the parlay group, which does not read it. */
  data: CoherenceCertificate | null;
  target: string;
  chosen: CoherenceEventView | null;
}) {
  const views = GROUP_VIEWS[group];
  const [view, setView] = useState<CertificateView>(views[0][0]);

  return (
    <div className="coh-views">
      {/* Drawn only where there is a choice to make. One segment is a control
          that cannot be pressed. */}
      {views.length > 1 ? (
        <div className="seg" role="group" aria-label="Certificate view">
          {views.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {group === "parlays" ? (
        <div className="coh-combos">
          <CombosPane active={active} view={view as ComboView} />
        </div>
      ) : !data ? null : group === "basket" ? (
        <PortfolioPane certificate={data} chosen={chosen} />
      ) : view === "proof" ? (
        <ProofView data={data} />
      ) : (
        <VerdictView data={data} target={target} />
      )}
    </div>
  );
}
