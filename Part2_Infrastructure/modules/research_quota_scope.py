"""The tenant bound: which rows a research read may see.

The second half of `modules.research_quota`, which holds the argument for why
these two are one decision applied at one door. They are two files because the
pair crossed the 400-line ceiling `tests/test_file_size.py` enforces, and the
refusal vocabulary is imported from there rather than restated so that a caller
handling a `Bound` never has to ask which module minted it.

WHAT IT IS FOR
--------------

`supabase/migrations/20260822090000_research_tenant_scope.sql` gives the two
retrieval RPCs an optional `filter_desk_id`. Before it, a search spanned every
row in `research_documents` whoever wrote them — the RLS policy on that table is
keyed on `user_id`, the writer sets `user_id` on nothing, and the gateway reads
with the service role key, which bypasses RLS entirely. Three ways for the same
predicate not to run.

This module answers two questions for the routes: what scope should this read
carry, and can the retrieval in THIS deployment carry it. The second exists
because the answer can be no during a rollout, and because both of the obvious
things to do about that are wrong — see `scope_parameter_accepted`.
"""

from __future__ import annotations

import inspect
from typing import Any

from config import settings

# `_env_flag` is reached across the split deliberately, in the shape
# `research_rag.retrieval` already uses for `research_bm25._unavailable`: the
# rejected alternative is a second four-line parser here, which drifts the day
# one of them learns another spelling of "true" and leaves two settings files
# disagreeing about what "on" means.
from modules.research_quota import SCOPE_UNAVAILABLE, Bound, _env_flag

#: Off by default, and the default is the point: with this unset the routes pass
#: no tenant argument and retrieval behaves exactly as it does today. It is
#: switched on once `modules/research_rag/retrieval.py` carries `desk_id`
#: through to the RPC that `supabase/migrations/20260822090000_research_tenant_scope.sql`
#: added the parameter to. A single-desk deployment never needs it.
SCOPE_TO_DESK = _env_flag("RESEARCH_SCOPE_TO_DESK", False)

#: The one spelling of the retrieval-side parameter name, so the probe below and
#: the call sites cannot drift apart. `retrieval.search(query, ..., desk_id=...)`
#: forwards it to the RPC as `filter_desk_id`.
SCOPE_PARAM = "desk_id"


def desk_scope() -> str | None:
    """The desk id reads must be confined to, or None for today's behaviour.

    `settings.supabase_desk_id` rather than a new setting of its own, because it
    is the SAME id `modules/research_rag/writer.py` stamps on every row it
    inserts. A second setting would be a second answer to "whose corpus is
    this", and the first time the two disagreed the search would return nothing
    and look like an empty corpus.

    Not keyed on the caller yet, and that is stated rather than implied: every
    web request authenticates against one shared gateway token, so `trader_identity`
    resolves to `web:token` or `web:anonymous` and there is no per-user identity
    to key on. This function is where that mapping goes the day there is one;
    what it can do today is stop a read from spanning OTHER desks' rows, which
    is the gap that exists on a shared Supabase project.
    """
    if not SCOPE_TO_DESK:
        return None
    return settings.supabase_desk_id or None


def scope_parameter_accepted(callee: Any) -> bool:
    """Whether `callee` can actually carry the tenant scope.

    Asked rather than assumed, because the retrieval half of this change lands
    in a file this module does not own. Passing `desk_id=` to a `search` that
    does not take it is a `TypeError` — a 500 on every search — and NOT passing
    it while `SCOPE_TO_DESK` is on is worse: the route would serve unscoped rows
    to an operator who had switched scoping on and been told nothing. So the
    caller probes, and turns "configured but unenforceable" into a typed refusal
    rather than into either of those.

    `**kwargs` counts as accepting, which is the one false positive this can
    produce; a retrieval method that swallowed the argument would be a defect in
    that file, and `tests/test_research_security_scope.py` pins the parameter by
    name against the real module so the contract is checked somewhere.
    """
    try:
        signature = inspect.signature(callee)
    except (TypeError, ValueError):
        return False
    for parameter in signature.parameters.values():
        if parameter.name == SCOPE_PARAM or parameter.kind is parameter.VAR_KEYWORD:
            return True
    return False


def scope_bound(desk_id: str, where: str) -> Bound:
    """The refusal for "scoping is on and this deployment cannot apply it".

    `where` names the callee that could not carry the argument, because that is
    the one piece of information the operator needs and cannot get from the
    setting: which half of the chain is behind.
    """
    return Bound(
        SCOPE_UNAVAILABLE,
        f"RESEARCH_SCOPE_TO_DESK is on, so this read must be confined to desk {desk_id}, "
        f"and `{where}` in this deployment cannot carry a tenant scope — so the search "
        "was NOT run. Serving it unscoped would return every desk's documents under a "
        "setting that says otherwise.",
    )
