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
* **Module B** — a pre-trade risk gateway: 14 gates in ~0.2 ms on the single
  order path, an automatic drawdown breaker, reduce-only mode before the halt,
  and a kill switch reachable from four surfaces.
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

**→ [`Part2_Infrastructure/README.md`](Part2_Infrastructure/README.md)** for the
architecture, the design arguments, and what is implemented versus mocked.

## 🛠️ Tech Stack

Versions are as deployed/locked on 2026-08-08 (read from the running container,
the lockfile and the live database). Full detail — every dependency's *why*,
the API-key table and the RAG/ML pipeline — lives in
[`Part2_Infrastructure/README.md` §Tech Stack](Part2_Infrastructure/README.md).

### Frontend Core
* **[Next.js v16.3.0](https://nextjs.org)** — App Router + Turbopack on Vercel (`sin1`); the browser bundle ships zero backend credentials.
* **[React v19.2.8](https://react.dev)** · **[TypeScript v5.9.3](https://www.typescriptlang.org)** — one workspace, eight URL-addressable role tabs.
* **[Tailwind CSS v4.3.3](https://tailwindcss.com)** — utilities over a hand-written token system with a test-enforced AA contrast contract; charts are hand-rolled SVG, no chart library.

### Backend
* **[Python v3.12.13](https://www.python.org)** + **[FastAPI v0.141.1](https://fastapi.tiangolo.com)** + **[Uvicorn v0.52.1](https://www.uvicorn.org)** — the always-on gateway, one stateful process by design (in-memory book + kill switch).
* **[NumPy v2.5.1](https://numpy.org)** / **[pandas v3.0.5](https://pandas.pydata.org)** — reference engines for TCA, risk and backtesting; vectorbt optional.
* **[httpx](https://www.python-httpx.org)** / **[websockets](https://websockets.readthedocs.io)** — keyless Binance + Bybit L2 ingest and all outbound HTTP.

### Database
* **[DuckDB v1.5.5](https://duckdb.org)** — embedded append-only audit log, the **authoritative** store; survives every network dependency being down.
* **[PostgreSQL v17.6](https://www.postgresql.org) / [Supabase](https://supabase.com)** — durable mirror with RLS deny-by-default and `decided_by` provenance; never a second decision-maker.
* **[pgvector v0.8.2](https://github.com/pgvector/pgvector)** — 384-dim HNSW research index (`gte-small` via a Supabase Edge Function; zero API keys).

### DevOps & Infrastructure
* **[Docker v29.7.2](https://www.docker.com)** — non-root two-stage image + compose; contract-tested, secret-free by test.
* **[Caddy v2.6.2](https://caddyserver.com)** — automatic HTTPS in front of the gateway on Oracle Cloud (Singapore — region is load-bearing for venue egress).
* **[GitHub Actions](https://github.com/features/actions)** — four network-free CI jobs; 396 gateway + 689 web + 13 service tests.
* **[Vercel](https://vercel.com)** — two serverless projects from one repo; builds are Ed25519-attested against a trust root pinned in reviewed source.

### Verify it end to end

Everything runs offline: market data falls back to clearly-tagged synthetic books, the backtester uses its own NumPy engine, and every fixture is committed.

```bash
cd Part2_Infrastructure
python -m venv venv && venv/bin/pip install -r requirements-core.txt
venv/bin/python -m pytest                            # 396 gateway tests
venv/bin/python tools/synthetic_probe.py             # book → cost → risk gate → audit
(cd web && npm install && npm test)                  # 689 web tests, incl. cross-engine parity
(cd OpenBB_Service && ../venv/bin/python -m pytest)  # 13 service tests
```

To run the complete platform concurrently:
```bash
cd Part2_Infrastructure/web && npm run dev:all
```
This launches both the **FastAPI Gateway (`http://127.0.0.1:8000`)** and **Next.js Desk Workspace (`http://localhost:3000`)** concurrently.

`.github/workflows/ci.yml` runs the same three suites plus lint, the API
contract snapshot, the committed-tree guard and the journey probe on every push.

---

## Submission contents

| Item | File |
|---|---|
| CV | `CV_Ian_Wangsa.pdf` — belongs at the root of this folder before zipping |
| Part 1 notebook (HTML export) | `Part1_Data_Handling/Part1_Data_Handling.html` |
| Part 1 notebook (source) | `Part1_Data_Handling/Part1_Data_Handling.ipynb` |
| Part 2 code, docs and outputs | `Part2_Infrastructure/` |
