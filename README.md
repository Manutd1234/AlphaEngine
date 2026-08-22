# NUSSIF Developer Analyst Case Study — Ian Wangsa

*Updated 2026-08-22. The tree figures below were re-counted against this tree
on that date and the commands that produced them are quoted beside them. Suite
counts here are what the three runners printed on that date, NOT what
`Part2_Infrastructure/web/lib/test-counts.generated.ts` currently says: a week
of work has outrun that file, it still carries web 4,008 across 871 suites, and
`npm run counts:refresh` is owed before the next push (`CLAUDE.md` §4 tabulates
all four generated artefacts and which two are behind). Measurements taken off other
hardware — the production VM's latency, the regenerated decision bench — carry
their own earlier dates where they appear, because restamping a reading nobody
re-took would be a claim rather than a measurement.*

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
  everything offline. `web/lib/test-counts.generated.ts` is the dated record the desk displays, and it
  is a week behind this tree — run the suites rather than reading it.

**The headline numbers, measured 2026-08-22:** **2,099 gateway + 4,124 web + 14 service tests**, none
needing a network. That gateway figure is the run with the optional cross-encoder weights seeded; CI,
which seeds nothing, prints **2,091 passed and 2 skipped** — both are green, and
[`CLAUDE.md` §3](CLAUDE.md) holds the arithmetic that reconciles them rather than picking a favourite.
Then: 17 pre-trade gates, 15 of which any order can reach and 2 of which fire only for paper-equity
orders, decided in **13.2 µs** p50 on the compiled engine against 25.3 µs on the Python reference,
with the arithmetic core at 83 ns (dev Mac, `tools/bench_decision.py`, regenerated 2026-08-20 into
`docs/architecture/latency-bench.generated.json`; ~320 ns p50 on the production VM, read off `/metrics`
on 2026-08-17); 20/20 gate-parity scenarios bit-exact across both engines; **135 Telegram commands**
from one generated catalogue; and **54 OpenAPI paths carrying 56 operations**, with the committed
contract's SHA-256 re-verified against `tools/openapi.json` on 2026-08-22
(`node web/scripts/check-gateway-openapi-digest.mjs`, digest `9409bdda…`). The deployed gateway's
live `/openapi.json` was last compared against that contract on 2026-08-17 and has not been re-probed
since; that comparison needs the running host, so it is not part of the offline verify block.

### Where each concern lives

| Concern | Directory | Why it is there and not somewhere tidier |
|---|---|---|
| **Frontend** | [`Part2_Infrastructure/web/`](Part2_Infrastructure/web/) | Vercel's **Root Directory** points at this exact path. Moving it means reconfiguring the deployment before the next push builds. |
| **Backend — risk gateway** | [`Part2_Infrastructure/`](Part2_Infrastructure/) — `main.py`, `config.py`, `modules/` | A FastAPI app's entrypoint belongs at its package root; that is where `uvicorn main:app`, `pytest`'s rootdir and the Dockerfile all expect it. Burying it in a `gateway/` folder would be less conventional, not more. |
| **Backend — research service** | [`Part2_Infrastructure/OpenBB_Service/`](Part2_Infrastructure/OpenBB_Service/) | Separately deployed, separately versioned, its own `pyproject.toml`. |
| **Job queue** | `Part2_Infrastructure/` — `worker.py`, `celery_tasks.py` | Optional Celery backend. Sits beside the app it serves; absent Redis, the gateway runs jobs in-process. |
| **Database — Postgres mirror** | [`supabase/`](supabase/) | The Supabase CLI resolves `supabase/` from the **repository root**. `supabase db push` in `schema.yml` runs from here. |
| **Database — Oracle ADB** | [`oracle/`](oracle/) | Plain DDL, applied by `tools/apply_oracle_schema.py`. |
| **DevOps — CI/CD** | [`.github/workflows/`](.github/workflows/) | GitHub's own convention; it cannot live anywhere else. |
| **Infrastructure — containers** | [`Part2_Infrastructure/docker/`](Part2_Infrastructure/docker/) | Gateway image, built by `deploy.yml` and run on OCI. The builder stage compiles the native decision core (`native/decision_core/`) so the runtime image carries the `.so` and no compiler. |
| **Operations — scripts** | `Part2_Infrastructure/tools/` | Schema appliers, probes, fixture generators, the OpenAPI exporter. |
| **Documentation** | [`docs/`](docs/), [`SETUP.md`](SETUP.md), [`CLAUDE.md`](CLAUDE.md) | Six shelves — `architecture/`, `engineering/`, `planning/`, `product/`, `testing/`, `whitepaper/` — indexed by [`docs/README.md`](docs/README.md); setup instructions; the things an agent otherwise gets wrong. |
| **Migration bundle** | [`tools/bundle_migrations.py`](tools/bundle_migrations.py) | Repo root, not `Part2_Infrastructure/tools/`, because it reads `supabase/migrations/` and the Supabase CLI resolves that from the repository root too. |

Every one of those locations is fixed by the tool that reads it — Vercel, the
Supabase CLI, GitHub Actions, uvicorn, pytest — rather than chosen for looks. A
`frontend/ backend/ database/` reshuffle would read tidier in a file listing and
would break four separate deployments, so the layout follows the tools and this
table does the explaining instead.

### The map

What is where — 1,413 tracked files (`git ls-files | wc -l`, 2026-08-22) plus 32 that are in the tree
and not yet committed (the whitepaper's eight Typst files, the image-retrieval bench, one migration,
and the components and suites that landed with this week's work), two levels deep. The table above
explains *why* each path is where it is; this is the *what*:

```
├── README.md · SETUP.md · CLAUDE.md      this file; the running instructions; the agent notes
├── docs/                                 architecture · engineering · planning · product ·
│                                         testing · whitepaper (Typst source, 83 pages)
├── tools/bundle_migrations.py            regenerates supabase/apply_all.generated.sql
├── docker-compose.yml                    one-command always-on gateway
├── .github/workflows/                    ci · deploy (gateway CD) · e2e · schema · two keepalives
├── Part1_Data_Handling/                  the notebook (ipynb + executed HTML), its builder, its README
├── Part2_Infrastructure/                 1,331 files — the platform
│   ├── main.py · config.py · modules/    the FastAPI risk gateway, 224 files. The 17-gate battery
│   │                                     is the modules/risk_proxy/ package, the audit log
│   │                                     modules/audit/, the routes eight routers in modules/api/
│   ├── native/decision_core/             the C++ (pybind11) decision core — bit-exact vs Python
│   ├── tests/                            the gateway pytest suite (130 test files)
│   ├── tools/                            fixture generators, OpenAPI export, probes, the Telegram
│   │                                     catalogue, four benches (decision, core ticks, re-rank,
│   │                                     image retrieval)
│   ├── docker/                           the two-stage gateway image (builder compiles the core)
│   ├── docs/                             RUNBOOK · GRAPH_RECALL · REFACTOR_RULES · telegram checklist
│   ├── web/                              the Next.js desk (875 tracked files: app/ · components/ ·
│   │                                     lib/ · 279 `.test.ts` suites in the tree)
│   ├── OpenBB_Service/                   the stateless research service (own pyproject, 14 tests)
│   ├── developer-console/                experimental; not part of the assessed deliverable
│   └── notebooks/ · templates/           research template; the gateway's single-file console
├── supabase/                             35 migrations, seed, 2 edge functions, one generated
│                                         bundle — the Postgres mirror + RAG
└── oracle/                               plain DDL: schema, in-DB Monte Carlo VaR, least-privilege user
```

Those per-directory figures are `git ls-files <dir> | wc -l` on 2026-08-22, and the test-file counts
are `ls` over the tree, so they include the files git has not been told about yet. They roughly
doubled over the preceding week; an earlier draft of this map quoted 1,127 / 612 / 468, which is what
a file count does if nobody re-runs it.

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
microservice, and a Telegram companion (135 commands, inline keyboards, in-place
card edits, 16 chart generators) — sharing one append-only audit log. The
command count is generated from the registry by `tools/telegram_catalogue.py`
and checked in CI, so it cannot drift from what the bot dispatches.

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
calculator. Postgres is authoritative: lexical `tsvector` and 384-dim pgvector
arms joined by Reciprocal Rank Fusion at k = 60, with the Neo4j graph arm fused
into the same ranking rather than appended after it; a three-band corrective
policy (`ANSWER_BAND = 0.8`, `REFUSE_BAND = 0.4`) that rewrites once in the
middle band; an optional local ONNX cross-encoder that re-orders what survives —
benchmarked, not estimated, at 197 ms for twenty short rows and 1.5 s at the
truncation ceiling, which is why its bulkhead is a single thread; and a
generation step that refuses rather than guesses. Truncation, an ungrounded
sentence and an unquoted figure are three separately named refusals, checked in
that order. Charts go to the model as PNGs under their own 45-second budget
against 20 for text, both derived from two live calls measured at 20.6 s and
29.9 s. With `GEMINI_API_KEY` unset the whole plane still retrieves and simply
reports `verdict=refused` with the reason, and `/api/research/rag/ask` carries a
request-rate and dollar-spend bound either way.

**Built for all seven quant-desk roles.** The README's *Who this is for* section
opens with a coverage matrix: each role's question, where it is answered, and
what is honestly still missing. Researchers, traders, portfolio managers, risk
managers, data engineers, SREs and developers each have surfaces, and all of
them reconcile to the same rows.

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
verify-it-yourself E2E checklist; the UI overhaul's slices and the passes that followed
(one type scale in rem, the moving desk, the header's priority ladder, the decision chip)
are named in it where they land. **[`docs/architecture/LATENCY_BUDGET.md`](docs/architecture/LATENCY_BUDGET.md)** is
the three-plane latency argument with its regenerated bench table. One thing to get right before
quoting a microsecond figure: the budget deliberately carries **two** decision readings and refuses
to average them. `docs/architecture/latency-bench.generated.json` (regenerated 2026-08-20 on a
loaded laptop) reads 13.2 / 25.3 µs and is the pair to quote outside that document — it is what
this README, `Part2_Infrastructure/README.md` and the feature tour all use. The interleaved A/B
ladder in its §2.3, run on a quiet machine, reads 12.4 / 23.1 µs. Neither is wrong; picking one and
"correcting" the other is. The audit that findings
were raised against and the plans that sequenced the work are working notes kept outside
this repository; what survives them is enforced by the design-system tests, which is the
only form a constraint keeps.

**→ [`docs/whitepaper/`](docs/whitepaper/)** — the institutional whitepaper: Typst source, six
chapters, one per audience cluster: topology; researcher and PM; risk and trader; data, SRE and
developer; mathematical foundations; infrastructure and telemetry. Build it with
`typst compile docs/whitepaper/main.typ AlphaEngine_Institutional_Whitepaper.pdf`; that command
produced 83 A4 pages on 2026-08-22. NOT BUILT: no PDF is committed, `typst` is in no requirements
file, and no CI job compiles it — a broken chapter is caught by whoever next runs the command.

**→ [`.claude/skills/`](.claude/skills/)** — three Claude Code skills,
`/start-alpha-engine`, `/tour` and `/verify`, described in
[`SETUP.md`](SETUP.md#claude-code-skills).

## Tech Stack

Versions re-read on 2026-08-22 from `web/package-lock.json` and the gateway
virtualenv that CI mirrors (Python 3.12.14); every one below was unchanged from
the 2026-08-17 reading. Managed services and the running container carry that
earlier date, because they were not re-probed. Full detail (every dependency's
*why*, the API-key table and the RAG/ML pipeline) is in
[`Part2_Infrastructure/README.md` §Tech Stack](Part2_Infrastructure/README.md).

### Frontend Core

| Component | Version | Role |
|---|---|---|
| **[Next.js](https://nextjs.org)** | `16.3.0` | App Router + Turbopack on Vercel (`sin1`); the browser bundle ships zero backend credentials. |
| **[React](https://react.dev)** | `19.2.8` | One workspace, eight URL-addressable role tabs. |
| **[TypeScript](https://www.typescriptlang.org)** | `5.9.3` | Strict mode, shared contract types with the Python engine's fixtures. |
| **[Tailwind CSS](https://tailwindcss.com)** | `4.3.3` | Utilities over a hand-written token system with a test-enforced AA contrast contract. Charts are hand-rolled SVG — no chart library. |

### Backend

| Component | Version | Role |
|---|---|---|
| **[Python](https://www.python.org)** | `3.12.14` | The gateway runtime (`python:3.12-slim`, two-stage image; the builder stage compiles the decision core). |
| **[FastAPI](https://fastapi.tiangolo.com)** | `0.141.1` | 54 documented paths carrying 56 operations, behind a committed OpenAPI contract. (60 route decorators in total, 3 in `main.py` and 57 across the eight routers in `modules/api/`; the four that never reach the schema are one WebSocket, `/ws/book/{symbol}`, and three `include_in_schema=False` HTML aliases for the same console. Two paths serve two verbs each — `/api/orders` and `/api/data/work-items`.) |
| **[Uvicorn](https://www.uvicorn.org)** | `0.52.3` | One stateful process by design — in-memory book + kill switch. |
| **[NumPy](https://numpy.org)** | `2.5.2` | Reference engine for TCA, risk and backtesting; vectorbt optional. |
| **[pybind11](https://pybind11.readthedocs.io)** | `3.1.0` (build-time) | Binds the C++ decision core (`native/decision_core/`) — `requirements-native.txt`, builder stage only; `DECISION_CORE=auto\|native\|python` selects the engine and `/health` publishes which one is live. |
| **[pandas](https://pandas.pydata.org)** | `3.0.5` | Bar/series handling across analytics. |
| **[websockets](https://websockets.readthedocs.io)** | `17.0.1` | Keyless Binance + Bybit L2 ingest. |

### Database

| Component | Version | Role |
|---|---|---|
| **[DuckDB](https://duckdb.org)** | `1.5.5` | Embedded append-only audit log — the **authoritative** store; survives every network dependency being down. |
| **[PostgreSQL](https://www.postgresql.org)** | `17.6` | Durable mirror with `decided_by` provenance; never a second decision-maker. |
| **[Supabase](https://supabase.com)** | managed | Hosts the mirror; RLS deny-by-default, zero `anon` policies. |
| **[pgvector](https://github.com/pgvector/pgvector)** | `0.8.2` | 384-dim HNSW research index (`gte-small` via a Supabase Edge Function; zero API keys). |

### DevOps & Infrastructure

| Component | Version | Role |
|---|---|---|
| **[Docker](https://www.docker.com)** | `29.7.2` | Non-root two-stage image + compose; contract-tested, secret-free by test. |
| **[Caddy](https://caddyserver.com)** | `2.6.2` | Automatic HTTPS in front of the gateway. |
| **[Oracle Cloud](https://www.oracle.com/cloud/)** | managed | Always-on host, Singapore — region is load-bearing for venue egress. |
| **[Vercel](https://vercel.com)** | managed | Two serverless projects from one repo; builds are Ed25519-attested against a trust root pinned in reviewed source. |
| **[GitHub Actions](https://github.com/features/actions)** | managed | Four network-free CI jobs on every push (`gateway`, `openbb-service`, `web`, `repo-audit`): 2,091 gateway + 4,124 web + 14 service tests. Two more are opt-in and never gate a push — `live-smoke` (`workflow_dispatch`, needs Oracle and Supabase secrets) and `rerank-real` (`workflow_dispatch` or a `rerank` label; seeds the 1.05 GiB cross-encoder weights, caches them, and fails if that suite skips). `deploy.yml` ships the gateway (build → GHCR → SSH swap → verify → roll back, and a warning if the container fell back to the Python engine); `openbb-keepalive.yml` and `oracle-keepalive.yml` ping the research service and the Oracle backend on a schedule. |

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
venv/bin/python -m pytest                            # 2,091 passed, 2 skipped
venv/bin/python tools/synthetic_probe.py             # book → cost → risk gate → audit; 6/6 steps
(cd web && npm test)                                 # 4,124 tests across 899 suites
(cd OpenBB_Service && ../venv/bin/python -m pytest)  # 14 passed
```

Those commands *are* the source of the three numbers — each figure is the count
its own runner prints on the last line (`pytest` summary; `node --test`'s
`ℹ pass`). The desk displays them from `web/lib/test-counts.generated.ts`, which
`npm run counts:refresh` regenerates and which is behind the tree as this is
written; CI checks only its **web** line, via
`node scripts/check-test-counts.mjs web <log>`.

**Two green gateway numbers, and the difference is opt-in, not drift.** Two
files in the suite skip with a named reason rather than pretending they ran:
`tests/test_data_ops_postgrest.py` skips one collected test with no Supabase
credentials, and `tests/test_research_rerank_real.py` skips at MODULE level, so
its eight tests are not collected at all until cross-encoder weights are seeded
(`venv/bin/python tools/bench_rerank.py --seed --model-path DIR` — 1.05 GiB —
then `RERANK_TEST_MODEL_PATH=DIR` on the run). That is the whole of the
difference between **2,091 passed / 2 skipped** and **2,099 passed / 1 skipped**:
8 passes gained, 1 skip lost. [`CLAUDE.md` §3](CLAUDE.md) works it through, and
records the trap that a `Part2_Infrastructure/.env` naming
`RERANK_TEST_MODEL_PATH` turns the opt-in on with nothing exported — which is
how two people re-measure one tree and print different totals. Both opt-ins are
exercised rather than merely designed: with real credentials all 11 tests in
`test_data_ops_postgrest.py` run green against a live Supabase project, and with
seeded weights the ONNX cross-encoder runs its 8 green offline.

**Do not `set -a && . ./.env` first.** That exports `REQUIRE_AUTH=1`, which the
suite's `conftest.py` defends with `setdefault` — beaten by an exported variable
— and around 80 route tests then fail with 401 for a reason none of them states.
Pass one variable per run instead.

Re-run these rather than trusting this section: a test count quoted from memory
goes stale the week after it is written — this one did, by 116 web tests and 28
suites, inside a week. The 2,091 needs the native core built
(`venv/bin/python native/decision_core/setup.py build_ext --inplace --build-temp build/native`,
after `pip install -r requirements-native.txt`); the parity suites fail rather
than skip without it.

`.github/workflows/ci.yml` runs the same three suites plus lint, the native-core
build, the API contract snapshot, the committed web test-count check, the
committed-tree guard and the journey probe on every push.

---

## Navigating the Repo

| Item | File |
|---|---|
| How to run any of it | [`SETUP.md`](SETUP.md) |
| Part 1 notebook (HTML export) | `Part1_Data_Handling/Part1_Data_Handling.html` |
| Part 1 notebook (source) | `Part1_Data_Handling/Part1_Data_Handling.ipynb` |
| Part 2 code, docs and outputs | `Part2_Infrastructure/` |
| The documentation index | [`docs/README.md`](docs/README.md) |
| The institutional whitepaper (Typst source, no PDF committed) | [`docs/whitepaper/`](docs/whitepaper/) |
| The things an agent otherwise gets wrong | [`CLAUDE.md`](CLAUDE.md) |
