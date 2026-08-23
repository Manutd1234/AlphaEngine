"use client";

/**
 * The Strategy Codex — the catalogue as a reference library.
 *
 * Forty-six models, seven families, browsable before any run exists: a
 * reference library that demands a completed sweep is wrong, which is why the
 * page renders this section outside the no-data empty-state map. Nothing is
 * ever locked — gating capability behind usage is the navigation fork the
 * complexity-tier system exists to prohibit.
 *
 * Explored-state is derived from the experiment log on every render
 * (`lib/strategy-progress.ts`) and says so in the group header, because it can
 * regress: the log caps at 60 records and can be cleared, and a marker that
 * cannot regress would be claiming memory the system does not have.
 *
 * Family identity uses no new colour tokens (the theme test pins the dark
 * palettes byte-for-byte): a two-letter monogram, the printed family name, and
 * a `--codex-accent` mixed inline from the existing series tokens. The accent
 * decorates — borders and tints only, never text — so the AA contract stays
 * with the `-text` tokens.
 */

import { Fragment, type CSSProperties } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import type { ExperimentRecord } from "@/lib/experiments";
import { STRATEGY_DOCS } from "@/lib/strategy-docs";
import {
  progressFor,
  strategiesByFamily,
  strategyProgress,
} from "@/lib/strategy-progress";
import { STRATEGY_LABELS, type Strategy, type StrategyFamily } from "@/lib/types";

const FAMILY_THESIS: Record<StrategyFamily, string> = {
  Trend: "Hold while a direction persists — give up the turn to keep the middle.",
  Breakout: "Enter when price leaves a level it respected; the old range is the risk.",
  "Mean reversion": "Fade the stretch toward an anchor. A stretch that keeps going is called a trend.",
  Momentum: "Bet recent winners keep winning for about as long as the lookback.",
  Volume: "Read conviction from participation — price moves count more when volume agrees.",
  Volatility: "Trade the character of movement, not its direction.",
  Fitted: "Coefficients estimated from the data: the two parameters tune the fit, not the rule.",
};

const FAMILY_MONOGRAM: Record<StrategyFamily, string> = {
  Trend: "TR",
  Breakout: "BK",
  "Mean reversion": "MR",
  Momentum: "MO",
  Volume: "VL",
  Volatility: "VX",
  Fitted: "FI",
};

/** Seven accents mixed from the three existing series tokens — no new tokens. */
const FAMILY_ACCENT: Record<StrategyFamily, string> = {
  Trend: "var(--series-1)",
  Breakout: "var(--series-2)",
  "Mean reversion": "var(--series-3)",
  Momentum: "color-mix(in srgb, var(--series-1) 55%, var(--series-3))",
  Volume: "color-mix(in srgb, var(--series-2) 60%, var(--series-1))",
  Volatility: "color-mix(in srgb, var(--series-2) 45%, var(--series-3))",
  Fitted: "color-mix(in srgb, var(--series-1) 45%, var(--text-muted))",
};

/** The honest half of the doc, cut to its first sentence for the card. */
function firstSentence(prose: string): string {
  const stop = prose.indexOf(". ");
  return stop === -1 ? prose : `${prose.slice(0, stop)}.`;
}

export default function StrategyCodex({
  records,
  activeStrategy,
  onSelect,
}: {
  records: ExperimentRecord[];
  activeStrategy: Strategy;
  /** Adopt the strategy in the picker and jump to Summary. */
  onSelect: (strategy: Strategy) => void;
}) {
  const progress = strategyProgress(records);

  // A lateral move stays lateral: similar-model links walk the shelf rather
  // than adopting the model, so browsing never silently changes the picker.
  const jumpToCard = (strategy: Strategy) => {
    const card = document.getElementById(`codex-card-${strategy}`);
    if (!card) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    card.querySelector<HTMLButtonElement>(".codex-card__select")?.focus({ preventScroll: true });
  };

  return (
    <div className="strategy-codex">
      {/* The next-bar / exit-wins convention was stated here and was removed on
          request. It is not lost: `lib/export-python.ts` carries it for anyone
          reading the generated code, which is where it decides something. */}
      {[...strategiesByFamily()].map(([family, strategies]) => {
        const explored = strategies.filter((s) => progress.has(s)).length;
        return (
          <section
            key={family}
            className="codex-family"
            aria-label={`${family} models`}
            style={{ "--codex-accent": FAMILY_ACCENT[family] } as CSSProperties}
          >
            <header className="codex-family__head">
              <span className="codex-monogram" aria-hidden>{FAMILY_MONOGRAM[family]}</span>
              <div>
                <h2>{family}</h2>
                <p className="codex-family__thesis">{FAMILY_THESIS[family]}</p>
              </div>
              <span className="codex-family__progress">
                {/* The sentence is ONE element. Its container is a grid, and a
                    grid wraps every run of bare text in an anonymous item of
                    its own — so "explored", the ticker and "of 46" were three
                    rows rather than three words. */}
                <span className="codex-family__progress-count">
                  explored <NumberTicker value={explored} /> of {strategies.length}
                </span>
                <small>from this browser&apos;s run log (last 60 runs)</small>
              </span>
            </header>
            {/* One real table per family, the same five columns at the same
                widths in all seven (14a fixes the layout), one strategy per
                row. The subgrid-aligned tiles this replaces shared row tracks
                but still read as seven uneven grids; the ask was one shape.
                `.table-wrap` is focusable so a keyboard reader can reach the
                sideways scroll on a narrow screen, the idiom every wide table
                on the desk uses. */}
            <div className="table-wrap" tabIndex={0}>
              <table className="codex-table">
                <thead>
                  <tr>
                    <th scope="col">Strategy</th>
                    <th scope="col">What it does</th>
                    <th scope="col">Fails when</th>
                    <th scope="col">Best result</th>
                    <th scope="col">Similar</th>
                  </tr>
                </thead>
                <tbody>
                  {strategies.map((strategy) => {
                    const doc = STRATEGY_DOCS[strategy];
                    const state = progressFor(progress, strategy);
                    const explored_ = state.runs > 0;
                    const active = strategy === activeStrategy;
                    return (
                      <tr
                        key={strategy}
                        id={`codex-card-${strategy}`}
                        className={active ? "is-active" : undefined}
                      >
                        <th scope="row">
                          <button
                            type="button"
                            className="codex-card__select"
                            onClick={() => onSelect(strategy)}
                            aria-current={active || undefined}
                            title={`Select ${STRATEGY_LABELS[strategy]} and open Summary`}
                          >
                            <strong>{STRATEGY_LABELS[strategy]}</strong>
                          </button>
                        </th>
                        <td className="codex-card__summary">{doc.summary}</td>
                        <td className="codex-card__fails">{firstSentence(doc.whenItFails)}</td>
                        <td>
                          {/* Glyph + word, never colour alone. */}
                          <span
                            className="codex-chip"
                            data-verdict={explored_ ? state.bestVerdict : undefined}
                          >
                            {explored_
                              ? <><span aria-hidden>●</span> {state.bestVerdict?.toUpperCase()}</>
                              : <><span aria-hidden>◌</span> not yet run</>}
                          </span>
                        </td>
                        <td className="codex-card__similar">
                          {/* A packed comma run. The comma rides INSIDE the
                              label it follows so it cannot orphan onto a line
                              of its own; the space between buttons is the
                              break opportunity. Commas, not middle dots —
                              middle-dot.test.ts holds those at zero outside
                              tabular mono. */}
                          {doc.similar.map((s, index) => (
                            <Fragment key={s}>
                              {index > 0 ? " " : null}
                              <button
                                type="button"
                                className="text-action"
                                onClick={() => jumpToCard(s)}
                                title={`Jump to ${STRATEGY_LABELS[s]}`}
                              >
                                {STRATEGY_LABELS[s]}{index < doc.similar.length - 1 ? "," : ""}
                              </button>
                            </Fragment>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
