"""Pydantic request/response contracts shared by the REST API and gateway console.

This module is the FACADE. The models themselves live in the six
``modules/schemas_*.py`` files re-exported below, one per contract area, so no
single file carries the whole wire surface.

Two things about this file are load-bearing:

  * ``tools/openapi.json`` is generated from these classes and the web build
    gates on a digest of it (``web/scripts/check-gateway-openapi-digest.mjs``).
    Which FILE a model lives in is invisible to that digest; the ORDER of the
    fields inside a model is not. Move models freely, fields never.
  * Every import site in this repository says ``from modules.schemas import X``.
    The re-exports below must therefore stay exhaustive, and each one is
    written ``import X as X  # noqa: F401`` because ``ruff --fix`` deletes the
    plain form as unused.
"""

from __future__ import annotations

# Re-exports, one name per line, each written ``X as X`` so ``ruff --fix`` does
# not delete it as unused. Sorted by module then name, which is what ruff's
# isort rule enforces; the grouping by contract area lives in the file names.
from modules.schemas_backtest import BacktestRequest as BacktestRequest  # noqa: F401
from modules.schemas_backtest import BacktestResult as BacktestResult  # noqa: F401
from modules.schemas_backtest import JobStatus as JobStatus  # noqa: F401
from modules.schemas_backtest import ParamResult as ParamResult  # noqa: F401
from modules.schemas_backtest import WalkForwardFold as WalkForwardFold  # noqa: F401
from modules.schemas_coherence import CoherenceAblation as CoherenceAblation  # noqa: F401
from modules.schemas_coherence import CoherenceBookLevel as CoherenceBookLevel  # noqa: F401
from modules.schemas_coherence import CoherenceBooks as CoherenceBooks  # noqa: F401
from modules.schemas_coherence import CoherenceBookView as CoherenceBookView  # noqa: F401
from modules.schemas_coherence import CoherenceBudgetStatus as CoherenceBudgetStatus  # noqa: F401
from modules.schemas_coherence import CoherenceCertificate as CoherenceCertificate  # noqa: F401
from modules.schemas_coherence import CoherenceCertificateLeg as CoherenceCertificateLeg  # noqa: F401
from modules.schemas_coherence import CoherenceEpisode as CoherenceEpisode  # noqa: F401
from modules.schemas_coherence import CoherenceEpisodes as CoherenceEpisodes  # noqa: F401
from modules.schemas_coherence import CoherenceEpisodeSample as CoherenceEpisodeSample  # noqa: F401
from modules.schemas_coherence import CoherenceEventView as CoherenceEventView  # noqa: F401
from modules.schemas_coherence import CoherenceFeeFill as CoherenceFeeFill  # noqa: F401
from modules.schemas_coherence import CoherenceFees as CoherenceFees  # noqa: F401
from modules.schemas_coherence import CoherenceHostStatus as CoherenceHostStatus  # noqa: F401
from modules.schemas_coherence import CoherenceIndexPoint as CoherenceIndexPoint  # noqa: F401
from modules.schemas_coherence import CoherenceIndexSeries as CoherenceIndexSeries  # noqa: F401
from modules.schemas_coherence import CoherenceMarketView as CoherenceMarketView  # noqa: F401
from modules.schemas_coherence import CoherenceRecorderStatus as CoherenceRecorderStatus  # noqa: F401
from modules.schemas_coherence import CoherenceReplay as CoherenceReplay  # noqa: F401
from modules.schemas_coherence import CoherenceShardStatus as CoherenceShardStatus  # noqa: F401
from modules.schemas_coherence import CoherenceStatus as CoherenceStatus  # noqa: F401
from modules.schemas_coherence import CoherenceSurvivalPoint as CoherenceSurvivalPoint  # noqa: F401
from modules.schemas_coherence import CoherenceUniverse as CoherenceUniverse  # noqa: F401
from modules.schemas_coherence_history import CoherenceBookHistory as CoherenceBookHistory  # noqa: F401
from modules.schemas_coherence_history import CoherenceBookHistoryPoint as CoherenceBookHistoryPoint  # noqa: F401
from modules.schemas_coherence_lab import CoherenceBin as CoherenceBin  # noqa: F401
from modules.schemas_coherence_lab import CoherenceCalibration as CoherenceCalibration  # noqa: F401
from modules.schemas_coherence_lab import CoherenceCalibrationHistory as CoherenceCalibrationHistory  # noqa: F401,E501
from modules.schemas_coherence_lab import CoherenceCalibrationPoint as CoherenceCalibrationPoint  # noqa: F401,E501
from modules.schemas_coherence_lab import CoherenceCombo as CoherenceCombo  # noqa: F401
from modules.schemas_coherence_lab import CoherenceComboLeg as CoherenceComboLeg  # noqa: F401
from modules.schemas_coherence_lab import CoherenceComboRow as CoherenceComboRow  # noqa: F401
from modules.schemas_coherence_lab import CoherenceCombos as CoherenceCombos  # noqa: F401
from modules.schemas_coherence_lab import CoherenceCompositionRow as CoherenceCompositionRow  # noqa: F401
from modules.schemas_coherence_lab import CoherenceDispersion as CoherenceDispersion  # noqa: F401
from modules.schemas_coherence_lab import CoherenceKelly as CoherenceKelly  # noqa: F401
from modules.schemas_coherence_lab import CoherenceMapPoint as CoherenceMapPoint  # noqa: F401
from modules.schemas_coherence_lab import CoherencePendingMinute as CoherencePendingMinute  # noqa: F401
from modules.schemas_coherence_lab import CoherenceProbe as CoherenceProbe  # noqa: F401
from modules.schemas_coherence_lab import CoherenceReliabilityBin as CoherenceReliabilityBin  # noqa: F401
from modules.schemas_coherence_lab import CoherenceRfqPanel as CoherenceRfqPanel  # noqa: F401
from modules.schemas_coherence_lab import CoherenceSeriesBias as CoherenceSeriesBias  # noqa: F401
from modules.schemas_coherence_lab import CoherenceSettlementFeed as CoherenceSettlementFeed  # noqa: F401
from modules.schemas_coherence_lab import CoherenceShell as CoherenceShell  # noqa: F401
from modules.schemas_coherence_lab import CoherenceShellEntry as CoherenceShellEntry  # noqa: F401
from modules.schemas_coherence_lab import CoherenceStake as CoherenceStake  # noqa: F401
from modules.schemas_coherence_lab import CoherenceSurface as CoherenceSurface  # noqa: F401
from modules.schemas_coherence_lab import CoherenceWeatherSample as CoherenceWeatherSample  # noqa: F401
from modules.schemas_data import DataBackfillRequest as DataBackfillRequest  # noqa: F401
from modules.schemas_data import DataCapability as DataCapability  # noqa: F401
from modules.schemas_data import DataInterval as DataInterval  # noqa: F401
from modules.schemas_data import DataJobAccepted as DataJobAccepted  # noqa: F401
from modules.schemas_data import DataJobsResponse as DataJobsResponse  # noqa: F401
from modules.schemas_data import DataJobView as DataJobView  # noqa: F401
from modules.schemas_data import DataReplayRequest as DataReplayRequest  # noqa: F401
from modules.schemas_data import DataSchedulesResponse as DataSchedulesResponse  # noqa: F401
from modules.schemas_data import DataScheduleView as DataScheduleView  # noqa: F401
from modules.schemas_diffusion import DiffusionAbsorptionResponse as DiffusionAbsorptionResponse  # noqa: F401, E501
from modules.schemas_diffusion import DiffusionEvent as DiffusionEvent  # noqa: F401
from modules.schemas_diffusion import DiffusionEventResponse as DiffusionEventResponse  # noqa: F401
from modules.schemas_diffusion import DiffusionEventsResponse as DiffusionEventsResponse  # noqa: F401
from modules.schemas_diffusion import DiffusionFindingsResponse as DiffusionFindingsResponse  # noqa: F401, E501
from modules.schemas_diffusion import DiffusionStageRecord as DiffusionStageRecord  # noqa: F401
from modules.schemas_market import BookLevel as BookLevel  # noqa: F401
from modules.schemas_market import ExecutionEstimate as ExecutionEstimate  # noqa: F401
from modules.schemas_market import OrderStatus as OrderStatus  # noqa: F401
from modules.schemas_market import OrderType as OrderType  # noqa: F401
from modules.schemas_market import RoutingLeg as RoutingLeg  # noqa: F401
from modules.schemas_market import Side as Side  # noqa: F401
from modules.schemas_market import TCAReport as TCAReport  # noqa: F401
from modules.schemas_market import TimeInForce as TimeInForce  # noqa: F401
from modules.schemas_market import VenueBook as VenueBook  # noqa: F401
from modules.schemas_ml import MLFeatureView as MLFeatureView  # noqa: F401
from modules.schemas_ml import MLFitRequest as MLFitRequest  # noqa: F401
from modules.schemas_ml import MLFoldView as MLFoldView  # noqa: F401
from modules.schemas_ml import MLRunDetail as MLRunDetail  # noqa: F401
from modules.schemas_ml import MLRunsResponse as MLRunsResponse  # noqa: F401
from modules.schemas_ml import MLRunSummary as MLRunSummary  # noqa: F401
from modules.schemas_ml import ResearchGraphNeighbour as ResearchGraphNeighbour  # noqa: F401
from modules.schemas_ml import ResearchGraphResponse as ResearchGraphResponse  # noqa: F401
from modules.schemas_research import ResearchRagAnomalyMatch as ResearchRagAnomalyMatch  # noqa: F401
from modules.schemas_research import ResearchRagEmbedRequest as ResearchRagEmbedRequest  # noqa: F401
from modules.schemas_research import ResearchRagEmbedResponse as ResearchRagEmbedResponse  # noqa: F401
from modules.schemas_research import ResearchRagMatch as ResearchRagMatch  # noqa: F401
from modules.schemas_research import ResearchRagSearchRequest as ResearchRagSearchRequest  # noqa: F401
from modules.schemas_research import ResearchRagSearchResponse as ResearchRagSearchResponse  # noqa: F401
from modules.schemas_research import ResearchRagStatus as ResearchRagStatus  # noqa: F401
from modules.schemas_trading import CancelRequest as CancelRequest  # noqa: F401
from modules.schemas_trading import CheckResult as CheckResult  # noqa: F401
from modules.schemas_trading import Fill as Fill  # noqa: F401
from modules.schemas_trading import KillSwitchRequest as KillSwitchRequest  # noqa: F401
from modules.schemas_trading import OrderAck as OrderAck  # noqa: F401
from modules.schemas_trading import OrderEvent as OrderEvent  # noqa: F401
from modules.schemas_trading import OrderRequest as OrderRequest  # noqa: F401
from modules.schemas_trading import OrderTimeline as OrderTimeline  # noqa: F401
from modules.schemas_trading import PaperExecutionReference as PaperExecutionReference  # noqa: F401
from modules.schemas_trading import Position as Position  # noqa: F401
from modules.schemas_trading import ReduceOnlyRequest as ReduceOnlyRequest  # noqa: F401
from modules.schemas_trading import ReplaceRequest as ReplaceRequest  # noqa: F401
from modules.schemas_trading import RiskDecision as RiskDecision  # noqa: F401
from modules.schemas_trading import RiskState as RiskState  # noqa: F401
from modules.schemas_trading import WorkingOrder as WorkingOrder  # noqa: F401

__all__ = [
    "BacktestRequest",
    "BacktestResult",
    "BookLevel",
    "CancelRequest",
    "CheckResult",
    "DataBackfillRequest",
    "DataCapability",
    "DataInterval",
    "DataJobAccepted",
    "DataJobsResponse",
    "DataJobView",
    "DataReplayRequest",
    "DataSchedulesResponse",
    "DataScheduleView",
    "DiffusionAbsorptionResponse",
    "DiffusionEvent",
    "DiffusionEventResponse",
    "DiffusionEventsResponse",
    "DiffusionFindingsResponse",
    "DiffusionStageRecord",
    "ExecutionEstimate",
    "Fill",
    "JobStatus",
    "KillSwitchRequest",
    "MLFeatureView",
    "MLFitRequest",
    "MLFoldView",
    "MLRunDetail",
    "MLRunsResponse",
    "MLRunSummary",
    "OrderAck",
    "OrderEvent",
    "OrderRequest",
    "OrderStatus",
    "OrderTimeline",
    "OrderType",
    "PaperExecutionReference",
    "ParamResult",
    "Position",
    "ReduceOnlyRequest",
    "ReplaceRequest",
    "ResearchGraphNeighbour",
    "ResearchGraphResponse",
    "ResearchRagAnomalyMatch",
    "ResearchRagEmbedRequest",
    "ResearchRagEmbedResponse",
    "ResearchRagMatch",
    "ResearchRagSearchRequest",
    "ResearchRagSearchResponse",
    "ResearchRagStatus",
    "RiskDecision",
    "RiskState",
    "RoutingLeg",
    "Side",
    "TCAReport",
    "TimeInForce",
    "VenueBook",
    "WalkForwardFold",
    "WorkingOrder",
]
