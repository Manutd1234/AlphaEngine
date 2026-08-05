"use client";

/**
 * The decision loop, live. Replaces the hero's static "Research → Risk →
 * Execution" text with four stages whose states derive from what the system
 * actually measured (lib/overview-state.ts) — no invented progress.
 *
 * Colour note: the hero behind this panel is a theme-invariant navy gradient,
 * so the theme-flipping `--*-text` tokens are wrong here — their light-theme
 * values fail contrast on the dark plane. This map fixes the DARK-theme text
 * steps (asserted AA-clear against a visually equivalent surface by
 * tests/theme.test.ts) regardless of theme, the same reasoning the hero's own
 * fixed background carries in globals.css. Precedent for the shape:
 * ROUTE_STATE_STYLE in components/systems/types.ts — icon + word carry the
 * meaning; colour reinforces.
 */

import {
  CircleCheck,
  Circle,
  ChevronRight,
  Database,
  FlaskConical,
  LoaderCircle,
  OctagonX,
  Shield,
  TriangleAlert,
  Zap,
} from "lucide-react";

import type { DecisionStage, StageId, StageState } from "@/lib/overview-state";

const STAGE_ICON: Record<StageId, typeof Database> = {
  data: Database,
  research: FlaskConical,
  risk: Shield,
  execution: Zap,
};

const STATE_STYLE: Record<StageState, { Icon: typeof Circle; word: string; hex: string }> = {
  ok: { Icon: CircleCheck, word: "ok", hex: "#35c48f" },
  active: { Icon: LoaderCircle, word: "active", hex: "#86adf5" },
  attention: { Icon: TriangleAlert, word: "attention", hex: "#e8ab3d" },
  halted: { Icon: OctagonX, word: "halted", hex: "#f0737c" },
  idle: { Icon: Circle, word: "idle", hex: "#9fb0c7" },
};

export default function DecisionLoopPipeline({ stages }: { stages: DecisionStage[] }) {
  return (
    <div
      className="relative z-[1] min-w-[300px] rounded-[13px] border border-white/15 bg-[rgba(5,17,34,0.36)] p-4 backdrop-blur-[10px] max-[900px]:w-full max-[900px]:min-w-0"
      aria-label="AlphaEngine decision loop"
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#86adf5]">Decision loop</span>
      <ol className="mt-2 flex list-none flex-wrap items-stretch gap-x-1 gap-y-2 p-0" aria-label="Pipeline stages">
        {stages.map((stage, index) => {
          const StageIcon = STAGE_ICON[stage.id];
          const style = STATE_STYLE[stage.state];
          const StateIcon = style.Icon;
          return (
            <li key={stage.id} className="flex min-w-0 items-center gap-1">
              <div className="grid min-w-0 gap-0.5 rounded-[9px] border border-white/10 bg-[rgba(11,23,40,0.55)] px-2.5 py-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#e8eefb]">
                  <StageIcon size={13} aria-hidden />
                  {stage.label}
                  <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: style.hex }}>
                    <StateIcon size={11} aria-hidden className={stage.state === "active" ? "animate-spin" : undefined} />
                    {style.word}
                  </span>
                </span>
                <span className="max-w-[11rem] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-[#9fb0c7]">
                  {stage.detail}
                </span>
              </div>
              {index < stages.length - 1 && (
                <ChevronRight size={12} aria-hidden className="shrink-0 text-[#74e7d0]/70" />
              )}
            </li>
          );
        })}
      </ol>
      <small className="mt-2 block text-[10px] text-[#9fb0c7]">Paper-only · observable · reproducible</small>
    </div>
  );
}
