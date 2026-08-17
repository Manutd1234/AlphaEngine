# AlphaEngine Trading Automation — NUSSIF Developer Analyst Case Study (Part 2)

*Updated 2026-08-17. Counts, versions and measurements are what the tree, the
runners and the deployed gateway reported on that date; §6's command tables are
generated from the code and checked in CI.*

> **NUSSIF 2026 Infra Assessment Alignment**  
> This infrastructure project supports quant traders, researchers, portfolio managers, risk officers, and data/SRE engineers across the assessment themes: **Portfolio Risk Dashboard (Theme #2)**, **Market Data Quality/Freshness Monitor (Theme #3)**, **Alternative Data & Signal Pipeline (Theme #6)**, **TCA / Execution Automation**, and **Infrastructure Reliability**.

---

## Assessment Proof-of-Concept & Thought Process

1. **Alpha & Signal Utility**: Real-time cross-venue L2 order book depth (Binance + Bybit) prevents adverse selection. Pre-trade TCA estimates VWAP & slippage before order entry. Deflated Sharpe ratios (DSR) prevent backtest overfitting.
2. **Implemented vs. Mocked Components**:
   - **Implemented**: Live Binance/Bybit WebSocket depth streaming, 17 pre-trade risk gates evaluated by two engines (the Python reference and a bit-exact C++ core that times its own arithmetic in nanoseconds), FastAPI risk gateway, DuckDB append-only audit log, OpenBB provider layer, Next.js web workspace, Telegram companion bot (114 commands, inline keyboards, in-place card edits, sixteen matplotlib PNG chart generators).
   - **Mocked**: Paper order execution (simulated fills at L2 touch; resting limit orders).
3. **Production Architecture & Data Collection Frequency**:
   - **100ms** L2 depth polling & book consolidation.
   - **4s** system health & circuit breaker polling.
   - **30s** persistent DuckDB audit log flushes.
4. **Trader & PM Signal Consumption**:
   - **Interactive Web Workspace**: 8 Role-Explicit workspaces (`Overview (All Roles)`, `Research (Quant Researcher)`, `Execution (Quant Trader)`, `Portfolio (Portfolio Manager)`, `Risk (Risk Manager)`, `Data (Data Engineer)`, `Reliability (DevOps/SRE)`, `Developer (Quant Developer)`).
   - **Telegram Mobile Companion**: 8 tab commands (`/overview`, `/research`, `/execution`, `/portfolio`, `/risk`, `/data`, `/reliability`, `/developer`) delivering formatted statistics, visual chart PNGs and tappable inline keyboards that switch sections, symbols and intervals and refresh a card in place.
5. **Validation & Risk Constraints**: Kupiec Likelihood Ratio test for VaR model validation, hard risk limits, and rate limiting (15 commands per 10s).

---

Unified execution-quality, pre-trade-risk and strategy-research infrastructure
with three deliberately separate surfaces: an always-on stateful gateway, a
Vercel web workspace, and an independent **Telegram companion** — text cards, charts and
inline keyboards on a phone. The
companion reports portfolio, market-data and operational state, and — for
explicitly listed operators only — can halt, resume, flatten, set reduce-only or
reset the paper book. It never opens or authenticates a web UI, and it cannot
open a position.

That last capability is opt-in and off by default. `TELEGRAM_CONTROL_USER_IDS`
is a **second, narrower allow-list** than the one that grants read access, and
it is empty unless someone sets it: being able to see the book does not imply
being able to stop the desk. Every control command requires a single-use,
user-bound, 90-second confirmation code, so a forwarded message cannot fire one,
and `/flatten` submits through the same pre-trade gates as a manual order
rather than around them.

| | Module | Where it runs |
|---|---|---|
| **A** | Cross-venue TCA & L2 order-book depth (live Binance + Bybit) | gateway |
| **B** | Pre-trade risk gateway & emergency kill-switch | gateway |
| **C** | Asynchronous parametric backtesting, deflated for multiple testing | gateway **and** Vercel |

Everything writes to an append-only DuckDB audit log.

```
 Telegram companion                 Next.js web workspace
 cards, charts, buttons + alerts  portfolio · research · execution
 /portfolio /quote /status              │                 │
          │ read + gated controls        │ portfolio       │ OpenBB
          ▼                              ▼                 ▼
 FastAPI gateway (always-on)       same gateway      OpenBB Service
 A: L2 ingest + smart routing      server-only       stateless Vercel API
 B: risk state + kill switch       credentials       quote/bars/news/fundamentals
 C: jobs + audit history
          │
   DuckDB audit log
```

`ALPHAENGINE_GATEWAY_URL` and `OPENBB_API_URL` therefore identify different
services. The former points to the long-lived authoritative portfolio gateway;
the latter points to the stateless [`OpenBB_Service/`](OpenBB_Service/) project.

---

## Who this is for

Seven roles run a quant desk and they ask different questions. The system is
organised around that rather than around a feature list — and the point of one
platform rather than seven tools is that they all reconcile to the same rows.

**Coverage at a glance.** What exists, per role, and what is honestly still
missing (§9 has the detail):

| Role | Their question | Where it is answered | Known gap |
|---|---|---|---|
| **Quant Trader** | *Can I send this, and what will it cost?* | Execution cockpit, 15 pre-trade gates, cross-venue TCA, resting-order book, blotter | Paper fills only; no queue position, so a resting order fills in full or not at all |
| **Quant Researcher** | *Does this actually work?* | Sweep engine, Deflated Sharpe, walk-forward, PBO, promotion gate | No feature store; per-browser experiment log |
| **Portfolio Manager** | *Where am I exposed, and what should I own?* | Portfolio view, risk contributions, allocation proposal, rebalance | No benchmark-relative attribution |
| **Risk Manager** | *Is the model right, and will the limits hold?* | Kupiec VaR backtest, stress scenarios, reduce-only mode, kill switch | No margin or liquidation modelling |
| **Data Engineer** | *Can I trust this data?* | Overview-first trust cockpit, provider registry, failover, quote/bars/news/fundamentals contracts, quarantine and lineage, a durable cross-instance quality ledger with rule-based escalation, replay and backfill jobs on a config-driven schedule, a persisted versioned work queue | One gateway process and one SQLite file — durable across restarts and deploys, not replicated across regions; contracts check the normalised shape, not each vendor's raw JSON |
| **DevOps / SRE** | *Is it healthy, and what do I do at 3am?* | `/health`, `/metrics`, systems console, alert rules, runbook | No log aggregation or distributed tracing |
| **Quant Developer** | *Can I change this safely?* | Typed contracts, OpenAPI snapshot, parity suites (Python ↔ TypeScript to 1e-4, Python ↔ C++ to the bit), CI, 864 + 2,410 + 14 tests | No generated client, no property-based fuzzing |

### Quant Traders — *"Can I send this, and what will it cost?"*

| Need | Where |
|---|---|
| See real liquidity before committing | Consolidated L2 ladder, streaming from Binance + Bybit |
| Know the cost *before* the fill | `/tca BTCUSDT 100000 BUY` — VWAP, slippage in bps, routing split |
| Is the consolidated book crossed right now | Cross-venue dislocation strip, sized to the smaller resting leg and quoted **gross** — because two taker legs usually cost more than the edge |
| Not send the order with the extra zero | 15 pre-trade gates decided in tens of microseconds — 15 µs p50 on the compiled engine, 23 µs on the Python reference (dev Mac), the arithmetic core itself 83 ns there and ~320 ns on the production VM; a rejection returns the full check vector |
| Stop everything, now | Authenticated gateway console, `POST /api/risk/kill`, the web workspace's risk panel, or `/halt` in Telegram — the last two gated by a separate operator allow-list and a typed confirmation |
| Know when something breaks without watching a screen | Push alerts on breaches, halts, feed outages and `/watch` liquidity thresholds — to Telegram *and* to the Alerts panel on the Execution tab |
| See my own flow, not just the market | Execution cockpit: order blotter with the full check vector per row, live P&L strip, execution-quality summary (fill rate, realised slippage, tail latency) |
| Send an order and see every gate's verdict | Order ticket with the gate-by-gate check vector rendered for accepts *and* rejects, plus fat-finger and rate-limit presets |
| Leave a bid on the book instead of paying the spread | Resting `LIMIT` orders (`GTC`/`DAY`/`IOC`) that fill at their own limit when the consolidated touch crosses them, and can be cancelled or replaced: `GET /api/orders`, `POST /api/orders/{id}/cancel` |
| Trace a fill back to the idea | Orders stamped with the strategy and experiment id; the blotter links back to the research run |

### Portfolio Managers — *"Where am I exposed, and which limit binds first?"*

| Need | Where |
|---|---|
| The book, not a position list | `/portfolio` and `GET /api/portfolio` |
| Is this one bet or a spread book? | Concentration: largest share, HHI, effective position count |
| Gross vs net — directional or hedged? | Both reported; a market-neutral book has large gross and ~zero net |
| How much room is left before trading stops | Headroom on every limit, and the **binding constraint** named explicitly |
| What is actually producing the P&L | Attribution by symbol and by strategy, from the append-only audit log |
| Is a −20% scenario a tail event today, or a Tuesday | Volatility regime as a percentile of the instrument's *own* history; named scenarios scale **up** with it, never down |
| Which scenario should I actually worry about | Every named scenario ranked by projected loss, each flagged if it would trip the halt |
| What *should* the book be, not just what it is | Allocation proposal in four methods — equal-weight, inverse-vol, equal-risk-contribution, minimum-variance — clipped by the same limits the gate enforces, naming what clipped each weight |
| What would I have to trade to get there | Rebalance trade list with an adjustable drift band, composed but never sent |
| What did the book do this month | Persisted equity snapshots from the risk monitor: day, month-to-date and since-inception P&L that survive a reload |
| Which sleeve made the money | Realised P&L per strategy, replayed from audited fills through the same average-cost accounting the live book uses |

A trader's view answers a question about the *next order*; a PM's answers one
about the *whole book*. The same numbers do not serve both, which is why
`/api/portfolio` exists separately from `/api/risk/state`.

### Quant Researchers — *"Does this strategy actually work?"*

| Need | Where |
|---|---|
| Test an idea across a parameter grid | Sweep in the Vercel workspace, submit through the authenticated backtest API, or queue one from Telegram with `/backtest` on the same jobs engine; the companion then reports progress and results as cards and charts |
| Not be fooled by the best of N draws | **Deflated Sharpe Ratio** — the hurdle a random search of the same size clears |
| Know it generalises | Walk-forward: parameters chosen in-sample, scored on the next unseen fold |
| See *robustness*, not just a winner | Sharpe surface — a plateau survives; an isolated peak is an overfit |
| Know *why* it failed | Every grid point classified plateau/slope/cliff by what its neighbours do; walk-forward drawn fold by fold with efficiency and parameter drift |
| Know whether it is alpha or beta | Returns regressed on market, trend and volatility-regime factors built from the same instrument — with alpha's t-statistic and the residual share |
| See the loss tail, not just its variance | VaR, expected shortfall, Ulcer index and a monthly return grid |
| Realistic costs | Fees and slippage charged on turnover; fills at the next bar, never at mid. Optional square-root impact, funding and borrow — off by default, because on they diverge from the gateway |
| Know *how much*, not just whether | Kelly from the sweep's own realised win and loss magnitudes — quarter-Kelly, capped at 20% of the book, zero when there is no edge, and flagged when the odds came from too few trades to mean anything |
| Not re-test the same idea, or forget how many were tried | Run history that states the cross-run count: a per-run DSR prices one grid, not forty hypotheses |
| Know two runs are actually comparable | A SHA-256 fingerprint of the bars each run saw — a date range is not a dataset, and the comparison panel refuses to imply otherwise |
| Know whether the search itself is the problem | Probability of backtest overfitting: how often the in-sample winner landed in the *worse half* of the same grid out-of-sample |
| Stop a lookback leaking across a fold boundary | Optional embargo between each training window and its test window |
| Record what a run settled, in my own words | Notes and tags per run, kept on the record so a re-run cannot silently discard them |
| Work in a notebook against the real engine | `notebooks/research_template.ipynb` imports `modules.backtester` directly — no server, no network, and it replays a recorded run out of the audit log |

The research portal will tell you a strategy **fails** even when the equity curve
looks good. That is the feature: a +82% backtest with DSR 0.71 and negative
out-of-sample Sharpe gets a red FAIL, not a green tick.

### Risk Managers — *"Is the model right, and will the limits hold?"*

| Need | Where |
|---|---|
| Checks that are strict, visible and hard to bypass | 15 pre-trade gates on the single order path; the full vector is audited for accepts *and* rejects |
| Limits that a compromised service cannot move | Limits are a frozen dataclass in `config.py` — changing one is a code change, a review and a deploy |
| A graduated response, not a cliff | Reduce-only mode from 80% of the drawdown budget: closing orders pass, opening orders do not. A desk in trouble needs a way *out* |
| Exposure, concentration and drawdown continuously | Live from the gateway, marked to market every 1 s by the same loop that trips the breaker |
| Tail risk, not just variance | Parametric **and** historical VaR/CVaR side by side — where they diverge is the fat tail the normal model cannot see |
| **Do I trust my own VaR?** | Kupiec proportion-of-failures backtest with a Basel traffic light. The forecast is re-fitted on a rolling window and scored on the *next* bar, never on data it was fitted to |
| Scenario loss on today's book | Named historical scenarios with **measured** betas. Every leg reports how its move was decided — explicit shock, measured beta, the scenario's blanket assumption, or left flat because none of those applied — so an assumption can never be read as a measurement |
| A limit on the risk number itself | Advisory VaR budget as a share of equity (prop-desk practice is 1–3%), reported and deliberately never used to block an order |
| Stop trading, from anywhere | Kill switch on the API, the console, the web workspace and Telegram — the last two behind a separate operator allow-list and a typed confirmation. Engaging it also cancels the resting book, because a halt that leaves orders working is not a halt |
| A recovery procedure, not an improvised one | `POST /api/risk/resume` takes a reason that lands in the audit log beside what tripped the halt; `docs/RUNBOOK.md` has the sequence |

Risk here is a live guardrail, not an end-of-day report: the breaker trips
without a human, and every number a risk manager reads is the same number the
gate used.

### Data Engineers — *"Can I trust this data?"*

| Need | Where |
|---|---|
| Market-data quality and freshness at a glance | The Data tab opens on an overview-first trust cockpit for the active instrument, bringing freshness, validation evidence, quarantine, lineage and provider capacity into one triage path |
| Ingestion that survives a bad feed | Sequence-gap detection forces a resubscribe; per-venue staleness clocks; automatic synthetic fallback, always tagged |
| Provider failover I can see | Ranked registry across 7 providers with circuit breakers, a quota ledger, and a failover graph showing which node a request would land on *and why each other was skipped* |
| Validation on content, not just transport | Quote, bar, news and fundamentals contracts check positive/ranged prices, unique ordered timestamps, valid highs/lows and freshness, well-formed and de-duplicated headlines with sane sentiment scores, and an issuer profile that is about the issuer asked for and non-empty. The active-quote probe carries the contract result for that exact payload; zero evaluated payloads is **unknown**, never a clean bill of health |
| Replay and backfill I can trigger and schedule | `POST /api/data/replay` re-runs one capability through the workspace's own validated fetch path and records the contract result in the ledger; `POST /api/data/backfill` fetches bars for a date range (Binance for a pair, the workspace's registry for an equity), runs the same bar contract in Python (`modules/data_jobs.py`, pinned to the web's by `web/tests/fixtures/bars-contract-parity.json`) and merges a clean series into the gateway's bar cache — the backtester's offline tier, which no longer wipes deep history on a live refresh. `DATA_SCHEDULES` drives both on a cadence; Lineage & Payloads shows the jobs and the schedule |
| A quality record that survives a restart and spans every instance | Every web instance pushes its contract findings through the ops-sync round trip; the gateway persists them in SQLite on its data volume (`DATA_QUALITY_RETENTION_DAYS`, default 7) and returns the merged view in the same response. Two rules escalate — a burst of fatal findings from one provider, or a fail rate over a threshold — to the Telegram alert chats and the audit log, one per cooldown, auto-resolved when the condition clears; the Data tab shows each escalation with the channel it went to |
| The difference between bad data and a renamed field | Three severities — `fatal` (rejected, failed over), `warn` (served, labelled), `drift` (our mapping looks stale, not the market) |
| Somewhere to look at a suspect payload | Bounded, health-route-instance quarantine on the Data tab with violations, cache key and a redacted excerpt. Serverless request routes do not reliably share that memory, so an empty buffer is never treated as proof; rejected payloads are never cached |
| Lineage from vendor bytes to rendered number | Pipeline inspector follows the workspace's active symbol and selected bar interval through cache key, TTL, provenance, every skipped provider, upstream calls, raw vendor JSON and normalised output |
| Cross-source agreement | On-demand consensus quotes show available, configured and answering source counts, absolute source timestamps and any leg more than 50 bps from the median |
| Provider capacity before a lookup fails | Failover order, readiness, quota consumption, reserve boundaries and cache state sit together in **Providers & Capacity** |
| Operational triage that outlives the tab | **Work Queue** rows live in the gateway's SQLite work-item table (`GET/POST /api/data/work-items`, `PATCH …/{id}`): every create and status change is versioned and audit-logged, a stale edit is refused with the current row rather than overwritten, and the nine seeded samples are marked as such. When the gateway is unreachable the board says so and holds edits locally until it answers; it is a queue, not a ticket system with a workflow engine behind it |
| Query the record without an ETL step | DuckDB, append-only: `SELECT quantile(latency_ms, 0.99) FROM orders` against the same file the gateway writes |
| Feed health as a time series | `/metrics` exports per-venue book age, update rate, reconnects and staleness |

This directly addresses the assessment's market-data quality/freshness monitor,
infrastructure quality and reliability criteria while keeping the first answer
usable to a trader under pressure: *trust, review, or insufficient evidence?*
The improvement that matters is not more data — it is data whose provenance,
scope and quality are visible at the point of use, and whose record outlives
the instance that produced it.

### DevOps / SRE — *"Is it healthy, and what do I do at 3am?"*

| Need | Where |
|---|---|
| Health for every deployable unit | `GET /health` (gateway), authenticated `GET /api/ops/snapshot` (typed gateway components), `/telegram/health`, `/healthz` (OpenBB service), `/api/system/health` (web aggregation) |
| Metrics a scraper can act on | `GET /metrics` — Prometheus text exposition, hand-rolled, **no client library**: feed state, book age, kill switch, order counters, drawdown budget, queue depth, per-route latency percentiles |
| Alert rules I do not have to invent | `tools/alert-rules.example.yml` — every expression keyed to a metric this gateway actually exports, each linked to its runbook section |
| A procedure at 3am | `docs/RUNBOOK.md`: feed down, drawdown halt, rejection spike, gate latency, job backlog, provider degraded — each with a way to rehearse it locally |
| Whether the failure is compute, provider, cache or venue | Systems console: breaker state, p50/p95/p99 with sample counts, quota meters with the reserve boundary, failover graph |
| To break it on purpose and watch it recover | Bounded, self-expiring simulated outages from the operator panel |
| One command that proves the money path works | `python tools/synthetic_probe.py` — health → book → cost → risk gate → audit, in-process and offline, non-zero exit on any failure |
| A deploy that cannot ship a file that was never committed | `tools/check_repo_complete.sh` builds an export of HEAD, not the working tree |
| CI on every push | `.github/workflows/ci.yml`: three suites (the gateway's with the native core built first), lint, the OpenAPI contract snapshot, the committed test-count check, the repo guard and the journey probe. `deploy.yml` then ships the gateway to OCI — build, GHCR, SSH swap, verify, roll back — and warns if the container came up on the Python engine; `openbb-keepalive.yml` keeps the research service warm every ten minutes |

### Quant Developers — *"Can I change this safely?"*

| Need | Where |
|---|---|
| Typed contracts, not conventions | Pydantic models on every route, with `response_model` — the schema is the code |
| A published, versioned API | `/docs` live, plus a committed `tools/openapi.json` snapshot; a test fails if the API changes without regenerating it |
| Documented tunables | `BacktestRequest` carries bounds *and* descriptions, so `/docs` doubles as the researcher's parameter registry |
| Confidence that two implementations agree | Python↔TypeScript parity suites for the **backtest engine** and the **risk engine**, both driven by fixtures the Python reference emits; and Python↔C++ parity for the **pre-trade decision** — the twenty-scenario `gate-parity.json` fixture, reproduced bit-for-bit (`tests/test_gate_parity.py`, `tests/test_decision_core_native.py`) |
| To debug a request without guessing | Pipeline inspector down to raw vendor JSON; bounded trace ring with redaction; `/api/system/inspect` |
| Tests that run anywhere | 864 gateway + 2,410 web + 14 service tests (2026-08-17), all offline by construction — no network, no fixtures fetched at test time. Each figure is what its runner prints: `venv/bin/python -m pytest`, `(cd web && npm test)`, `venv/bin/python -m pytest OpenBB_Service/tests`; `web/lib/test-counts.generated.ts` records them and CI checks it |
| A lint gate that catches defects, not style | ruff with bugbear, async and bandit rules; `tsc --strict` on the web tier |
| To add a provider or an endpoint without breaking things | Uniform `Adapter` interface with declared capabilities; the recipe is in §7 and in `web/README.md` |

### What ties them together

The audit log. Every gate decision, kill-switch event, TCA snapshot, equity
mark and backtest run is appended to DuckDB and is queryable with plain SQL. A
trader's rejected order, a PM's attribution figure, a risk manager's incident
timeline and a researcher's sweep all reconcile to the same rows — so "why does
it say that?" has an answer that does not depend on anyone's memory.

The second thing that ties them together is that the same maths runs in both
languages. The backtest engine and the risk engine each exist twice — Python for
the gateway and the Telegram companion, TypeScript for the browser — because
neither runtime can call the other. Two implementations of one calculation is
two chances to be wrong, so the Python side is the reference, `tools/` emits its
answers as fixtures, and the TypeScript suite asserts it reproduces them. A VaR
quoted on a phone and a VaR on a screen cannot disagree without a test failing.

---

## Three deployment units in this directory

Part 2 ships as three independently deployable projects. They are kept in one
directory because they are one deliverable, and separate because they have
genuinely different runtime needs — one holds sockets open, one is serverless,
one must scale without touching risk state.

### 1. The gateway — Python / FastAPI (this directory)

Live order books, the risk gateway and the optional Telegram
companion. This unit needs a long-lived process because it owns WebSocket
subscriptions, portfolio state, the kill switch and the audit log. Sections 1–10
below document it.

### 2. [`web/`](web/) — the research portal (Next.js / Vercel)

The integrated desk workspace. It works keylessly for crypto; optional
server-side variables connect its read-only portfolio proxy to the stateful
gateway and its OpenBB adapter to the separate stateless service.

```bash
cd web
npm install
npm run dev    # http://localhost:3000
npm test       # 2,410 tests across 620 suites
```

Live-feed endpoints (public, no key):
`/api/ticker` · `/api/depth` · `/api/tca` · `/api/ohlcv` · `POST /api/backtest` ·
`/api/markets` for the index. Tick-by-tick L2 streams straight from the exchanges
to the browser, since a serverless function cannot hold a subscription open.

Research-data endpoints (`/api/quote` incl. cross-source consensus, `/api/news`,
`/api/fundamentals`, `/api/research` for open-web search/scrape, and
`/api/providers` for supply-chain health) route through a seven-provider
registry — Binance (public, keyless), FMP, Tiingo, Massive (ex-Polygon.io),
Alpha Vantage, Firecrawl and OpenBB — with per-provider quota budgeting,
circuit breaking and ranked failover. Every key is optional: keyless
deployments still serve crypto through Binance's public API.
See [`web/.env.example`](web/.env.example).

Systems endpoints (`/api/system/health` for breakers, latency percentiles and
the live failover graph, `/api/system/events` for the structured trace,
`/api/system/inspect` for one lookup taken apart down to the vendor's raw JSON,
and `POST /api/system/actions` for operator controls) back three of the eight
tabs — **Data** for the data engineer, **Reliability** for the SRE and
**Developer** for the contract surface — from one shared poll. The write path is
gated by `ALPHAENGINE_OPERATOR_TOKEN`: open outside production, refused in
production when unset, because a cache purge and a health probe both spend real
quota.

Full documentation: [`web/README.md`](web/README.md)

### 3. [`OpenBB_Service/`](OpenBB_Service/) — stateless research data (Python / FastAPI / Vercel)

Quotes, bars, company news and fundamentals through pinned OpenBB YFinance
fetchers. This project has no Telegram lifecycle, trading route, portfolio
state, database or writable runtime dependency, so it can scale independently
from the gateway.

```bash
cd OpenBB_Service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app:app --port 8010
pytest
```

Deploy it as a separate Vercel project with Root Directory
`Part2_Infrastructure/OpenBB_Service`, then use its HTTPS origin as
`OPENBB_API_URL`. Full details: [`OpenBB_Service/README.md`](OpenBB_Service/README.md).

### Also in this directory: [`developer-console/`](developer-console/) — experimental, not a deployment unit

A fourth tracked app (Next.js 16 on a Vite/Cloudflare toolchain, drizzle-orm on
SQLite) that prototypes a standalone developer console. It is **not** part of
the assessed deliverable, is deployed nowhere, and shares no code or data with
the three units above — named here so the directory tree and the docs agree.
Its SQLite/drizzle stack is unrelated to the Supabase Postgres mirror described
in §2.

---

## 1. Quick start

```bash
cd Part2_Infrastructure
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt          # or requirements-core.txt (see §8)
uvicorn main:app --port 8000
```

Open the independent gateway console at **<http://localhost:8000/app>**.

That is the whole setup. No API keys, no Redis, no database server, no Telegram
token — the console comes up with live market data and a working risk gateway.
The optional pieces are in §6 (Telegram) and §7 (Celery).

Run the tests:

```bash
pytest                                   # deterministic; no network required
```

---

## 2. Architecture

```
 Telegram companion          Gateway console / API         Next.js workspace
 cards, charts, buttons      authenticated controls        portfolio proxy
 /portfolio /quote /status        │                              │
          │ read + 5 controls     │                              │
          └──────────────┬────────┘                              │
                         ▼                                       │
              FastAPI stateful gateway ◄─────────────────────────┘
              main.py · auth · routing · one process, in Docker (:8000)
                    │       │       │
           ┌────────▼─┐ ┌───▼────┐ ┌▼──────────────┐
           │ A · TCA  │ │ B · risk│ │ C · backtest │
           │ L2 + VWAP│ │ 17 gates│ │ jobs + DSR   │
           │          │ │ py + C++│ │              │
           └────┬─────┘ └────┬────┘ └──────┬───────┘
                └────────────┼──────────────┘
                             ▼
                      DuckDB audit log ── authoritative, on a Docker volume
                             │
                             │  best-effort, bounded queue, never on the order path
                             ▼
              Supabase Postgres ── order_blotter mirror · desk_risk_limits (RLS)
                             └──── pgvector research_documents (RAG)

 Next.js OpenBB adapter ──► standalone OpenBB_Service (stateless, read-only)
```

The stateful portfolio gateway and the production OpenBB service are separate
deployments. `ALPHAENGINE_GATEWAY_URL` points here; `OPENBB_API_URL` points to
[`OpenBB_Service/`](OpenBB_Service/). The separation prevents slow research
fetches and serverless scaling from sharing the gateway's mutable risk state.

## Tech Stack

Versions are what is **actually deployed or locked** as of 2026-08-17 — read
from `web/package-lock.json`, the Python 3.12 virtualenv CI mirrors, the live
database and the running container, not from minimum pins. Rows marked *optional* degrade gracefully when absent; a managed
service carries no pinned version.

### Frontend Core

| Component | Version | Role in AlphaEngine |
|---|---|---|
| **[Next.js](https://nextjs.org)** | `16.3.0` | App Router + Turbopack on Node ≥20.9. Server-side proxy routes are the only path to backend credentials; the browser bundle ships zero secrets. |
| **[React](https://react.dev)** | `19.2.8` | One client workspace, eight role tabs. Every subtab is URL-addressable and survives back/forward. |
| **[TypeScript](https://www.typescriptlang.org)** | `5.9.3` | Strict mode. Contract fixtures emitted by the Python engine are type-checked on this side (§12 parity). |
| **[Tailwind CSS](https://tailwindcss.com)** | `4.3.3` | Utilities only, bridged onto a hand-written token system in `app/globals.css` that owns both theme palettes and an AA contrast contract enforced by `tests/theme.test.ts`. No preflight — the house reset stays authoritative. |
| **[Lucide](https://lucide.dev)** | `1.28.0` | The only icon dependency. Charts are hand-rolled SVG on one scale kit (`components/chart-kit.tsx`) — there is deliberately no chart library. |

### Backend

| Component | Version | Role in AlphaEngine |
|---|---|---|
| **[Python](https://www.python.org)** | `3.12.14` | The gateway runtime inside the container (`python:3.12-slim`, two stages). |
| **[FastAPI](https://fastapi.tiangolo.com)** | `0.141.1` | **38 documented paths carrying 39 operations.** The OpenAPI schema is a committed contract (`tools/openapi.json`) whose SHA-256 the web build verifies at `prebuild`. The three figures below look contradictory and are not — each is counted on a different basis, so state the basis rather than reconciling them into agreement. `main.py` declares **43 route decorators** (29 `@app.get` + 13 `@app.post` + 1 `@app.websocket`). Four never reach the schema: the `/ws/book/{symbol}` WebSocket, which OpenAPI does not describe, and the three HTML routes (`/`, `/app`, `/ui`) marked `include_in_schema=False` — leaving **39 operations**. Those 39 collapse onto **38 paths** because `/api/orders` serves two verbs: `POST` submits an order through the gates, `GET` lists the resting book. |
| **[Uvicorn](https://www.uvicorn.org)** | `0.52.3` | **One process, no workers, by design** — the risk gateway holds a mutable in-memory book, a resting-order book, a token bucket and the kill switch; a second worker would fork the book and localise the halt. |
| **[Pydantic](https://docs.pydantic.dev)** | `2.13.4` | Every API payload, risk decision and bot read-model shares one schema module (`modules/schemas.py`). |
| **[httpx](https://www.python-httpx.org)** | `0.28.1` | All outbound HTTP, including the Supabase mirror — chosen over `supabase-py` to keep the import graph network-free for CI. |
| **[websockets](https://websockets.readthedocs.io)** | `17.0.1` | Venue WebSocket ingest: Binance and Bybit L2 depth streams. |
| **[NumPy](https://numpy.org)** | `2.5.2` | The reference backtest engine and all TCA/risk maths. |
| **[pybind11](https://pybind11.readthedocs.io)** | `3.1.0` *(build-time)* | Binds the C++ decision core (`native/decision_core/decision_core.cpp` → `modules/_decision_core*.so`). Listed in `requirements-native.txt`, installed only in the Docker builder stage and by `requirements-dev.txt`; the runtime image carries the `.so` and no compiler. `DECISION_CORE=auto\|native\|python` selects the engine, `/health`, `/metrics` and the ops snapshot publish which one is live, and the deploy workflow warns if a container came up on Python. |
| **[pandas](https://pandas.pydata.org)** | `3.0.5` | Bar/series handling across the backtester and analytics. |
| **[vectorbt](https://vectorbt.dev)** | *optional* | Accelerator in `requirements.txt`. The NumPy engine is the documented fallback and `/health` reports which is live. |
| **[Celery](https://docs.celeryq.dev) + Redis** | *optional* | Set `REDIS_URL` and the job queue switches from the in-process pool automatically; same task callables either way. |

### Database

| Component | Version | Role in AlphaEngine |
|---|---|---|
| **[DuckDB](https://duckdb.org)** | `1.5.5` | The **authoritative** store: an embedded, append-only audit log (orders, events, backtests, equity) on a named Docker volume, with an SQLite fallback. Embedded on purpose — the desk must keep trading when every network dependency is down. |
| **[PostgreSQL](https://www.postgresql.org)** | `17.6` | The durable **mirror**, never a second decision-maker. Every gateway decision streams through a bounded queue into `public.order_blotter` with `decided_by` provenance, measured `latency_ms` and the full check vector — every gate that ran, out of the seventeen defined. |
| **[Supabase](https://supabase.com)** | managed | Hosts that Postgres. RLS deny-by-default (zero `anon` policies), append-only by trigger, `search_path` pinned on every `SECURITY DEFINER` function. Sixteen ordered migrations in [`../supabase/migrations/`](../supabase/migrations/); `tests/test_supabase_schema.py` pins SQL limit defaults to `config.py` offline. |
| **[pgvector](https://github.com/pgvector/pgvector)** | `0.8.2` | 384-dim HNSW cosine index over `public.research_documents` — see **RAG & ML** below. |

### DevOps & Infrastructure

| Component | Version | Role in AlphaEngine |
|---|---|---|
| **[Docker](https://www.docker.com)** | `29.7.2` | Two-stage `python:3.12-slim` image ([`docker/gateway.Dockerfile`](docker/gateway.Dockerfile)): the builder stage installs `requirements-native.txt` and compiles the decision core, the runtime stage copies the `.so` and nothing else from it; non-root uid 10001, stdlib health probe, compose file at the repo root. `tests/test_container_contract.py` rejects any secret-shaped literal in the committed files. |
| **[Caddy](https://caddyserver.com)** | `2-alpine` | TLS termination on the VM: the deploy workflow runs a Caddy sidecar on `:8443` with its **internal CA** (a bare IP gets no public issuance; the single client that matters pins the root instead — [`docs/TLS_FLIP.md`](../docs/TLS_FLIP.md)), so the gateway token need not cross the internet in cleartext. |
| **[Supabase CLI](https://supabase.com/docs/guides/cli)** | `2.112.0` | Migration push via the IPv4 session pooler (the direct DB host is IPv6-only) and edge-function deploys. |
| **[Oracle Cloud](https://www.oracle.com/cloud/)** | managed | The always-on host (Singapore). Region is load-bearing: US egress gets Binance HTTP 451 / Bybit 403 (§11). |
| **[Vercel](https://vercel.com)** | managed | Two serverless projects (web portal, OpenBB service) from one repo with different Root Directories, region `sin1`. Artifact custody via an Ed25519-signed build attestation against a trust root pinned in reviewed source (`web/lib/artifact-trust.mjs`). |
| **[GitHub Actions](https://github.com/features/actions)** | managed | Four network-free jobs (gateway, OpenBB, web, repo-audit) plus a manual live-smoke: a red build means the code broke, never that an exchange was slow. 864 gateway + 2,410 web + 14 service tests. Three more workflows: `deploy.yml` (gateway CD to OCI with rollback and an engine check), `openbb-keepalive.yml` and `oracle-keepalive.yml` (schedulers Vercel Hobby and Always Free cannot provide), `schema.yml` (Supabase migrations). |

### API Keys & Secrets

Every credential the platform reads, what it powers, and the only place it may
live. The rule behind the table: **the browser bundle holds zero backend
credentials**, and the service-role key never leaves the gateway host.

| Variable | Service | Powers | Lives in |
|---|---|---|---|
| `WEB_API_TOKEN` | gateway auth | every authenticated gateway route (`hmac.compare_digest`) | gateway `.env` |
| `ALPHAENGINE_GATEWAY_URL` / `_TOKEN` | web → gateway | the server-side portfolio/risk proxy; token must equal `WEB_API_TOKEN` | Vercel (server-side) |
| `ALPHAENGINE_OPERATOR_TOKEN` *(optional)* | web operator writes | absent = operator mutations locked in production (safe default) | Vercel (server-side) |
| `ALPHAENGINE_PAPER_ORDER_DEFAULT` *(optional, exact `1`)* | new paper orders only | lets a missing browser credential use the server-held operator token; supplied credentials remain strict overrides | Vercel (server-side) |
| `FMP_API_KEY` | [Financial Modeling Prep](https://financialmodelingprep.com) | equity quotes/fundamentals in the provider registry | Vercel (server-side) |
| `TIINGO_API_KEY` | [Tiingo](https://www.tiingo.com) | equity/crypto bars | Vercel (server-side) |
| `MASSIVE_API_KEY` | [Massive (Polygon)](https://polygon.io) | market aggregates | Vercel (server-side) |
| `ALPHAVANTAGE_API_KEY` | [Alpha Vantage](https://www.alphavantage.co) | fallback quotes/bars | Vercel (server-side) |
| `FIRECRAWL_API_KEY` | [Firecrawl](https://firecrawl.dev) | open-web research search | Vercel (server-side) |
| `OPENBB_API_URL` / `_TOKEN` | the OpenBB service | quotes, bars, news, fundamentals | Vercel + service env |
| `TELEGRAM_BOT_TOKEN` (+ allowlists) | [Telegram Bot API](https://core.telegram.org/bots/api) | the companion; fail-closed user allowlist | gateway `.env` |
| `TELEGRAM_LINK_SECRET` *(optional, ≥32 chars)* | Connect-button account linking | HMACs the single-use deep link that binds a chat to a web desk pass; below 32 characters the feature stays off | gateway `.env` **and** Vercel, identical |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase PostgREST | the order mirror + RAG writes | **gateway `.env` only — never Vercel** |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | Supabase (browser) | the browser Realtime client (`web/lib/supabaseClient.ts`) and, in `web/proxy.ts`, the single test for whether this deployment can authenticate anyone at all — absent, the edge mints a guest pass instead of asking for a sign-in. Publishable on purpose: RLS scopes the anon key to gateway-decided, unowned rows on the public demo desk and nothing else | Vercel |
| `ALPHAENGINE_ARTIFACT_SIGNING_KEY` | build attestation | Ed25519 signature over commit/env/tree, verified against the pinned trust root | Vercel (build-time only) |
| Binance & Bybit L2 | public venue WebSockets | **keyless** — consolidated depth needs no credential | — |

Free keys sitting in a dashboard that nothing reads are removed, not kept
"just in case" — an unused credential is pure leak surface.

### RAG & ML

Semantic recall over what the desk already records — no new instrumentation,
no paid inference, and nothing generated presented as measured.

| Layer | Choice | Why this, and what it refuses to do |
|---|---|---|
| **Corpus** | 3 document kinds in `public.research_documents` | Completed **backtest runs** (symbol, strategy, params, Sharpe, DSR verdict, OOS Sharpe, PBO, `data_hash`), session **execution summaries**, and **risk incidents** — written through the same bounded-queue discipline as the mirror. `tools/backfill_research_rag.py` replays the audit log's existing `backtest_runs`, so the corpus predates the feature. |
| **Embeddings** | [`gte-small`](https://huggingface.co/Supabase/gte-small), 384-dim, unit-normalised | Served by `Supabase.ai` inside the [`embed-research` edge function](../supabase/functions/embed-research/index.ts): no paid API, no key, no model weights in the gateway image. |
| **Index** | pgvector HNSW, cosine | `match_research_documents` is `SECURITY INVOKER` and refuses any row that is not `embedding_status='ready'`. |
| **Storage honesty** | `body` holds the exact embedded text | A renderer change can never silently invalidate stored vectors. An embed outage stores `embedding_status='pending'` — **never a zero vector**, which is equidistant from everything and would rank as "similar" to any query. |
| **Retrieval trigger** | A precisely-defined execution anomaly | An accepted fill whose *realised* slippage exceeds the pre-trade ceiling (`max_est_slippage_bps`), a rejection citing `est_slippage`/`daily_drawdown`, or the drawdown breaker engaging. Not vibes, not every order. |
| **Surfaces** | `POST /api/research/rag/search` · `GET /api/research/rag/status` | Top-3 similar historical reports attach to the alert already being broadcast. When Supabase is absent the routes return a typed `unavailable` — never `[]`, because "searched, found nothing" is a different fact. |

**Quant/statistical ML in the engine** — all in-process, no external ML service:

| Method | Answers |
|---|---|
| [Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) + PSR | Is this Sharpe real after correcting for how many strategies were tried? |
| PBO (probability of backtest overfitting) | How likely is it the search itself overfit? |
| Walk-forward out-of-sample | Does it hold on data the optimiser never saw? |
| Kupiec VaR backtest + traffic-light zones | Is the risk model calibrated, or quietly wrong? |
| Historical + parametric VaR/ES | What is the tail, by two independent methods? |
| Kelly sizing · regime classification · Monte Carlo bands | How much, in what regime, with what dispersion? |

Python is the reference implementation and TypeScript reproduces it against
committed fixtures (§12) — so a number on a phone cannot disagree with the one
on screen without a test failing.

```
Part2_Infrastructure/
├── main.py                 FastAPI gateway: routes, auth, lifespan, book WebSocket
├── config.py               Every constant and risk limit (env-overridable)
├── celery_tasks.py         Celery task definitions (optional backend)
├── worker.py               Celery worker entrypoint (optional)
├── modules/
│   ├── tca_engine.py       A · L2 ingest, book state, VWAP/slippage, routing
│   ├── risk_proxy.py       B · gates, positions, resting book, breaker, kill switch,
│   │                       the startup core self-measure
│   ├── decision_core.py    B · which engine decides (DECISION_CORE=auto|native|python)
│   ├── backtester.py       C · signals, engines, DSR/PSR, walk-forward, plots
│   ├── portfolio.py        PM view: concentration, headroom, binding constraint
│   ├── research.py         Local OpenBB bridge for bot/compatibility use
│   ├── research_rag.py     pgvector research index (off by default)
│   ├── jobs.py             Async job queue (in-process pool ⇄ Celery)
│   ├── audit.py            DuckDB append-only audit log
│   ├── telegram.py         Read models, cards, inline keyboards, alerts, webhook/polling
│   ├── telegram_charts.py  Sixteen matplotlib PNG generators for the companion
│   ├── quant_risk.py       VaR/ES, risk contribution, Kelly, regime, dislocation
│   ├── operations.py       Typed, secret-free ops snapshot (/api/ops/snapshot)
│   ├── metrics.py          Prometheus text exposition, hand-rolled (no client lib)
│   ├── web_telemetry.py    Cross-instance ops ledger the web instances sync into
│   ├── data_ops_store.py   Strict SQLite store (WAL, one lock) for the data-ops tables
│   ├── data_quality.py     Contract-finding ledger, escalation rules, Telegram + audit publish
│   ├── work_items.py       The Data tab's persisted, versioned, audit-logged work queue
│   ├── data_jobs.py        Replay and backfill executors, and the Python bar contract
│   ├── data_scheduler.py   Config-driven cadence for replay and backfill (DATA_SCHEDULES)
│   └── schemas.py          Pydantic contracts shared by API, UI and bot
├── native/decision_core/   decision_core.cpp + setup.py — the C++ pre-trade
│                           arithmetic battery, built into modules/_decision_core*.so
├── templates/miniapp.html  Independent gateway console (single file, no build step)
├── tests/                  Gateway, risk, portfolio, research and bot tests
├── tools/                  Parity-fixture generators, bench_decision.py, the Telegram
│                           catalogue generator, committed-tree build guard
├── docker/                 gateway.Dockerfile + deploy notes (compose file at repo root)
├── requirements.txt        (+ -core, -dev, -native, -openbb variants)
│
├── web/                    Unit 2 — Next.js research portal (deployed to Vercel)
├── OpenBB_Service/         Unit 3 — stateless OpenBB API (deployed separately)
└── LICENSE

../supabase/                Postgres mirror + RAG: migrations, seed, edge function
../docker-compose.yml       One-command always-on gateway (host port 8000)
```

---

## 3. Module A — Cross-Venue TCA & Order Book Depth

**The trading problem.** Slippage is a compounding tax. A signal with 12 bps of
expected edge is *unprofitable* if crossing the book costs 15 bps. And because
liquidity is fragmented, the cheapest venue changes minute to minute.

**What it does.**

- Maintains L2 books from **Binance** (`@depth20@100ms`) and **Bybit**
  (`orderbook.50`, snapshot + sequenced deltas) over WebSocket.
- Walks the real ladder for a target notional to produce **VWAP, slippage in bps,
  levels consumed** and whether the size is fillable at all.
- **Smart routing:** merges every venue's levels into one consolidated ladder,
  sorts by price, and walks it. The per-venue split of that walk *is* the routing
  instruction, and it is provably the lowest achievable blended cost for that size.
- Reports the saving versus the worst single venue, in bps and in dollars.

Live output for a $100k BTCUSDT buy:

```
consolidated mid : 62669.28 | venues: ['BINANCE', 'BYBIT']

venue              vwap  slip bps  levels  fillable
BINANCE        62668.59     0.001       1      True
BYBIT          62670.90     0.008       1      True

SMART ROUTE:
  BINANCE    100.00%  $     100,000 @ 62,668.59
  blended vwap 62,668.5900  slip -0.111 bps
  saving vs worst venue: $3.69 (0.369 bps)
```

**Design decisions worth defending:**

- *Partial-book streams over diff streams.* Binance's diff stream requires REST
  snapshot + buffered-delta reconciliation, and silently corrupts the book if one
  message is dropped. `@depth20@100ms` is self-healing: every message is a
  complete top-20 snapshot. Bybit's feed *is* sequence-tagged, so it is consumed
  as snapshot + delta — and a **sequence gap forces a reconnect** rather than
  trusting a book that may have holes.
- *Depth-weighted consolidated mid.* A single venue's mid is unstable when that
  venue is thin. Weighting by top-5 depth gives a reference price that does not
  jump when one book momentarily crosses.
- *Crossed consolidated books are real.* You will see negative consolidated
  spreads in the UI. That is not a bug: across venues, best-bid can genuinely
  exceed best-ask for tens of milliseconds. Showing it is more honest than
  clamping it, and it is exactly the signal a cross-venue arb desk watches.
- *Auto-reconnect with exponential backoff + jitter*, and a staleness clock per
  venue — a feed that stops updating is excluded from pricing before it can
  poison a fill estimate.

**Offline behaviour.** If every venue is unreachable, a synthetic random-walk
book is generated so the system stays demonstrable. Every payload derived from it
carries `synthetic: true` and the UI shows a **⚠ SYNTHETIC** badge. Nothing
derived from simulated data is ever presented as live.

---

## 4. Module B — Pre-Trade Risk Gateway & Kill-Switch

**The trading problem.** The expensive failures on an automated desk are not bad
signals, they are operational: an extra zero, a strategy re-firing in a tight loop
after a rejected ack, an exchange ban from rate-limit abuse, a position that keeps
averaging into a liquidation cascade. Every order therefore passes one choke point
that can say *no* in microseconds, and a human can stop the desk with one message.

**The 17 gates**, evaluated cheapest-first. Rows 4 and 5 are marked *paper
equity* because they exist only for that path — an order priced from a trusted
vendor quote instead of a live L2 ladder — and never run against a crypto order:

| # | Gate | Guards against |
|---|---|---|
| 1 | `kill_switch` | everything — one boolean read, always first |
| 2 | `symbol_halt` | per-instrument suspension |
| 3 | `symbol_whitelist` | trading an instrument nobody approved |
| 4 | `paper_execution_model` *(paper equity)* | claiming a fill model the input cannot support — a quote is a price, not a book, so this path accepts `MARKET` only and refuses to pretend a resting `LIMIT` has depth behind it |
| 5 | `reference_freshness` *(paper equity)* | sizing against a quote that has gone off — age bounded by `PAPER_EQUITY_QUOTE_MAX_AGE_S` (a week by default, so a weekend close still demonstrates), and rejected outright if it is dated more than 60 s into the future, which is a clock fault rather than a quote |
| 6 | `duplicate_order` | a retrying algo double-firing |
| 7 | `rate_limit` | runaway loops and exchange bans (token bucket) |
| 8 | `price_available` | pricing an order with no live mark |
| 9 | `order_sized` | ambiguous quantity/notional |
| 10 | `max_order_notional` | **fat finger** — $50k cap |
| 11 | `symbol_concentration` | projected per-symbol exposure, resting orders included |
| 12 | `gross_exposure` | projected book-wide exposure, likewise |
| 13 | `price_band` | limit price far from mark (fat finger, part 2) |
| 14 | `working_book` | an algo that places and never cancels — the resting book has a ceiling of its own |
| 15 | `daily_drawdown` | the bad day — hard stop at 5% of start-of-day equity |
| 16 | `reduce_only` | *adding* risk once 80% of the drawdown budget is spent, while still allowing the exit |
| 17 | `est_slippage` | illiquid size — measured on the **routed** execution, not the mid |

Measured: **15 µs p50** for the whole decision on the compiled engine and
**23 µs** on the Python reference (5 000 orders, two venues, dev Mac,
`tools/bench_decision.py`); the arithmetic battery inside it — the consolidated
mark, sizing, projected exposure, price band, drawdown, reduce-only and the
cross-venue routed slippage walk — runs in a C++ core that times its own work
with `steady_clock` at **83 ns p50** on that Mac and **~320 ns p50 / 352 ns
p99** on the shared production VM (read from the live `/metrics` on
2026-08-17). The three figures are three planes and never blended — the
decision in µs, the core in ns, the ~70 ms round trip to the venue in ms —
and [`docs/LATENCY_BUDGET.md`](../docs/LATENCY_BUDGET.md) is the full
argument, with the regenerated table. `reduce_only` was added
with the reduce-only work and the count moved from twelve to fourteen; the two
that were previously one row are now their own, because a hard stop and a
graduated throttle are different controls and a reader should be able to see
both. `working_book` took it to fifteen on exactly that precedent. Resting orders
introduced a resource an algo can exhaust without breaching a single notional
limit — an order that is placed and never cancelled costs unbounded memory and an
unbounded sweep, which is the runaway-loop failure this module exists to stop —
and a ceiling that never appears in a check vector is a ceiling nobody audits.
Paper equity then took it to seventeen for the same reason a third time: quoting
an equity off a vendor snapshot introduces two failure modes a crypto order
cannot have — a stale reference price and an order type the quote cannot honour —
and both were already being refused in code before either had a named row here.
An unnamed refusal is worse than a strict one: the trader sees a rejection with
nothing to look up.

**Two engines, one battery, one fixture.** The seventeen gates exist twice on
the server: the Python reference in `risk_proxy.py::RiskGateway.submit`, and a
native core (`native/decision_core/decision_core.cpp`, pybind11) that owns the
book ladders and every gate that is arithmetic — rows 8–13 and 15–17 above,
including the routed walk that prices `est_slippage`. The eight it does not
evaluate are not arithmetic: kill switch, symbol halt, whitelist, the two
paper-equity gates, duplicate-order membership, the rate-limit token consume
(which mutates and so runs exactly once, in Python) and the working-book depth
are state reads, evaluated before the core's clock starts. `DECISION_CORE=auto`
uses the compiled core when it imports and the reference otherwise; `native`
refuses to start without it; `python` pins the reference. Which one is live is
on `/health`, `/metrics` (`alphaengine_decision_engine{engine=…}`), the ops
snapshot and the desk header. The standard between them is bit-for-bit, not a
tolerance: `tools/make_gate_fixture.py` records the reference's verdict for
twenty scenarios into `web/tests/fixtures/gate-parity.json`, and
`tests/test_gate_parity.py` (Python) and `tests/test_decision_core_native.py`
(C++) each assert the same accept/reject, the same gate order and the same
observed and limit floats. Getting there surfaced three silent-wrongness traps
worth naming — CPython's Neumaier-compensated `sum()`, FMA contraction, and
`list.sort`'s stability under `reverse=True` deciding which venue fills a price
tie — each now pinned. At startup the gateway also times the compiled battery
once on a synthetic two-venue book (`RiskGateway.run_core_self_measure`, 300
samples after 50 warm-ups) so the nanosecond figure is published before the
first order; those samples land only in the core (ns) histogram, counted
separately as `core_self_test_samples`, and never in the decision (µs) one.

Nine of the seventeen are conditional on the order in front of them.
`paper_execution_model` and `reference_freshness` need a paper-equity quote to
check. `max_order_notional`, `symbol_concentration` and `gross_exposure` each
price a *size*, so all three are skipped when the order could not be sized at all
— which is exactly the feed-outage case: a crypto `MARKET` order carrying a
quantity but no live mark runs eight gates, rows 1–3, 6–9 and `daily_drawdown`,
and never reaches a notional limit because there is no notional to compare.
`price_band` and `working_book` apply only to a `LIMIT`, `reduce_only` only
inside the defensive regime and only to an order that has a size to call
reducing, and `est_slippage` only where there is a size to route. A returned
vector is therefore the gates that *ran*, not a fixed-length row — a check that
did not apply and a check that passed are different facts, and collapsing them
would be the same mistake as reporting a missing number as zero.

**Principles:**

1. **Deny on ambiguity.** No live mark ⇒ reject. The gateway never guesses a price.
2. **Every decision is evidence.** Accepted *and* rejected orders are written to
   the audit log with the full check vector. A post-mortem can answer "why did
   this get through?" without re-running anything. A rejection returns HTTP 200 —
   it is a business outcome, not an error.
3. **The breaker is automatic.** A background monitor marks positions to market
   every 1 s (`RISK_MONITOR_INTERVAL_S`; it was 5 s) and trips the kill switch
   itself at the drawdown limit, with a warning
   alert at 80% of budget. No human required.
4. **Limits live in code with env overrides.** A limit that a compromised service
   can mutate at runtime is not a limit. `Settings` is a frozen dataclass; changing
   a hard limit requires a deploy, and therefore a code review.
5. **The gate measures what the fill will do.** The liquidity check runs against
   the *routed* execution, not the best single venue — otherwise the gateway would
   reject orders the router could fill, and understate cost on ones it accepted.
   `tests/test_risk_proxy.py::test_slippage_check_and_fill_price_agree` pins this.

**Paper fills are priced off the ladder, not the mid.** Filling at mid is the most
common way a paper system flatters itself. A **taker** — a market order, or a
limit that crosses the spread — fills at the smart route's actual VWAP and pays
`PAPER_FEE_BPS`, so paper PnL carries live cost structure.

**A maker is priced differently, and has to be.** A resting order fills when the
consolidated touch crosses it, at **its own limit price**, and pays
`PAPER_MAKER_FEE_BPS`. It is on the other side of that trade: somebody crossed the
spread to reach it. Charging it a taker fee, or filling it at a route VWAP that
walked *through* its own limit, would report a cost the desk did not pay. Its
measured slippage against the mark is therefore often **negative** — that is price
improvement, it is the honest number, and it is what makes maker-versus-taker
economics visible in the blotter rather than a footnote.

**Kill-switch control stays inside authenticated surfaces.** Use the gateway
console or `POST /api/risk/kill` and `/api/risk/resume`; every change is audited
with actor and reason. Telegram reaches the same switch through `/halt` and
`/resume`, but only from the second, narrower control allow-list and only through
a two-message confirmation the API path does not require (§6): a chat message is
an unusually easy thing to send by accident and an unusually easy thing to
forward, so the surface that is easiest to reach carries the ceremony.

### Resting orders

A `LIMIT` order nobody is willing to meet has somewhere to wait. Five states cover
its whole life:

| State | Means |
|---|---|
| `WORKING` | resting on the book: live, cancellable, and counted against exposure |
| `FILLED` | the consolidated touch crossed it |
| `CANCELLED` | pulled — by a trader, a replace, the kill switch, reduce-only, a session roll or a book reset |
| `EXPIRED` | a `DAY` order that reached the session boundary, or an `IOC` with nothing to be immediate against |
| `REJECTED` | never rested; a gate said no |

`PARTIALLY_FILLED` is deliberately absent, and its absence is load-bearing. The L2
feeds carry ladder *snapshots*, not trade prints (§3), so how much of a resting
order a crossing trade consumed cannot be measured from this data. A state that
can never be reached honestly is a state that advertises a model this system does
not have.

**The matcher** is a 1 s sweep (`WORKING_ORDER_SWEEP_S`) over the resting book
against `TCAEngine.top_of_book` — the **consolidated touch**, the best bid and
offer anyone is actually displaying. Deliberately *not* `consolidated_mid`: that
number is depth-weighted, which is what makes it a stable reference and exactly
what makes it the wrong thing to fill against. A limit order crosses when somebody
is showing a price through it, not when a weighted average drifts past it. The
sweep reads the same `_live_books` the router does, so a stale venue cannot fill a
resting order for the same reason it cannot price a route, and it is directly
callable (`sweep_working_orders`) so a test observes a fill deterministically
instead of waiting out a timer and still not knowing when it happened.

**Time in force** is `GTC`, `DAY` or `IOC` — three, not the usual six. `FOK` is
not offered because fill-or-kill is only meaningful alongside partial fills, and
advertising it would imply the model above. A `MARKET` order sent with `GTC` or
`DAY` is a 422 rather than a silent coercion to `IOC`: a market order that rests
is not a thing, and quietly rewriting one answers a question nobody asked. Clients
that never send the field are unaffected — `submit` resolves an absent value to
`GTC` for a `LIMIT` and `IOC` for a `MARKET`, which is what the gateway did before
resting orders existed.

**Three things empty the book, and each is an invariant rather than a courtesy.**

1. **The kill switch.** The halt alert says *"all new orders are now rejected"*.
   With resting orders alive that sentence was false — an order placed before the
   halt would have kept trading through it. A halt that does not reach the resting
   book is not a halt, so `trigger_kill` cancels it and says how many it pulled.
2. **Reduce-only.** The defensive regime accepts only orders that make the book
   smaller. An order that rested before the threshold was crossed does not know
   that, and one that fills afterwards makes the book bigger — which would leave
   the regime a claim rather than a control. The sweep pulls every resting order
   that would add risk, by the same reducing test gate 16 (`reduce_only`) applies to an incoming one.
3. **Session rollover and book reset.** Every resting order dies at the boundary,
   `DAY` or not. That is what guarantees a decision and its fill land in the same
   UTC session and on the same side of a `book_reset` — the property the
   rehydration replay depends on without knowing this code exists. The `DAY`
   orders are retired **first**, and as `EXPIRED` rather than `CANCELLED`,
   because a `DAY` order at midnight did exactly what its time in force
   promised. With the blanket cancel running first, `EXPIRED` was a state the
   schema declared that this route could never reach, and the blotter read as
   though the system had pulled an order that had simply run out of day.

**Storage.** `orders` still holds one row per order, written once, when the order
reaches a terminal state — so the resting phase never leaves behind a row that a
later write has to mutate. `ts` is when that outcome happened and `decided_at` is
when the gates ran; for a `MARKET` order they are the same instant, which is why
every pre-existing row stays correct, and for a resting order they are not, so the
blotter shows a fill when it filled rather than an hour earlier. The transitions
themselves go to a new append-only `order_events` table. That is what lets an order
outlive its own request without costing the audit log the append-only property the
whole replay path is built on.

---

## 5. Module C — Asynchronous Parametric Backtester

**The trading problem.** Research is throughput-bound. But throughput without
statistical discipline just finds noise faster.

**The honest-machinery argument.** The best Sharpe in a grid of 400 is *a maximum
of 400 draws*, not an estimate of edge. A grid over a pure random walk reliably
produces "Sharpe 1.8" somewhere. Two corrections ship with every sweep:

- **Deflated Sharpe Ratio** (Bailey & López de Prado 2014). The hurdle is the
  Sharpe a *random* search of the same size would have produced:

  ```
  SR*₀ = √V[{SRₙ}] · [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]
  ```

  DSR is then PSR measured against that hurdle, accounting for sample length,
  skew and kurtosis. Note the null **drops the sample mean** — a common
  implementation slip is to add it back, which makes the hurdle negative when a
  grid is uniformly unprofitable and lets a losing strategy clear it.
- **Walk-forward.** Parameters are chosen in-sample on each fold and scored on the
  *next*, unseen fold. The aggregate OOS Sharpe is the only number here computed
  on data the parameter choice never touched.

A real run on ETHUSDT 4h — and why the discipline matters:

```
best 5/200   sharpe +1.258   return +82.18%   maxDD -37.95%
DSR 0.713    walk-forward OOS sharpe -0.343
  -> FAIL — the winning Sharpe is consistent with selection bias over this grid.
```

An 82% backtest return that the system refuses to endorse. That is the feature.

**Engineering:**

- Sweeps run **off the request path** in a worker pool — the event loop that
  carries the kill switch must never queue behind a 30-second backtest.
- 74 combinations × 3000 bars in **~2.3 s** (vectorbt, whole grid as one 2-D
  portfolio).
- **Two engines.** vectorbt is primary; a dependency-free NumPy engine implements
  identical accounting as a fallback (numba ABI breakage should not make the
  module unrunnable). `test_engines_agree_on_direction_and_scale` asserts they
  agree on return, Sharpe, exposure and fees.
- Three models: MA crossover, Donchian breakout, RSI reversion.
- Data: Binance public klines → DuckDB cache → deterministic synthetic. The cache
  is what makes an offline environment work.
- Outputs an equity curve (with drawdown panel and the DSR verdict rendered into
  the image) and a Sharpe surface heatmap — a smooth plateau is a robust region,
  an isolated peak is an overfit. Telegram can queue a sweep on the same jobs
  engine (`/backtest`) and reports progress and results as cards and charts —
  research, never execution: it cannot send an order.

---

## 6. Telegram

The companion is optional: the gateway, API and web workspace remain fully
functional with no Telegram token. When enabled, it is an independent text and
visual-chart interface for phone-friendly portfolio, OpenBB, execution and
health cards. It does not render a web page or send web links, and it cannot
open a position. The companion registers **114 commands**; **5** of them change
what the desk is allowed to do — `/halt`, `/resume`, `/flatten`, `/reduceonly`,
`/resetbook` — and each requires membership of `TELEGRAM_CONTROL_USER_IDS`
(**Gated controls**, below), which is separate from the read allow-list and
empty by default, and **90** are pushed to Telegram's `/` menu (the API caps
that list at 100; the rest still dispatch, and `/commands` lists them all). Of
the reads, all but one are pure — the exception is `/backtest`, which queues a
sweep on the same jobs engine the API and the web use. That crosses into
research, not execution: it submits work to the queue and never an order to the
gateway. Notification preferences and liquidity watches also change from chat,
but they are the companion's own state rather than the desk's. The command
tables below are generated from the registry by `tools/telegram_catalogue.py`,
so these counts and the pushed menu cannot drift from what the bot dispatches.

**It is interactive, not a text pager.** The command centre (`/start`,
`/menu`), the eight tab cards and their section cards carry inline keyboards
built by `kb()` against the same registry, so a button that points at nothing
is a red test rather than a dead button a user finds first; a tap is authorised
on the *tapper* (`callback.from`), never on the tapped message's author, and
the Controls category is refused from a button outright — no confirmation
challenge is ever issued by a tap. Refresh edits the tapped card in place
(Telegram's "message is not modified" means the tap already succeeded and
nothing is resent; any other refusal falls through to a fresh send). Symbol and
interval rows switch a card without retyping. Sixteen chart generators in
`modules/telegram_charts.py` — series, bars, depth, drawdown, histogram,
heatmap, equity, paired bars, gate ladder, latency CDF, scatter, multi-series,
VaR breach, pipeline, cone, status grid — draw what they were handed or return
`None`, never a placeholder captioned as data. Charts and buttons come from
`modules/telegram_charts.py` and `modules/telegram.py` alone; the companion
still renders no web page and sends no web link.

### Fail-closed bootstrap

1. Create the bot with `@BotFather`. Put the token only in an ignored `.env`
   file or host secret as `TELEGRAM_BOT_TOKEN`; never put it in source or docs.
2. Leave `PUBLIC_URL` empty and use `TELEGRAM_MODE=polling` (or `auto`) for the
   first local start. Leave `TELEGRAM_ALLOWED_USER_IDS` empty.
3. Message `/whoami`. With no allow-list, only `/start`, `/help`, `/commands`,
   `/about`, `/whoami` and `/version` work; operational data fails closed.
4. Copy the reported **Telegram user ID** into
   `TELEGRAM_ALLOWED_USER_IDS`, then restart. Authorization follows
   `message.from.id`, so an allowed group does not authorize every group member.
5. Optionally put destination **chat IDs** in `TELEGRAM_ALERT_CHAT_IDS` for
   centrally managed alerts. User IDs authorize; chat IDs only identify where
   notifications are delivered. An allow-listed user must run `/subscribe`
   once in each destination so the bot records its current authorised owner;
   ownerless legacy rows never receive pushes.

There is a second way in, and it does not require an operator or a restart: the
**Connect** button in the workspace header. It mints a single-use, HMAC-signed
deep link (`TELEGRAM_LINK_SECRET`, set identically on the gateway and the web
deployment) that binds the chat to the web identity that tapped it — account or
guest pass. The grant is read parity and nothing more: a bound chat sees exactly
what that identity could already see by opening the workspace, over a second
transport. It never reaches `_may_control`, so a binding cannot halt, resume,
flatten, set reduce-only or reset the book. The direction is one-way by design —
a web identity authorises a Telegram read; no Telegram identity ever
authenticates a web request. The secret must be at least 32 characters; below
that the feature stays off and the gateway refuses connect codes outright rather
than guessing at one.

For webhook delivery, set a stable HTTPS `PUBLIC_URL`, choose
`TELEGRAM_MODE=webhook`, and configure a unique random
`TELEGRAM_WEBHOOK_SECRET` of at least 32 characters. The gateway refuses an
insecure webhook configuration. Long-polling needs no public endpoint and has
the same command behavior.

### Token rotation

Treat a token pasted into chat, a ticket, a screenshot or a log as compromised.
Use BotFather to revoke it, replace the environment secret with the newly issued
value, restart the gateway, and verify the bot identity with `/version` or
`/whoami`. Never document or reuse the exposed value. Rotation does not change
`TELEGRAM_ALLOWED_USER_IDS` or subscription records.

### Discoverability

The command menu is generated from the same registry as dispatch and help, so
the menu cannot advertise an unimplemented command. Use `/commands` for the
complete catalogue, `/help portfolio` for a category, or `/help quote` for exact
syntax and a copyable example. Responses use consistent text cards with an
explicit `LIVE`, `DELAYED`, `STALE`, `SYNTHETIC` or failure label, data source,
UTC timestamp and suggested next commands.

Market commands call this process's local `modules/research.py` bridge directly;
they never call or open the web workspace. Install `requirements-openbb.txt` on
the gateway host to enable them. The standalone `OpenBB_Service` remains the
production `OPENBB_API_URL` target for the Next.js workspace, so web research
can scale independently from portfolio state.

<!-- telegram-catalogue:start -->

#### Tabs

| Command | Purpose |
|---|---|
| `/overview` | System signal & cross-role dashboard + chart |
| `/research [SYMBOL]` | Strategy sweep & tearsheet + chart |
| `/execution [SYMBOL]` | Live L2 book & routing + chart |
| `/data` | Quality, freshness & failover + chart |
| `/reliability` | Telemetry & latency + chart |
| `/developer` | CI/CD, OpenAPI & repo posture + chart |
| `/portfolio` | Whole-book PM summary + charts |
| `/risk` | Drawdown, gateway budget & limit utilisation + charts |

#### Essentials

| Command | Purpose |
|---|---|
| `/start` | Open the command centre |
| `/menu` | Tappable desk menu |
| `/help [CATEGORY\|COMMAND]` | Help by category or command |
| `/commands` | List the complete command catalogue |
| `/status` | Gateway, feeds, queue and OpenBB |
| `/about` | What this independent bot does |
| `/whoami` | Show Telegram user and chat IDs |
| `/version` | Runtime version and bot mode |
| `/ping` | Check command-path responsiveness |
| `/ops` | Structured reliability snapshot |

#### Portfolio

| Command | Purpose |
|---|---|
| `/equity [LIMIT]` | Persisted equity curve and period returns |
| `/positions [SYMBOL]` | Open positions and marks |
| `/pnl` | Realised and unrealised P&L |
| `/exposure` | Gross, net and leverage |
| `/concentration` | Largest weights and effective bets |
| `/headroom` | Remaining capacity before limits |
| `/limits` | Deployed hard risk limits |
| `/attribution` | Flow and costs by strategy |
| `/allocation [ew\|iv\|erc\|mv]` | Current vs target weights and the rebalance trades |
| `/performance` | Realised P&L and fees by strategy sleeve |

#### Markets

| Command | Purpose |
|---|---|
| `/openbb` | OpenBB provider readiness |
| `/quote SYMBOL [equity\|crypto]` | OpenBB quote |
| `/bars SYMBOL [15m\|1h\|4h\|1d] [COUNT]` | Recent OpenBB OHLCV rows |
| `/trend SYMBOL [INTERVAL] [COUNT]` | Return and direction over recent bars |
| `/range SYMBOL [INTERVAL] [COUNT]` | High/low range over recent bars |
| `/volume SYMBOL [INTERVAL] [COUNT]` | Latest and average volume |
| `/news SYMBOL [COUNT]` | Latest company headlines |
| `/fundamentals SYMBOL` | Company profile and key metrics |
| `/snapshot SYMBOL [equity\|crypto]` | Quote, fundamentals and headlines |
| `/symbols` | Tracked instruments and examples |
| `/compare SYM1 SYM2 [SYM3…] [INTERVAL]` | Normalised price overlay across instruments |

#### Execution

| Command | Purpose |
|---|---|
| `/book SYMBOL` | Top of book across venues |
| `/spread SYMBOL` | Venue and consolidated spreads |
| `/depth SYMBOL` | Bid/ask depth by venue |
| `/tca SYMBOL NOTIONAL [BUY\|SELL]` | VWAP, slippage and smart route |
| `/route SYMBOL NOTIONAL [BUY\|SELL]` | Smart-route allocation only |
| `/liquidity SYMBOL [NOTIONAL]` | Fillability and route capacity |
| `/venues` | Venue connectivity overview |
| `/feedstatus` | Detailed market-feed health |
| `/orders [COUNT]` | Recent gateway decisions |
| `/fills [COUNT]` | Recent accepted fills |
| `/rejections [COUNT]` | Recent rejected orders |
| `/slippage` | Aggregate execution slippage |
| `/fees` | Aggregate execution fees |
| `/timeline ORDER_ID` | Lifecycle of one order from the audit trail |
| `/working [SYMBOL]` | Orders resting on the book right now |
| `/lineage [SYMBOL]` | Signal path OpenBB→feeds→book→gates→decisions→audit |
| `/gates [SYMBOL] [NOTIONAL] [BUY\|SELL]` | Dry-run the 17 pre-trade gates against current state |
| `/quality [venue\|strategy]` | Fill quality by venue or strategy |
| `/imbalance SYMBOL` | Order-book imbalance per venue |
| `/costs [YYYY-MM-DD]` | Session fees versus slippage |
| `/latency` | Decision-latency CDF and route tail |
| `/blotter [all\|fills\|rejects\|working] [N]` | Merged recent orders and working, rejections by gate |
| `/spreadhistory SYMBOL [VENUE] [spread\|slip\|depth]` | Spread, slippage or depth history per venue |

#### Research

| Command | Purpose |
|---|---|
| `/researchstatus` | OpenBB and job-system status |
| `/jobs [COUNT]` | Recent research jobs |
| `/job JOB_ID` | Inspect one job |
| `/backtests [COUNT]` | Completed backtest history |
| `/backtest SYMBOL [INTERVAL] [STRATEGY]` | Queue a parameter sweep on the shared jobs engine |
| `/rag QUERY` | Similarity search over this desk's own runs and incidents |
| `/strategies [STRATEGY]` | Supported strategy catalogue |
| `/intervals` | Supported market horizons |
| `/events [COUNT]` | Recent risk/audit events |
| `/incidents [COUNT]` | Warning and critical events |
| `/walkforward SYMBOL [STRATEGY]` | In-sample vs out-of-sample Sharpe per fold |
| `/stability SYMBOL [STRATEGY]` | Parameter-grid heatmap and the stable region |
| `/overfit SYMBOL [STRATEGY]` | DSR, PSR, PBO and the minimum track record |
| `/decision SYMBOL [STRATEGY]` | Promotion gates and sizing for a candidate |

#### Alerts

| Command | Purpose |
|---|---|
| `/subscribe` | Receive operational notifications |
| `/unsubscribe` | Stop optional notifications |
| `/subscriptions` | Show notification state |
| `/watch SYMBOL [NOTIONAL] [MAX_BPS]` | Watch execution-cost deterioration |
| `/unwatch [SYMBOL]` | Remove one or all liquidity watches |
| `/watches` | Show active liquidity watches |
| `/digest` | On-demand portfolio and systems digest |

#### Risk

| Command | Purpose |
|---|---|
| `/var [1d\|4h\|1h]` | Portfolio VaR and expected shortfall |
| `/riskcontrib [INTERVAL]` | Which position carries the risk |
| `/correlation [INTERVAL]` | Cross-position correlation matrix |
| `/stress [SCENARIO]` | Scenario loss on the current book |
| `/varbacktest [INTERVAL]` | Has the VaR model been right? |
| `/rebalance [ew\|iv\|erc\|mv]` | Target weights and the trades to reach them |
| `/regime SYMBOL [INTERVAL]` | Volatility regime for an instrument |
| `/size WIN_RATE PAYOFF [EQUITY]` | Kelly position sizing from a win rate |
| `/dislocation SYMBOL` | Cross-venue crossed-book check |
| `/montecarlo [1\|5\|20]` | Bootstrapped terminal-P&L cone over a horizon |
| `/beta SYM [REF]` | Beta and hedge ratio of a symbol against a reference |

#### Data

| Command | Purpose |
|---|---|
| `/trust` | Feed trust verdict and book-age freshness |
| `/dataquality [N]` | Feed degrade/recover events and reconnect counts |
| `/payload SYMBOL` | Per-venue provenance for one symbol |
| `/providers` | OpenBB, venue feeds and web-ops quota/outages |
| `/tasks` | The persisted Data work queue by status, and the research jobs engine |

#### Reliability

| Command | Purpose |
|---|---|
| `/sli` | Service-level indicators and the native core's latency |
| `/planes` | Provider, platform and evidence dependency planes |
| `/circuits` | Risk breakers as a headroom ladder |
| `/traces [N]` | Recent audit events merged with web outages |
| `/remediation` | The five typed controls, their scope and live state |
| `/webops` | Web telemetry ledger: p50/p99, outages, quota |

#### Developer

| Command | Purpose |
|---|---|
| `/readiness` | Launch-readiness grid across runtime and backends |
| `/cicd` | The verify gates a deploy must pass |
| `/apis [TAG]` | OpenAPI surface by tag, or one tag's operations |
| `/codebase` | Python file and line counts by area |

#### Controls

| Command | Purpose |
|---|---|
| `/halt [SYMBOL] \| /halt CODE` | Engage the kill switch |
| `/resume [SYMBOL] \| /resume CODE` | Release the kill switch |
| `/flatten [SYMBOL] \| /flatten CODE` | Close every open position |
| `/reduceonly [on\|off] \| /reduceonly CODE` | Accept only risk-reducing orders |
| `/resetbook \| /resetbook CODE` | Reset the paper book and session accounting |

<!-- telegram-catalogue:end -->

The command tables above are generated from the registry by
`tools/telegram_catalogue.py --write`, and `--check` fails CI when the tables,
the intro counts, or the live checklist drift from `COMMAND_SPECS`. Every button,
`/menu` tab and `Next:` line resolves to a command in one of these tables. The
whole Risk category is read-only — `/rebalance` and `/allocation` compose a trade
list and never send one — and computed by `modules/quant_risk.py` against the
gateway's own book, so a VaR quoted on a phone and the same VaR on the risk tab
cannot be allowed to disagree.

#### Gated controls, in detail

These five — the **Controls** table above — are the only commands that change what
the desk is allowed to do, and they are the reason `TELEGRAM_CONTROL_USER_IDS`
exists as a **second, narrower allow-list** than the one that grants read access.
It is empty unless someone sets it: being able to see the book does not imply
being able to stop the desk. A chat bound through the workspace's **Connect**
button never reaches this list either — a binding grants reads and nothing else.

The two-call shape is the control. The bare command returns a single-use,
user-bound confirmation code that expires in ninety seconds and is burned even on
a wrong guess; the second call spends it. A forwarded message therefore cannot
fire one, and `/flatten` submits through the same pre-trade gates as a manual
order rather than around them.

### Security and delivery guarantees

- Operational commands require a user ID in `TELEGRAM_ALLOWED_USER_IDS`, or a
  chat bound to a web desk pass through the workspace's **Connect** button; with
  neither, the bot exposes bootstrap identity/help only.
- The bot cannot *open* a position: there is intentionally no `/order` command,
  and no way to reach one. The five commands that change what the desk is
  allowed to do are `/halt`, `/resume`, `/flatten`, `/reduceonly` and
  `/resetbook`, and each needs the separate control allow-list *and* a
  confirmation code — which a binding never grants. `/flatten` does enter
  orders — closing ones, submitted through the same seventeen pre-trade gates as
  a manual order rather than around them — so the guarantee is that the
  companion cannot add risk, not that it never trades. `/backtest` queues a
  sweep, which is research and reaches the jobs engine rather than the gateway.
  Subscriptions and liquidity watches are the companion's own state, not the
  desk's.
- `/start` does not silently subscribe. Subscription changes are explicit and
  persisted in the audit store.
- Webhook requests require Telegram's matching
  `X-Telegram-Bot-Api-Secret-Token`; update IDs are deduplicated and commands are
  rate-limited per user.
- Provider and user text is HTML-escaped, long cards split on safe boundaries,
  and transport errors are sanitized so a token-bearing API URL is never
  returned through logs or health payloads.
- Transition alerts fire once on breach and once on recovery rather than every
  polling interval, reducing alert fatigue without hiding state changes.

---

## 7. API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | all three modules + feed health |
| `GET` | `/metrics` | Prometheus text exposition — feeds, risk, queue, latency |
| `GET` | `/api/ops/snapshot` | authenticated, versioned and secret-free SRE snapshot — feed freshness, risk mode, queue, audit, alerting and route latency |
| `POST` | `/api/ops/web-state/sync` | one web instance's telemetry deltas in, the merged cross-instance view out — including the durable data-quality ledger |
| `GET` | `/api/data-quality/view` · `findings` | the merged contract-finding ledger (SQLite on the data volume, seven-day retention) and its older rows, filtered |
| `GET` `POST` | `/api/data/work-items` | the Data tab's persisted work queue: list, and create (versioned, audit-logged) |
| `PATCH` | `/api/data/work-items/{id}` | a versioned edit; a stale version answers **409** with the current row |
| `POST` | `/api/data/replay` · `/api/data/backfill` | queue a replay (one capability through the workspace's validated fetch path, cache bypassed) or a backfill (bars for a date range, contract-checked, merged into the bar cache) → `job_id` |
| `GET` | `/api/data/jobs` · `/api/data/schedules` | recent replay/backfill jobs (the queue's memory) and the configured schedule, invalid entries with their error |
| `GET` | `/api/config` | symbols, venues, limits |
| `GET` | `/api/book/{symbol}` | per-venue L2 ladders |
| `GET` | `/api/tca/{symbol}` | VWAP, slippage, smart route |
| `WS` | `/ws/book/{symbol}` | consolidated book + TCA at 4 Hz |
| `POST` | `/api/orders` | **submit through the risk gateway** |
| `GET` | `/api/orders` | orders resting on the book right now (`?symbol=` to narrow) |
| `GET` | `/api/orders/{id}` | one order's transition timeline, from `order_events` |
| `POST` | `/api/orders/{id}/cancel` | pull one resting order |
| `POST` | `/api/orders/{id}/replace` | cancel-and-new; returns the **new** order's check vector |
| `GET` | `/api/risk/state` | equity, PnL, drawdown, positions |
| `GET` | `/api/risk/limits` | the active hard limits |
| `GET` | `/api/portfolio` | PM view: concentration, headroom, binding constraint, attribution, per-sleeve realised P&L |
| `GET` | `/api/portfolio/history` | persisted equity curve + day/MTD/inception returns |
| `POST` | `/api/risk/kill` · `/resume` · `/reset` | emergency control |
| `POST` | `/api/backtest` | queue a sweep → `job_id` |
| `GET` | `/api/jobs` · `/api/jobs/{id}` | queue stats · progress, then the full result |
| `GET` | `/api/audit/orders` · `events` · `backtests` · `stats` | audit log |
| `GET` | `/api/research/openbb/health` · `quote` · `bars` · `news` · `fundamentals` | Local/compatibility OpenBB bridge used by the companion |
| `POST` | `/telegram/webhook` | Telegram updates |

Three of the order routes deserve their reasons stated. `GET /api/orders` is the
*open* book only — terminal decisions stay in `/api/audit/orders`, because the set
a desk can still act on and the set it has already acted on are different
questions. **Cancel does not consume a rate-limit token.** The token bucket sits
on the submit path and nowhere else, so a cancel spends nothing: it only ever
reduces risk, and a book in trouble must always be able to get out; a rate limiter
that can trap a desk inside a position is a worse control than no rate limiter. A
*replace* does spend one, because its second half is a submit and a replacement
that could outrun the limiter would be a cancel-shaped hole in it. It carries no
typed-confirmation ritual either — that
ceremony suits a desk-wide action, not a single order a trader pulls repeatedly.
**Replace is cancel-and-new**, so the replacement faces every gate again and the
caller gets *its* check vector rather than the original's: a replacement can be
rejected where the first order passed, and returning stale evidence would hide
that. It does not inherit the original `client_order_id`, which is already spent
against the idempotency gate and would reject the replacement as a duplicate of
the order it replaces.

Interactive docs at `/docs`, and a committed snapshot at `tools/openapi.json`.
The snapshot is the contract two independently deployed clients rely on, so
`tests/test_openapi_contract.py` fails if the API changes without it being
regenerated — a rename that would 404 a browser fails in CI instead.

```bash
python tools/export_openapi.py            # regenerate, deliberately
python tools/export_openapi.py --check    # what CI runs
```

**Adding an endpoint.** Define the shape in `modules/schemas.py`, add the route
in `main.py` with `response_model=`, add a case to `tests/test_api.py`, and
regenerate the snapshot. The `response_model` is what makes the schema and the
implementation impossible to drift apart; the snapshot is what makes the drift
visible to the clients.

**Local OpenBB bridge.** `modules/research.py` remains available for the
co-located Telegram companion and local compatibility testing. Install the
optional gateway runtime and rebuild its extension map when using that path:

```bash
pip install -r requirements-openbb.txt
openbb-build
```

The keyless Yahoo Finance extension is selected explicitly for deterministic
quote, bars, company-news and fundamentals routing. The dependency remains
optional: when absent, routes return `{"ok": false, "error": …}` with HTTP 200,
and `/api/research/openbb/health` reports the missing provider. Calls run in a
two-worker bulkhead with a seven-second bound so research cannot stall the risk
event loop.

**Production OpenBB target.** The Next.js workspace should not set
`OPENBB_API_URL` to this stateful gateway. Deploy
[`OpenBB_Service/`](OpenBB_Service/) independently and use that stateless
read-only service as the production target:

```text
ALPHAENGINE_GATEWAY_URL=https://stateful-gateway.example.com
ALPHAENGINE_GATEWAY_TOKEN=<gateway WEB_API_TOKEN>

OPENBB_API_URL=https://openbb-service.example.com
OPENBB_API_TOKEN=<OpenBB service token>
```

The standalone service uses pinned provider fetchers directly, has no trading
or Telegram routes, and can scale or cold-start without sharing mutable
portfolio state. On a public gateway still set `REQUIRE_AUTH=1` and a strong
`WEB_API_TOKEN`; it protects the portfolio and trading APIs, not the separate
OpenBB deployment. The console then asks for that bearer token on load and
keeps it only in the current page's memory; the server never embeds it in HTML.

```bash
# a rejection, with its evidence
curl -s -X POST localhost:8000/api/orders -H 'Content-Type: application/json' \
  -d '{"symbol":"BTCUSDT","side":"BUY","notional":500000,"order_type":"MARKET"}'
```

The audit log is plain DuckDB — query it directly, no ETL:

```sql
SELECT symbol, count(*) AS n,
       quantile(latency_ms, 0.99) AS p99_ms,
       avg(slippage_bps) FILTER (WHERE accepted) AS avg_slip
FROM orders GROUP BY symbol;
```

---

## 8. Configuration & dependencies

Every value in `config.py` is env-overridable; see `.env.example`. Defaults match
the assessment brief: **$50k** max order, **5 orders/sec**, **5%** daily drawdown,
**$100k** TCA probe size.

The data-quality ledger adds its own, all with defaults that need no setting:

| Variable | Default | What it sets |
|---|---|---|
| `DATA_OPS_DB_PATH` | `$DATA_DIR/data_ops.sqlite` | the SQLite file holding the quality ledger (and, later, work items and schedules) |
| `DATA_QUALITY_RETENTION_DAYS` | `7` | how long findings are kept (1–90) |
| `DATA_QUALITY_VIEW_WINDOW_MINUTES` | `1440` | the window the merged view summarises |
| `DATA_QUALITY_ESCALATE_FATAL_COUNT` / `_WINDOW_MINUTES` | `3` / `15` | rule 1: this many payloads with a fatal finding from one provider inside the window |
| `DATA_QUALITY_ESCALATE_FAIL_RATE` / `_MIN_SAMPLES` | `0.25` / `8` | rule 2: a contract-fail rate above the fraction once at least this many payloads were evaluated |
| `DATA_QUALITY_ESCALATE_COOLDOWN_MINUTES` | `60` | one escalation per (rule, provider) per cooldown |
| `DATA_WORK_SEED` | `true` | seed the work queue with its nine sample rows the first time the table is empty |
| `WEB_WORKSPACE_URL` | origin of `PAPER_EQUITY_QUOTE_URL`, else empty | the web workspace the replay executor (and an equity backfill) calls back into |
| `DATA_JOB_TIMEOUT_S` | `20` | the replay/backfill executor's HTTP timeout |
| `DATA_BACKFILL_MAX_BARS` | `20000` | the most bars one backfill may span |
| `DATA_SCHEDULES` | empty | semicolon-separated `replay:<cap>:<SYMBOL>@every=1h` / `backfill:<SYMBOL>:<interval>:<lookback>@daily=HH:MM` entries |
| `DATA_SCHEDULER_TICK_S` | `30` | how often the scheduler checks what is due |

The resting book and paper-equity adapter add seven of their own:

| Variable | Default | What it sets |
|---|---|---|
| `WORKING_ORDER_SWEEP_S` | `1.0` | how often the resting book is checked against the consolidated touch |
| `MAX_WORKING_ORDERS` | `200` | the ceiling gate 14 (`working_book`) enforces |
| `PAPER_MAKER_FEE_BPS` | `1.0` | what a resting fill pays, against the taker `PAPER_FEE_BPS` (`4.0`) |
| `PAPER_EQUITY_SLIPPAGE_BPS` | `8.0` | explicit cost applied to a server-verified equity quote; this model never claims L2 routing |
| `PAPER_EQUITY_QUOTE_MAX_AGE_S` | `604800` | oldest trusted equity quote the gateway will size a paper MARKET order against |
| `PAPER_EQUITY_QUOTE_URL` | empty | optional validated quote facade for authenticated clients that predate the enriched order envelope |
| `PAPER_EQUITY_QUOTE_TIMEOUT_S` | `5.0` | fail-closed timeout for that server-side quote lookup |

`requirements.txt` is the full set. **Build the virtualenv on Python 3.12** —
the version CI pins, and the only one the gateway (3.11–3.14) and the OpenBB
service (`>=3.12,<3.15`) both accept.

This used to read "verified on 3.11 – 3.14, including vectorbt + numba on
3.14", and that was wrong in a way worth recording. numba publishes no 3.14
wheel, so on a 3.14 interpreter vectorbt does not install — and the suite does
not fail, it *skips*: `tests/test_backtester.py:99`, "vectorbt not installed".
The summary line reads 863 passed, 1 skipped and looks healthy while the
vectorbt engine goes entirely untested. On 3.12 the same tree is 864 passed,
nothing skipped (2026-08-17). The 864 also needs the native decision core
built — `pip install -r requirements-native.txt`, then
`python native/decision_core/setup.py build_ext --inplace --build-temp build/native`
— because `tests/test_decision_core_native.py` and
`tests/test_core_self_measure.py` fail rather than skip without it; a broken
build has to turn CI red, and CI builds it before the suite for exactly that
reason.

If numba genuinely will not build on your platform, use
`requirements-core.txt` — the backtester falls back to its NumPy engine and
nothing else changes. Prefer that to a newer interpreter, because it fails
loudly in one place rather than quietly everywhere.

**Celery/Redis is optional.** Set `REDIS_URL` and the job queue switches from the
in-process thread pool to Celery automatically; `python worker.py` starts a
worker. Without a broker, the same task callables run in-process. The API,
gateway console and Telegram companion consume the same job status contract;
that abstraction matters more than the broker choice.

**Supabase is optional and off by default.** With none of these set, the mirror
and the RAG index are no-ops and every test passes offline:

| Variable | Default | What it sets |
|---|---|---|
| `SUPABASE_URL` | *(empty — disabled)* | the project's `https://<ref>.supabase.co` origin |
| `SUPABASE_SERVICE_ROLE_KEY` | *(empty — disabled)* | server-side PostgREST credential; **gateway env only, never Vercel** |
| `SUPABASE_MIRROR_ENABLED` | `0` | stream gateway order decisions to `public.order_blotter` |
| `SUPABASE_DESK_ID` | fixed UUID `…0001` | the single-tenant desk id until auth ships |
| `SUPABASE_TIMEOUT_S` | `5.0` | per-request timeout for mirror/RAG writes |
| `SUPABASE_MIRROR_QUEUE_MAX` | `1000` | bounded queue; overflow is counted and dropped, never blocking |
| `RESEARCH_RAG_ENABLED` | `0` | embed backtests/summaries/incidents and retrieve on anomaly |

---

## 9. Assessment criteria

### Implemented vs. mocked

**Live and real:** L2 WebSocket ingest from two venues with sequence handling and
reconnection; all TCA maths and the cross-venue router; all 15 pre-trade gates,
position accounting, the drawdown breaker and the kill switch; the resting-order
lifecycle — five states, three times in force, the touch-crossing matcher,
cancel and replace, maker fills priced and charged separately from taker fills,
and the three invariants that empty the book; vectorbt parameter sweeps on live
Binance klines; DSR and walk-forward; the DuckDB audit log; the compiled
decision core and its bit-exact parity with the reference; and the fail-closed
Telegram webhook/polling companion with its cards, charts and inline keyboards.
The Data workspace reads live
registry, freshness, cache, lineage and provider-capacity evidence; its contract
and quarantine telemetry is bounded to the function instance that observed it.

**Mocked, deliberately:** order *execution*. Accepted orders fill on paper against
the live ladder rather than being sent to an exchange, and a resting order is
matched against the consolidated touch rather than by a venue's matching engine —
so it has no queue ahead of it, which is the **queue position and partial fills**
row of the table below. This is exactly what a pre-production risk gateway does
before it is pointed at a venue, and it is the only honest thing to do without a
funded account. The synthetic order book (§3) is a clearly-labelled offline
fallback, never a silent substitute. The Data tab's **Work Queue** is persisted
on the gateway (versioned, audit-logged, seeded samples marked as such); what it
is not is a ticketing or incident system with a workflow engine — the board says
"queue" and means it.

**Mirror and RAG (Supabase):** the Postgres mirror and the pgvector research
index are real code with real tests, and **off by default** — the gateway is
fully functional with Supabase absent, and every suite passes without a network.
The SQL `submit_alphaengine_order` RPC is a labelled **sandbox decider** (same
family as the browser sandbox), never the desk's decision: authoritative rows
carry `decided_by = 'gateway'`. Realtime browser streaming is designed but not
shipped — it would put the first backend env var into the browser bundle, and
that trade is documented rather than made by accident.

### Production scale-out

AWS ECS/Kubernetes behind an ALB; TimescaleDB or ClickHouse for tick storage with
DuckDB kept for ad-hoc analytics (the Supabase Postgres mirror shipped here is
the first step on that path — durable cloud copy, RLS multi-tenant-ready);
direct FIX sessions instead of public WebSockets; Redis-backed Celery workers on
a separate autoscaling group; secrets in AWS Secrets Manager with an HSM for
signing keys; the risk gateway replicated with shared limit state in Redis so a
single instance failure cannot open the gate.

Prometheus metrics on gate latency, feed staleness and rejection rates **ship
here** — `GET /metrics`, with example alert rules in
`tools/alert-rules.example.yml`. What is left for production is the stack around
them: a Prometheus that scrapes it, a Grafana that draws it, and an alertmanager
that routes it somewhere other than Telegram.

### What is deliberately missing

A submission that lists only what it has is not a design document. These are the
gaps a reviewer should expect to find, and why each is where it is:

| Gap | Where it bites | Why it is not here |
|---|---|---|
| **RBAC and SSO** | Signing in establishes *who you are* for your own preferences, and `/profile` manages that identity — linked providers, active sessions, password. It confers no authority. That is still undifferentiated: every role shares one gateway token, and the only distinctions that gate an action are that token, the Telegram read allow-list and the narrower control allow-list | Real role separation needs the identity to reach the gateway and the risk controls, which is a system in its own right rather than a login page. The *controls* that matter — who can halt, who can flatten — are already gated separately from who can read |
| **Orchestration** | No Airflow/Dagster: ingestion is supervised in-process and backfill is manual | A scheduler is the right answer at multi-desk scale and pure overhead at one process. The pieces it would schedule — validation, failover, staleness — exist and are testable without it |
| **Log aggregation and tracing** | Logs are per-process; there is no request id threaded across the three units | The bounded trace ring and the pipeline inspector answer the debugging questions locally. Shipping logs needs somewhere to ship them |
| **Margin, financing, liquidation** | Risk is notional-based: no leverage, funding or liquidation modelling | The paper book is unlevered and cash-settled, so a margin model would be arithmetic about a fiction |
| **Full CPCV** | Overfitting is priced by DSR and a sequential PBO estimate, not combinatorially purged cross-validation | CPCV costs factorially more compute for a tighter estimate of the same quantity. The cheap version is honest about being the cheap version |
| **Feature store and shared experiment registry** | Experiment history is per browser; the gateway's own `backtest_runs` table is the durable record | A feature store is a team-scale answer to a team-scale problem |
| **Queue position and partial fills** | A working `LIMIT` fills *in full* the instant the consolidated touch crosses it: nothing sits ahead of it in a queue, and no fill is ever partial | The L2 feeds carry ladder snapshots, not trade prints (§3, `modules/tca_engine.py`), so how much of a resting order a crossing trade consumed is genuinely unknowable from this data. Modelling it would mean inventing a queue-position assumption and a participation rate, then reporting the result as measured execution. Full-fill-on-cross is optimistic and says so; a fabricated partial-fill model would not |
| **Working-order durability** | Resting orders live in the single gateway process. A *graceful* stop cancels them and audits the cancellation like any other. An ungraceful one — `SIGKILL`, an OOM, the host going away — cancels nothing and audits nothing: `order_events` stops at the order's `ACCEPTED_WORKING` row, no `orders` row is ever written, and the record's last word is that the order is still resting when it no longer exists anywhere | Persisting them would claim a recovery guarantee a single-instance paper gateway cannot honour, and would risk resurrecting a resting order at a price nobody has re-checked. The gap is disclosed rather than papered over because the failure mode is silent: nothing in the audit log distinguishes an order that vanished with the process from one that is genuinely still open |
| **An overnight book, and the equity level across a downtime** | Two halves of one gap. A position held across 00:00 UTC has no durable start-of-day mark, so the session boundary records the equity it opened on but the fill replay — which covers one UTC day — cannot rebuild the positions behind it. The restarted process therefore publishes a *smaller* book than the live one by exactly that mark, and says so in a `WARNING`. Separately, a gateway that was **down** across the boundary finds no rollover record at all: the P&L its earlier sessions banked is unrecoverable from a session-scoped replay, so it opens on the configured starting balance and warns that it has done so | The daily drawdown limit is meant to reset each session, so a full budget on a new session is correct. What is wrong is the *denominator* it resets against: after a losing week the restarted desk measures today's loss against its opening balance rather than against what the account is really worth, so a given dollar loss reads as a smaller fraction than it is. Closing it needs a durable position snapshot with per-symbol start-of-day marks, which is the same missing piece as the margin model above. Refusing to boot was the alternative and is worse: stopping a paper desk overnight is ordinary operation, and a gateway that will not start after it is the more damaging failure. Both cases are loud in the log rather than silent on the panel |
| **mypy** | Python is typed but not type-checked in CI | pydantic plugin plus third-party stubs is a day of work with little to show a reviewer; ruff catches the defects that matter |

Three smaller absences around the resting book belong in that list rather than in
a footnote. There is no `FOK`, post-only, stop, iceberg or OCO order type — each
is either meaningless without partial fills or a second matching model wearing an
order type's clothes. Replace is cancel-and-new with no queue-priority retention,
which is what most venues do for a price change or a size increase anyway, so the
simplification costs less than it first looks. And a *marketable* `LIMIT` can
still print through its own limit price on a thin ladder: it takes the taker path,
and `smart_route` is not price-bounded. The limit is enforced as a resting
condition, not as a fill constraint, and this is the one place the paper fill is
optimistic in a way a real venue would not be.

### Validation & signal testing

Walk-forward optimisation with a strict IS/OOS split; DSR to price the multiple
testing; costs modelled as fee + slippage bps charged on turnover, with fill
prices taken from the real ladder rather than the mid; buy-and-hold reported
alongside every result; the Sharpe surface published so plateau-versus-peak is
visible rather than asserted. The test suite includes a sweep over a pure random
walk that asserts the system refuses to endorse it
(`test_dsr_rejects_a_noise_grid`).

### Costs & operational risks

Main costs are a low-latency host (~$200/mo) and, in production, paid L2 feeds.
Key risks and their mitigations, all implemented here:

| Risk | Mitigation |
|---|---|
| WebSocket drop | exponential backoff + jitter, heartbeats, per-venue staleness clock |
| Corrupted book | sequence-gap detection forces a resubscribe; partial-book streams self-heal |
| Exchange rate-limit ban | token bucket (5/s, burst 10) before anything leaves |
| Runaway algo | rate limit + idempotency on `client_order_id` + kill switch |
| Bad day | automatic drawdown breaker at 5%; reduce-only from 80% of budget, so the desk can still close but not open |
| A VaR nobody has checked | Kupiec proportion-of-failures backtest with a Basel traffic light, scored out-of-sample |
| Silently bad vendor data | quote and bar data contracts; fatal violations fail over, suspect ones are quarantined with bounded per-instance evidence |
| Overfit research reaching production | DSR + walk-forward reported on every sweep |
| Alerting outage | alert-hook failures are caught and never block the trade path |

---

## 10. Testing

**38 suites**, counted as `tests/test_*.py`. The `tests/` directory holds 39 `.py`
files: those 38 plus `conftest.py`, which is fixtures rather than a suite. Both
figures are `ls`, not memory — `ls tests/test_*.py | wc -l` and
`ls tests/*.py | wc -l` (2026-08-17). No per-suite test counts are quoted below,
because parametrised cases mean a file's `def test_` count is not the number it
contributes to the 864.

*Modules A, B and C — the engines*

```
tests/test_tca_engine.py   Module A: book state, delta application, VWAP and
                           slippage against a hand-computed ladder, routing,
                           staleness
tests/test_risk_proxy.py   Module B: every gate, the token bucket, position
                           accounting, the automatic breaker, fill quality,
                           gate/fill agreement
tests/test_working_orders.py
                           the resting book: the touch-crossing matcher, time in
                           force, maker pricing and fees, cancel and replace, and
                           the three invariants that empty the book
tests/test_backtester.py   Module C: signal definitions, look-ahead check, cost
                           accounting, engine agreement, DSR/PSR properties,
                           noise-grid rejection
tests/test_strategy_catalog.py
                           every strategy in the catalogue actually trades, and
                           both engines agree on it — a strategy that never fires
                           fails silently otherwise
tests/test_decision_latency.py
                           the pre-trade decision histogram: the arithmetic, and
                           that a decision is recorded at all
tests/test_gate_parity.py  the running gateway still decides what the committed
                           twenty-scenario fixture recorded — same accept/reject,
                           gate order, observed and limit numbers
tests/test_decision_core_native.py
                           the C++ core builds and imports (a red build, never a
                           skip), reproduces the same fixture to the bit, folds a
                           book identically to Python over random deltas, keeps
                           the persistent ladders a bit-exact mirror, and agrees
                           with `route_estimate` on random multi-venue books to
                           the last bit of `slippage_bps`
tests/test_core_self_measure.py
                           the startup self-measure lands in the core (ns)
                           histogram, counted as self-test samples, and never in
                           the decision (µs) one
tests/test_drawdown_alerts.py
                           the drawdown warning fires on the edge, not on every
                           tick
tests/test_paper_equity.py paper equities use a trusted quote without pretending
                           the quote is an L2 book
tests/test_equity_quote.py the quote bridge trusts evidence, never a
                           browser-supplied price
```

*Portfolio, risk and the session boundary*

```
tests/test_portfolio.py    concentration maths, netting, the binding constraint,
                           attribution wiring, realised P&L per strategy sleeve,
                           persisted equity history and period returns
tests/test_quant_risk.py   covariance conventions, risk contributions, Kelly,
                           regime, historical VaR, the Kupiec backtest, scenario
                           propagation with measured betas, all four allocation
                           methods and the limits that clip them
tests/test_rehydration.py  position replay from audited fills, reset boundaries,
                           and the ambiguity that must fail closed
tests/test_session_rollover.py
                           the UTC boundary: day two opens flat after a winning
                           and a losing session, equity does not jump across it,
                           the drawdown budget resets against the new balance,
                           and the boundary survives a restart — including one
                           whose durable write failed, which must not roll
```

*The API surface and its contracts*

```
tests/test_api.py          REST contract, client separation, rejection semantics,
                           job lifecycle, webhook authentication, audit
                           persistence
tests/test_openapi_contract.py
                           the committed API snapshot, so a contract change
                           reaching two independently deployed clients cannot be
                           silent
tests/test_stream_desk.py  the desk stream's four properties, asserted from the
                           side that owns them rather than by reading `main.py`
                           as text from the web repo
tests/test_web_state.py    the shared web-ops ledger: merge semantics, bounds and
                           the wire contract
tests/test_jobs_security.py
                           credential handling at the Celery process boundary
```

*The data-ops plane — the ledger, the queue and the jobs*

```
tests/test_data_quality.py the contract-finding ledger: two instances merging into
                           one window, a retried push deduped by sequence, stale
                           and future findings refused, pruning, a fail rate that
                           stays null rather than becoming zero, both escalation
                           rules opening once per cooldown and resolving
                           themselves, and the publish path with the bot disabled
tests/test_work_items.py   the persisted work queue: seeding once, id allocation
                           per prefix, a version bumped on every patch, a stale
                           edit refused with the current row rather than
                           overwritten, and an audit row per mutation
tests/test_data_jobs.py    replay and backfill: the Python bar contract pinned to
                           the web's by a shared fixture, each replay outcome over
                           a mocked transport, forward-paged Binance backfill, the
                           completion hook persisting clean bars and dropping the
                           rows, and the scheduler's grammar and restart safety
```

*Research and the corpus*

```
tests/test_research.py     OpenBB bridge: the absence contract (ok:false, never
                           500), NaN-cleaning, field-alias resolution, input
                           validation
tests/test_research_rag.py the research index's honesty contract, verified
                           offline
```

*Telegram — eight suites, because it is the one companion that can change risk
state*

```
tests/test_telegram.py     command registry, fail-closed user authorisation, text
                           rendering, OpenBB reads and transition alerts
tests/test_telegram_commands.py
                           the registry floor: every command in the catalogue
                           must actually answer, not merely be advertised
tests/test_telegram_controls.py
                           the five gated controls: a separate allow-list,
                           single-use confirmation codes, expiry
tests/test_telegram_link.py
                           binding a chat to a web desk identity, and the narrow
                           security question of why that binding is not an
                           authentication bypass
tests/test_telegram_charts.py
                           every generator plots what it was handed, or returns
                           None — the module once shipped a sine wave captioned
                           as real data
tests/test_telegram_interactive.py
                           the interactivity layer: every button resolves to a
                           registered command, a tap is authorised on the tapper
                           and never issues a control challenge, and in-place
                           editing degrades to sending
tests/test_telegram_analytics.py
                           the fold-detail reads, the read-only gate preview and
                           the symbol/interval switchers
tests/test_telegram_docs.py
                           README §6 and the live checklist are the generator's
                           own output — `tools/telegram_catalogue.py --check`
                           run inside the suite, so a new command that is not in
                           the docs turns the tests red
```

*Persistence, packaging and deployment*

```
tests/test_supabase_mirror.py
                           the mirror's contract: invisible to the order path,
                           honest about losses
tests/test_supabase_schema.py
                           the committed Supabase SQL held in parity with
                           `config.py`, offline
tests/test_oracle_applier.py
                           the Oracle schema applier splits the committed DDL
                           correctly — PL/SQL blocks are where a naive splitter
                           silently does the wrong thing
tests/test_container_contract.py
                           the committed container definition held to the
                           promises its comments make; rejects any secret-shaped
                           literal. Text analysis on purpose — CI is network-free
                           and never builds the image
```

The gateway test suite is deterministic and requires no external network: market
data is disabled, the backtester falls back to its NumPy engine, and every
fixture is committed. The same is true of the web and service suites.

---

## 11. Deployment

### Docker — the always-on gateway (host port 8000)

The serverless portal cannot host the gateway: long-lived venue WebSockets, an
embedded DuckDB file and an in-memory kill switch all need one process that
never spins down. That process now ships as a container.

```bash
docker compose up -d --build       # from the repo root
docker compose ps                  # wait for STATUS (healthy)
curl -fsS http://127.0.0.1:8000/health | head -c 200
docker compose exec gateway python tools/synthetic_probe.py   # money path, in-container
```

Design decisions live as comments in
[`docker/gateway.Dockerfile`](docker/gateway.Dockerfile) and the root
`docker-compose.yml`; the load-bearing ones: **one uvicorn process** (a second
worker would fork the in-memory book and localise the kill switch),
`requirements-core.txt` in the image (NumPy engine fallback; vectorbt via
`--build-arg REQUIREMENTS=requirements.txt`), the **native decision core
compiled in the builder stage** (`requirements-native.txt` and
`build-essential` live there only; the runtime stage copies
`modules/_decision_core*.so` and nothing else across, so the image runs the
compiled engine and carries no compiler), a **named volume** for
`/app/data` so the audit log survives rebuilds (a bind mount arrives owned by
the host and uid 10001 cannot write it), non-root user, and a stdlib health
probe against the unauthenticated `/health`. Secrets arrive only through
`Part2_Infrastructure/.env` (see `.env.example`) — the committed files contain
none, and `tests/test_container_contract.py` enforces that shape permanently.

### Oracle Cloud (or any Docker host) — the public origin Vercel can reach

The compose file is the portable artifact; the host just needs Docker. On an
OCI instance:

1. **Verify the instance**: Ampere A1 (aarch64) is fully supported — every
   `requirements-core.txt` dependency ships aarch64 wheels; build the image on
   the VM. A 1 GB E2 Micro runs the core gateway but is tight. Region matters —
   from US egress Binance returns 451 and Bybit 403 (see the Vercel note below);
   test `curl -sI https://api.binance.com/api/v3/ping` from the VM first.
2. **Open ingress twice** — the VCN security list (443/80) *and* the OS
   firewall (Oracle images ship restrictive iptables). One without the other is
   the classic "port open in the console but unreachable".
3. `git clone` → `cp Part2_Infrastructure/.env.example Part2_Infrastructure/.env`
   and set `WEB_API_TOKEN` (fresh `openssl rand -hex 32`), `REQUIRE_AUTH=1` →
   `docker compose up -d --build`.
4. **HTTPS**: the deploy workflow already runs the Caddy TLS sidecar on
   `:8443` (internal CA, pinned by the web project) — follow
   [`docs/TLS_FLIP.md`](../docs/TLS_FLIP.md) to open the port and flip
   `ALPHAENGINE_GATEWAY_URL`. With a domain, swap `tls internal` for
   automatic issuance.
5. On Vercel set `ALPHAENGINE_GATEWAY_URL=https://your-domain.com` and
   `ALPHAENGINE_GATEWAY_TOKEN` to the same `WEB_API_TOKEN`, redeploy. This is
   the step that switches Portfolio/Risk from the labelled sandbox to the
   authoritative live book and turns the Developer tab's Gateway and Schema
   readiness gates green.

If Always Free: Oracle reclaims *idle* Always Free instances, and a quiet
gateway can look idle — upgrading the account to Pay-As-You-Go keeps the free
resources free while exempting it from reclamation.

**Continuous deployment.** None of steps 3–5 is repeated by hand after the first
time. [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) runs on
every push to `main`: the gateway suite first (native core built, schema
checked, money-path probe), then the image is built and pushed to GHCR under a
lowercased path, then an SSH session pulls it, swaps the container with the
audit volume (`alphaengine_alphaengine_audit`, compose-prefixed) intact,
verifies `/health` from inside the VM and rolls back to the previous image on
failure. The verify step also reads `decision_engine` off the health payload:
`native` is logged as such, and a container that fell back to Python emits a
workflow warning — the gateway is healthy either way, but the nanosecond figure
would be missing from the desk and that should be visible in the run, not only
in the header's "Python fallback" mark. A `reachable` job then probes `:8000`
from a GitHub runner (a failure here is the OCI security list or the instance
firewall) and `:8443` advisorily. Two schedulers live beside it because neither
Vercel Hobby nor Always Free offers one fine enough:
`openbb-keepalive.yml` pings the OpenBB service's `/healthz` every ten minutes
so a research quote rarely meets a cold import, and `oracle-keepalive.yml`
keeps the Autonomous Database from auto-stopping. The web workspace and the
OpenBB service deploy themselves from git as Vercel projects and are
deliberately not in `deploy.yml` — putting them there would deploy them twice.

### Vercel — research portal (`web/`)

Set **Project → Settings → Build & Deployment → Root Directory** to
`Part2_Infrastructure/web`. That is the only required setting; it is a standard
Next.js 16 app and every environment variable is optional for the keyless crypto
experience (provider keys extend coverage — see [`web/.env.example`](web/.env.example)).
Connect portfolio and OpenBB independently:

```text
ALPHAENGINE_GATEWAY_URL=https://stateful-gateway.example.com
ALPHAENGINE_GATEWAY_TOKEN=<same value as gateway WEB_API_TOKEN>

OPENBB_API_URL=https://openbb-service.example.com
OPENBB_API_TOKEN=<same value as the OpenBB service OPENBB_API_TOKEN>
```

Set them for Production and Preview, then redeploy. Do not point
`OPENBB_API_URL` at the stateful portfolio gateway in production. The
standalone OpenBB service is stateless and independently scalable, while the
gateway owns mutable book and risk state. `/api/providers` probes OpenBB health
before marking it ready; a non-empty URL alone is not a health signal. The
portfolio proxy validates the gateway schema and preserves last-known data as
explicitly stale during an outage.

There is deliberately **no repository-root `vercel.json`**: a root config that
ran `cd web && npm install` works only while the Root Directory is the repo root
— once it points at the app, the build already starts there and the same command
fails with `cd: web: No such file or directory`. The one config that does exist,
[`web/vercel.json`](web/vercel.json), contains no paths at all — it pins
`"framework": "nextjs"` so the build can never fall back to the static "Other"
preset (which expects a `public/` output directory and fails *after* a
successful `next build`), and `"regions": ["sin1"]`.

That region is not cosmetic. From Vercel's default US region both venue clients
returned errors in production — Binance **HTTP 451** and Bybit **HTTP 403** — so
"consolidated cross-venue depth" was quietly single-venue depth wearing a
cross-venue label. The cause was the egress geography, not the hostnames, and no
amount of host failover fixed it. Singapore restored both venues to a 0% error
rate.

`next` is pinned exactly (not `^`) so a deployment can never resolve to a
different build than the one tested here.

**Turn off Deployment Protection** only if this case-assessment URL must be
public. Gateway and OpenBB credentials remain server-only in Vercel; the
browser can access only the explicit same-origin proxy routes. Telegram is not
an authentication path for this workspace, and account linking does not make it
one — the link runs one way. A web identity can authorise a *Telegram* read;
nothing a Telegram user does is ever evidence about a web request, and the bot
still answers to its own allow-list rather than to anything a browser session
says.

A binding also grants no more than a desk pass already does, and
`POST /api/auth/guest` hands a pass to anyone who asks — so it moves the same
shared book between transports it was already on rather than unlocking
anything new. Control commands (`/halt`, `/flatten`, `/resetbook`) stay gated on
`TELEGRAM_CONTROL_USER_IDS` alone and are never widened by a link. For an
account the identity is proved by validating the Supabase JWT, never read off
the unsigned desk cookie, which would otherwise let someone bind their chat to
another person's row.

### Vercel — standalone OpenBB service (`OpenBB_Service/`)

Create a second Vercel project with Root Directory
`Part2_Infrastructure/OpenBB_Service`. Configure a long random
`OPENBB_API_TOKEN` there, then set the matching token and the new project's
HTTPS origin in the `web` project. Keep the service read-only and do not add
portfolio, order, Telegram, database or background-worker concerns to it. See
[`OpenBB_Service/README.md`](OpenBB_Service/README.md) for its routes and
deployment checks.

---

## 12. One engine, two implementations, one test that proves it

The gateway runs parameter sweeps through vectorbt/numba; Vercel's serverless
runtime cannot. So the engine is reimplemented in TypeScript — and
[`web/tests/parity.test.ts`](web/tests/parity.test.ts) replays real Binance bars
through it and asserts it reproduces what the Python reference produced from
identical input, across all three models and both directions.

That test caught two real bugs in the port. It is regenerated with:

```bash
python tools/make_parity_fixture.py
```

The pre-trade decision is the third instance of the same discipline, held to a
stricter standard because it can be: Python and C++ evaluate the same battery
against the same twenty-scenario fixture and must agree to the bit — see
*Two engines, one battery, one fixture* in §4.

The risk maths is deliberately doubled the same way.
[`modules/quant_risk.py`](modules/quant_risk.py) and
[`web/lib/portfolio-risk.ts`](web/lib/portfolio-risk.ts) are two implementations
of one set of conventions — so that a VaR quoted in Telegram and the same VaR on
the risk tab cannot disagree, and neither depends on the other being
reachable. The shared constants (`Z95`, the 2.0627 expected-shortfall
multiplier, `ddof=1`, mid-rank percentiles) are pinned by tests on both sides.

The allocation solvers are the sharpest case of that discipline. All four —
`equal_weight`, `inverse_vol`, `equal_risk` and `min_variance` — exist in both
engines, and [`web/tests/fixtures/risk-parity.json`](web/tests/fixtures/risk-parity.json)
pins every one of them target weight by target weight to 1e-4. Two details are
there because the obvious version is wrong. Minimum variance runs a
square-root-damped multiplicative fixed point that **retains its best iterate**: a
multiplicative fixed point is not proven to decrease the objective on every step,
and a method called "minimum variance" that returned a portfolio more volatile
than the inverse-variance seed it started from would be indefensible. And the
allocation fixture carries its **own** book instead of reusing the VaR history —
that history is exactly collinear by design (ETHUSDT is 1.5× BTCUSDT, so the
measured beta is a known quantity rather than a sample artefact), which makes its
covariance singular and its minimum-variance objective flat along one direction,
where two implementations wander apart for reasons that have nothing to do with
either being wrong. Both iterative solvers also run a fixed 60 steps rather than
testing for convergence, because a tolerance check lets two implementations stop
on different iterations and disagree by more than the fixture allows.

---

## 13. Verifying this deliverable

Everything a reviewer needs to check runs offline:

```bash
pytest                                    # 864 gateway + companion tests, nothing skipped (3.12, native core built)
python tools/bench_decision.py            # regenerates the latency table in docs/LATENCY_BUDGET.md §2.1
python tools/synthetic_probe.py           # end-to-end: book → cost → gate → audit
cd OpenBB_Service && pytest               # 13 stateless service tests
cd web && npm install && npm test         # 2,410 workspace tests across 620 suites, incl. the parity suites
bash tools/check_repo_complete.sh         # builds the *committed* tree
```

Every test count quoted anywhere in this repository comes from one of those
runners' own final line — `pytest`'s summary, `node --test`'s `ℹ pass`. Re-run
them rather than believing the prose; these figures have drifted before, and a
count nobody re-derives is a count that quietly stops being true.

Two of those deserve a note. The **probe** is the one that proves the parts are
wired to each other rather than merely correct in isolation: it walks the money
path in-process, submits an order the risk gate *must* refuse, and exits
non-zero if any step fails. The **parity suites** are what make "one engine, two
implementations" a claim rather than an aspiration — `tools/make_parity_fixture.py`
and `tools/make_risk_fixture.py` emit the Python reference's answers, and the
TypeScript tests assert reproduction to the fourth decimal.

The same commands run in CI on every push (`.github/workflows/ci.yml`), plus
`ruff check .`, `python tools/export_openapi.py --check`, the native-core build
before the gateway suite, and `scripts/check-test-counts.mjs` against
`web/lib/test-counts.generated.ts`.

The last one exists because of a real incident: a bare `lib/` pattern inherited
from GitHub's Python `.gitignore` template silently swallowed the web app's
`lib/`, so the working tree built while the pushed repo did not. The guard
exports `HEAD` via `git archive` and builds *that*, then checks every tracked
`.gitignore` for unanchored directory patterns, scans for committed credentials,
and verifies import-path case (macOS is case-insensitive; the deploy target is
not).

---

## 14. Security

- `.env` is gitignored. **No token, key or secret is committed.** Telegram,
  gateway and OpenBB tokens belong only in local or hosted environment secrets.
- Telegram authorization uses stable `message.from.id` values from
  `TELEGRAM_ALLOWED_USER_IDS`, not group chat membership. An empty allow-list is
  fail-closed and exposes bootstrap help only.
- Webhook mode requires a non-default high-entropy secret and validates
  `X-Telegram-Bot-Api-Secret-Token`. Polling mode needs no public endpoint.
- The link between the web workspace and the bot runs one way only: the header
  offers a deep link out to Telegram, and nothing comes back.
- The Telegram companion cannot open a position, authenticate a browser, or
  open a web workspace. It *can* queue a research sweep (`/backtest`, on the
  jobs engine, never the order path), and it *can* halt, resume, flatten, set
  reduce-only and reset the book — but only for user IDs in
  `TELEGRAM_CONTROL_USER_IDS`, only with a single-use user-bound confirmation
  code that expires in 90 seconds and is burned even on a wrong guess, never
  from an inline button, and `/flatten` goes through the same pre-trade gates
  as any other order rather than around them.
- The web project keeps `ALPHAENGINE_GATEWAY_TOKEN` and `OPENBB_API_TOKEN`
  server-side and connects to two separate services with distinct URLs.
- Risk limits are a frozen dataclass with env overrides: changing a hard limit
  requires a deploy, and therefore a code review.
- **Supabase posture:** `SUPABASE_SERVICE_ROLE_KEY` lives only in the gateway's
  environment — never on Vercel, never in the browser. RLS is enabled on every
  table and is deny-by-default. `anon` holds exactly one policy — SELECT on
  gateway-decided, unowned rows of the fixed demo desk, which is the public
  decision tape — and nothing else; a signed-in user's own rows carry their
  `user_id` and stay private. `authenticated` was audited against that same
  standard when the login shipped: `record_alphaengine_decision` had kept its
  bootstrap EXECUTE grant, which would have let any account forge
  gateway-provenance rows into that public tape, and it is now revoked. Every
  `SECURITY DEFINER` function pins `SET search_path = public, pg_temp` — an
  unpinned definer function is a privilege-escalation footgun. `order_blotter`
  is append-only by trigger, not convention. `tests/test_supabase_schema.py`
  asserts all of this from the committed SQL, offline.
- The container runs as non-root (uid 10001) with a stdlib health probe;
  `tests/test_container_contract.py` rejects any secret-shaped literal in the
  committed Docker files.
