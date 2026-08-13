# NUSSIF Developer Analyst Case Study — Ian Wangsa

Two parts, in two directories. Start with whichever question you came for.

| | What it answers | Where |
|---|---|---|
| **Part 1** | What is wrong with 298 rows of LLM usage data, and what does the spend actually tell you? | [`Part1_Data_Handling/`](Part1_Data_Handling/) |
| **Part 2** | **AlphaEngine** — infrastructure a quant desk runs on, built end to end | [`Part2_Infrastructure/`](Part2_Infrastructure/) |

---

## Part 1 — Data handling

A Jupyter notebook that finds seven planted defects in 2.7% of the rows,
repairs each with a stated reason, and then answers the three questions: the
usage trend, the real cost driver, and what had to be assumed to say either.

The headline finding is that cost grew faster than tokens (+33% against +27%),
which is model-mix drift rather than volume — and that one service accounts for
52% of spend on 6.5% of requests. The lever is model choice and context size,
not call count.

**Open [`Part1_Data_Handling/Part1_Data_Handling.html`](Part1_Data_Handling/Part1_Data_Handling.html)**
in any browser — every output is executed and embedded, no server needed. The
notebook is generated from `build_notebook.py`, so the narrative is diff-able as
text rather than buried in cell JSON.

---

## Part 2 — AlphaEngine

> *One engine, two implementations, one test that proves it.*

An always-on FastAPI gateway, a Next.js desk workspace, a stateless research
microservice, and a Telegram companion — sharing one append-only audit log.

* **Module A** — cross-venue L2 order books from Binance and Bybit, with
  sequence-gap detection, staleness clocks, and transaction-cost analysis on the
  routed execution rather than the mid.
* **Module B** — a pre-trade risk gateway: 17 gates in ~0.2 ms on the single
  order path — fifteen any order can reach, plus two that fire only for
  paper-equity orders — an automatic drawdown breaker, reduce-only mode before
  the halt, and a kill switch reachable from four surfaces.
* **Module C** — asynchronous parameter sweeps that report the Deflated Sharpe
  Ratio, walk-forward out-of-sample results, and the probability the search
  itself is overfitting — and that will tell you a good-looking equity curve
  fails.

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
failing.

**→ [`SETUP.md`](SETUP.md)** to get it running — it starts with the zero-config
path (three commands, no Python, no keys, no `.env`) and only then adds the
gateway. Read it before creating a virtualenv: the name and location of that
directory are load-bearing, and getting them wrong is the single most expensive
mistake in this repository.

**→ [`Part2_Infrastructure/README.md`](Part2_Infrastructure/README.md)** for the
architecture, the design arguments, and what is implemented versus mocked.

**→ [`docs/FEATURE_TOUR.md`](docs/FEATURE_TOUR.md)** — the guided walkthrough of the whole
platform, tab by tab, with the zero-config / keyed / gateway-backed capability map and the
verify-it-yourself E2E checklist. **[`docs/UI_IMPROVEMENTS.md`](docs/UI_IMPROVEMENTS.md)** is
the UI audit the overhaul stood on — every finding cites file and line, and its eight
independently shippable slices are all shipped and named in the tour. The two planning
documents that sequenced and succeeded that work are working notes kept outside this
repository; the audit and the tour are the parts worth reading.

**→ [`.claude/skills/`](.claude/skills/)** — three Claude Code skills,
`/start-alpha-engine`, `/tour` and `/verify`, described in
[`SETUP.md`](SETUP.md#claude-code-skills).

## Tech Stack

Versions are as deployed/locked on 2026-08-08 — read from the running
container, the lockfile and the live database. Full detail (every dependency's
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
| **[Python](https://www.python.org)** | `3.12.13` | The gateway runtime. |
| **[FastAPI](https://fastapi.tiangolo.com)** | `0.141.1` | 38 documented paths carrying 39 operations, behind a committed OpenAPI contract. (`main.py` declares 43 route decorators; the WebSocket and three `include_in_schema=False` HTML routes do not reach the schema, and `/api/orders` serves two verbs on one path.) |
| **[Uvicorn](https://www.uvicorn.org)** | `0.52.1` | One stateful process by design — in-memory book + kill switch. |
| **[NumPy](https://numpy.org)** | `2.5.1` | Reference engine for TCA, risk and backtesting; vectorbt optional. |
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
| **[GitHub Actions](https://github.com/features/actions)** | managed | Four network-free CI jobs: 692 gateway + 2,174 web + 13 service tests. |

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
venv/bin/python -m pytest                            # 692 passed
venv/bin/python tools/synthetic_probe.py             # book → cost → risk gate → audit
(cd web && npm test)                                 # 2,174 tests across 548 suites
(cd OpenBB_Service && ../venv/bin/python -m pytest)  # 13 passed
```

Those commands *are* the source of the three numbers — each figure is the count
its own runner prints on the last line (`pytest` summary; `node --test`'s
`ℹ pass`). Re-run them rather than trusting this paragraph: a test count quoted
from memory goes stale the week after it is written.

`.github/workflows/ci.yml` runs the same three suites plus lint, the API
contract snapshot, the committed-tree guard and the journey probe on every push.

---

## Submission contents

| Item | File |
|---|---|
| CV | `CV_Ian_Wangsa.pdf` — belongs at the root of this folder before zipping |
| How to run any of it | [`SETUP.md`](SETUP.md) |
| Part 1 notebook (HTML export) | `Part1_Data_Handling/Part1_Data_Handling.html` |
| Part 1 notebook (source) | `Part1_Data_Handling/Part1_Data_Handling.ipynb` |
| Part 2 code, docs and outputs | `Part2_Infrastructure/` |
