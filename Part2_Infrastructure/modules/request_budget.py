"""ASGI propagation of the web proxy's fixed request-budget classes."""

from __future__ import annotations

import re
import time
import uuid

from fastapi.responses import JSONResponse

from modules.api.errors import backend_error_payload
from modules.backend_runtime import (
    BUDGET_CLASS_HEADER,
    BUDGETS_MS,
    REMAINING_BUDGET_HEADER,
    REQUEST_ID_HEADER,
    BackendDeadlineExceeded,
    BackendSaturated,
    RequestBudget,
    _request_budget,
)

_REQUEST_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")


class RequestBudgetMiddleware:
    """Validate the Next proxy's fixed budget class and bind it to reads."""

    def __init__(self, app) -> None:
        self.app = app

    @staticmethod
    def _headers(scope) -> dict[str, str]:
        return {
            key.decode("latin1").lower(): value.decode("latin1")
            for key, value in scope.get("headers", [])
        }

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = self._headers(scope)
        candidate = headers.get(REQUEST_ID_HEADER.lower(), "").strip()
        request_id = candidate if _REQUEST_ID.fullmatch(candidate) else str(uuid.uuid4())
        requested = headers.get(BUDGET_CLASS_HEADER.lower(), "H2").upper()
        budget_class = requested if requested in BUDGETS_MS else "H2"
        ceiling = BUDGETS_MS[budget_class]
        try:
            remaining_ms = min(
                ceiling,
                max(0, int(headers.get(REMAINING_BUDGET_HEADER.lower(), ceiling))),
            )
        except ValueError:
            remaining_ms = ceiling
        now = time.monotonic()
        budget = RequestBudget(request_id, budget_class, now, now + remaining_ms / 1000.0)
        token = _request_budget.set(budget)
        response_started = False

        async def send_wrapper(message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                elapsed_ms = (time.monotonic() - now) * 1000.0
                response_headers = list(message.get("headers", []))
                response_headers.extend([
                    (REQUEST_ID_HEADER.lower().encode(), request_id.encode()),
                    (BUDGET_CLASS_HEADER.lower().encode(), budget_class.encode()),
                    (
                        REMAINING_BUDGET_HEADER.lower().encode(),
                        str(round(budget.remaining_s() * 1000)).encode(),
                    ),
                    (
                        b"server-timing",
                        (
                            f"backend;dur={elapsed_ms:.3f}, queue;dur={budget.queue_wait_ms:.3f}, "
                            f"blocking;dur={budget.blocking_ms:.3f}"
                        ).encode(),
                    ),
                ])
                message["headers"] = response_headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except (BackendDeadlineExceeded, BackendSaturated) as exc:
            if response_started:
                raise
            deadline = isinstance(exc, BackendDeadlineExceeded)
            response = JSONResponse(
                status_code=504 if deadline else 503,
                headers={} if deadline else {"Retry-After": "1"},
                content=backend_error_payload(exc, budget, deadline=deadline),
            )
            await response(scope, receive, send_wrapper)
        finally:
            _request_budget.reset(token)
