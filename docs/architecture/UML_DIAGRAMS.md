# UML diagrams — the anti-twitch machinery and the research pipeline

*Drawn from the tree as of 22 August 2026. Every class, member and constant here
exists in the named source file; if a diagram disagrees with the code, the code
is right and this file is stale — fix it here.*

This document is four diagrams and the minimum prose to read them. The
arguments behind each design live where they always have:
[`Part2_Infrastructure/README.md`](../../Part2_Infrastructure/README.md)
(§2 Architecture, §Tech Stack → RAG & ML) is authoritative on the system,
[`docs/product/FEATURE_TOUR.md`](../product/FEATURE_TOUR.md) walks the surfaces,
[`docs/architecture/LATENCY_BUDGET.md`](LATENCY_BUDGET.md) owns the three-plane latency
discipline, and the module docstrings — which argue *why* and name rejected
alternatives — are the primary source for everything summarised here.

---

## 1. The anti-twitch machinery — class diagram

Four classes in `web/lib` — sources
[`desk-source.ts`](../../Part2_Infrastructure/web/lib/desk-source.ts),
[`venue-liveness.ts`](../../Part2_Infrastructure/web/lib/venue-liveness.ts),
[`polling.ts`](../../Part2_Infrastructure/web/lib/polling.ts) and
[`use-throttled-value.ts`](../../Part2_Infrastructure/web/lib/use-throttled-value.ts)
— all deliberately **not hooks**, and all four for the same reason their
docstrings state: a class can be driven by a fake clock and a scripted sequence
of outcomes with no DOM and no renderer, and every one of the defects these
classes exist to prevent was unreachable by the unit suite while the decision
lived inside a component. The React wrappers are thin — `useDeskSource`,
`usePolling`, `useThrottledValue` — and
[`livebook.ts`](../../Part2_Infrastructure/web/lib/livebook.ts) constructs one
`VenueLiveness` per venue.

```mermaid
classDiagram
    direction LR

    class DeskSourceMachine~T~ {
        -promotionStreak : number
        -now : clock injected for tests
        -chosenSource : DeskSource or null
        -settledYet : boolean
        -lastGood : payload and at, or null
        -lastFailure : ProbeFailure or null
        -successes : number
        -demoted : boolean
        +observe(outcome ProbeOutcome~T~) void
        +choose(source DeskSource) void
        +restore(source DeskSource) void
        +release() void
        +state : DeskSourceState~T~
        -resolve() DeskShowing~T~
    }

    class DeskShowing~T~ {
        <<union>>
        kind measured : payload, tier live or cached, lastGoodAt
        kind generated : cause TierCause
        kind empty : failure or null
    }

    class DeskSourceState~T~ {
        +showing : DeskShowing~T~
        +tier : DataTier
        +cause : TierCause or null
        +settled : boolean
        +lastGoodAt : Date or null
        +chosen : DeskSource or null
        +failure : ProbeFailure or null
    }

    class VenueLiveness {
        -staleAfterMs : number
        -promotionUpdates : number
        -updates : number
        -lastUpdateAt : number or null
        -transportStatus : VenueLivenessStatus
        -staleAtUpdates : number or null
        +update(at number) void
        +transport(status VenueLivenessStatus) void
        +restart() void
        +statusAt(now number) VenueLivenessStatus
        +isLiveAt(now number) boolean
    }

    class PollingController {
        -failures : number
        -inFlight : boolean
        +consecutiveFailures : number
        +nextDelayMs() number
        +start() void
        +stop() void
        +runNow() Promise
        -schedule(ms number) void
        -fire() Promise
    }

    class ValueThrottle~T~ {
        -held : T or NOTHING
        +holding : boolean
        +open : boolean
        +push(value T) void
        +flush() void
        +retime(intervalMs number) void
        +stop() void
        -openWindow() void
    }

    DeskSourceMachine ..> DeskShowing : resolve()
    DeskSourceMachine ..> DeskSourceState : state getter
    DeskSourceState o-- DeskShowing : showing

    note for DeskSourceMachine "PROMOTION_STREAK = 2. Demotion to cached is\nimmediate on one failure; promotion back to live\nneeds two consecutive successes. Measured data is\nnever replaced by generated data."
    note for VenueLiveness "STALE_AFTER_MS = 8000 (re-exported from\nlivebook-socket.ts, one definition).\nPROMOTION_UPDATES = 2 — the same asymmetry\nas DeskSourceMachine, for the same reason."
    note for PollingController "One loop for what fourteen useEffect loops\ngot wrong independently - hidden-tab pause,\ngeometric backoff capped at maxBackoffMs,\nrevalidate-on-visible, no overlapping ticks."
    note for ValueThrottle "THROTTLE_INTERVAL_MS = 300. Leading-edge,\ntrailing-flush, coalescing. held uses a Symbol\nsentinel so null and undefined survive a window\nas the measurements they are."
```

The four are one family, and each docstring cross-cites the others.
`VenueLiveness` refuses to let transport states pretend to be liveness:
`connecting` and `error` pass straight through `statusAt`, and the class
decides only between `live` and `stale`, only once a venue has ever sent a
book. `PROMOTION_STREAK` and `PROMOTION_UPDATES` are both two because two is
the smallest number a single late packet cannot satisfy; the constants' own
comments argue why higher would be worse.

---

## 2. `DeskShowing` transitions — state diagram

`DeskShowing` is a derived value: `resolve()` computes it from the machine's
fields on every `state` read. The diagram below is therefore the resolved value
as it moves under probe outcomes and human choices — the events are
`observe(ok)`, `observe(fail)`, `choose()`, `release()`.

```mermaid
stateDiagram-v2
    state "measured (live)" as measured_live
    state "measured (cached)" as measured_cached
    state "generated" as generated
    state "empty" as empty

    [*] --> empty : new machine — no probe has settled

    empty --> measured_live : observe(ok) — first reading
    empty --> generated : observe(fail) with no data and no choice
    empty --> empty : choose("live") with no reading — honoured as a failure card, not a fiction

    measured_live --> measured_cached : observe(fail) — demotion is immediate, writes lock
    measured_cached --> measured_cached : observe(ok) — streak 1 of 2
    measured_cached --> measured_live : second consecutive observe(ok) — PROMOTION_STREAK = 2
    measured_cached --> measured_cached : observe(fail) — streak resets to 0

    measured_live --> generated : choose("sandbox") — the only path from measured to generated
    measured_cached --> generated : choose("sandbox")
    empty --> generated : choose("sandbox")
    generated --> measured_live : observe(ok) with no sandbox choice pinned — a chosen sandbox stays generated whatever any probe says
    generated --> measured_live : release() with an undemoted reading retained
    generated --> measured_cached : release() with a demoted reading retained

    note right of generated
        cause names why —
        "chosen" for a pressed Sandbox control,
        "not-configured" when the failure code is
        gateway_not_configured (the deployed
        workspace's normal state, not a fault),
        "incident" for anything else.
    end note

    note right of measured_cached
        Rule 1 - measured data is never replaced by
        generated data. Every failure on a desk that
        has ever had a reading stops at cached: real
        numbers carried with their age, writesEnabled
        false. The sandbox is reachable only from a
        desk with no reading, or by a human choosing it.
    end note
```

Two readings worth making explicit. First, no arrow leaves a measured state for
`generated` except `choose("sandbox")` — that absence is the module's whole
point, and the cockpit oscillation its docstring reproduces is unrepresentable
here. Second, a gateway alternating success and failure settles at `cached` and
stays there, because each failure resets the streak — the honest description of
a gateway reachable half the time. The flat `tier` field reports `"sandbox"`
for an `empty` desk: the safe reading, not an accurate one; anything that needs
"nothing yet" reads `showing.kind` or `settled` instead.

---

## 3. `POST /api/research/rag/ask` — sequence diagram

The corrective path: route, retrieve wide, narrow, grade, rewrite once, then
answer or refuse. Declared in
[`modules/api/research.py`](../../Part2_Infrastructure/modules/api/research.py)
and orchestrated by `answer_from_corpus` in
[`modules/research_crag.py`](../../Part2_Infrastructure/modules/research_crag.py).
The bands are `ANSWER_BAND = 0.8` and `REFUSE_BAND = 0.4`, defined once in
`research_crag` and imported back by `research_generate` so the two fences
cannot drift apart.

```mermaid
sequenceDiagram
    autonumber
    participant W as caller
    participant API as modules.api.research<br>research_rag_ask
    participant CRAG as research_crag<br>answer_from_corpus
    participant R as research_router<br>ResearchRouter
    participant RAG as research_rag<br>ResearchRag.search / connected
    participant B as research_bm25
    participant S as research_stages
    participant RR as research_rerank
    participant G as research_generate
    participant A as AuditLog (DuckDB)

    W->>API: POST /api/research/rag/ask
    API->>CRAG: answer_from_corpus(get_rag(), query, audit=get_audit())
    CRAG->>R: plan(query) — RuleBasedPlanner, max_calls=3
    R->>A: research_plan row
    R-->>CRAG: Plan (hybrid_search always present — fallback plan if the planner misbehaved)
    CRAG->>R: execute(plan, rag, match_count=research_stages.wide(n))

    loop each ToolCall — graph_traverse always moved last
        alt structured_runs
            R-->>R: ToolResult unsupported — no structured-runs reader on this gateway (NOT BUILT) — hybrid answers instead
        else hybrid_search / lexical_exact
            R->>RAG: search(text, match_count)
            RAG->>RAG: embed via /functions/v1/embed-research (gte-small, 384-dim)
            alt embed returned None
                RAG-->>R: state embed_failed — never a zero vector
            else
                RAG->>RAG: rpc match_research_documents_hybrid — dense + lexical arms, RRF k=60, similarity floor 0.76
                RAG->>B: apply_bm25 → rank_candidates + fuse at RRF_K — the third arm, reorders but never adds or drops
                RAG-->>R: state ok, matches + bm25 report (or unavailable, typed, never an empty list)
            end
        else graph_traverse
            R->>RAG: connected(seed id from earlier matches) via traverse_research_graph
            RAG-->>R: state ok + connected rows, or skipped when nothing was retrieved to walk from
        end
        R->>A: research_tool_call row per invocation
    end

    alt run.state is not ok, or no matches
        CRAG-->>API: ResearchAnswer state unavailable / embed_failed, or ok with no rows — ungraded, and NOT a refusal
    else rows came back
        CRAG->>S: narrow(query, matches, n)
        S->>RR: asyncio.to_thread(rerank) under _RERANK_BULKHEAD Semaphore(2)
        RR-->>S: report — reranked, or unconfigured / unavailable / failed / empty with the fused order kept
        CRAG->>CRAG: ContextGrader.grade — 0.40 agreement + 0.25 similarity + 0.25 overlap + 0.10 recency

        opt band rewrite (0.4 – 0.8)
            CRAG->>CRAG: grader.rewrite — appends the best match's symbol / strategy, never an LLM call
            CRAG->>R: plan + execute the rewrite, ONCE — straight-line code, no loop for a third attempt
            CRAG->>S: narrow again — same scale, or the score comparison is meaningless
            CRAG->>CRAG: grade the retry — keep whichever round scored higher
        end

        alt score below 0.4 — refused
            CRAG-->>API: state refused — refusal names the corpus_size denominator — matches emptied, generation None (never attempted)
        else answerable
            CRAG->>S: synthesise(answered query, matches, kept score, router)
            S->>G: generate(query, documents, crag_score)
            alt precheck fence fires
                G-->>S: verdict refused — no documents, an unciteable id, ungraded context, or the refuse band — the model is never called
            else SDK absent
                G-->>S: verdict refused — GEMINI_API_KEY unset or google-genai not installed — a normal deployment, reported not raised
            else model called
                G->>G: Gemini generate_content — TIMEOUT_MS 20000, MAX_OUTPUT_TOKENS 1024, TEMPERATURE 0.0
                alt reply starts CORPUS_SILENT
                    G-->>S: verdict corpus_silent — a correct answer, not a failure
                else a citation is fabricated, or none given
                    G-->>S: verdict refused — the whole answer, never flagged and returned
                else
                    G-->>S: verdict answered + verified [doc:id] citations
                end
            end
            S->>R: record_generation — research_generation ledger row, gated on model_called, never on generated
            CRAG-->>API: state ok — generation report carried separately, never flattened into state
        end
    end
    API-->>W: ResearchAnswer
```

The response model (`ResearchAnswer`) keeps the outcomes that must never
collapse into one another as distinct states: `ok`, `refused`, `unavailable`,
`embed_failed` — and `ok` with an empty `matches` list is "searched, found
nothing", a fifth fact distinct from all four. CRAG refuses on retrieval
relevance; generation refuses on a grounding fence; `generation` is a separate
field precisely so one value can never claim to say which fired.

---

## 4. The research pipeline modules — class diagram of who imports whom

Every arrow below is a verified `import` in the named module, except where the
label says otherwise: `research_stages` defers its `research_generate` import
into `synthesise()`, `modules.api.research` defers `centrality_report` into its
route, and the router never imports `research_rag` at all — it calls whatever
`rag` object it is handed. Sources under
[`Part2_Infrastructure/modules/`](../../Part2_Infrastructure/modules/).

```mermaid
classDiagram
    direction TB

    class api_research["modules.api.research"] {
        research_rag_search()
        research_rag_ask()
        research_graph_communities()
        research_graph_centrality()
    }
    class research_crag {
        ContextGrader
        Grade
        ResearchAnswer
        answer_from_corpus()
        ANSWER_BAND : 0.8
        REFUSE_BAND : 0.4
    }
    class research_router {
        ResearchRouter
        RuleBasedPlanner
        Plan / ToolCall / ToolResult / Execution
        TOOLS : hybrid graph runs lexical
    }
    class research_stages {
        wide()
        narrow()
        synthesise()
        _RERANK_BULKHEAD : Semaphore(2)
    }
    class research_rerank {
        rerank()
        configured()
        RERANK_CANDIDATES : 20
        RERANK_MODEL : bge-reranker-base
    }
    class research_generate {
        generate()
        _precheck()
        _verify()
        verdicts answered / corpus_silent / refused
    }
    class research_bm25 {
        rank_candidates()
        fuse()
        tokenise()
        RRF_K : 60
    }
    class research_rag["modules.research_rag (package)"] {
        ResearchRag / get_rag()
        _RetrievalMixin.search()
        _RetrievalMixin.connected()
        apply_bm25()
        RAG_MIN_SIMILARITY : 0.76
    }
    class research_graph_reads {
        read_all_edges()
        detect_corpus_communities()
        community_report()
        centrality_report()
        reconcile_communities()
    }
    class research_communities {
        detect_communities()
        rank_documents()
        SEED : 20260821
    }
    class research_graph_projection {
        project()
        project_communities()
        configured()
    }
    class research_reconcile {
        re-exports reconcile_communities
    }

    api_research ..> research_crag : answer_from_corpus
    api_research ..> research_stages : wide / narrow
    api_research ..> research_rag : get_rag
    api_research ..> research_graph_reads : community_report, centrality_report

    research_crag ..> research_router : plan / execute
    research_crag ..> research_stages : wide / narrow / synthesise
    research_stages ..> research_rerank : rerank via to_thread
    research_stages ..> research_generate : deferred import inside synthesise()
    research_generate ..> research_crag : ANSWER_BAND, REFUSE_BAND — the one deliberate cycle
    research_router ..> research_rag : duck-typed rag.search / rag.connected at runtime — no import

    research_rag ..> research_bm25 : rank_candidates / fuse
    research_graph_reads ..> research_communities : detect_communities, rank_documents
    research_graph_reads ..> research_graph_projection : project_communities
    research_reconcile ..> research_graph_reads : scheduler name resolution

    note for research_stages "The seam. research_generate reads the bands\nfrom research_crag so one definition of the\nrelevance floor exists - which makes a module-level\nimport back impossible; synthesise() defers it.\nRestating the numbers was the rejected alternative."
    note for research_router "Bounded planner - closed tool registry,\nmax_calls=3, every plan and call written to the\naudit ledger, deterministic fallback to plain\nhybrid search when the planner misbehaves."
    note for research_graph_projection "Neo4j, optional (requirements-graph.txt).\nUnconfigured reports a named reason, never an\nexception. Postgres stays authoritative - drop\nthe graph and re-project."
    note for research_communities "networkx, optional (requirements-communities.txt).\nAbsent reports unavailable with the reason.\nLouvain is seeded - one partition per edge set,\nnot one per run."
```

### What happens when an optional piece is absent

The pipeline's most distinctive property, stated per module because each module
states it about itself:

| Piece | Absent when | Designed behaviour when absent |
|---|---|---|
| Re-ranker (`research_rerank`) | `RERANK_MODEL_PATH` unset (the default), or `fastembed` not installed (`requirements-rerank.txt`) | With the path unset, `configured()` is false and `research_stages.wide` never widens — retrieval stays at the caller's `match_count` and `rerank_state` says `unconfigured`. With the path set but `fastembed` missing, retrieval does widen and `rerank` hands the fused order back truncated, `rerank_state` `unavailable`. Either way the RRF order stands — never an error, never an empty list. |
| Generation (`research_generate`) | `GEMINI_API_KEY` unset, or `google-genai` not installed (`requirements-genai.txt`) | `generate` returns `verdict: refused` with the named reason; the whole test suite passes with neither present. The report's `model_called` flag stays false, so no ledger row claims spend that never happened. |
| Neo4j (`research_graph_projection`) | `requirements-graph.txt` not installed, or the driver unconfigured | `project` / `project_communities` return a named-reason report; the communities route fixes `project=False` anyway, because a GET must not write. |
| networkx (`research_communities`) | `requirements-communities.txt` not installed | `detect_communities` and `rank_documents` return `unavailable` with the reason; `modularity` is additionally *absent* — not null, not 0.0 — when the graph has no tie to measure. |
| Supabase corpus (`research_rag`) | `SUPABASE_URL` / service key unset | `search` and `connected` return a typed `unavailable` state, never `[]`; a failed embed returns `None`, never a zero vector. |
| `structured_runs` tool (`research_router`) | Always, today | **NOT BUILT.** The planner routes counts and extrema to it and the router records the call as `unsupported` — "no structured-runs reader on this gateway; hybrid answers instead". The plan's always-present hybrid call answers. |

One further debt the code names itself: on a re-ranking deployment
`research_stages.wide` applies one width to every tool in a plan, so the graph
arm also fetches twenty neighbours and nothing narrows those — bounded, recall
not correctness, and the fix (a separate width on `ResearchRouter.execute`) is
"owed rather than done", in the module's own words. Likewise
`RAG_MIN_SIMILARITY = 0.76` is measured from six queries against one document
and its comment says the number will move; the eval harness is the named owner
of turning it from a floor derived from three observed clusters into one that
is continuously re-measured.
