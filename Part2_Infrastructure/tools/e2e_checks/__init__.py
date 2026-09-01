"""The checks ``tools/e2e_smoke.py`` runs, grouped by the boundary they probe.

The script stayed a script — ``venv/bin/python tools/e2e_smoke.py`` is unchanged
— and kept the registry, the rendering and the exit code. What moved here is the
checks themselves, one module per group: ``infrastructure``, ``web``, ``data``,
``drills``, over the shared ``transport``.

``web/tests/gateway-transport.test.ts`` reads this package's source alongside the
script's. It used to read only ``tools/e2e_smoke.py``; a probe extracted to a
module would have left that scan matching a file that no longer defines it.
"""

from __future__ import annotations

from tools.e2e_checks.data import check_backtest as check_backtest  # noqa: F401
from tools.e2e_checks.data import check_graph_linkage as check_graph_linkage  # noqa: F401
from tools.e2e_checks.data import check_market_data as check_market_data  # noqa: F401
from tools.e2e_checks.data import check_oracle as check_oracle  # noqa: F401
from tools.e2e_checks.data import check_rag_embed as check_rag_embed  # noqa: F401
from tools.e2e_checks.data import check_rag_status as check_rag_status  # noqa: F401
from tools.e2e_checks.data import check_supabase as check_supabase  # noqa: F401
from tools.e2e_checks.data import check_supabase_mirror as check_supabase_mirror  # noqa: F401
from tools.e2e_checks.drills import drill_kill_switch as drill_kill_switch  # noqa: F401
from tools.e2e_checks.drills import drill_outage as drill_outage  # noqa: F401
from tools.e2e_checks.infrastructure import check_decision_histogram as check_decision_histogram  # noqa: F401
from tools.e2e_checks.infrastructure import check_gateway_auth as check_gateway_auth  # noqa: F401
from tools.e2e_checks.infrastructure import check_gateway_health as check_gateway_health  # noqa: F401
from tools.e2e_checks.infrastructure import check_venue_feeds as check_venue_feeds  # noqa: F401
from tools.e2e_checks.transport import FAIL as FAIL  # noqa: F401
from tools.e2e_checks.transport import GATEWAY as GATEWAY  # noqa: F401
from tools.e2e_checks.transport import OK as OK  # noqa: F401
from tools.e2e_checks.transport import SKIP as SKIP  # noqa: F401
from tools.e2e_checks.transport import TIMEOUT as TIMEOUT  # noqa: F401
from tools.e2e_checks.transport import VERCEL as VERCEL  # noqa: F401
from tools.e2e_checks.transport import Result as Result  # noqa: F401
from tools.e2e_checks.transport import fetch as fetch  # noqa: F401
from tools.e2e_checks.web import check_vercel_app as check_vercel_app  # noqa: F401
from tools.e2e_checks.web import check_vercel_health as check_vercel_health  # noqa: F401
from tools.e2e_checks.web import check_vercel_root_redirect as check_vercel_root_redirect  # noqa: F401
from tools.e2e_checks.web import check_vercel_to_gateway as check_vercel_to_gateway  # noqa: F401
