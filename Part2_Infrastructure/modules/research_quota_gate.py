"""The door the two guarded research routes go through.

`modules.research_quota` holds the bounds themselves — a rate, a spend window, a
tenant scope — as plain objects with no idea that HTTP exists, which is what
lets them be tested without a client. This module is the other half: what those
bounds look like on the wire, which callee chain has to be probed before a
scope can be claimed, and the correlation id that ties one request to the rows
it wrote. It carries the `research_quota` prefix because it is the wiring of
those bounds and shares their vocabulary; nothing here decides anything.

It lives beside them rather than inside `modules/api/research.py` for the
reason `tests/test_file_size.py` exists: that router is a page of route
declarations, and a hundred and forty lines of door in front of them makes the
routes the thing you scroll past.

THE SEARCH LEDGER ROW IS HERE FOR A DIFFERENT REASON. It is not a bound. It is
here because it needs the same correlation id the bounds' refusals and `/ask`'s
plan rows carry, and an id minted in two places is two ids.
"""

from __future__ import annotations

import logging
import math
import uuid
from typing import Any

from fastapi.responses import JSONResponse

from modules.audit import get_audit
from modules.research_quota import SCOPE_UNAVAILABLE, Bound
from modules.research_quota_scope import (
    SCOPE_PARAM,
    desk_scope,
    missing_desk_bound,
    scope_bound,
    scope_parameter_accepted,
)
from modules.research_router import ResearchRouter
from modules.schemas_research import ResearchBoundRefusal

log = logging.getLogger("alphaengine.api.research")

SEARCH_ROUTE = "/api/research/rag/search"
ASK_ROUTE = "/api/research/rag/ask"

#: Where the correlation id is published on `/ask`.
#:
#: A header rather than a body field, and not by preference: `ResearchAnswer` is
#: `research_crag`'s model, and the id belongs on the same object that carries
#: the grade. Until it can go there, a header is the one place on this response
#: a reader can be handed the id WITHOUT this route inventing a second answer
#: shape for `/ask`. `/search` publishes it in both places, because that
#: response model is this plane's own.
CORRELATION_HEADER = "X-Research-Correlation-Id"

#: What a bound refuses with, documented on both routes so the shape is in
#: `/docs` rather than only in the code that returns it.
BOUND_RESPONSES: dict[int | str, dict[str, Any]] = {
    429: {"model": ResearchBoundRefusal, "description": "Rate or spend bound refused the request"},
    503: {"model": ResearchBoundRefusal, "description": "A configured tenant scope could not be applied"},
}


def refusal_response(
    bound: Bound,
    route: str,
    query: str,
    *,
    spend: dict[str, Any] | None = None,
) -> JSONResponse:
    """A bound's refusal, as HTTP. Never a 500.

    429 for the two spend bounds and 503 for the scope one: "come back in a
    minute" and "this deployment cannot do that" are different instructions, and
    a client that retries a 503 forever is a client the wrong status code made.
    `Retry-After` is set only when there IS a time to give — an integer, since
    the header's seconds form is one, and rounded UP so a client obeying it to
    the second does not arrive one token early and get refused again.
    """
    status = 503 if bound.state == SCOPE_UNAVAILABLE else 429
    headers = (
        {"Retry-After": str(max(1, math.ceil(bound.retry_after_s)))}
        if bound.retry_after_s is not None
        else {}
    )
    body = ResearchBoundRefusal(
        state=bound.state, route=route, query=query, reason=bound.reason,
        retry_after_s=bound.retry_after_s, spend=spend,
    )
    return JSONResponse(status_code=status, content=body.model_dump(mode="json"), headers=headers)


def scope_for(callees: tuple[Any, ...]) -> tuple[str | None, Bound | None, dict[str, Any]]:
    """The tenant scope this read must carry, or the bound that refuses it.

    `(None, None, {})` is the unconfigured deployment and it is the common path:
    `RESEARCH_SCOPE_TO_DESK` is off by default, nothing is passed, and retrieval
    behaves exactly as it did before the predicate existed.

    Every callee in the chain is probed, not just the first. `/ask` retrieves
    through `answer_from_corpus`, which retrieves through `rag.search`, so a
    `search` that had learned the argument while the corrective path had not
    would leave `/ask` running unscoped under a setting that says it is scoped —
    the exact shape of "tenancy is nominal" this predicate exists to end.
    """
    desk = desk_scope()
    if desk is None:
        return None, None, {}
    if not desk:
        return desk, missing_desk_bound(), {}
    for callee in callees:
        if not scope_parameter_accepted(callee):
            return desk, scope_bound(desk, getattr(callee, "__name__", "retrieval")), {}
    return desk, None, {SCOPE_PARAM: desk}


def correlated_router(audit: Any) -> tuple[ResearchRouter, str | None]:
    """A router for one request, and the id its ledger rows will carry.

    The id is MINTED here and handed to the router rather than read back from
    it, so the plan row, the tool-call rows and the generation row all carry the
    same one: they are written at three points of one request, and the only
    thing that can tie them together is a value that existed before any of them.

    The `TypeError` path is a rollout, not a guess. A router that does not yet
    take a correlation id is constructed without one, and the id reported is
    then whatever that router says its own is — None if it says nothing, NEVER
    the minted value. Reporting an id no row carries would send a reader
    hunting the ledger for rows that do not exist, which is worse than telling
    them there is no id.
    """
    minted = uuid.uuid4().hex
    try:
        built = ResearchRouter(audit=audit, correlation_id=minted)
    except TypeError:
        return ResearchRouter(audit=audit), None
    return built, getattr(built, "correlation_id", minted)


def record_search(query: str, payload: dict[str, Any]) -> str | None:
    """One `research_search` row, in the shape `ResearchRouter._write` writes.

    `/ask` has written a plan row, a row per tool call and a generation row
    since the corrective path landed. `/search` — the other half of the
    retrieval traffic, and the half a workspace calls on every panel open —
    wrote nothing at all, so an auditor reading the ledger saw a desk that only
    ever asked graded questions. Same `actor="research"` and the same `detail`
    truncation, so both kinds of row come out of one query.

    Returns the id the row carries, or None when no row was written. A ledger
    that is down must not fail a read — that is the router's rule and it holds
    here — but it must not be REPORTED as having recorded something either, so
    the id comes back only from the path that actually wrote one.
    """
    audit = get_audit()
    if audit is None:
        return None
    correlation = uuid.uuid4().hex
    try:
        audit.record_risk_event(
            "research_search",
            severity="info",
            actor="research",
            detail=query[:200],
            payload={"correlation_id": correlation, **payload},
        )
    except Exception:  # noqa: BLE001 - a ledger that is down must not stop a read
        log.warning("research_search not recorded", exc_info=True)
        return None
    return correlation
