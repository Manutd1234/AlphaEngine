"use client";

/**
 * The decision loop, live. Replaces the hero's static "Research → Risk →
 * Execution" text with four stages whose states derive from what the system
 * actually measured (lib/overview-state.ts) — no invented progress.
 *
 * Colour note: this used to sit on the hero's theme-invariant zinc plane, so it
 * carried its own fixed ink — a `--hero-*` ramp that never flipped with the
 * theme, including a duplicate of the status ramp. The band now renders on
 * `--surface-2` like every other band on the desk, so the ordinary text roles
 * are not merely allowed here, they are the correct ones: they are the tokens
 * whose contrast `tests/theme.test.ts` already checks against the surfaces
 * they actually land on, in both themes. Precedent for the shape:
 * ROUTE_STATE_STYLE in components/systems/types.ts — icon + word carry the
 * meaning; colour reinforces.
 */

import type { CSSProperties } from "react";

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

/**
 * Each stage opens the section its own verdict is computed from.
 *
 * The reviewer tour has told readers that "every pipeline stage links into its
 * tab" while these rendered as four `<div>`s: the first thing the tour asks a
 * reviewer to click did nothing at all. Real `<button>`s rather than a click
 * handler on the card, so the four stages are reachable by keyboard and are
 * announced as controls; the destination itself belongs to the shell, which is
 * the only place that knows how to write a location.
 */

const STAGE_ICON: Record<StageId, typeof Database> = {
  data: Database,
  research: FlaskConical,
  risk: Shield,
  execution: Zap,
};

const STATE_STYLE: Record<StageState, { Icon: typeof Circle; word: string; hex: string }> = {
  ok: { Icon: CircleCheck, word: "ok", hex: "var(--success-text)" },
  active: { Icon: LoaderCircle, word: "active", hex: "var(--notice-text)" },
  attention: { Icon: TriangleAlert, word: "attention", hex: "var(--warning-text)" },
  halted: { Icon: OctagonX, word: "halted", hex: "var(--critical-text)" },
  idle: { Icon: Circle, word: "idle", hex: "var(--text-muted)" },
};

export default function DecisionLoopPipeline({
  stages,
  onOpenStage,
}: {
  stages: DecisionStage[];
  onOpenStage: (stage: StageId) => void;
}) {
  return (
    <div
      /* Four stages, one row. The list used to wrap, which stranded Execution
         on a second line under three-quarters of empty panel and made the hero
         ~70px taller than it needed to be. Every stage is now `flex-1 min-w-0`
         in a nowrap row, so they share the width and each detail line ellipses
         rather than pushing a sibling onto the next line. */
      className="relative z-[1] min-w-0 flex-[1_1_600px] max-[900px]:w-full"
    >
      {/* The band's local accent via the var shorthand — the plane is fixed
          dark in both themes, so this ink is fixed too and lives on
          .overview-hero rather than :root. */}
      <span className="text-fs-sm font-bold uppercase tracking-[0.05em] text-(--plane-accent)">Decision loop</span>
      <ol
        className="mt-2 flex list-none flex-nowrap items-stretch gap-x-1 p-0 max-[560px]:flex-wrap max-[560px]:gap-y-2"
        aria-label="Pipeline stages"
      >
        {stages.map((stage, index) => {
          const StageIcon = STAGE_ICON[stage.id];
          const style = STATE_STYLE[stage.state];
          const StateIcon = style.Icon;
          return (
            <li
              key={stage.id}
              className="stagger-reveal flex min-w-0 flex-1 items-center gap-1 max-[560px]:flex-[1_1_100%]"
              style={{ "--stagger-i": index } as CSSProperties}
            >
              {/* `font-normal` and `text-left` restore what the desk's base
                  button rule would otherwise impose on the detail line; the
                  rest of the chrome — cursor, focus ring, hover border — is
                  inherited from that rule on purpose, so this reads as a
                  control in the same voice as every other one. */}
              <button
                type="button"
                onClick={() => onOpenStage(stage.id)}
                title={`Open ${stage.label}`}
                /* These were `rgba(255,255,255,0.10)` and `rgba(11,23,40,0.55)`
                   — a hand-mixed border and plane that only made sense against
                   the fixed dark hero, and that drew a near-white box on a navy
                   card whenever the theme flipped. The band is an ordinary
                   surface now, so the ordinary tokens apply and the tile
                   follows the theme like every other control. */
                className="grid min-w-0 flex-1 gap-1 rounded-[var(--radius-control)] border border-axis bg-surface-2 px-3 py-2.5 text-left font-normal"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-fs-lg font-semibold text-text-primary">
                  <StageIcon size={15} aria-hidden className="shrink-0" />
                  <span className="min-w-0 truncate">{stage.label}</span>
                  <span className="flex shrink-0 items-center gap-1 text-fs-sm font-bold" style={{ color: style.hex }}>
                    <StateIcon size={12} aria-hidden className={stage.state === "active" ? "animate-spin" : undefined} />
                    {style.word}
                  </span>
                </span>
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fs-sm text-text-secondary">
                  {stage.detail}
                </span>
              </button>
              {index < stages.length - 1 && (
                <ChevronRight size={13} aria-hidden className="shrink-0 text-text-muted" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
