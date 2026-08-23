# NUSSIF Developer Analyst Case Study — Ian Wangsa

*Updated 2026-08-24. Every count, path and version below was read off this tree
or off a runner's own output on that date, and the command that produced it is
quoted beside it. Measurements taken on other hardware — the production VM's
latency, the regenerated decision bench — keep their own earlier dates, because
restamping a reading nobody re-took would be a claim rather than a measurement.
Where a figure is one CI actually gates, this file says so; where it is a dated
record CI does **not** check, it says that too, because the two are not the same
kind of number.*

Two parts, in two directories. Start with whichever question you came for.

| | What it answers | Where |
|---|---|---|
| **Part 1** | What is wrong with 298 rows of LLM usage data, and what does the spend actually tell you? | [`Part1_Data_Handling/`](Part1_Data_Handling/) |
| **Part 2** | **AlphaEngine** — infrastructure a quant desk runs on, built end to end | [`Part2_Infrastructure/`](Part2_Infrastructure/) |

### Start here, with ten minutes

- **What it is:** the [Part 2 summary below](#part-2--alphaengine) — one paragraph, three modules, and
  [`docs/product/FEATURE_TOUR.md`](docs/product/FEATURE_TOUR.md) when a walkthrough beats a summary.
- **See it running:** the desk at <https://alphaengine-workspace.vercel.app> ("Continue as guest" — no
  account needed) and the gateway's own `GET /health` at `http://149.118.48.255:8000/health`.
- **Judge the engineering from three files:** the seventeen-gate battery —
  [`modules/risk_proxy/gates.py`](Part2_Infrastructure/modules/risk_proxy/gates.py) declares
  `GATE_ORDER` and
  [`modules/risk_proxy/decision.py`](Part2_Infrastructure/modules/risk_proxy/decision.py)
  evaluates it (it is a package now, not the single `risk_proxy.py` older links point at) — the C++
  core that reproduces it bit-for-bit in
  [`Part2_Infrastructure/native/decision_core/decision_core.cpp`](Part2_Infrastructure/native/decision_core/decision_core.cpp)
  (its header comment is the design document), and the fixture that pins them to each other in
  [`Part2_Infrastructure/web/tests/fixtures/gate-parity.json`](Part2_Infrastructure/web/tests/fixtures/gate-parity.json).
- **Verify the claims rather than trusting them:** the [verify block below](#verify-it-end-to-end) runs
  everything offline. `web/lib/test-counts.generated.ts` is the dated record the desk displays; CI
  checks only its **web** line, so run the suites rather than reading its gateway line.

**The headline numbers, measured 2026-08-24:** **2,992 gateway + 4,461 web + 24 service tests**, none
needing a network. That gateway figure is the run with the optional cross-encoder weights seeded
(2,992 passed, 1 skipped); CI seeds nothing, so its run collects fewer items and reports two skips
instead of one. Both are green, both are correct, and
[`CLAUDE.md`](CLAUDE.md) holds the arithmetic that reconciles them rather than picking a favourite —
`pytest -rs` prints the two reasons on any machine. Then: 17 pre-trade gates, 15 of which any order
can reach and 2 of which fire only for paper-equity orders, decided in **13.2 µs** p50 on the
compiled engine against 25.3 µs on the Python reference, with the arithmetic core at 83 ns (dev Mac,
`tools/bench_decision.py`, regenerated 2026-08-20 into
`docs/architecture/latency-bench.generated.json`; ~320 ns p50 on the production VM, read off
`/metrics` on 2026-08-17); 20/20 gate-parity scenarios bit-exact across both engines; **136 Telegram
commands** from one generated catalogue; and **73 OpenAPI paths carrying 76 operations**
(`tools/openapi.json`, OpenAPI 3.1.0), with the committed contract's canonical-JSON SHA-256
re-verified on 2026-08-24 (`node web/scripts/check-gateway-openapi-digest.mjs`, digest
`3379dbca…`). The deployed gateway's live `/openapi.json` was last compared against that contract on
2026-08-17 and has not been re-probed since; that comparison needs the running host, so it is not
part of the offline verify block.

### Where each concern lives

| Concern | Directory | Why it is there and not somewhere tidier |
|---|---|---|
| **Frontend** | [`Part2_Infrastructure/web/`](Part2_Infrastructure/web/) | Vercel's **Root Directory** points at this exact path. Moving it means reconfiguring the deployment before the next push builds. |
| **Backend — risk gateway** | [`Part2_Infrastructure/`](Part2_Infrastructure/) — `main.py`, `config.py`, `modules/` | A FastAPI app's entrypoint belongs at its package root; that is where `uvicorn main:app`, `pytest`'s rootdir and the Dockerfile all expect it. Burying it in a `gateway/` folder would be less conventional, not more. |
| **Backend — research service** | [`Part2_Infrastructure/OpenBB_Service/`](Part2_Infrastructure/OpenBB_Service/) | Separately deployed, separately versioned, its own `pyproject.toml`. |
| **Job queue** | `Part2_Infrastructure/` — `worker.py`, `celery_tasks.py` | Optional Celery backend. Sits beside the app it serves; absent Redis, the gateway runs jobs in-process. |
| **Database — Postgres mirror + corpus** | [`supabase/`](supabase/) | The Supabase CLI resolves `supabase/` from the **repository root**. `supabase db push` in `schema.yml` runs from here. |
| **Database — Oracle ADB** | [`oracle/`](oracle/) | Plain DDL, applied by `.github/workflows/schema.yml` through `tools/apply_oracle_schema.py`. |
| **Database — Neo4j Aura** | *no directory* | There is nothing to keep: the graph is a **one-way projection** of a Postgres table, rebuildable from it at any time, so it has schema files nowhere and a rebuild command instead ([`modules/research_graph_projection.py`](Part2_Infrastructure/modules/research_graph_projection.py)). |
| **DevOps — CI/CD** | [`.github/workflows/`](.github/workflows/) | GitHub's own convention; it cannot live anywhere else. |
| **Infrastructure — containers** | [`Part2_Infrastructure/docker/`](Part2_Infrastructure/docker/) | Gateway image, built by `deploy.yml` and run on OCI. The builder stage compiles the native decision core (`native/decision_core/`) so the runtime image carries the `.so` and no compiler. |
| **Operations — scripts** | `Part2_Infrastructure/tools/` | Schema appliers, probes, fixture generators, the OpenAPI exporter, four benches. |
| **Documentation** | [`docs/`](docs/), [`SETUP.md`](SETUP.md), [`CLAUDE.md`](CLAUDE.md) | Six shelves — `architecture/`, `engineering/`, `planning/`, `product/`, `testing/`, `whitepaper/` — indexed by [`docs/README.md`](docs/README.md); setup instructions; the things an agent otherwise gets wrong. |
| **Migration bundle** | [`tools/bundle_migrations.py`](tools/bundle_migrations.py) | Repo root, not `Part2_Infrastructure/tools/`, because it reads `supabase/migrations/` and the Supabase CLI resolves that from the repository root too. |

Every one of those locations is fixed by the tool that reads it — Vercel, the
Supabase CLI, GitHub Actions, uvicorn, pytest — rather than chosen for looks. A
`frontend/ backend/ database/` reshuffle would read tidier in a file listing and
would break four separate deployments, so the layout follows the tools and this
table does the explaining instead.

### The map

What is where, two levels deep. No file count is pinned here on purpose: the tree's enumeration
lives in `Part2_Infrastructure/web/lib/repository-manifest.generated.json` and is gated at `prebuild`
by `generate-codebase-manifest.mjs --check`, which compares the committed list against
`git ls-files --cached --others --exclude-standard` from the repository root. Re-derive the count
with that command rather than trusting a figure in prose — describe the gate, which is stable, not
the number, which moves. The table above explains *why* each path is where it is; this is the *what*:

```
├── README.md · SETUP.md · CLAUDE.md      this file; the running instructions; the agent notes
├── docs/                                 architecture · engineering · planning · product ·
│                                         testing · whitepaper (Typst source, 83 pages)
├── tools/bundle_migrations.py            regenerates supabase/apply_all.generated.sql
├── docker-compose.yml                    one-command always-on gateway (one service, host 8000)
├── .github/workflows/                    ci · deploy (gateway CD) · e2e · schema · two keepalives
├── Part1_Data_Handling/                  the notebook (ipynb + executed HTML), its builder, its README
├── Part2_Infrastructure/                 1,650 files — the platform
│   ├── main.py · config.py · modules/    the FastAPI risk gateway, 313 files. The 17-gate battery
│   │                                     is the modules/risk_proxy/ package, the audit log
│   │                                     modules/audit/, the routes twelve routers in modules/api/
│   ├── native/decision_core/             the C++ (pybind11) decision core — bit-exact vs Python
│   ├── tests/                            the gateway pytest suite (185 test_*.py files)
│   ├── tools/                            fixture generators, OpenAPI export, probes, the Telegram
│   │                                     catalogue, four benches (decision, core ticks, re-rank,
│   │                                     image retrieval)
│   ├── docker/                           the two-stage gateway image (builder compiles the core)
│   ├── docs/                             RUNBOOK · GRAPH_RECALL · REFACTOR_RULES · telegram checklist
│   ├── notebooks/coherence_lab/          14 lesson notebooks behind the Coherence tab's curriculum
│   ├── web/                              the Next.js desk (996 tracked files: app/ · components/ ·
│   │                                     lib/ · 303 `.test.ts` FILES in the tree, which the
│   │                                     runner reports as 980 suites — different units)
│   ├── OpenBB_Service/                   the stateless research service (own pyproject, 24 tests)
│   ├── developer-console/                experimental; not a deployment unit, not assessed
│   └── templates/                        the gateway's single-file console
├── supabase/                             37 migrations, seed, 2 edge functions, one generated
│                                         bundle — the Postgres mirror + the research corpus
└── oracle/                               plain DDL: schema, in-DB Monte Carlo VaR, least-privilege user
```

Those per-directory figures are `git ls-files <dir> | wc -l` on 2026-08-24, and the test-file counts
are `ls` over the tree, so they include the files git has not been told about yet. They roughly
doubled over the preceding fortnight; an earlier draft of this map quoted 1,127 / 612 / 468 and then
1,413 / 1,331 / 875, which is what a file count does if nobody re-runs it. **The gate, not the number,
is the thing to trust:** `npm run build` refuses to start until
`web/lib/repository-manifest.generated.json` lists the same files `git ls-files` does, so a stale
count is caught at `prebuild` rather than believed.

---

## Part 1 — Data handling

A Jupyter notebook that finds 8 defects across 7 of 298 rows, repairs each with
a stated reason, and then answers the three questions: the usage trend, the real
cost driver, and what had to be assumed to say either.

**Q1 — usage is growing at about 3.5% a week, and nothing suggests cost is
growing faster than usage.** Over 75 days: spend +3.54%/week (95% CI 2.91 to
4.17), requests +3.65% (2.63 to 4.67), tokens +3.60% (2.86 to 4.35) — three
intervals that overlap almost entirely. That is volume growth at constant unit
economics, so there is no model-mix drift to correct. Held at that rate, spend
doubles in about 4.6 months.

An earlier draft of this analysis reported the opposite — cost +33% against
tokens +27%, read as drift toward the expensive model. That came from trimming
both ends of the weekly series as a precaution; the final week was in fact
complete, and discarding it is what produced the ordering. Fitted properly, with
weekday effects absorbed and standard errors corrected for autocorrelation, the
difference disappears. It is in §4 of the notebook, because how a headline
survives being tested is more informative than the headline.

**Q2 — one service is 52% of spend on 6.5% of requests**, and it survived all
nine alternative cleanings. Decomposed, it makes *fewer* calls than the
baseline; the cost is tokens per request and unit price. The lever is model
choice and context size, not call volume.

**Open [`Part1_Data_Handling/Part1_Data_Handling.html`](Part1_Data_Handling/Part1_Data_Handling.html)**
in any browser — every output is executed and embedded, no server needed. The
notebook is generated from `build_notebook.py`, so the narrative is diff-able as
text rather than buried in cell JSON.

---

## Part 2 — AlphaEngine

> *One engine, two implementations, one test that proves it.*

An always-on FastAPI gateway, a Next.js desk workspace, a stateless research
microservice, and a Telegram companion (136 commands, inline keyboards, in-place
card edits, 16 chart generators) — sharing one append-only audit log. The
command count is generated from the registry by `tools/telegram_catalogue.py`
and re-checked inside the gateway suite (`tests/test_telegram_docs.py` runs
`--check`), so it cannot drift from what the bot dispatches.

* **Module A** — cross-venue L2 order books from Binance and Bybit, with
  sequence-gap detection, staleness clocks, and transaction-cost analysis on the
  routed execution rather than the mid.
* **Module B** — a pre-trade risk gateway: 17 gates on the single order path
  — fifteen any order can reach (`kill_switch` through `est_slippage`), plus
  `paper_execution_model` and `reference_freshness`, which fire only for
  paper-equity orders — decided in tens of microseconds (13.2 µs p50 on the
  compiled engine, 25.3 µs on the Python reference, dev Mac,
  `tools/bench_decision.py`), with the
  arithmetic battery itself timed inside a C++ core at 83 ns p50 on that Mac
  and ~320 ns p50 on the shared production VM — plus an automatic drawdown
  breaker, reduce-only mode before the halt, and a kill switch reachable from
  four surfaces. The core is bit-exact against the Python reference and the
  gateway self-measures it at startup, so the nanosecond figure is on the desk
  before the first order.
* **Module C** — asynchronous parameter sweeps that report the Deflated Sharpe
  Ratio, walk-forward out-of-sample results, and the probability the search
  itself is overfitting — and that will tell you a good-looking equity curve
  fails.

**And a retrieval plane over the desk's own notes**, because a research desk
that cannot answer "what did we conclude about this last month" is a
calculator. Postgres is authoritative. `search` fuses **four** arms at
Reciprocal Rank Fusion k = 60 — dense (384-dim pgvector over `gte-small`),
sparse (`ts_rank_cd` over a generated `search_tsv`), Okapi BM25 re-scoring what
the RPC returned, and an optional CLIP arm over a chart's *pixels* — and the
Neo4j graph walk is a **fifth**, fused one stage later at the same constant, in
[`modules/research_router_exec.py`](Part2_Infrastructure/modules/research_router_exec.py)
rather than inside `search`. On top of that: a three-band corrective policy
(`ANSWER_BAND = 0.8`, `REFUSE_BAND = 0.4`) that rewrites once in the middle
band and refuses if the rewrite does not clear it; an optional local ONNX
cross-encoder that re-orders what survives — benchmarked, not estimated, at
197 ms for twenty short rows and 1.5 s at the truncation ceiling, which is why
its bulkhead is a single thread; and a generation step that refuses rather than
guesses. Truncation, an ungrounded sentence and an unquoted figure are three
separately named refusals, checked in that order. Charts go to the model as PNGs
under their own 45-second budget against 20 for text, both derived from two live
calls measured at 20.6 s and 29.9 s. With `GEMINI_API_KEY` unset the whole plane
still retrieves and simply reports `verdict=refused` with the reason, and
`/api/research/rag/ask` carries a request-rate and dollar-spend bound either way.

**Built for all seven quant-desk roles.** [`Part2_Infrastructure/README.md`](Part2_Infrastructure/README.md)'s
*Who this is for* section opens with a coverage matrix: each role's question,
where it is answered, and what is honestly still missing. Researchers, traders,
portfolio managers, risk managers, data engineers, SREs and developers each have
surfaces, and all of them reconcile to the same rows. The desk is **nine tabs**
— those seven roles, an overview that launches into them, and **Coherence**, the
prediction-market engine described below — across **59 rail sections**, every id
a public deep link declared once in
[`web/lib/sections.ts`](Part2_Infrastructure/web/lib/sections.ts).

**Coherence — prices as probabilities, tested for coherence.** A contract paying
$1 if an event happens is a probability with a price on it. This tab reads
Kalshi live, records whole bid ladders rather than prices, and tests whether a
family of those prices admits a probability measure at all; where it does not,
the failure hands back a portfolio that wins in every state. It places no
orders, and the header says so. Its eleven sections each split into in-pane
view switchers (Universe · Books · Lattice · Dutch book · Fees · Coherence index
· Combos · Calibration · Diffusion · Shell · Lessons), read out of
[`components/CoherenceConsole.tsx`](Part2_Infrastructure/web/components/CoherenceConsole.tsx).

**One result on that tab is a null, and it is stated as one.** The Information
Diffusion study asks whether the text of an FOMC statement predicts how fast the
market absorbs it. As of this session the verdict is scored **out of sample**
([`modules/coherence/diffusion/skill.py`](Part2_Infrastructure/modules/coherence/diffusion/skill.py),
21 tests in `tests/test_diffusion_skill.py`). The absorption clock **is**
predictable — out-of-sample **R² +0.144** from the stage and the size of the
rate move alone, with the press conference about **7.0 minutes slower** than the
statement — but adding the text changes that by **−0.343** (shuffled **p 0.875**),
and over a declared 3×3 grid of specifications the gain was negative in **all
nine** cells, including the one with the largest in-sample |t| of 2.85. So the
clock has real structure and the statement's information spectrum is not part of
it. That is a stronger null than the criterion it replaced, and it is not
softened anywhere in these docs.

The maths that matters exists twice — Python for the gateway and the companion,
TypeScript for the browser — because neither runtime can call the other. That is
two chances to be wrong, so the Python side is the reference, `tools/` emits its
answers as fixtures, and the TypeScript suites assert it reproduces them. A VaR
quoted on a phone cannot disagree with the one on the screen without a test
failing. The pre-trade arithmetic exists a third time, in C++, and there the
standard is bit-for-bit: the same twenty-scenario fixture pins both engines.

**→ [`SETUP.md`](SETUP.md)** to get it running — it starts with the zero-config
path (three commands, no Python, no keys, no `.env`) and only then adds the
gateway. Read it before creating a virtualenv: the name and location of that
directory are load-bearing, and getting them wrong is the single most expensive
mistake in this repository.

**→ [`Part2_Infrastructure/README.md`](Part2_Infrastructure/README.md)** for the
architecture, the design arguments, and what is implemented versus mocked.

**→ [`docs/product/FEATURE_TOUR.md`](docs/product/FEATURE_TOUR.md)** — the guided walkthrough of the whole
platform, tab by tab, with the zero-config / keyed / gateway-backed capability map and the
verify-it-yourself E2E checklist. **[`docs/architecture/LATENCY_BUDGET.md`](docs/architecture/LATENCY_BUDGET.md)** is
the three-plane latency argument with its regenerated bench table. One thing to get right before
quoting a microsecond figure: the budget deliberately carries **two** decision readings and refuses
to average them. `docs/architecture/latency-bench.generated.json` (regenerated 2026-08-20 on a
loaded laptop) reads 13.2 / 25.3 µs and is the pair to quote outside that document — it is what
this README, `Part2_Infrastructure/README.md` and the feature tour all use. The interleaved A/B
ladder in its §2.3, run on a quiet machine, reads 12.4 / 23.1 µs. Neither is wrong; picking one and
"correcting" the other is.

**→ [`docs/whitepaper/`](docs/whitepaper/)** — the institutional whitepaper: Typst source, six
chapters, one per audience cluster: topology; researcher and PM; risk and trader; data, SRE and
developer; mathematical foundations; infrastructure and telemetry. Build it with
`typst compile docs/whitepaper/main.typ AlphaEngine_Institutional_Whitepaper.pdf`; that command
produced 83 A4 pages on 2026-08-22. NOT BUILT IN CI: `.gitignore` excludes `*.pdf`, so no PDF is
committed, `typst` is in no requirements file, and no workflow compiles it — a broken chapter is
caught by whoever next runs the command.

**→ [`.claude/skills/`](.claude/skills/)** — three Claude Code skills,
`/start-alpha-engine`, `/tour` and `/verify`, described in
[`SETUP.md`](SETUP.md#claude-code-skills).

## Tech Stack

Versions re-read on 2026-08-24 from `web/package-lock.json` and the gateway
virtualenv that CI mirrors (Python 3.12.14). Managed services carry their own
earlier dates where they were not re-probed. Full detail — every dependency's
*why*, the API-key table and the per-layer argument — is in
[`Part2_Infrastructure/README.md` §Tech Stack](Part2_Infrastructure/README.md)
and [`docs/planning/TECH_STACK.md`](docs/planning/TECH_STACK.md). **Rows marked
*optional* degrade to a named, typed refusal rather than an exception or a
silent zero** — that shape is the house rule, and every optional row below
states what its absence looks like.

### Frontend Core

| Component | Version | Role |
|---|---|---|
| **[Next.js](https://nextjs.org)** | `16.3.0` | App Router + Turbopack on Vercel (`sin1`); the browser bundle ships zero backend credentials. |
| **[React](https://react.dev)** | `19.2.8` | One workspace, **nine** URL-addressable role tabs over 59 rail sections. |
| **[TypeScript](https://www.typescriptlang.org)** | `5.9.3` | Strict mode, shared contract types generated from the gateway's own OpenAPI (`lib/gateway-contract.generated.ts`). |
| **[Tailwind CSS](https://tailwindcss.com)** | `4.3.3` | Utilities over a hand-written token system with a test-enforced AA contrast contract. Charts are hand-rolled SVG — no chart library. |
| **[Lucide](https://lucide.dev)** | `1.28.0` | The only icon dependency. |

**Neo4j on the frontend: nothing here reads it, and that is the honest answer.**
No component, hook or route in `web/` opens a Neo4j connection. What the desk
shows is the `source: "neo4j" | "corpus"` field the two graph *report* routes
return, so a reader can see which store answered — the graph is a backend
read model, never a browser dependency.

### Backend

| Component | Version | Role |
|---|---|---|
| **[Python](https://www.python.org)** | `3.12.14` | The gateway runtime (`python:3.12-slim`, two-stage image; the builder stage compiles the decision core). |
| **[FastAPI](https://fastapi.tiangolo.com)** | `0.141.1` | **73 documented paths carrying 76 operations**, behind a committed OpenAPI 3.1.0 contract. 77 `@router.*` decorators live across **twelve** routers in `modules/api/` (audit 4, coherence 5, coherence_history 3, coherence_lab 7, data 11, diffusion 4, meta 5, ml 3, research 15, risk 14, tca 3, telegram 3); one of those is the `/ws/book/{symbol}` WebSocket, which OpenAPI does not describe, and `main.py` adds three `include_in_schema=False` HTML console aliases. `main.py`'s own docstring still says "fifty-two routes" and is stale — the contract file is the count to trust. |
| **[Uvicorn](https://www.uvicorn.org)** | `0.52.3` | One stateful process by design — in-memory book + kill switch. `tests/test_container_contract.py` fails the build if `--workers` or `gunicorn` appears in the committed image. |
| **[Pydantic](https://docs.pydantic.dev)** | `2.13.4` | Every payload; the models live in six `modules/schemas_*.py` files behind one façade. |
| **[NumPy](https://numpy.org)** | `2.5.2` | Reference engine for TCA, risk and backtesting. |
| **[pandas](https://pandas.pydata.org)** | `3.0.5` | Bar/series handling across analytics. |
| **[httpx](https://www.python-httpx.org)** | `0.28.1` | All outbound HTTP, Supabase included — chosen over `supabase-py` to keep the import graph network-free for CI. |
| **[websockets](https://websockets.readthedocs.io)** | `17.0.1` | Keyless Binance + Bybit L2 ingest. |
| **[pybind11](https://pybind11.readthedocs.io)** | `3.1.0` (build-time) | Binds the C++ decision core (`native/decision_core/`) — `requirements-native.txt`, builder stage only; `DECISION_CORE=auto\|native\|python` selects the engine and `/health` publishes which one is live. |
| **[vectorbt](https://vectorbt.dev)** | *optional* | An accelerator, never a second answer. Absent — which is what the container ships — the backtester runs its own NumPy engine and `/health` reports which is live. |
| **[Celery](https://docs.celeryq.dev) + Redis** | *optional* | Set `REDIS_URL` and the job queue switches from the in-process pool; the same task callables run either way. |

### Database

Five stores, and the boundary between them is the point: exactly one is
authoritative for decisions, and no request path depends on any of the other
four being up.

| Component | Version | Role, and what happens when it is absent |
|---|---|---|
| **[DuckDB](https://duckdb.org)** | `1.5.5` | **Authoritative.** The embedded append-only audit ledger ([`modules/audit/store.py`](Part2_Infrastructure/modules/audit/store.py)) — every order, risk decision, TCA snapshot and backtest run, on a named Docker volume. Not importable → SQLite fallback, `backend: "sqlite"`. **Locked by another live process → `AuditLedgerConflict` is raised and never fallen back from**, because a second process writing a private divergent history is the worst thing this subsystem could do. A second DuckDB file, `coherence.duckdb`, holds the Kalshi book tape ([`modules/coherence/fs/store.py`](Part2_Infrastructure/modules/coherence/fs/store.py)) and is append-only for the same reason. |
| **SQLite** | stdlib, 3.12 | The data-ops store ([`modules/data_ops_store.py`](Part2_Infrastructure/modules/data_ops_store.py)): quality findings, escalations, work items, schedule runs. Deliberately *not* a table in DuckDB — this is state a person just edited, so it needs a write that **raises** and an UPDATE that reports whether it hit a row. `PRAGMA busy_timeout=30000`, one process-wide open. |
| **[PostgreSQL](https://www.postgresql.org)** / **[Supabase](https://supabase.com)** | `17.6` / managed | The durable mirror **and** the authoritative home of the research corpus: 37 ordered migrations, two edge functions, RLS deny-by-default. Never a second decision-maker. Absent → `search` and `connected` return a typed `unavailable` **state**, never `[]`, because "searched and found nothing" and "could not search" render differently. |
| **[pgvector](https://github.com/pgvector/pgvector)** | `0.8.2` | 384-dim HNSW cosine index over `research_documents` (`gte-small`, served by a Supabase Edge Function — no key, no weights in the image). A separate 512-dim CLIP `image_embedding` column sits beside it and is empty on a default deployment, because two models are two coordinate systems and must never share one column. |
| **[Neo4j Aura](https://neo4j.com/cloud/aura/)** | driver `5.28.4`, *optional* | A **one-way, rebuildable projection** of the Postgres `research_edges` table — nothing else writes there, asserted by `tests/test_research_graph_projection.py`. Exactly **two** routes read it back, `GET /api/research/graph/communities` and `/centrality`, and both mark `source: "neo4j" \| "corpus"`. Three refusals stay distinguishable — not configured, sweep has not run, mid-rebuild — and a writer may not read its own output. **GDS is not on Aura Free**, so Louvain and PageRank run in-process via networkx ([`modules/research_communities.py`](Part2_Infrastructure/modules/research_communities.py)); request-time traversal is a Postgres recursive CTE capped at depth 4. Drop the graph and re-project: **no request path depends on it being up.** |
| **[Oracle Autonomous DB](https://www.oracle.com/autonomous-database/)** | managed, *optional* | Authoritative for **nothing**. Runs one thing: a GBM terminal-value VaR as an in-database procedure ([`oracle/`](oracle/)), reached from the web tier through node-oracledb **thin** mode over walletless TLS (`poolMin: 0`, `poolMax: 2` — Vercel scales lambdas independently and a low ADB session limit is the difference between graceful queueing and `ORA-12516`). Absent → a typed result carrying `oracle_not_configured`, never a throw and never a credential in the message. |

### Machine learning

All in-process. No external ML service, no paid inference, and no number
presented as measured that was not.

| Layer | Where | The decision that shapes it |
|---|---|---|
| **Supervised runs** | [`modules/ml/`](Part2_Infrastructure/modules/ml/), routes `modules/api/ml.py`, tables from the `20260820090000_ml_runs*` migrations | **Two engines, one contract.** `ML_ENGINE=auto\|sklearn\|numpy`, validated at import. Nothing in `engine.py` imports scikit-learn — `main.py` imports `modules.ml.fit` at boot, so a module-scope import would put scipy on the start-up path. **A run that fell back is a different run**: recorded on `ml_runs.engine`, reported on `/health`, named in the unavailability message. |
| **The models** | `modules/ml/models.py` | Ridge and logistic are hand-rolled in NumPy, closed-form, one deterministic sequence — the coefficients *are* the research result, and a solver that changes between minor versions changes yesterday's conclusions. No early stopping, no adaptive rates, no feature selection. |
| **Scoring** | `modules/ml/runner.py` | Every metric is computed on the **concatenated out-of-sample predictions**, test windows only, in time order. There is no in-sample number in the result object at all. |
| **Walk-forward, purged and embargoed** | [`modules/ml/splits.py`](Part2_Infrastructure/modules/ml/splits.py) | Purge drops training bars whose label window reaches into the test window. **The embargo is vacuous in this splitter and that is a property of the scheme, not an omission** — an expanding walk-forward with contiguous test windows never has a training row after a test window, so every fold reports `embargoed_bars == 0`, a *measured* zero. The parameter is kept for combinatorial purged CV, where a test window is cut from the middle. |
| **Overfitting** | `modules.backtester.overfitting_probability` | Deflated Sharpe and PBO have **one** implementation; `modules/ml/selection.py` delegates to it. A research plane with two definitions of "deflated Sharpe" has none. |
| **Calibration** | [`modules/coherence/kernel/calibration.py`](Part2_Infrastructure/modules/coherence/kernel/calibration.py) | Brier under Murphy's decomposition — `Reliability − Resolution + Uncertainty + Binning`. Reliability is the only term a recalibration repairs; resolution enters with a minus sign, because a forecaster quoting the base rate everywhere is perfectly reliable and useless. |
| **Information diffusion** | [`modules/coherence/diffusion/`](Part2_Infrastructure/modules/coherence/diffusion/) | The out-of-sample skill test described above. `SKILL_FLOOR = 0.0` — zero is the honest threshold and the only one that is not a choice. |
| **scikit-learn** | `requirements-ml.txt`, *optional* | Absent → the hand-rolled NumPy models run and the run says so. It is never a hidden substitution. |

### Retrieval (RAG)

Semantic recall over what the desk already records. Five stages, each with a
named refusal rather than a silent success.
**The enterprise-RAG stack, stage by stage.** This is the standard pattern's own
taxonomy, mapped onto what actually runs. Rows marked *optional* are **off on a
default deployment** and each names the environment variable that turns it on
and the typed refusal it returns when it is off — never an exception, never a
silent zero.

| Layer / Stage | What runs it | How it behaves, and what its absence looks like |
|---|---|---|
| **Stage 1: Ingestion & Parsing** | [`modules/research_rag/writer.py`](Part2_Infrastructure/modules/research_rag/writer.py) | Five document kinds — `backtest_run`, `chart`, `ml_run`, `risk_incident` written **live in-process**, `execution_summary` **only** by `tools/backfill_research_rag.py`, which is stated as a gap rather than implied as coverage. Writes ride the mirror's bounded queue with three retries on its backoff curve, then a bounded dead-letter book that records what never landed. `body` holds the **exact embedded text**, so a renderer change can never silently alter what was searched. An embed outage stores `embedding_status='pending'` and **never a zero vector** — a zero vector is equidistant from everything and would rank as similar to every query. |
| **Stage 1: Vector & Sparse DB** | pgvector in the same Supabase Postgres; [`modules/research_bm25.py`](Part2_Infrastructure/modules/research_bm25.py) | **Four arms fused inside `search`, all at `RRF_K = 60`** — dense, Postgres FTS, Okapi BM25, image — with the constant defined **once**, at [`research_bm25.py:120`](Part2_Infrastructure/modules/research_bm25.py), and imported rather than restated: an arm on its own constant would be a second fusion wearing the first one's name. Dense is `gte-small`, 384-dim, unit-normalised, HNSW cosine, served from a Supabase edge function — no key, no per-call cost, no weights in the gateway image. BM25 runs `k1 = 1.2`, `b = 0.75`, and `MIN_TOKEN_LENGTH = 1` ([`:114`](Part2_Infrastructure/modules/research_bm25.py)) because the usual `len > 2` rule deletes `FX`, `MA`, `PE` and the `s` of `S&P`. |
| **Stage 1: Knowledge Graph** | Postgres `research_edges` (authoritative) → [`research_graph_projection.py`](Part2_Infrastructure/modules/research_graph_projection.py) → Neo4j Aura → [`research_graph_read_model.py`](Part2_Infrastructure/modules/research_graph_read_model.py) | A **one-way, rebuildable projection**; nothing else writes there, and `tests/test_research_graph_projection.py` asserts it. Exactly **two** routes read it back — `GET /api/research/graph/communities` and `/centrality` — and both mark `source: "neo4j" \| "corpus"` so a reader sees which store answered. Three refusals stay distinguishable: not configured, sweep never ran, mid-rebuild (`_one_sweep`). **GDS is not on Aura Free**, so Louvain and PageRank run in-process via networkx; request-time traversal never leaves Postgres, as a recursive CTE capped at depth 4. Drop the graph and re-project — **no request path depends on it being up.** |
| **Stage 2: Agent Orchestration** | [`modules/research_router.py`](Part2_Infrastructure/modules/research_router.py) | A **bounded plan over a closed four-tool registry**. There is no loop that can decide to keep going — the bound is structural, not a counter. The default planner is a **rule set, not a model**; `Planner` is a `Protocol` ([`:113`](Part2_Infrastructure/modules/research_router.py)) so a model-backed one can be substituted, and the limits are enforced by the router rather than by the planner, so a substituted planner cannot widen them. Every plan and call is audited under one correlation id, and a deterministic fallback always exists — routing never invents an answer. |
| **Stage 3: Re-ranker Model** | [`modules/research_rerank.py`](Part2_Infrastructure/modules/research_rerank.py) — *optional* | `BAAI/bge-reranker-base` ([`:131`](Part2_Infrastructure/modules/research_rerank.py)), ONNX, CPU, **off by default**. `MAX_DOCUMENT_CHARS = 2_000` ([`:163`](Part2_Infrastructure/modules/research_rerank.py)) **is** the latency: 101 ms at 40 chars a row against 1,529 ms at 2,000 — measured by `tools/bench_rerank.py`, median of seven runs, not estimated. Absent (`RERANK_MODEL_PATH` unset) the candidates return in their original fused order with `reranked: False` and a named reason. Cohere and Voyage were rejected **by name**: a vendor call would break the network-free suite and send the desk's research off-box. |
| **Stage 4: CRAG Evaluator** | [`modules/research_crag.py`](Part2_Infrastructure/modules/research_crag.py) + `research_crag_policy.py` | Three bands — `ANSWER_BAND = 0.8`, `REFUSE_BAND = 0.4` ([`:71-72`](Part2_Infrastructure/modules/research_crag.py)). **The grader is arithmetic, not a model, deliberately**: an LLM judging its own retrieval is a model grading a model. The single rewrite is bounded **structurally** — straight-line code with one `if`, not a loop with a counter — and the band check happens **before** the generation call, so a refusal costs nothing. |
| **Stage 5: LLM / Multimodal Model** | `research_generate*.py` — *optional* | Generation is fenced five ways and refuse-first: a model that invents a Sharpe ratio is worse than no answer, because the invented number looks exactly like a measured one. `POST /ask` is bounded by the gateway's own token bucket plus a rolling spend window, and the three refusals stay **distinguishable** — `rate_limited`, `spend_capped`, `scope_unavailable` ([`research_quota.py:156-158`](Part2_Infrastructure/modules/research_quota.py)). Multimodal is built on **both** halves and **both are off by default**: retrieval embeds a chart PNG with a local CLIP `ViT-B/32` pair (512-dim, ONNX on CPU, [`research_image.py:133`](Part2_Infrastructure/modules/research_image.py)) as the fourth arm at the same k = 60, and `research_generate_vision.py` attaches the PNG as **evidence, never a source**. Gated on `RESEARCH_IMAGE_MODEL_PATH`; the measured reason the default stays off is in [`PRD.md` §6](docs/planning/PRD.md). |
| **Data Lineage & Telemetry** | The DuckDB audit ledger + one correlation id per request | Every plan, tool call and refusal is written under the same correlation id, so a returned answer can be walked back to the arms that produced it. `body` is the exact embedded text and `embedding_model` is recorded per document, so a re-embed under a different model is visible rather than assumed. The ledger is **append-only**, and a lock conflict raises `AuditLedgerConflict` rather than falling back — a second process writing a private divergent history is the worst thing this subsystem could do. |

The per-dependency argument — what the pattern recommends, what this project
uses instead, and why — is [`docs/planning/TECH_STACK.md` §The enterprise-RAG
mapping](docs/planning/TECH_STACK.md).


| Stage | Where | The constant or the rule that matters |
|---|---|---|
| **1 · Corpus** | `modules/research_rag/writer.py` | Five document kinds; four are written live in-process, `execution_summary` only by the backfill tool — stated as a gap, not implied as coverage. `body` holds the exact embedded text; an embed outage stores `embedding_status='pending'` and **never a zero vector**, which is equidistant from everything and would rank as similar to any query. |
| **2 · Retrieval** | [`modules/research_rag/retrieval.py`](Part2_Infrastructure/modules/research_rag/retrieval.py) | **Four arms fused inside `search`, all at `RRF_K = 60`** — dense, sparse, BM25, image — and the graph walk is a **fifth**, fused one stage later. The constant is defined once, at [`modules/research_bm25.py:120`](Part2_Infrastructure/modules/research_bm25.py), and imported rather than restated: an arm on another constant would be a second fusion wearing the first one's name. BM25 uses `k1 = 1.2`, `b = 0.75`, and `MIN_TOKEN_LENGTH = 1` — the usual `len > 2` rule deletes `FX`, `MA`, `PE` and the `s` of `S&P`. |
| **3 · Routing** | [`modules/research_router.py`](Part2_Infrastructure/modules/research_router.py) | A **bounded plan** from a closed four-tool registry, every plan and call audited under one correlation id, a deterministic fallback that always exists, and routing that never invents an answer. The default planner is a **rule set, not a model**; `Planner` is a Protocol so a model-backed one can be substituted, and the limits are enforced by the router rather than by the planner. |
| **4 · Re-ranking** | [`modules/research_rerank.py`](Part2_Infrastructure/modules/research_rerank.py), *optional* | `BAAI/bge-reranker-base`, ONNX, CPU, **off by default**. `MAX_DOCUMENT_CHARS = 2_000` **is** the latency: 101 ms at 40 chars a row, 1,529 ms at 2,000. Measured, not estimated (`tools/bench_rerank.py`, median of seven runs). Falling back returns the candidates in their original fused order with `reranked: False` and a named reason. Cohere and Voyage were rejected: a vendor call would break the network-free suite and send the desk's research off-box. |
| **5 · Grading and generation** | [`modules/research_crag.py`](Part2_Infrastructure/modules/research_crag.py) + `research_generate*.py`, *optional* | Three bands (`0.8` / `0.4`), and the one rewrite is bounded **structurally** — straight-line code with one `if`, not a loop with a counter. The grader is arithmetic, not a model, deliberately. Generation is fenced five ways and the band check happens **before** the call. `/ask` is bounded by a token bucket (the gateway's own, imported) plus a rolling spend window; refusals are typed `rate_limited` / `spend_capped` / `scope_unavailable`. |

### DevOps & Infrastructure

Three deployment units, and `deploy.yml` ships exactly **one** of them — its own
header states the rule: the web workspace and the OpenBB service are Vercel
projects that deploy themselves from git, and putting them here would deploy
them twice.

| Component | Version | Role |
|---|---|---|
| **[Docker](https://www.docker.com)** | `29.7.2` | Two-stage `python:3.12-slim` image, non-root uid 10001, stdlib health probe (python:slim ships no curl), port 8000 fixed in EXPOSE/HEALTHCHECK/CMD. The compose file declares one service and a **named volume** — a bind mount arrives owned by the host user and uid 10001 cannot write it, which silently degrades DuckDB to an unwritable SQLite fallback. `stop_grace_period: 20s`, because the lifespan writes a final `gateway_stop` event on SIGTERM and the 10 s default risks a stranded `.duckdb.wal`. |
| **[Caddy](https://caddyserver.com)** | `2-alpine` | TLS on `:8443` with a **pinned internal CA** — a bare IP gets no public issuance, and the single client that matters pins the root instead ([`docs/engineering/TLS_FLIP.md`](docs/engineering/TLS_FLIP.md)). |
| **[Oracle Cloud](https://www.oracle.com/cloud/)** | managed | Always-on host, Singapore. The region is load-bearing, not cosmetic: from US egress Binance returns 451 and Bybit 403. |
| **[Vercel](https://vercel.com)** | managed | Two serverless projects from one repo with different Root Directories, region `sin1`; builds are Ed25519-attested against a trust root pinned in reviewed source. |
| **[GitHub Actions](https://github.com/features/actions)** | managed | **Six workflows.** `ci.yml` runs four **network-free** jobs on every push and every pull request — `gateway` (ruff → native-core build → pytest → `export_openapi.py --check` → the money-path probe), `openbb-service`, `web` (`npm ci` → tests → the committed web test-count check → typecheck → build) and `repo-audit` (`check_repo_complete.sh --fast`, which builds an export of HEAD rather than the working tree). Two more never gate a push: `live-smoke` (`workflow_dispatch` only, because it needs live Oracle and Supabase secrets) and `rerank-real` (`workflow_dispatch` or a `rerank` label; it seeds and caches the 1.05 GiB cross-encoder weights, runs that suite offline, and **fails if it skips**). `deploy.yml` ships the gateway on pushes that touch `Part2_Infrastructure/**` minus `web/**` and `OpenBB_Service/**`: verify → build → GHCR → SSH swap preserving the volume → probe → roll back, with a warning if the container came up on the Python engine. `e2e.yml` smokes the live deployments twice daily (`23 6,18 * * *`) and **never on push** — a venue outage is not a reason to block a code change. `openbb-keepalive.yml` pings every ten minutes (a Vercel function stays warm 5–15 min; Hobby crons run once a day); `oracle-keepalive.yml` runs daily at 02:17 because a free ADB stops itself after seven idle days. `schema.yml` is **`workflow_dispatch` only** — DDL that rides a code deploy is how a table gets altered by someone shipping a CSS change. |

**Three committed generated artefacts cascade from one schema change**, and this
is the sequence to run when a field is added to any `modules/schemas_*.py` model:

1. `Part2_Infrastructure/tools/openapi.json` — `python tools/export_openapi.py`; CI gates it with `--check`.
2. `Part2_Infrastructure/web/lib/gateway-openapi-digest.generated.ts` — a **canonical-JSON SHA-256 with sorted keys**, not a file hash. Gated at `prebuild`.
3. `Part2_Infrastructure/web/lib/gateway-contract.generated.ts` — `node --import tsx scripts/generate-gateway-client.ts`.

Two more generated files live beside them, `mc-parity-reference.generated.ts`
and `test-counts.generated.ts`, and neither is edited by hand.

### Verify it end to end

Everything runs offline: market data falls back to clearly-tagged synthetic books, the backtester uses its own NumPy engine, and every fixture is committed.

**→ [`SETUP.md`](SETUP.md) is the running instructions** — prerequisites, the one
virtualenv path the dev scripts accept, how to start the gateway and the
workspace together, every environment variable, and troubleshooting. It is the
file to read before the first command rather than after the first failure; this
section only states what the suites report.

From a tree that is already set up:

```bash
cd Part2_Infrastructure
venv/bin/python -m pytest                            # 2,992 passed, 1 skipped (weights seeded)
venv/bin/python tools/synthetic_probe.py             # book → cost → risk gate → audit; 6/6 steps
(cd web && npm test)                                 # 4,461 passed, 2 skipped, 980 suites
(cd OpenBB_Service && ../venv/bin/python -m pytest)  # 24 passed
```

Those commands *are* the source of the three numbers — each figure is the count
its own runner printed on 2026-08-24 (`pytest`'s summary line; `node --test`'s
`ℹ pass`). The desk displays them from `web/lib/test-counts.generated.ts`, which
`npm run counts:refresh` regenerates. **Read that file carefully even when it is
fresh:** CI checks only its **web** line, via
`node scripts/check-test-counts.mjs web <log>`, so the gateway line in it is a
dated record and not a gate. Refreshed 2026-08-24 in the **CI shape** to 2,986
(2,984 passed, 2 skipped); a weights-seeded machine prints 2,993 (2,992 passed,
1 skipped), and that eight-test gap is the seeding rather than staleness.

**Two green gateway numbers, and the difference is opt-in, not drift.** Two
files in the suite skip with a named reason rather than pretending they ran:
`tests/test_data_ops_postgrest.py` skips one collected test with no Supabase
credentials, and `tests/test_research_rerank_real.py` skips at MODULE level, so
its tests are not collected at all until cross-encoder weights are seeded
(`venv/bin/python tools/bench_rerank.py --seed --model-path DIR` — 1.05 GiB —
then `RERANK_TEST_MODEL_PATH=DIR` on the run). That is the whole of the
difference between the seeded shape above and the smaller one CI prints.
[`CLAUDE.md`](CLAUDE.md) works the arithmetic through and records the trap that a
`Part2_Infrastructure/.env` naming `RERANK_TEST_MODEL_PATH` turns the opt-in on
with nothing exported — which is how two people re-measure one tree and print
different totals. Force the CI shape with
`RERANK_TEST_MODEL_PATH= venv/bin/python -m pytest`, and read the reasons with
`-rs` rather than the count alone.

**Do not `set -a && . ./.env` first.** That exports `REQUIRE_AUTH=1`, which the
suite's `conftest.py` defends with `setdefault` — beaten by an exported variable
— and around 80 route tests then fail with 401 for a reason none of them states.
Pass one variable per run instead.

Re-run these rather than trusting this section: a test count quoted from memory
goes stale the week after it is written — this one did, by 851 gateway tests
between 2026-08-22 and 2026-08-24. The suite also needs the native core built
(`venv/bin/python native/decision_core/setup.py build_ext --inplace --build-temp build/native`,
after `pip install -r requirements-native.txt`); the parity suites fail rather
than skip without it, because a broken build has to turn CI red.

`.github/workflows/ci.yml` runs the same three suites plus lint, the native-core
build, the API contract snapshot, the committed web test-count check, the
committed-tree guard and the money-path probe on every push.

---

## Navigating the Repo

| Item | File |
|---|---|
| How to run any of it | [`SETUP.md`](SETUP.md) |
| Part 1 notebook (HTML export) | [`Part1_Data_Handling/Part1_Data_Handling.html`](Part1_Data_Handling/Part1_Data_Handling.html) |
| Part 1 notebook (source) | `Part1_Data_Handling/Part1_Data_Handling.ipynb` |
| Part 2 code, docs and outputs | [`Part2_Infrastructure/`](Part2_Infrastructure/) |
| The desk workspace's own README | [`Part2_Infrastructure/web/README.md`](Part2_Infrastructure/web/README.md) |
| The stateless research service | [`Part2_Infrastructure/OpenBB_Service/README.md`](Part2_Infrastructure/OpenBB_Service/README.md) |
| The documentation index | [`docs/README.md`](docs/README.md) |
| The things an agent otherwise gets wrong | [`CLAUDE.md`](CLAUDE.md) |

### Every document under `docs/`

Described one line each, and indexed in full — with what each is *for* — in
[`docs/README.md`](docs/README.md).

| Document | What it is for |
|---|---|
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | The system in one sitting: the three deployment units, the parity argument, the three latency planes. |
| [`docs/architecture/DATA_PROCESSING_FLOW.md`](docs/architecture/DATA_PROCESSING_FLOW.md) | Every hop data takes, vendor bytes to rendered number. |
| [`docs/architecture/UML_DIAGRAMS.md`](docs/architecture/UML_DIAGRAMS.md) | Class and sequence diagrams; every member drawn exists in the named source file. |
| [`docs/architecture/LATENCY_BUDGET.md`](docs/architecture/LATENCY_BUDGET.md) | Every latency number the desk claims, with the method and the machine stated. |
| [`docs/architecture/latency-bench.generated.json`](docs/architecture/latency-bench.generated.json) | The generated bench data behind that budget's §2.1 table. Regenerated, never edited. |
| [`docs/architecture/DATA_OPS_BACKEND.md`](docs/architecture/DATA_OPS_BACKEND.md) | The four tables the gateway must not forget across a restart, and where they live. |
| [`docs/engineering/CODING_STANDARDS.md`](docs/engineering/CODING_STANDARDS.md) | The house rules, almost every one enforced by a named test rather than by review. |
| [`docs/engineering/TLS_FLIP.md`](docs/engineering/TLS_FLIP.md) | Moving the web-to-gateway hop to HTTPS behind a pinned internal CA, and why pinning beats public PKI for one client. |
| [`docs/planning/PRD.md`](docs/planning/PRD.md) | The enterprise RAG requirement and the delivery record: built, substituted with an argument, or NOT BUILT with the reason. |
| [`docs/planning/PLAN.md`](docs/planning/PLAN.md) | Where the research plane stands, what it owes, and the decision log with rejected alternatives. |
| [`docs/planning/TECH_STACK.md`](docs/planning/TECH_STACK.md) | The stack layer by layer, versions read from the tree. |
| [`docs/planning/WORKFLOW.md`](docs/planning/WORKFLOW.md) | How to work on AlphaEngine without losing an hour to a trap somebody already fell into. |
| [`docs/product/PRODUCT_GUIDE.md`](docs/product/PRODUCT_GUIDE.md) | What each tab is for, what a number on screen is allowed to be, what a click may change. |
| [`docs/product/FEATURE_TOUR.md`](docs/product/FEATURE_TOUR.md) | The guided walkthrough of all nine tabs, pinned to `lib/sections.ts` by a test. |
| [`docs/testing/TESTING.md`](docs/testing/TESTING.md) | The testing philosophy — and the one document in `docs/` allowed to discuss test counts. |
| [`docs/whitepaper/`](docs/whitepaper/) | The institutional whitepaper: Typst source, six chapters. No PDF is committed (`*.pdf` is gitignored). |

Operational documents live beside the code they operate, in
[`Part2_Infrastructure/docs/`](Part2_Infrastructure/docs/):
[`RUNBOOK.md`](Part2_Infrastructure/docs/RUNBOOK.md),
[`GRAPH_RECALL.md`](Part2_Infrastructure/docs/GRAPH_RECALL.md),
[`REFACTOR_RULES.md`](Part2_Infrastructure/docs/REFACTOR_RULES.md) and
[`telegram-live-checklist.md`](Part2_Infrastructure/docs/telegram-live-checklist.md).
