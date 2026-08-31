"""Structured proof evidence carried by a coherence certificate."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CoherenceProofConstraintLeg(BaseModel):
    """One executable quote side in a derived constraint."""

    ticker: str
    label: str
    direction: str
    side: str
    price: str | None = None
    size_hundredths: int


class CoherenceProofConstraintRow(BaseModel):
    """One derived constraint, including its quote arithmetic."""

    family: str
    scope: str
    because: str
    bound: str
    cost: str | None = None
    slack: str | None = None
    testable: bool
    violated: bool | None = None
    untestable_reason: str | None = None
    executable_size_hundredths: int | None = None
    legs: list[CoherenceProofConstraintLeg] = Field(default_factory=list)


class CoherenceProofObservation(BaseModel):
    """Counts from the observation behind a certificate."""

    markets_observed: int | None = None
    markets_in_event: int | None = None
    outcomes_in_component: int
    executable_buy_sides: int | None = None
    executable_sell_sides: int | None = None


class CoherenceProofSolver(BaseModel):
    """The matrix dimensions and decision statistic of the answering engine."""

    engine: str
    variables: int | None = None
    state_rows: int | None = None
    optimum: str | None = None
    optimum_kind: str
    decision_boundary: str
    verdict: str


class CoherenceProofConstraints(BaseModel):
    """The named constraints available to explain the decision."""

    tested: int
    untestable: int
    rows: list[CoherenceProofConstraintRow] = Field(default_factory=list)


class CoherenceProofEvidence(BaseModel):
    """Structured, data-derived inputs for the interactive proof surface."""

    observation: CoherenceProofObservation
    solver: CoherenceProofSolver
    constraints: CoherenceProofConstraints
