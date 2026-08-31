"use client";

/** Active operator context with the complete proof sequence available on demand. */

import { ArrowRight, ListTree } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { CoherenceSection } from "@/lib/sections";
import styles from "./ProofsMethodMap.module.css";

export const PROOFS_OPERATORS: ReadonlyArray<{
  section: CoherenceSection;
  label: string;
  operator: string;
  question: string;
  inputs: string;
  formula: string;
  explanation: string;
  output: string;
  handoff: string;
}> = [
  {
    section: "certificate",
    label: "Test",
    operator: "LP feasibility",
    question: "Can one distribution reproduce every quoted contract?",
    inputs: "Payoff matrix A, price vector p, and settlement-state basis.",
    formula: "Aq = p; q ≥ 0; 1ᵀq = 1",
    explanation: "Solve for non-negative state weights q that reproduce quotes and sum to one.",
    output: "A feasible distribution or an infeasible result.",
    handoff: "Infeasible passes to the dual witness; feasible closes as coherent.",
  },
  {
    section: "portfolio",
    label: "Witness",
    operator: "Farkas dual",
    question: "Which basket proves an infeasible price system?",
    inputs: "Rejected constraints, prices, settlement payoffs, and three fees.",
    formula: "max_L min_s [payoff_L(s) − cost(L)]",
    explanation: "Find basket L whose worst state pays more than it costs.",
    output: "Legs, worst-state payoff, fees, margin, and net edge.",
    handoff: "Check returned legs against capacity; zero legs withhold size.",
  },
  {
    section: "combos",
    label: "Joint",
    operator: "Fréchet–Hoeffding",
    question: "Which joint probabilities can the marginals support without assuming dependence?",
    inputs: "pᵢ = P(Aᵢ) for each required leg Aᵢ; n is the number of required legs.",
    formula: "L = max(0, Σpᵢ − n + 1); U = minᵢ pᵢ; L ≤ P(∩Aᵢ) ≤ U",
    explanation: "The sum sets the floor; the smallest marginal sets the ceiling. Marginals do not identify dependence.",
    output: "A feasible parlay interval [L, U].",
    handoff: "Outside the interval proves incompatibility. Inside means feasible—not fair value—and Πpᵢ remains only an independence reference.",
  },
  {
    section: "index",
    label: "Distance",
    operator: "L1 projection",
    question: "How far are prices from the coherent set?",
    inputs: "Price vector p and feasible probability polytope Q.",
    formula: "min_{q ∈ Q} ‖p − q‖₁",
    explanation: "Find the coherent vector with the smallest absolute adjustment.",
    output: "Distance and nearest coherent projection.",
    handoff: "Keep structural distance separate from settled accuracy.",
  },
  {
    section: "calibration",
    label: "Outcome",
    operator: "Brier score",
    question: "After settlement, how far were quotes from outcomes?",
    inputs: "N settled pairs with probability p and binary outcome y.",
    formula: "Brier = N⁻¹ Σ(p − y)²",
    explanation: "Mean squared probability error; zero is perfect.",
    output: "One proper score for the settled corpus.",
    handoff: "Decompose it so corpus difficulty is not forecast quality.",
  },
  {
    section: "corpus",
    label: "Sample",
    operator: "Murphy decomposition",
    question: "Which Brier terms belong to calibration, discrimination, difficulty, or binning?",
    inputs: "Brier score, bins, base rate, observed rates, and binning residue.",
    formula: "Brier = REL − RES + UNC + BIN",
    explanation: "Reliability and Binning add error; Resolution subtracts discrimination; Uncertainty belongs to the questions.",
    output: "Four signed terms reconstructing Brier.",
    handoff: "Corpus records their markets and sample depth.",
  },
  {
    section: "lessons",
    label: "Guard",
    operator: "Guard graph",
    question: "Which test turns red when a claim stops being true?",
    inputs: "Published claim, owner, lesson, and pinned regression test.",
    formula: "claim → module → lesson → pinned test",
    explanation: "Connect each assertion to its computation and contract test.",
    output: "A navigable claim-to-test path.",
    handoff: "A failed guard returns to its owning stage.",
  },
];

export default function ProofsMethodMap({
  activeSection,
  onSection,
}: {
  activeSection: CoherenceSection;
  onSection: (section: CoherenceSection) => void;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="proofs-method-trigger"
          aria-label={`Open proof method map, ${PROOFS_OPERATORS.length} operators`}
        >
          <ListTree aria-hidden="true" />
          Method map
          <span className="proofs-method-trigger__count" aria-hidden="true">
            {PROOFS_OPERATORS.length}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent className="proofs-method-sheet w-[min(96rem,calc(100vw-1rem))] max-w-none">
        <div className="coherence-plane proofs-plane proofs-method-sheet__body">
          <SheetHeader>
            <SheetTitle>Proof operator map</SheetTitle>
            <SheetDescription>
              Seven stages connect quote feasibility to the tests that guard the engine. Each row names its inputs, operation, output, and hand-off.
            </SheetDescription>
          </SheetHeader>
          <nav className={styles.map} aria-label="Proof operator map">
            <ol className={styles.rail}>
              {PROOFS_OPERATORS.map((item, index) => {
                const active = item.section === activeSection;
                return (
                  <li
                    key={item.section}
                    className={styles.stage}
                    data-active={active ? "true" : "false"}
                    data-proof-operator-card={item.section}
                  >
                    <span className={styles.index} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <article className={styles.card} aria-current={active ? "step" : undefined}>
                      <header className={styles.cardHeader}>
                        <span>
                          <small>{item.label}</small>
                          <strong>{item.operator}</strong>
                        </span>
                        {active ? <em>Current stage</em> : null}
                      </header>
                      <p className={styles.question}>{item.question}</p>
                      <div className={styles.details}>
                        <div
                          className="table-wrap"
                          role="region"
                          aria-label={`${item.operator} method details`}
                          tabIndex={0}
                        >
                          <table className={`${styles.operatorTable} coh-table`}>
                          <caption className="coh-table__caption sr-only">
                            Inputs, operation, output, and hand-off for this proof stage.
                          </caption>
                          <tbody>
                            <tr>
                              <th scope="row"><h3>Inputs</h3></th>
                              <td><p>{item.inputs}</p></td>
                            </tr>
                            <tr className={styles.operation}>
                              <th scope="row"><h3>Operation</h3></th>
                              <td>
                                <code aria-label={`${item.operator} formula: ${item.formula}`}>
                                  {item.formula}
                                </code>
                                <p>{item.explanation}</p>
                              </td>
                            </tr>
                            <tr>
                              <th scope="row"><h3>Output and hand-off</h3></th>
                              <td><p><strong>{item.output}</strong></p><p>{item.handoff}</p></td>
                            </tr>
                          </tbody>
                          </table>
                        </div>
                      </div>
                      <SheetClose asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={styles.openStage}
                          onClick={() => onSection(item.section)}
                        >
                          Open {item.label.toLowerCase()} stage
                          <ArrowRight aria-hidden="true" />
                        </Button>
                      </SheetClose>
                    </article>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      </SheetContent>
    </Sheet>
  );
}
