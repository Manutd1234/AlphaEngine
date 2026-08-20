"""Walk the research graph from a terminal: associative recall over what this desk has done.

Hybrid search answers "what is similar to this"; it cannot answer "what is CONNECTED to this",
and the question worth building for is the second kind — *every run sharing this data_hash that
later tripped the breaker*. No keyword ranking answers that. It is a join over ``research_edges``,
the link table `modules/research_graph.persist_edges` writes from STRUCTURED columns with no LLM
in the ingest path, traversed by ``traverse_research_graph``: the recursive CTE from migration
20260820090500, capped at depth 4, refusing revisits, carrying the relation that reached each row.

CLAUDE IS A NARRATOR, NEVER THE RETRIEVAL. The traversal runs first, is deterministic, and IS the
answer; ``--narrate`` pipes the finished rows to the `claude` CLI for prose about them and the
rows stay on screen beside it, because a summary that replaces its evidence is how a reproducible
desk stops being one. An absent or failing `claude` is reported with its reason and the rows print
anyway — never a silent skip — and ``--json`` needs no narrator at all. Nothing in ``modules/`` or
``main.py`` imports this and nothing in the request path shells out to `claude`; no credential is
read from argv either, because argv lands in the process table and there is no ``--key`` flag.

Exit status: 0 answered, 1 answered in part, 2 could not be asked. Entry points, states, round trips
and the flags the schema cannot serve: docs/GRAPH_RECALL.md, which carries a worked invocation.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import settings  # noqa: E402

#: The enum from migration 20260820090400, duplicated for the reason `research_graph` duplicates it:
#: the database owns the constraint, and a bad value is refused here rather than sent. OUTCOME_ is
#: the directional half — the two relations that say "and then what happened".
RELATIONS = ("same_data", "same_symbol", "same_strategy", "same_regime", "followed_by", "promoted_to")
OUTCOME_RELATIONS = ("followed_by", "promoted_to")
DOC_COLUMNS = "id,kind,source_ref,symbol,strategy,interval,data_hash,occurred_at,title"

#: A value the corpus does not hold, or that this run could not read — never a zero. The budget caps
#: the rows handed to the narrator, so a wide walk cannot become an unbounded prompt.
DASH = "—"
DASH_NOTE = f"{DASH} marks a value this run could not read. It is not zero and not none."
NARRATION_BUDGET = 20_000
MARKS = {"ok": "●", "partial": "▲", "unavailable": "✕"}


@dataclass(frozen=True, slots=True)
class Recall:
    """Three states that never collapse. ``ok``: the graph was walked, and ``rows`` may be empty, which
    means "connected to nothing" and is an answer. ``partial``: a secondary read failed, so the rows are
    real and the field that could not be read is ``None``, never 0. ``unavailable``: the query could not
    be made and ``reason`` says why — the rows are not an empty list standing in for a failure.
    """
    state: str
    question: str
    rows: list[dict[str, Any]] = field(default_factory=list)
    reason: str | None = None
    notes: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {**asdict(self), "notes": list(self.notes), "row_count": len(self.rows)}


@dataclass(frozen=True, slots=True)
class Corpus:
    client: httpx.Client
    desk_id: str


@dataclass(frozen=True, slots=True)
class Narration:
    """``ok`` with text; ``absent``/``failed``/``skipped`` with a reason. Never silent."""
    state: str
    text: str | None = None
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


# -- transport --------------------------------------------------------------------------------- #
def open_client(*, url: str | None = None, key: str | None = None,
                transport: httpx.BaseTransport | None = None) -> tuple[httpx.Client | None, str | None]:
    """A PostgREST client, or ``None`` and the reason there is not one."""
    base = (url if url is not None else settings.supabase_url).rstrip("/")
    token = key if key is not None else settings.supabase_service_role_key
    if missing := [n for n, v in (("SUPABASE_URL", base), ("SUPABASE_SERVICE_ROLE_KEY", token)) if not v]:
        return None, (f"Supabase is not configured: {' and '.join(missing)} unset. The graph could not be "
                      "read, which is not the same fact as a graph that holds nothing.")
    headers = {"apikey": token, "Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return httpx.Client(base_url=base, timeout=settings.supabase_timeout_s, transport=transport,
                        headers=headers), None


def _rows(response: httpx.Response, what: str) -> tuple[list[dict[str, Any]] | None, str | None]:
    if response.status_code >= 300:
        why = ("this deployment predates migration 20260820090400 (the edge table) or 20260820090500 (the "
               "traversal function)") if response.status_code == 404 else "the corpus could not be read"
        return None, f"{what} returned HTTP {response.status_code} — {why}."
    try:
        return list(response.json() or []), None
    except ValueError:
        return None, f"{what} returned a body that is not JSON."


def _get(corpus: Corpus, path: str, params: dict[str, str]) -> tuple[list[dict[str, Any]] | None, str | None]:
    try:
        response = corpus.client.get(path, params={"desk_id": f"eq.{corpus.desk_id}", **params})
    except httpx.HTTPError as exc:
        return None, f"GET {path} failed: {type(exc).__name__}."
    return _rows(response, f"GET {path}")


def _documents(corpus: Corpus, params: dict[str, str]) -> tuple[list[dict[str, Any]] | None, str | None]:
    return _get(corpus, "/rest/v1/research_documents", {"select": DOC_COLUMNS, **params})


def _edges(corpus: Corpus, ids: set[str],
           relations: tuple[str, ...] = ()) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Every edge touching these documents, in EITHER direction — symmetric edges are stored once."""
    joined = ",".join(sorted(ids))
    params = {"select": "src_id,dst_id,relation,evidence", "or": f"(src_id.in.({joined}),dst_id.in.({joined}))"}
    if relations:
        params["relation"] = f"in.({','.join(relations)})"
    return _get(corpus, "/rest/v1/research_edges", params)


def _looks_like_uuid(ref: str) -> bool:
    parts = ref.split("-")
    return len(parts) == 5 and all(p and all(c in "0123456789abcdefABCDEF" for c in p) for p in parts)


def _counterpart(edge: dict[str, Any], identifier: str) -> str:
    return str(edge["dst_id"]) if str(edge["src_id"]) == identifier else str(edge["src_id"])


def _partial(question: str, rows: list[dict[str, Any]], key: str, reason: str) -> Recall:
    for row in rows:
        row[key] = None
    return Recall("partial", question, rows=rows, reason=reason, notes=(DASH_NOTE,))


def _none_found(question: str, what: str) -> Recall:
    return Recall("ok", question, notes=(f"No document in this desk's corpus carries {what}. The corpus "
                                         "was read and holds none of them; nothing failed.",))


# -- entry points ---------------------------------------------------------------------------- #
def from_run(corpus: Corpus, ref: str, question: str, *, depth: int = 2, limit: int = 20,
             relations: list[str] | None = None, kind: str | None = None) -> Recall:
    """Traverse out from one document, resolved by id or by ``source_ref``."""
    params: dict[str, str] = {"order": "occurred_at.desc", "limit": "1"}
    params["id" if _looks_like_uuid(ref) else "source_ref"] = f"eq.{ref}"
    if kind:
        params["kind"] = f"eq.{kind}"
    found, reason = _documents(corpus, params)
    if found is None:
        return Recall("unavailable", question, reason=reason)
    if not found:
        return _none_found(question, f"the reference {ref}" + (f" with kind {kind}" if kind else ""))

    payload: dict[str, Any] = {"start_id": found[0]["id"], "max_depth": max(1, min(depth, 4)),
                               "match_count": max(1, min(limit, 100))}
    if relations:
        payload["relations"] = list(relations)
    try:
        response = corpus.client.post("/rest/v1/rpc/traverse_research_graph", json=payload)
    except httpx.HTTPError as exc:
        return Recall("unavailable", question, reason=f"RPC traverse_research_graph failed: {type(exc).__name__}.")
    walked, reason = _rows(response, "RPC traverse_research_graph")
    if walked is None:
        return Recall("unavailable", question, reason=reason)
    start = found[0]
    notes = (f"start: {_cell(start.get('kind'))} ref {_cell(start.get('source_ref'))} {_cell(start.get('title'))}",)
    if not walked:
        notes += ("The traversal ran and reached nothing: this document has no edges at that depth. That "
                  "is an answer, not a failure.",)
    return Recall("ok", question, rows=walked, notes=notes)


def over_data_hash(corpus: Corpus, digest: str, question: str, *, limit: int = 20) -> Recall:
    """Every run over the same bars, each with what the graph says followed it. Bounded reads.

    The runs are still the answer when a later read fails: ``outcomes`` is then ``None``, never
    ``[]``, and the reason says which read did not happen.
    """
    runs, reason = _documents(corpus, {"data_hash": f"eq.{digest}", "order": "occurred_at.asc",
                                       "limit": str(max(1, limit))})
    if runs is None:
        return Recall("unavailable", question, reason=reason)
    if not runs:
        return _none_found(question, f"data_hash {digest}")

    ids = {str(row["id"]) for row in runs}
    edges, edge_reason = _edges(corpus, ids, OUTCOME_RELATIONS)
    if edges is None:
        return _partial(question, runs, "outcomes", f"The {len(runs)} runs below are the complete set over "
                        f"that hash. What followed each of them is unknown: {edge_reason}")
    others: dict[str, dict[str, Any]] = {}
    wanted = {str(edge[end]) for edge in edges for end in ("src_id", "dst_id")} - ids
    if wanted:
        far, far_reason = _documents(corpus, {"id": f"in.({','.join(sorted(wanted))})"})
        if far is None:
            return _partial(question, runs, "outcomes", f"{len(edges)} downstream edges exist but the documents "
                            f"they point at could not be read: {far_reason}")
        others = {str(row["id"]): row for row in far}

    for row in runs:
        me = str(row["id"])
        row["outcomes"] = [{"relation": e["relation"], "evidence": e.get("evidence"),
                            "document": others[_counterpart(e, me)]} for e in edges
                           if me in (str(e["src_id"]), str(e["dst_id"])) and _counterpart(e, me) in others]
    return Recall("ok", question, rows=runs,
                  notes=(f"{len(runs)} runs over the same bars. A row with a followed_by incident is a run that "
                         "later tripped the breaker; results that disagree over one data_hash disagree about "
                         "method, not data.",))


def by_column(corpus: Corpus, column: str, value: str, question: str, *, limit: int = 20) -> Recall:
    """Documents on one linkable column, with the edge count each carries."""
    docs, reason = _documents(corpus, {column: f"eq.{value}", "order": "occurred_at.desc",
                                       "limit": str(max(1, limit))})
    if docs is None:
        return Recall("unavailable", question, reason=reason)
    if not docs:
        return _none_found(question, f"{column} {value}")

    edges, edge_reason = _edges(corpus, {str(row["id"]) for row in docs})
    if edges is None:
        return _partial(question, docs, "edges", f"The {len(docs)} documents below are the complete set. "
                        f"How many edges each carries is unknown: {edge_reason}")
    for row in docs:
        me = str(row["id"])
        row["edges"] = sum(1 for e in edges if me in (str(e["src_id"]), str(e["dst_id"])))
    return Recall("ok", question, rows=docs,
                  notes=("Edge counts are entry points; traverse one of them with --from-run.",))


# -- rendering ------------------------------------------------------------------------------- #
def _cell(value: Any) -> str:
    return DASH if value is None or value == "" else str(value)


def _render_row(row: dict[str, Any]) -> list[str]:
    head = []
    if "depth" in row:
        head += [f"depth {_cell(row.get('depth'))}", f"via {_cell(row.get('arrived_by'))}",
                 f"on {_cell(row.get('evidence'))}"]
    if "edges" in row:
        head.append(f"edges {_cell(row.get('edges'))}")
    fields = "  ".join(_cell(row.get(k)) for k in ("kind", "source_ref", "symbol", "strategy", "occurred_at"))
    lines = [f"  {MARKS['ok']}  " + "  ".join(head), f"    {fields}"] if head else [f"  {MARKS['ok']}  {fields}"]
    lines.append(f"    {_cell(row.get('title'))}")
    if "outcomes" not in row:
        return lines
    if row["outcomes"] is None:
        return lines + [f"    → {DASH} what followed could not be read (the reason is above)"]
    if not row["outcomes"]:
        return lines + ["    → nothing downstream in the graph"]
    return lines + ["    → " + "  ".join((_cell(o.get("relation")), f"on {_cell(o.get('evidence'))}")
                                         + tuple(_cell((o.get("document") or {}).get(k))
                                                 for k in ("kind", "source_ref", "title")))
                    for o in row["outcomes"]]


def render(recall: Recall) -> str:
    out = [f"GRAPH RECALL  {recall.question}",
           f"{MARKS.get(recall.state, '○')} {recall.state}  {len(recall.rows)} rows"]
    out += ([f"  reason: {recall.reason}"] if recall.reason else [])
    out += [f"  {note}" for note in recall.notes] + [""]
    for row in recall.rows:
        out += _render_row(row)
    if not recall.rows and recall.state != "unavailable":
        out.append("  (no rows)")
    return "\n".join(out)


# -- narration ------------------------------------------------------------------------------- #
def narration_prompt(recall: Recall) -> str:
    return ("You are narrating a deterministic graph traversal over a quant desk's research corpus. The rows "
            "below ARE the answer: do not add facts, do not re-rank them, do not speculate about causes. In at "
            "most 120 words of British English prose, say how these documents connect and what followed what. "
            f"Plain text, no emoji, no markdown.\n\nQuestion: {recall.question}\nState: {recall.state}\n\n"
            + json.dumps(recall.rows, indent=2, default=str)[:NARRATION_BUDGET])



def narrate(recall: Recall, *, which: Callable[[str], str | None] = shutil.which,
            timeout_s: float = 90.0) -> Narration:
    """Pipe a finished result to the `claude` CLI. Absence is a reported state, never a skip.

    Shelling out is the whole integration: no SDK, no npm package, no key on argv.
    """
    if not recall.rows:
        return Narration("skipped", reason=f"there are no rows to narrate ({recall.state}); prose over an "
                                           "empty result would describe nothing. The result above is complete.")
    binary = which("claude")
    if binary is None:
        return Narration("absent", reason="the `claude` CLI is not on PATH, so nothing narrated this result. "
                                          "The rows above are the complete answer and did not need it.")
    try:
        done = subprocess.run([binary, "-p"], input=narration_prompt(recall),  # noqa: S603
                              capture_output=True, text=True, timeout=timeout_s, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        return Narration("failed", reason=f"the `claude` CLI could not be run ({type(exc).__name__}). "
                                          "The rows above stand.")
    stderr = (done.stderr or "").strip().splitlines()
    if done.returncode != 0:
        return Narration("failed", reason=f"`claude` exited {done.returncode}: "
                                          f"{stderr[0] if stderr else 'no stderr'}. The rows above stand.")
    if not (done.stdout or "").strip():
        return Narration("failed", reason="`claude` exited 0 and printed nothing. The rows above stand.")
    return Narration("ok", text=done.stdout.strip())


def render_narration(narration: Narration, rows: int) -> str:
    if narration.state != "ok":
        return f"\n{MARKS['unavailable']} NARRATION NOT AVAILABLE  {narration.reason}"
    return (f"\nNARRATION  Claude, over the {rows} rows above. Prose about those rows, not a retrieval "
            f"and not evidence; the rows are the answer.\n{narration.text}")


# -- CLI ------------------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="graph_recall.py",
        description="Walk research_edges. Traversal first, narration optional and marked.",
        epilog="No credential is read from argv: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come from "
               "the environment, and `claude` manages its own auth.")
    entry = parser.add_mutually_exclusive_group(required=True)
    for flag, meta, note in (("--from-run", "ID", "a document id, or a run's source_ref"),
                             ("--data-hash", "HASH", "every run over the same bars"),
                             ("--incident", "ORDER_ID", "an incident's source_ref is its order id"),
                             ("--symbol", "SYMBOL", "documents on one symbol"),
                             ("--strategy", "NAME", "documents on one strategy")):
        entry.add_argument(flag, metavar=meta, help=note)
    parser.add_argument("--depth", type=int, default=2, help="hops; the CTE caps this at 4")
    parser.add_argument("--relation", action="append", choices=RELATIONS,
                        help="restrict a traversal to one relation; repeatable")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--json", action="store_true", help="machine-readable; never needs --narrate")
    parser.add_argument("--narrate", action="store_true", help="prose over the rows, if `claude` is on PATH")
    return parser


def question_for(args: argparse.Namespace) -> str:
    if args.from_run:
        return f"what {args.from_run} is linked to, {max(1, min(args.depth, 4))} hops out"
    if args.data_hash:
        return f"every run over data_hash {args.data_hash}, and what followed each"
    if args.incident:
        return f"what led to the incident on order {args.incident}"
    column, value = ("symbol", args.symbol) if args.symbol else ("strategy", args.strategy)
    return f"documents on {column} {value}, and how connected each is"


def recall_for(corpus: Corpus, args: argparse.Namespace) -> Recall:
    question = question_for(args)
    if args.from_run:
        return from_run(corpus, args.from_run, question, depth=args.depth, limit=args.limit, relations=args.relation)
    if args.data_hash:
        return over_data_hash(corpus, args.data_hash, question, limit=args.limit)
    if args.incident:
        return from_run(corpus, args.incident, question, depth=args.depth, limit=args.limit,
                        relations=args.relation, kind="risk_incident")
    column, value = ("symbol", args.symbol) if args.symbol else ("strategy", args.strategy)
    return by_column(corpus, column, value, question, limit=args.limit)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    client, reason = open_client()
    if client is None:
        result = Recall("unavailable", question_for(args), reason=reason)
    else:
        with client:
            result = recall_for(Corpus(client, settings.supabase_desk_id), args)
    narration = narrate(result) if args.narrate else None
    if args.json:
        print(json.dumps({**result.as_dict(), "narration": narration.as_dict() if narration else None},
                         indent=2, default=str))
    else:
        print(render(result))
        if narration is not None:
            print(render_narration(narration, len(result.rows)))
    return {"ok": 0, "partial": 1}.get(result.state, 2)



if __name__ == "__main__":
    raise SystemExit(main())
