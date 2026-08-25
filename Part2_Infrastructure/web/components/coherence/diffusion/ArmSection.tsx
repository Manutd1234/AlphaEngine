"use client";

/**
 * The announcement arm: absorption against a control of matched quiet windows.
 *
 * One of four sections of the Diffusion tab since 2026-08-25, where it was one
 * of four GROUPS of a Proofs section. Same four views, same one read; what it
 * gained is a head that can say what the arm is, and a control row that is the
 * only one on screen.
 *
 * Mechanism reads nothing — its drawing is two stage constants — and rides here
 * anyway, because a view that fetches nothing needs no gate of its own and a
 * section for one figure would put the switcher back where this pass found it.
 */

import { useState } from "react";

import PaneHead from "../PaneHead";
import InformationDiffusionPane from "./InformationDiffusionPane";
import type { AbsorptionRead } from "./types";

type ArmView = "absorption" | "floor" | "meetings" | "mechanism";

const VIEWS: ReadonlyArray<[ArmView, string]> = [
  ["absorption", "Absorption"],
  ["floor", "Noise floor"],
  ["meetings", "Meetings"],
  ["mechanism", "Mechanism"],
];

export default function ArmSection({ data, error }: { data: AbsorptionRead | null; error: string | null }) {
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
      <div className="seg" role="group" aria-label="Announcement arm view">
        {VIEWS.map(([name, label]) => (
          <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
            {label}
          </button>
        ))}
      </div>
      <InformationDiffusionPane view={view} read={data} error={error} />
    </section>
  );
}
