/**
 * The Strategy Codex — the catalogue as a reference library.
 *
 * Forty-six models remain available before any run exists. The seven families
 * are now addressable tabs, and each family keeps a compact strategy index
 * beside one complete strategy record. Only presentation is reduced: the
 * shared registry, documentation, progress, relationships and adopt action are
 * unchanged.
 */

import { Fragment, type CSSProperties, useEffect, useRef, useState } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ExperimentRecord } from "@/lib/experiments";
import { STRATEGY_DOCS } from "@/lib/strategy-docs";
import {
  FAMILY_ORDER,
  progressFor,
  strategiesByFamily,
  strategyProgress,
  type StrategyProgress,
} from "@/lib/strategy-progress";
import { STRATEGY_FAMILY, STRATEGY_LABELS, type Strategy, type StrategyFamily } from "@/lib/types";

export const FAMILY_THESIS: Record<StrategyFamily, string> = {
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

const STRATEGY_FAMILIES = [...strategiesByFamily()];

function familyId(family: StrategyFamily): string {
  return family.toLowerCase().replace(/\s+/g, "-");
}

/** Glyph plus word: the result never depends on colour alone. */
function StrategyRunState({ state }: { state: StrategyProgress }) {
  const explored = state.runs > 0;
  return (
    <span className="codex-chip" data-verdict={explored ? state.bestVerdict : undefined}>
      {explored
        ? <><span aria-hidden>●</span> {state.bestVerdict?.toUpperCase()}</>
        : <><span aria-hidden>◌</span> not yet run</>}
    </span>
  );
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
  const selectedFamily = STRATEGY_FAMILY[activeStrategy];
  const [activeFamily, setActiveFamily] = useState<StrategyFamily>(selectedFamily);
  const [browsedByFamily, setBrowsedByFamily] = useState<Partial<Record<StrategyFamily, Strategy>>>(
    { [selectedFamily]: activeStrategy },
  );
  const pendingFocus = useRef<Strategy | null>(null);

  useEffect(() => {
    const family = STRATEGY_FAMILY[activeStrategy];
    setActiveFamily(family);
    setBrowsedByFamily((current) => (
      current[family] === activeStrategy
        ? current
        : { ...current, [family]: activeStrategy }
    ));
  }, [activeStrategy]);

  useEffect(() => {
    const strategy = pendingFocus.current;
    if (!strategy || STRATEGY_FAMILY[strategy] !== activeFamily) return;
    const card = document.getElementById(`codex-card-${strategy}`);
    if (!card) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
    card.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [activeFamily, browsedByFamily]);

  const setBrowsedStrategy = (strategy: Strategy) => {
    const family = STRATEGY_FAMILY[strategy];
    setBrowsedByFamily((current) => ({ ...current, [family]: strategy }));
  };

  const handleFamilyChange = (value: string) => {
    const family = value as StrategyFamily;
    if (FAMILY_ORDER.includes(family)) setActiveFamily(family);
  };

  // Similar-model links browse instead of silently changing the live picker.
  const jumpToCard = (strategy: Strategy) => {
    setBrowsedStrategy(strategy);
    setActiveFamily(STRATEGY_FAMILY[strategy]);
    pendingFocus.current = strategy;
  };

  return (
    <Tabs
      className="strategy-codex"
      value={activeFamily}
      onValueChange={handleFamilyChange}
      orientation="horizontal"
    >
      {/* The next-bar / exit-wins convention was stated here and was removed on
          request. It is not lost: `lib/export-python.ts` carries it for anyone
          reading the generated code, which is where it decides something. */}
      <TabsList className="strategy-codex__tabs-list" aria-label={FAMILY_ORDER.join(", ")}>
        {STRATEGY_FAMILIES.map(([family, strategies]) => {
          const explored = strategies.filter((strategy) => progress.has(strategy)).length;
          return (
            <TabsTrigger
              key={family}
              id={`strategy-family-${familyId(family)}-tab`}
              className="strategy-codex__tab"
              value={family}
              aria-controls={`strategy-family-${familyId(family)}-panel`}
              style={{ "--codex-accent": FAMILY_ACCENT[family] } as CSSProperties}
            >
              <span className="codex-monogram" aria-hidden>{FAMILY_MONOGRAM[family]}</span>
              <span>{family}</span>
              <span className="strategy-codex__tab-count num">{explored}/{strategies.length}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>

      {STRATEGY_FAMILIES.map(([family, strategies]) => {
        const explored = strategies.filter((strategy) => progress.has(strategy)).length;
        const browsedStrategy = browsedByFamily[family] ?? strategies[0];
        const doc = STRATEGY_DOCS[browsedStrategy];
        const state = progressFor(progress, browsedStrategy);
        const active = browsedStrategy === activeStrategy;
        return (
          <TabsContent
            key={family}
            id={`strategy-family-${familyId(family)}-panel`}
            value={family}
            forceMount
            className="codex-family"
            aria-labelledby={`strategy-family-${familyId(family)}-tab`}
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
                <span className="codex-family__progress-count">
                  explored <NumberTicker value={explored} /> of {strategies.length}
                </span>
                <small>from this browser&apos;s run log (last 60 runs)</small>
              </span>
            </header>

            <ScrollArea className="codex-family__scroll">
              <div className="codex-family__body">
                <div className="codex-strategy-selector" role="group" aria-label={family}>
                  {strategies.map((strategy) => {
                    const selected = strategy === browsedStrategy;
                    return (
                      <button
                        key={strategy}
                        id={`codex-index-${strategy}`}
                        type="button"
                        className="codex-strategy-selector__item"
                        data-selected={selected || undefined}
                        aria-pressed={selected}
                        aria-current={strategy === activeStrategy || undefined}
                        onClick={() => setBrowsedStrategy(strategy)}
                      >
                        <strong>{STRATEGY_LABELS[strategy]}</strong>
                        <StrategyRunState state={progressFor(progress, strategy)} />
                      </button>
                    );
                  })}
                </div>

                <article
                  id={`codex-card-${browsedStrategy}`}
                  className="codex-strategy-detail"
                  data-active={active || undefined}
                  tabIndex={-1}
                >
                  <header className="codex-strategy-detail__head">
                    <div>
                      <span className="codex-strategy-detail__label">Strategy</span>
                      <button
                        type="button"
                        className="codex-card__select"
                        onClick={() => onSelect(browsedStrategy)}
                        aria-current={active || undefined}
                        title={`Select ${STRATEGY_LABELS[browsedStrategy]} and open Summary`}
                      >
                        <strong>{STRATEGY_LABELS[browsedStrategy]}</strong>
                      </button>
                    </div>
                    <div className="codex-strategy-detail__result">
                      <span className="codex-strategy-detail__label">Best result</span>
                      <StrategyRunState state={state} />
                    </div>
                  </header>

                  <dl className="codex-table codex-strategy-detail__facts">
                    <div>
                      <dt>What it does</dt>
                      <dd className="codex-card__summary">
                        <p>{doc.summary}</p>
                        <code>{doc.formula}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Fails when</dt>
                      <dd className="codex-card__fails">{doc.whenItFails}</dd>
                    </div>
                  </dl>

                  <div className="codex-card__similar">
                    <strong>Similar</strong>
                    <span>
                      {doc.similar.map((strategy, index) => (
                        <Fragment key={strategy}>
                          {index > 0 ? " " : null}
                          <button
                            type="button"
                            className="text-action"
                            onClick={() => jumpToCard(strategy)}
                            title={`Jump to ${STRATEGY_LABELS[strategy]}`}
                          >
                            {STRATEGY_LABELS[strategy]}
                            {index < doc.similar.length - 1 ? "," : ""}
                          </button>
                        </Fragment>
                      ))}
                    </span>
                  </div>
                </article>
              </div>
            </ScrollArea>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
