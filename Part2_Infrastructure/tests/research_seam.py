"""The shared harness for the two stage-seam suites. Not a test file itself.

`test_research_stage_seam.py` (the re-ranker) and
`test_research_generation_seam.py` (the generator) exercise the same corrective
path over the same corpus, and both would otherwise carry the same hundred lines
of harness. This repository's own conftest records what happens when they do not
share: "these lived in `test_telegram.py`, which meant a second Telegram test
file could not use them".

What lives here are PLAIN FUNCTIONS and classes, never pytest fixtures, and that
is deliberate. `tests/conftest.py` was the rejected home: this harness swaps
`research_rerank`'s and `research_generate`'s settings, and an autouse fixture
in the global conftest would do that under sixteen hundred tests that have never
heard of either module. Importing fixtures across test modules was the other
rejected alternative — a fixture imported by name and then taken as a parameter
reads to every linter as a redefinition, and silencing that on every signature
buys the duplication back in noqa comments. So each suite declares its own
four-line fixtures over the helpers below.

**Everything faked here is the outside world, and nothing else.** The two seams
under test — `research_crag` to `research_rerank`, and `research_crag` to
`research_generate` — run as the real modules calling the real modules. What is
substituted is the corpus (Supabase), the ONNX cross-encoder and the Gemini SDK,
the last two at exactly the boundaries those modules document as their own test
seams, because CI is network-free and neither optional extra is installed.
Faking there is what lets the REAL fallback, the REAL fences and the REAL prompt
run; faking one step higher would prove nothing, which is the whole argument of
`tests/test_research_contract.py`.
"""

from __future__ import annotations

import json
import threading
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from modules import research_crag as crag
from modules import research_generate as gen
from modules import research_rerank as rr
from modules.audit import AuditLog

NOW = datetime(2026, 8, 20, tzinfo=UTC)
QUERY = "BTCUSDT ma_crossover drawdown sweep"


def row(ref: str, **over) -> dict:
    """One row shaped like `match_research_documents_hybrid` returns."""
    base = dict(
        id=f"11111111-0000-0000-0000-{ref:>012}",
        kind="backtest_run", source_ref=ref,
        symbol="BTCUSDT", strategy="ma_crossover",
        occurred_at=(NOW - timedelta(days=1)).isoformat(),
        title="BTCUSDT ma_crossover drawdown sweep",
        body="Deflated Sharpe 0.29 over 74 combinations.",
        similarity=0.95, vector_rank=1, lexical_rank=1,
    )
    base.update(over)
    return base


def off_topic(ref: str, **over) -> dict:
    """A document with nothing to do with the query, fused first anyway.

    Old, low similarity, no shared vocabulary. This is the situation the
    cross-encoder exists for: RRF only ever sees RANK, so it cannot tell this
    row apart from the one below it that actually answers the question.
    """
    base = dict(
        title="Sourdough proofing schedule", body="Bulk fermentation notes.",
        symbol=None, strategy=None, similarity=0.30, vector_rank=1, lexical_rank=None,
        occurred_at=(NOW - timedelta(days=400)).isoformat(),
    )
    return row(ref, **{**base, **over})


IRRELEVANT = off_topic("sourdough")
STALE = off_topic("stale")
#: The same off-topic document, found by BOTH retrievers — so agreement no
#: longer separates it from the relevant row and only the cross-encoder can.
DECOY = off_topic("decoy", lexical_rank=1)
RELEVANT = row("sweep-1", vector_rank=2, lexical_rank=2)
#: A mid-band first round: both retrievers, middling similarity, and it names a
#: symbol and a strategy the query does not — so the rewrite fires.
NEAR = [row("near-0", similarity=0.62, occurred_at=(NOW - timedelta(days=30)).isoformat())]


def grounded(*docs: dict) -> str:
    """An answer citing only supplied ids — the one shape the fences pass."""
    return " ".join(f"It ran [doc:{d['id']}]." for d in docs)


class Corpus:
    """The Supabase side of the wire, and nothing else.

    `rounds` is a list of match lists served to successive searches, so a test
    can say "near-miss first, better after the rewrite". `widths` records the
    `match_count` each call asked for, which is how the retrieve-wide claim gets
    checked rather than assumed.

    `graph_widths` is the same record for the OTHER arm, and it is separate on
    purpose: the two arms are widened by different rules — the cross-encoder
    narrows what `search` returns and nothing narrows what `connected` returns
    — so one list holding both counts could not tell a correctly widened
    retrieval from a graph traversal that was widened by accident.
    """

    def __init__(self, rounds, *, connected=None, corpus_size=412):
        self.rounds = list(rounds)
        self.connected_rows = connected or []
        self.corpus_size = corpus_size
        self.queries: list[str] = []
        self.widths: list[int] = []
        self.graph_widths: list[int] = []
        self.scopes: list[str | None] = []

    async def search(self, query, match_count=3, kind=None, desk_id=None):
        self.queries.append(query)
        self.widths.append(match_count)
        self.scopes.append(desk_id)
        index = min(len(self.queries) - 1, len(self.rounds) - 1)
        return {
            "state": "ok",
            "matches": [dict(m) for m in self.rounds[index]],
            "corpus_size": self.corpus_size,
        }

    async def connected(self, document_id, match_count=3, max_depth=2, desk_id=None):
        self.graph_widths.append(match_count)
        self.scopes.append(desk_id)
        return {"state": "ok", "connected": list(self.connected_rows)}


class FakeCrossEncoder:
    """A scorer that likes the desk's own vocabulary. Records where it ran.

    The thread is recorded because it is a property of this WIRING rather than
    of the model: `rerank` is CPU-bound and this process also serves pre-trade
    risk checks, so a re-rank left on the event loop is tens of milliseconds a
    risk decision waited for.
    """

    calls: list[dict] = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def rerank(self, query, documents):
        FakeCrossEncoder.calls.append({
            "query": query,
            "documents": list(documents),
            "on_main_thread": threading.current_thread() is threading.main_thread(),
        })
        return [2.0 if "ma_crossover" in text else 0.1 for text in documents]


class FakeSdk:
    """Stands in for `google-genai` at `research_generate`'s own boundary.

    Records every call, so a test can assert one was NOT made — the only way to
    prove a fence fired before the money was spent rather than after it.
    """

    def __init__(self, text="", usage=None):
        self.text, self.usage = text, usage
        self.calls: list[dict] = []

    def Client(self, *, api_key):  # the SDK spells it this way
        return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(
            generate_content=self._generate,
        )))

    async def _generate(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents})
        return SimpleNamespace(text=self.text, usage_metadata=self.usage)


#: The SDK's config constructors, faked as plain namespaces so the real `_call`
#: still runs and the bounds it applies stay observable.
FAKE_TYPES = SimpleNamespace(
    GenerateContentConfig=lambda **kw: SimpleNamespace(**kw),
    HttpOptions=lambda **kw: SimpleNamespace(**kw),
)

USAGE = SimpleNamespace(prompt_token_count=812, candidates_token_count=96, total_token_count=908)


def absent(monkeypatch) -> None:
    """Neither extra configured, and no encoder remembered from another test.

    `settings` is a frozen dataclass, so the whole object is swapped rather than
    a field patched. This is the DEFAULT deployment and it is deliberately the
    baseline every test starts from: both modules report their own absence and
    the desk answers exactly as it did before either existed.
    """
    monkeypatch.setattr(rr, "_ENCODER", None)
    monkeypatch.setattr(rr, "_LOAD_ERROR", None)
    monkeypatch.setattr(rr, "_LOAD_ERROR_STATE", None)
    monkeypatch.setattr(rr, "_LOADED_PATH", None)
    monkeypatch.setattr(rr, "settings", SimpleNamespace(rerank_model_path=""))
    monkeypatch.setattr(gen, "settings", SimpleNamespace(
        gemini_api_key="", gemini_model="test-model",
    ))
    FakeCrossEncoder.calls.clear()


def install_reranker(monkeypatch) -> type[FakeCrossEncoder]:
    """Configure a re-ranker and give it a scorer at the module's own boundary.

    Substituted at `_import_cross_encoder` — the one function `research_rerank`
    documents as its test seam — so the caching, the state machine and the
    fallback around it are all the real thing.
    """
    monkeypatch.setattr(rr, "settings", SimpleNamespace(rerank_model_path="/models/bge"))
    monkeypatch.setattr(rr, "_import_cross_encoder", lambda: (FakeCrossEncoder, None))
    return FakeCrossEncoder


def install_model(monkeypatch, text: str = "", usage=USAGE) -> FakeSdk:
    """Install a fake provider at `_sdk`; hand back the recorder.

    Patched at `_sdk` rather than at `_call`, so the real `_call`, the real
    prompt, the real timeout and the real citation fence all still run.
    """
    fake = FakeSdk(text=text, usage=usage)
    monkeypatch.setattr(gen, "settings", SimpleNamespace(
        gemini_api_key="test-key-not-a-real-one", gemini_model="test-model",
    ))
    monkeypatch.setattr(gen, "_sdk", lambda: (fake, FAKE_TYPES, None))
    return fake


def open_ledger(path) -> SimpleNamespace:
    """A real `AuditLog`, never a recorder that accepts `**kwargs`.

    `ResearchRouter._write` carries the scar: it once passed the event name as
    `kind=`, which no `AuditLog` has ever accepted, so every write raised
    against the real store and passed against a fake whose signature the test
    itself had chosen. This is the production class on a throwaway file, and the
    rows are read back out of DuckDB.
    """
    log = AuditLog(path)

    def read(event: str, detail: str) -> list[dict]:
        return [
            {**r, "payload": json.loads(r["payload"])}
            for r in log.query(
                "SELECT event, actor, detail, payload FROM risk_events "
                "WHERE event = ? AND detail = ? ORDER BY ts",
                (event, detail),
            )
        ]

    return SimpleNamespace(log=log, read=read)


async def answer(corpus, query=QUERY, **kw):
    """The real `answer_from_corpus`, with the clock pinned. Never a stand-in."""
    return await crag.answer_from_corpus(corpus, query, now=NOW, **kw)
