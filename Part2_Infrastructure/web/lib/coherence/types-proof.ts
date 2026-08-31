/** Structured, exact evidence attached to a coherence solver certificate. */

export interface CoherenceProofConstraintLeg {
  ticker: string;
  label: string;
  direction: string;
  side: string;
  price: string | null;
  size_hundredths: number;
}

export interface CoherenceProofConstraintRow {
  family: string;
  scope: string;
  because: string;
  bound: string;
  cost: string | null;
  slack: string | null;
  testable: boolean;
  violated?: boolean | null;
  untestable_reason: string | null;
  executable_size_hundredths?: number | null;
  legs: CoherenceProofConstraintLeg[];
}

export interface CoherenceProofObservation {
  markets_observed?: number | null;
  markets_in_event?: number | null;
  outcomes_in_component: number;
  executable_buy_sides?: number | null;
  executable_sell_sides?: number | null;
}

export interface CoherenceProofSolver {
  engine: string;
  variables: number | null;
  state_rows: number | null;
  optimum: string | null;
  optimum_kind: string;
  decision_boundary: string;
  verdict: string;
}

export interface CoherenceProofConstraints {
  tested: number;
  untestable: number;
  rows: CoherenceProofConstraintRow[];
}

export interface CoherenceProofEvidence {
  observation: CoherenceProofObservation;
  solver: CoherenceProofSolver;
  constraints: CoherenceProofConstraints;
}
