"""The gateway's HTTP surface, one router per tag group.

``main.py`` used to declare all fifty-two paths itself. It now owns only what is
genuinely singular — the lifespan's start-up and shutdown ordering, the
``FastAPI`` application, the middleware stack, the console template and the
exception handler — and includes the routers re-exported here.

The split follows the tags the routes already carried, so the grouping in
``/docs`` is unchanged and every ``operationId`` with it: FastAPI derives those
from the handler's name and its path, and neither moved.

WHY THIS LIVES UNDER ``modules/``
    ``docker/gateway.Dockerfile`` copies the root modules BY NAME —
    ``COPY main.py config.py celery_tasks.py worker.py ./`` — and copies this
    tree wholesale with ``COPY modules/ modules/``. A router package beside
    ``main.py`` at the repository root would simply be absent from the image,
    and nothing would notice until a request arrived: the build succeeds, the
    container starts, ``/health`` passes, and every moved route 404s. Under
    ``modules/`` the routers ship with everything they import.

WHAT A TEST HAS TO PATCH NOW
    A handler reads its singletons — ``get_gateway``, ``get_audit``,
    ``get_queue``, ``get_rag`` — from the module it lives in, and these
    handlers no longer live in ``main``. ``monkeypatch.setattr(main, ...)``
    would bind a name nothing reads and pass while testing nothing, so the
    tests that did it now patch the router module instead.
"""

from __future__ import annotations

from modules.api.audit import router as audit_router
from modules.api.coherence import router as coherence_router
from modules.api.data import router as data_router
from modules.api.meta import router as meta_router
from modules.api.ml import router as ml_router
from modules.api.research import router as research_router
from modules.api.risk import router as risk_router
from modules.api.tca import router as tca_router
from modules.api.telegram import router as telegram_router

__all__ = [
    "audit_router",
    "coherence_router",
    "data_router",
    "meta_router",
    "ml_router",
    "research_router",
    "risk_router",
    "tca_router",
    "telegram_router",
]
