"use client";

/**
 * The decision loop, live. Replaces the hero's static "Research → Risk →
 * Execution" text with four stages whose states derive from what the system
 * actually measured (lib/overview-state.ts) — no invented progress.
 *
 * Colour note: the hero behind this panel is a theme-invariant zinc plane, so
 * the theme-flipping `--*-text` tokens are wrong here — their light-theme
 * values fail contrast on the dark plane. This map fixes the DARK-theme text
 * steps (each asserted AA-clear against --hero-plane itself by
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
  ok: { Icon: CircleCheck, word: "ok", hex: "var(--hero-good)" },
  active: { Icon: LoaderCircle, word: "active", hex: "var(--hero-info)" },
  attention: { Icon: TriangleAlert, word: "attention", hex: "var(--hero-warn)" },
  halted: { Icon: OctagonX, word: "halted", hex: "var(--hero-critical)" },
  idle: { Icon: Circle, word: "idle", hex: "var(--hero-muted)" },
};

export default function DecisionLoopPipeline({ stages }: { stages: DecisionStage[] }) {
  return (
    <div
      /* Four stages, one row. The list used to wrap, which stranded Execution
         on a second line under three-quarters of empty panel and made the hero
         ~70px taller than it needed to be. Every stage is now `flex-1 min-w-0`
         in a nowrap row, so they share the width and each detail line ellipses
         rather than pushing a sibling onto the next line. */
      className="relative z-[1] min-w-0 flex-[1_1_600px] max-[900px]:w-full"
      aria-label="AlphaEngine decision loop"
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--hero-accent)]">Decision loop</span>
      <ol
        className="mt-2 flex list-none flex-nowrap items-stretch gap-x-1 p-0 max-[560px]:flex-wrap max-[560px]:gap-y-2"
        aria-label="Pipeline stages"
      >
        {stages.map((stage, index) => {
          const StageIcon = STAGE_ICON[stage.id];
          const style = STATE_STYLE[stage.state];
          const StateIcon = style.Icon;
          return (
            <li key={stage.id} className="flex min-w-0 flex-1 items-center gap-1 max-[560px]:flex-[1_1_100%]">
              <div className="grid min-w-0 flex-1 gap-0.5 rounded-[9px] border border-white/10 bg-[rgba(11,23,40,0.55)] px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--hero-text)]">
                  <StageIcon size={13} aria-hidden className="shrink-0" />
                  <span className="min-w-0 truncate">{stage.label}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold" style={{ color: style.hex }}>
                    <StateIcon size={11} aria-hidden className={stage.state === "active" ? "animate-spin" : undefined} />
                    {style.word}
                  </span>
                </span>
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-[var(--hero-text-dim)]">
                  {stage.detail}
                </span>
              </div>
              {index < stages.length - 1 && (
                <ChevronRight size={12} aria-hidden className="shrink-0 text-[var(--hero-accent-2)]/70" />
              )}
            </li>
          );
        })}
      </ol>
      <small className="mt-2 block text-[10px] text-[var(--hero-text-dim)]">Paper-only · observable · reproducible</small>
    </div>
  );
}
