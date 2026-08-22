"""Where a chart's PIXELS live once the job that drew them is gone. The read half.

`modules/research_generate_vision.py` shows the equity curve to the model while
it answers, and it was MEASURED reading a -34% drawdown injection back off those
pixels. Until this module existed the bytes had exactly one home: the finished
`JobRecord` in the memory of the process that ran the sweep. The resolver walked
corpus row -> ``<job id>:<chart>`` -> `modules.jobs` -> ``result[<png key>]``,
and answered ``job_not_retained`` whenever that record was not in THIS process.

That state is honest and it was also, on any real deployment, the usual answer.
With ``REDIS_URL`` set the work runs in a Celery worker; a restart empties the
queue's dict; a second gateway replica never held the record at all. So the
multimodal path worked on a laptop and was absent everywhere it mattered — a
capability whose only caller is the developer's machine.

`supabase/migrations/20260822110000_research_chart_images.sql` carries the whole
storage argument — why a SIDE TABLE rather than a column on `research_documents`
(the hard constraint: no retrieval projection may ever be able to name these
bytes), why Storage is an open door rather than taken today, and why the table is
granted to nobody. `research_image_store_write` is the ingest half; this file is
`locate`, the three sources it tries, and the module state they share.

ONE MAP, TWO HALVES, SO THEY CANNOT DISAGREE
--------------------------------------------

`CHART_PNG_FIELDS` is the only statement of which chart has a rendered image.
The write path stores exactly these; the read path is `research_generate_vision.
CHART_IMAGE_KEYS`, which IS this object rather than a copy of it. So an image
cannot be stored that no reader can use, and a reader cannot ask for one nobody
was ever told to store — a class of drift that two dicts spelled the same way
would have made invisible. (`modules/research_image_ingest` holds a third copy
for the CLIP embedding arm; that file is not this change's to edit, and the
duplication is written down here rather than left to be discovered.)

THE ONE BLOCKING CALL, AND WHY IT IS HERE
-----------------------------------------

`_fetch` is a SYNCHRONOUS HTTP GET, and on the gateway it runs on the event
loop's thread. That is a real cost and it is not hidden.

`research_image_ingest._ENCODE_BULKHEAD` states this desk's rule in one line:
"Research may wait; risk may not" — the pre-trade checks share this process and
their budget is microseconds, which is why a CLIP forward pass measured in tens
of milliseconds was pushed off the loop. The same reasoning says a network round
trip belongs off the loop too.

It cannot go off the loop from here. `resolve` is synchronous, and the async
caller that would have to `await` a hydration step is `research_generate.
generate`, whose one line would be ``documents = await hydrate(documents)``.
That is the correct end state and it is written down as owed. Until it lands, a
synchronous function cannot await anything, and the alternatives were both worse
than the stall:

* SCHEDULE the fetch and report "not in time" for this answer, attaching on the
  next identical question. Non-blocking, honest, and it means the first person
  to ask after a restart never sees the chart — the feature would still be
  absent on the deployment that scales, just with a nicer name for it;
* PREFETCH every chart row that retrieval returns. That pulls image bytes for
  searches that will never generate an answer, which is the hard constraint's
  own spirit arriving through a side door.

So the stall is taken, and it is bounded on three sides rather than trusted:

* ``RESEARCH_CHART_IMAGE_FETCH_TIMEOUT_MS`` (1200 ms, and 0 DISABLES the fetch
  outright for an operator who would rather have the latency than the picture);
* an in-process LRU, so the stall is paid at most once per chart per process;
* the WRITE path warming that same LRU, so a gateway that ingested the sweep
  never fetches at all — the stall is a restart-and-replica cost, not a per-
  answer one, and it lands on a request that is about to spend twenty to thirty
  seconds inside a model call.

What is MEASURED here is the payload, not the round trip: 150,111 bytes decoded,
200,148 base64 characters, from a real `backtester.plots.plot_equity_curve` over
800 bars. The round trip to a hosted Supabase is not measured — this desk's tests
are offline by construction — so the bound below is a TIMEOUT, not a promise.
"""

from __future__ import annotations

import logging
import os
import threading
from collections import OrderedDict
from typing import Any

import httpx

from config import settings

log = logging.getLogger("alphaengine.research_image_store")

TABLE = "/rest/v1/research_chart_images"

#: The private key a queued document carries its PNG under, popped by
#: ``writer._index_one`` before the row is inserted. Underscored like
#: ``_retrieve_after`` and ``_image_png`` for the same reason: it is an
#: instruction to the drain, not a column, and a key that reached PostgREST
#: would be a 400 that dead-lettered the document.
CHART_PNG_FIELD = "_chart_png"

#: Chart name -> the key its rendered PNG occupies in a finished backtest
#: result. THE one statement of that mapping — see the module docstring on why
#: `research_generate_vision.CHART_IMAGE_KEYS` is this object and not a copy.
#:
#: Deliberately only the one entry that both halves exist for.
#: `research_chartdoc.describe_run` also produces ``drawdown``, ``walk_forward``
#: and ``gate_ladder`` documents and this desk draws none of them as their own
#: image — the drawdown is a subplot inside the equity figure, the other two are
#: text. ``heatmap_png`` goes the other way: the Sharpe surface IS rendered and
#: no chart document describes it, so there is nothing to cite an answer
#: against, and storing it would be bytes nothing can ever ask for.
CHART_PNG_FIELDS: dict[str, str] = {"equity_curve": "equity_curve_png"}

#: Wall clock for the one blocking GET, in milliseconds. ZERO DISABLES IT — the
#: job-queue fast path and the in-process cache still answer, and a chart that
#: neither holds reports the state it reported before this module existed. See
#: the module docstring for why the bound is a timeout rather than a promise.
#:
#: A module constant read from `os.environ` rather than a `Settings` field
#: because `config.py` is over its recorded length ceiling and may not gain a
#: line; `research_stages`, `research_image_arm` and `research_generate_vision`
#: set the same precedent.
FETCH_TIMEOUT_MS = int(os.environ.get("RESEARCH_CHART_IMAGE_FETCH_TIMEOUT_MS", "1200"))

#: How many base64 PNGs the process keeps in memory. FOUR, which at the measured
#: 200,148 characters per chart is roughly 800 kB — small beside the corpus queue
#: this process already holds, and enough that a reader working through one
#: sweep's charts pays the fetch once. Larger was rejected: this cache absorbs a
#: restart, it is not a store, and a store is what the table is for.
CACHE_MAX = int(os.environ.get("RESEARCH_CHART_IMAGE_CACHE_MAX", "4"))

#: Largest base64 payload this module will store or return, in characters. Four
#: megabytes is roughly twenty times the measured chart, so it does not trim a
#: desk figure; it stops something that is NOT one — a replaced job result, a
#: caller passing its own bytes — becoming an unbounded row and an unbounded
#: fetch. `research_image_ingest` bounds its input at the same number, likewise.
MAX_PNG_B64_CHARS = 4_000_000

# -- the states, and the sentence each one owes a reader --------------------- #
#
# These live here rather than in `research_generate_vision` because this module
# is what decides them; that module re-exports the names, so a caller still
# reads them off the one place it already imports. Every one is a different
# FACT with a different fix, which is the whole reason they are values and not
# prose a caller would have to match on.
IMAGE_ABSENT = "image_absent"
JOB_NOT_RETAINED = "job_not_retained"
JOB_UNFINISHED = "job_unfinished"
IMAGE_NOT_STORED = "image_not_stored"
IMAGE_STORE_UNREACHABLE = "image_store_unreachable"

REASONS: dict[str, str] = {
    IMAGE_ABSENT: "the run that produced this chart recorded no image for it",
    JOB_NOT_RETAINED: (
        "the job that drew this chart is not in this process's queue — a restart, a "
        "Celery worker, or another replica — and no stored image was reachable for it "
        "either, so the pixels are unreachable from here"
    ),
    JOB_UNFINISHED: "the job that drew this chart carries no result yet",
    IMAGE_NOT_STORED: (
        "the corpus keeps no image for this chart: it was indexed before the durable "
        "image store existed, or the sweep drew none. The document's own description "
        "is the evidence, and re-indexing the run is what would add the picture"
    ),
    IMAGE_STORE_UNREACHABLE: (
        "the durable image store could not be read in time, so the chart was answered "
        "from its description alone; this is a state of the fetch and says nothing "
        "about whether the image exists"
    ),
}

#: The in-process image cache. An `OrderedDict` used as an LRU rather than
#: `functools.lru_cache`, because the WRITE path puts entries in and a decorator
#: only ever fills itself from its own misses — and warming this from ingest is
#: what keeps a healthy gateway off the blocking path entirely.
_CACHE: OrderedDict[str, str] = OrderedDict()
#: Guards `_CACHE` and `_CLIENT`. The drain task and the answer path are on the
#: same event loop today, but `writer._submit` exists precisely because this
#: package is reached from the job queue's worker THREAD, so shared mutable
#: module state here is guarded rather than assumed single-threaded.
_LOCK = threading.Lock()
_CLIENT: httpx.Client | None = None


class _Rollout:
    """Whether PostgREST has told us this table is not deployed yet.

    A one-field object rather than a module-level `bool`, so that the write half
    in `research_image_store_write` sets the SAME flag this half reads — a
    plain `global` would have given each module its own name for it and the
    fetch would have kept asking a database that had already said no.
    """

    table_absent = False


def configured() -> bool:
    """Whether there is a corpus to read images from at all.

    Read at call time rather than captured at import, so a test that swaps
    `settings` changes the answer — and so the common case, a desk with no
    Supabase configured, costs one attribute read and never builds a client.
    """
    return bool(
        getattr(settings, "supabase_url", "")
        and getattr(settings, "supabase_service_role_key", "")
    )


def remember(document_id: str | None, png_b64: str | None) -> None:
    """Put one image in the process's cache. The write path's warm-up.

    Called from ingest, where the bytes are already in hand, so the gateway that
    indexed a sweep answers a question about its chart without a fetch. Also
    called after a successful fetch, so the stall is paid once.
    """
    if not document_id or not png_b64 or len(png_b64) > MAX_PNG_B64_CHARS:
        return
    with _LOCK:
        _CACHE[str(document_id)] = png_b64
        _CACHE.move_to_end(str(document_id))
        while len(_CACHE) > max(0, CACHE_MAX):
            _CACHE.popitem(last=False)


def cached(document_id: str | None) -> str | None:
    if not document_id:
        return None
    with _LOCK:
        found = _CACHE.get(str(document_id))
        if found is not None:
            _CACHE.move_to_end(str(document_id))
        return found


def reset() -> None:
    """Forget the cache, the client and the "table is absent" verdict.

    A test seam, and the reason it is one function rather than three: module
    state that a test clears in pieces is module state a later test inherits
    half of, which is how a suite starts passing for the wrong reason.
    """
    global _CLIENT
    with _LOCK:
        _CACHE.clear()
        client, _CLIENT = _CLIENT, None
        _Rollout.table_absent = False
    if client is not None:
        client.close()


def _job_id(doc: dict[str, Any]) -> str:
    ref = str(doc.get("source_ref") or "")
    return ref.rsplit(":", 1)[0] if ":" in ref else ref


def _from_job(doc: dict[str, Any], key: str) -> tuple[str | None, str | None]:
    """The base64 PNG a finished job holds, or the state that says why not.

    THE FAST PATH, kept exactly as it was. It is a dict lookup, it costs
    nothing, and on the in-process pool it still answers first — this change
    adds a fallback behind it rather than replacing it, because a design that
    always went to the database would have made a healthy laptop slower to buy
    a property it already had.

    `modules.jobs` is imported INSIDE the resolver, not at module scope. The
    research plane must not drag the job queue into its import graph — and
    `get_queue()` constructs a `ThreadPoolExecutor`, which spawns no thread
    until something is submitted, so resolving an image never starts a worker.
    """
    from modules.jobs import get_queue

    job_id = _job_id(doc)
    if not job_id:
        return None, JOB_NOT_RETAINED
    try:
        record = get_queue().get(job_id)
    except Exception as exc:  # noqa: BLE001 - a queue failure is a state, not an outage
        log.warning("research image store: job lookup failed for %s (%s)", job_id, exc)
        return None, JOB_NOT_RETAINED
    if record is None:
        return None, JOB_NOT_RETAINED
    result = getattr(record, "result", None)
    if not isinstance(result, dict):
        return None, JOB_UNFINISHED
    encoded = result.get(key)
    return (str(encoded), None) if encoded else (None, IMAGE_ABSENT)


def _client() -> httpx.Client:
    """The pooled synchronous client.

    Pooled at module scope so the TLS handshake is paid once per process rather
    than once per chart — with a per-call client the stall this module already
    argues about would be dominated by a handshake, every time.
    """
    global _CLIENT
    with _LOCK:
        if _CLIENT is None:
            key = str(getattr(settings, "supabase_service_role_key", "") or "")
            _CLIENT = httpx.Client(
                base_url=str(getattr(settings, "supabase_url", "") or "").rstrip("/"),
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                timeout=FETCH_TIMEOUT_MS / 1000,
            )
        return _CLIENT


def _fetch(document_id: str) -> tuple[str | None, str]:
    """One image, BY PRIMARY KEY, or the state that says why not.

    ``document_id=eq.<uuid>`` and ``select=png_b64`` — one row, one column. This
    is the only request in the gateway that names this table, which is what
    makes the hard constraint checkable rather than merely intended: a search
    that returns forty chart documents transfers exactly the bytes it
    transferred before this module existed.

    ``storage_path`` is not selected and not followed. The column exists so the
    migration's option (b) stays open; a row that used it reads here as no
    inline image, which is the honest answer from a reader that cannot fetch
    from Storage rather than a silent empty picture.
    """
    try:
        response = _client().get(
            TABLE,
            params={"document_id": f"eq.{document_id}", "select": "png_b64", "limit": "1"},
        )
    except httpx.HTTPError as exc:
        log.warning("research image store: %s reading %s", type(exc).__name__, document_id)
        return None, IMAGE_STORE_UNREACHABLE
    if response.status_code == 404:
        # The deployment predates the migration. Said once, then never asked
        # again — the same rollout state `_hybrid_arms` treats a 404 as.
        _Rollout.table_absent = True
        log.info("research chart images: table absent (404) — deployment predates the migration")
        return None, IMAGE_NOT_STORED
    if response.status_code >= 300:
        log.warning("research image store: HTTP %s reading %s", response.status_code, document_id)
        return None, IMAGE_STORE_UNREACHABLE
    try:
        rows = response.json() or []
    except ValueError:
        # A proxy answering 200 with an HTML error page — the failure
        # `embed_many` documents, reaching this reader by the same route.
        return None, IMAGE_STORE_UNREACHABLE
    encoded = rows[0].get("png_b64") if isinstance(rows, list) and rows else None
    if not encoded or len(str(encoded)) > MAX_PNG_B64_CHARS:
        return None, IMAGE_NOT_STORED
    return str(encoded), ""


def locate(doc: dict[str, Any], key: str) -> tuple[str | None, str | None]:
    """``(base64 png, None)`` or ``(None, state)`` for one chart document.

    Three sources in cost order, and the ORDER is the design:

    1. the in-process cache, warmed by ingest and by an earlier fetch — free;
    2. the finished `JobRecord` — free, and the only source before this module;
    3. the corpus's image table — one bounded blocking GET.

    Never raises. Every failure below is a named state, because the failure this
    whole path exists to prevent is an answer that says "the chart shows" over a
    call that carried no chart, and a reader cannot tell those apart from prose.

    A STORE THAT WAS NOT ASKED CHANGES NOTHING. Unconfigured, migration not run,
    fetch turned off, no document id — each of those returns the job path's own
    state, byte for byte what this desk reported before the table existed. The
    two new states appear only where a new question was actually put, and then
    they are the last word: both sources have been checked by that point, and
    which one failed is what an operator needs.
    """
    hit = cached(doc.get("id"))
    if hit:
        return hit, None

    encoded, missing = _from_job(doc, key)
    if not missing:
        return encoded, None
    if missing != JOB_NOT_RETAINED:
        # ``job_unfinished`` and ``image_absent`` are the job's own DEFINITIVE
        # answers — no result yet, or a result that drew no picture — and the
        # corpus cannot know better than the run about either. Only
        # ``job_not_retained``, "I cannot see the job from here", is the kind of
        # ignorance a second source can cure, so it is the only one that fetches.
        return None, missing

    document_id = str(doc.get("id") or "")
    if not document_id or not configured() or _Rollout.table_absent or FETCH_TIMEOUT_MS <= 0:
        return None, missing

    stored, state = _fetch(document_id)
    if state:
        # The STORE's word, now that it has been asked. ``job_not_retained``
        # stays true and is the less useful half of it: both sources have been
        # checked, and this one names a fix an operator can act on.
        return None, state
    remember(document_id, stored)
    return stored, None
