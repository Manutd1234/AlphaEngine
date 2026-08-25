"use client";

/**
 * The announcement arm: absorption, and the control that makes it a finding.
 *
 * TWO VIEWS SINCE 2026-08-25, down from four. `meetings` and the mechanism
 * drawing left for a section of their own — they answer what each decision did,
 * which is a different question from how fast a stage is absorbed.
 *
 * THREE VIEWS SINCE THE CLOCKS WERE DRAWN. `Control` held the attrition bars,
 * the percentile distribution and the two-clock ranking at 1,235px, which is
 * three answers behind one button and the longest thing on the tab after the
 * formula catalogue. The clocks are their own view now: the noise floor asks
 * whether a stage moved at all, and the clocks ask whether it stopped moving
 * because it had finished or because the market had — related, and not the same
 * question.
 *
 * THE NOISE FLOOR DID NOT LEAVE, and that is a decision rather than an
 * oversight. It is the CONTROL for the claim this section makes: the matched
 * half-hours in which nothing was announced, which is what "faster" is faster
 * than. A section boundary is how a reader stops encountering something, and a
 * reader who could reach the decay curve without ever meeting its control could
 * read a half-life off it and leave with a shape mistaken for a finding. So the
 * two views sit behind one button, and the switcher says "Control" rather than
 * "Noise floor" — the reader needs to know what it is FOR before they know what
 * it is called.
 */

import { memo, useState } from "react";

import PaneHead from "../PaneHead";
import InformationDiffusionPane from "./InformationDiffusionPane";
import type { AbsorptionRead } from "./types";

type ArmView = "absorption" | "floor" | "clocks";

const VIEWS: ReadonlyArray<[ArmView, string]> = [
  ["absorption", "Absorption"],
  ["floor", "Control"],
  ["clocks", "Clocks"],
];

function ArmSection({ data, error }: { data: AbsorptionRead | null; error: string | null }) {
  const [view, setView] = useState<ArmView>("absorption");
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-arm-heading">
      <PaneHead
        kicker="Announcement arm"
        title="How much of the move had arrived, and by when"
        id="diffusion-arm-heading"
        note="one estimator, two stages, one control"
        lede="A stage is measured against matched half-hours in which nothing was announced, so a fast absorption has to be faster than the market is anyway."
      />
      {/* Wrapped 2026-08-25: a bare `.seg` could be reached by neither
          the sticky rule nor the wrap rule, both `.coh-bar`-scoped. */}
      <div className="coh-bar">
        <div className="seg" role="group" aria-label="Announcement arm view">
          {VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <InformationDiffusionPane view={view} read={data} error={error} />
    </section>
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
export default memo(ArmSection);
