"""Wire models for the coherence lab: distribution, combos, calibration, feeds, shell.

Split from ``schemas_coherence.py`` when that file reached its length ceiling.
The seam is the same one the routers use: the other module carries the engine's
running state — universe, books, certificate, index — and this one carries the
readings built on top of it.

Every decimal crosses as a **string**, as everywhere else in this package. A
probability mass of ``0.0500`` and a bin midpoint of ``77549.99`` are both
fixed-point quantities whose last place decides an answer, and JSON numbers are
binary64. The client parses them with the same integer-centicent helpers the
rest of the tab uses.

Nullable fields are null and mean it. A mean that cannot be computed, a band
with an unquoted leg, a maker spread from a single quote — each comes across as
null with a sentence saying why, and none of them is ever zero.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Implied distribution (spec 9.2)
# --------------------------------------------------------------------------- #


class CoherenceProbe(BaseModel):
    """One reading of the survival function, and the market that gave it."""

    strike: str
    survival: str
    ticker: str
    label: str
    origin: str


class CoherenceBin(BaseModel):
    """One interval of the axis and the mass the prices put in it."""

    label: str
    low: str | None = None
    high: str | None = None
    mass: str
    representative: str | None = None
    negative: bool = False


class CoherenceSurface(BaseModel):
    """The distribution a family's prices imply, or the reason there is none."""

    state: str
    engine: str
    basis: str | None = None
    event_ticker: str = ""
    probes: list[CoherenceProbe] = Field(default_factory=list)
    bins: list[CoherenceBin] = Field(default_factory=list)
    total_mass: str | None = None
    tail_mass_low: str | None = None
    tail_mass_high: str | None = None
    mean: str | None = None
    variance: str | None = None
    standard_deviation: str | None = None
    skewness: str | None = None
    excess_kurtosis: str | None = None
    moments_note: str = ""
    negative_bins: list[str] = Field(default_factory=list)
    detail: str = ""


# --------------------------------------------------------------------------- #
# Multi-asset Kelly (spec 9.4)
# --------------------------------------------------------------------------- #


class CoherenceStake(BaseModel):
    """What to put on one outcome, as a fraction of the bankroll."""

    ticker: str
    label: str
    probability: str
    price: str
    edge: str
    full_fraction: str
    fraction: str
    admitted: bool = False


class CoherenceKelly(BaseModel):
    """The log-optimal plan, and the riskless alternative where one exists."""

    state: str
    engine: str
    stakes: list[CoherenceStake] = Field(default_factory=list)
    shrinkage: str = "0.25"
    reserve_rate: str | None = None
    cash_fraction: str | None = None
    staked_fraction: str | None = None
    growth_rate: str | None = None
    full_growth_rate: str | None = None
    worst_case_wealth: str | None = None
    basket_cost: str | None = None
    arbitrage_available: bool = False
    riskless_growth: str | None = None
    detail: str = ""


# --------------------------------------------------------------------------- #
# Combos and Frechet bounds (spec 6.3)
# --------------------------------------------------------------------------- #


class CoherenceComboLeg(BaseModel):
    ticker: str
    label: str
    side: str
    probability: str | None = None
    buy_cost: str | None = None
    opposite_cost: str | None = None


class CoherenceCombo(BaseModel):
    """One parlay against the band its legs leave it."""

    ticker: str
    label: str
    collection_ticker: str = ""
    scope: str = "cross-shard"
    legs: list[CoherenceComboLeg] = Field(default_factory=list)
    combo_bid: str | None = None
    combo_ask: str | None = None
    combo_mid: str | None = None
    price: str | None = None
    price_basis: str = "unavailable"
    lower_bound: str | None = None
    upper_bound: str | None = None
    independence: str | None = None
    band_width: str | None = None
    band_position: str | None = None
    dependence: str = "unavailable"
    inside_band: bool | None = None
    #: Rows on this parlay whose portfolio actually costs less than it is
    #: certain to pay. A price outside the band is NOT the same claim: the
    #: bounds are built from each leg's mid while the parlay is read from its
    #: offer, so an ask above min(leg mids) proves nothing tradable. Only a
    #: violated row carries a portfolio, so only this number may say "Dutch book".
    violated_rows: int = 0
    detail: str = ""


class CoherenceComboRow(BaseModel):
    """A Frechet bound as a testable portfolio."""

    because: str
    scope: str
    bound: str
    cost: str | None = None
    slack: str | None = None
    violated: bool = False
    legs: list[CoherenceComboLeg] = Field(default_factory=list)


class CoherenceCombos(BaseModel):
    state: str
    combos: list[CoherenceCombo] = Field(default_factory=list)
    rows: list[CoherenceComboRow] = Field(default_factory=list)
    quoted: int = 0
    outside_band: int = 0
    violations: int = 0
    notes: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Calibration (spec 9.3)
# --------------------------------------------------------------------------- #


class CoherenceReliabilityBin(BaseModel):
    label: str
    low: str
    high: str
    count: int = 0
    mean_forecast: str | None = None
    outcome_rate: str | None = None
    deviation: str | None = None


class CoherenceMapPoint(BaseModel):
    quoted: str
    calibrated: str
    weight: int = 0


class CoherenceCalibration(BaseModel):
    """The Brier score, its decomposition, and what the corpus is made of."""

    state: str
    engine: str
    count: int = 0
    base_rate: str | None = None
    brier: str | None = None
    reliability: str | None = None
    resolution: str | None = None
    uncertainty: str | None = None
    binning: str | None = None
    skill: str | None = None
    bias_slope: str | None = None
    median_horizon_s: int | None = None
    thin: bool = True
    bins: list[CoherenceReliabilityBin] = Field(default_factory=list)
    isotonic_map: list[CoherenceMapPoint] = Field(default_factory=list)
    composition: list[CoherenceCompositionRow] = Field(default_factory=list)
    detail: str = ""


class CoherenceCompositionRow(BaseModel):
    series_ticker: str
    count: int = 0


# --------------------------------------------------------------------------- #
# Settlement feeds (spec 9.1)
# --------------------------------------------------------------------------- #


class CoherenceWeatherSample(BaseModel):
    ts_ms: int
    value: str
    contributors: int = 0
    status: str = "unknown"


class CoherenceSettlementFeed(BaseModel):
    """The published index a contract resolves against, and its quality control."""

    state: str
    detail: str = ""
    city: str | None = None
    config_version: str = ""
    samples: list[CoherenceWeatherSample] = Field(default_factory=list)
    sample_count: int = 0
    degraded_samples: int = 0
    contributors_min: int | None = None
    contributors_max: int | None = None
    latest_value: str | None = None
    window_minutes: int = 60
    window_average: str | None = None
    window_average_clean: str | None = None
    spot_minus_window: str | None = None
    reference_rate_state: str = "unavailable"
    reference_rate_detail: str = ""


# --------------------------------------------------------------------------- #
# RFQ dispersion (spec 8.4)
# --------------------------------------------------------------------------- #


class CoherenceDispersion(BaseModel):
    market_ticker: str
    #: The Frechet band this market's legs leave, and the share of it the
    #: makers actually disagree over. Null where no combo reading covers this
    #: market or the panel is too thin — never zero, which would read as
    #: "the makers agree exactly" rather than "this was not measured".
    band_width: str | None = None
    band_fraction: str | None = None
    band_note: str = ""
    quotes: int = 0
    usable: int = 0
    median: str | None = None
    lowest: str | None = None
    highest: str | None = None
    spread: str | None = None
    median_width: str | None = None
    crossed: int = 0
    thin: bool = True
    detail: str = ""


class CoherenceRfqPanel(BaseModel):
    state: str
    detail: str = ""
    open_requests: int = 0
    dispersions: list[CoherenceDispersion] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# The shell (spec 10.3)
# --------------------------------------------------------------------------- #


class CoherenceShellEntry(BaseModel):
    name: str
    kind: str
    detail: str = ""


class CoherenceShell(BaseModel):
    """One ``ls`` or one ``cat`` over the watched universe."""

    state: str
    path: str
    command: str = "ls"
    exists: bool = True
    entries: list[CoherenceShellEntry] = Field(default_factory=list)
    body: str = ""
    detail: str = ""


CoherenceCalibration.model_rebuild()
