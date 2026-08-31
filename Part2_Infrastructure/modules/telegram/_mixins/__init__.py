"""One file per banner section of the original ``modules/telegram.py``.

Every file here is a MIXIN, not a module of free functions, and the reason is
not style. `_dispatch` resolves a handler with ``getattr(self, spec.handler)``
against a name stored as a STRING in `COMMAND_SPECS`, and each handler reaches
`self.send_message`, `self._authorised` and `self.gateway`. Free functions would
have to be re-bound by hand, and `_build_command_index`'s collision check plus
the registry's `hasattr` floor would only find out at import time.

The section boundaries are the author's own banner comments, kept verbatim at
the top of each file.
"""

from __future__ import annotations

from modules.telegram._mixins.activity import ActivityMixin
from modules.telegram._mixins.alerts import AlertsMixin
from modules.telegram._mixins.allocation import AllocationMixin
from modules.telegram._mixins.analytics import AnalyticsMixin
from modules.telegram._mixins.compare import CompareMixin
from modules.telegram._mixins.controls import ControlsMixin
from modules.telegram._mixins.costs import CostsMixin
from modules.telegram._mixins.dataops import DataOpsMixin
from modules.telegram._mixins.delivery import DeliveryMixin
from modules.telegram._mixins.desks import DesksMixin
from modules.telegram._mixins.developer import DeveloperMixin
from modules.telegram._mixins.essentials import EssentialsMixin
from modules.telegram._mixins.folds import FoldsMixin
from modules.telegram._mixins.linking import LinkingMixin
from modules.telegram._mixins.live import LiveMixin
from modules.telegram._mixins.market import MarketMixin
from modules.telegram._mixins.microstructure import MicrostructureMixin
from modules.telegram._mixins.montecarlo import MonteCarloMixin
from modules.telegram._mixins.orders import OrdersMixin
from modules.telegram._mixins.parsing import ParsingMixin
from modules.telegram._mixins.portfolio import PortfolioMixin
from modules.telegram._mixins.preview import PreviewMixin
from modules.telegram._mixins.reliability import ReliabilityMixin
from modules.telegram._mixins.research import ResearchMixin
from modules.telegram._mixins.research_detail import ResearchDetailMixin
from modules.telegram._mixins.risk import RiskMixin
from modules.telegram._mixins.riskdrivers import RiskDriversMixin
from modules.telegram._mixins.scenario_report import ScenarioReportMixin
from modules.telegram._mixins.scenarios import ScenariosMixin
from modules.telegram._mixins.services import ServicesMixin
from modules.telegram._mixins.streaming import StreamingMixin
from modules.telegram._mixins.subscriptions import SubscriptionsMixin
from modules.telegram._mixins.tabs import TabsMixin
from modules.telegram._mixins.tabs_coherence import CoherenceTabMixin
from modules.telegram._mixins.tabs_engine import EngineTabsMixin
from modules.telegram._mixins.tabs_ops import TabsOpsMixin

__all__ = [
    "StreamingMixin",
    "PreviewMixin",
    "ServicesMixin",
    "ScenarioReportMixin",
    "RiskDriversMixin",
    "ResearchDetailMixin",
    "DesksMixin",
    "ActivityMixin",
    "AlertsMixin",
    "AllocationMixin",
    "AnalyticsMixin",
    "CompareMixin",
    "ControlsMixin",
    "CostsMixin",
    "DataOpsMixin",
    "DeliveryMixin",
    "DeveloperMixin",
    "EssentialsMixin",
    "EngineTabsMixin",
    "FoldsMixin",
    "LinkingMixin",
    "LiveMixin",
    "MarketMixin",
    "MicrostructureMixin",
    "MonteCarloMixin",
    "OrdersMixin",
    "ParsingMixin",
    "PortfolioMixin",
    "ReliabilityMixin",
    "ResearchMixin",
    "RiskMixin",
    "ScenariosMixin",
    "SubscriptionsMixin",
    "TabsMixin",
    "CoherenceTabMixin",
    "TabsOpsMixin",
]
