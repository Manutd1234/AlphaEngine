"use client";

/**
 * What the selected strategy is, and when it stops working.
 *
 * Sits directly under the controls, next to the choice it explains. A reference
 * page listing all twenty-six would be read once and never again; a card that
 * changes when the dropdown changes is read every time someone picks something
 * unfamiliar, which is the moment the explanation is worth anything.
 *
 * "When it fails" is given the same weight as "when it works", not a smaller
 * one. A catalogue that only describes the conditions each model was built for
 * reads as twenty-six good ideas, and the reason the picker needs documenting
 * at all is that they are twenty-six trade-offs.
 *
 * Parameter meanings are rendered from `PARAM_MEANING` rather than restated in
 * the prose, so a renamed axis cannot end up described one way here and
 * labelled another on the slider four pixels away.
 */

import { STRATEGY_DOCS } from "@/lib/strategy-docs";
import { PARAM_MEANING, STRATEGY_FAMILY, STRATEGY_LABELS, type Strategy } from "@/lib/types";

interface StrategyDocCardProps {
  strategy: Strategy;
  /** Switches the picker without leaving the card. */
  onSelect?: (strategy: Strategy) => void;
}

export default function StrategyDocCard({ strategy, onSelect }: StrategyDocCardProps) {
  const doc = STRATEGY_DOCS[strategy];
  const params = PARAM_MEANING[strategy];

  return (
    <div className="card strategy-doc">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">{STRATEGY_FAMILY[strategy]}</span>
          <h2>{STRATEGY_LABELS[strategy]}</h2>
        </div>
      </div>

      <p className="sub">{doc.summary}</p>

      <dl className="strategy-doc__grid">
        <div>
          <dt>The rule</dt>
          <dd>{doc.formula}</dd>
        </div>
        <div className="is-works">
          <dt>When it works</dt>
          <dd>{doc.whenItWorks}</dd>
        </div>
        <div className="is-fails">
          <dt>When it fails</dt>
          <dd>{doc.whenItFails}</dd>
        </div>
        <div>
          <dt>Parameters</dt>
          <dd>
            {/* From PARAM_MEANING, which the sliders also read. */}
            <strong>fast</strong> — {params.fast}
            <br />
            <strong>slow</strong> — {params.slow}
          </dd>
        </div>
      </dl>

      <p className="strategy-doc__similar">
        <span className="muted">Compare against:</span>{" "}
        {doc.similar.map((other, index) => (
          <span key={other}>
            {index > 0 ? ", " : ""}
            {onSelect ? (
              <button type="button" className="linklike" onClick={() => onSelect(other)}>
                {STRATEGY_LABELS[other]}
              </button>
            ) : (
              STRATEGY_LABELS[other]
            )}
          </span>
        ))}
      </p>

      <p className="research-note">
        Both engines apply the same convention this description assumes: signals form on one bar and
        execute on the next, and on a bar where entry and exit both fire, the exit wins. Written down
        because a rule read as &ldquo;buy the crossover&rdquo; and a rule that also flattens on the
        same bar are different strategies with the same name.
      </p>
    </div>
  );
}
