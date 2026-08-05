# AlphaEngine Trading Automation — NUSSIF Developer Analyst Case Study, Part 2

Unified execution-quality, pre-trade-risk and strategy-research infrastructure
with three deliberately separate surfaces: an always-on stateful gateway, a
Vercel web workspace, and an independent **text-only Telegram companion**. The
companion reports portfolio, market-data and operational state, and — for
explicitly listed operators only — can halt, resume or flatten the book. It
never opens or authenticates a web UI and never queues a backtest.

That last capability is opt-in and off by default. `TELEGRAM_CONTROL_USER_IDS`
is a **second, narrower allow-list** than the one that grants read access, and
it is empty unless someone sets it: being able to see the book does not imply
being able to stop the desk. Every control command requires a single-use,
user-bound, 90-second confirmation code, so a forwarded message cannot fire one,
and `/flatten` submits through the same fourteen pre-trade gates as a manual order
rather than around them.

| | Module | Where it runs |
|---|---|---|
| **A** | Cross-venue TCA & L2 order-book depth (live Binance + Bybit) | gateway |
| **B** | Pre-trade risk gateway & emergency kill-switch | gateway |
| **C** | Asynchronous parametric backtesting, deflated for multiple testing | gateway **and** Vercel |

Everything writes to an append-only DuckDB audit log.

```
 Telegram companion                 Next.js web workspace
 text cards + pushed alerts       portfolio · research · execution
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
| **Quant Trader** | *Can I send this, and what will it cost?* | Execution cockpit, 14 pre-trade gates, cross-venue TCA, blotter | Paper fills only; no resting-order lifecycle |
| **Quant Researcher** | *Does this actually work?* | Sweep engine, Deflated Sharpe, walk-forward, PBO, promotion gate | No feature store; per-browser experiment log |
| **Portfolio Manager** | *Where am I exposed, and what should I own?* | Portfolio view, risk contributions, allocation proposal, rebalance | No benchmark-relative attribution |
| **Risk Manager** | *Is the model right, and will the limits hold?* | Kupiec VaR backtest, stress scenarios, reduce-only mode, kill switch | No margin or liquidation modelling |
| **Data Engineer** | *Can I trust this data?* | Provider registry, failover, data contracts, quarantine, lineage | No orchestration or backfill scheduler |
| **DevOps / SRE** | *Is it healthy, and what do I do at 3am?* | `/health`, `/metrics`, systems console, alert rules, runbook | No log aggregation or distributed tracing |
| **Quant Developer** | *Can I change this safely?* | Typed contracts, OpenAPI snapshot, parity suites, CI, 241 + 333 + 12 tests | No generated client, no property-based fuzzing |

### 🎯 Quant Traders — *"Can I send this, and what will it cost?"*

| Need | Where |
|---|---|
| See real liquidity before committing | Consolidated L2 ladder, streaming from Binance + Bybit |
| Know the cost *before* the fill | `/tca BTCUSDT 100000 BUY` — VWAP, slippage in bps, routing split |
| Is the consolidated book crossed right now | Cross-venue dislocation strip, sized to the smaller resting leg and quoted **gross** — because two taker legs usually cost more than the edge |
| Not send the order with the extra zero | 14 pre-trade gates in ~0.2 ms; a rejection returns the full check vector |
| Stop everything, now | Authenticated gateway console, `POST /api/risk/kill`, the web workspace's risk panel, or `/halt` in Telegram — the last two gated by a separate operator allow-list and a typed confirmation |
| Know when something breaks without watching a screen | Push alerts on breaches, halts, feed outages and `/watch` liquidity thresholds — to Telegram *and* to the Alerts panel on the Execution tab |
| See my own flow, not just the market | Execution cockpit: order blotter with the full check vector per row, live P&L strip, execution-quality summary (fill rate, realised slippage, tail latency) |
| Send an order and see every gate's verdict | Order ticket with the fourteen-check vector rendered for accepts *and* rejects, plus fat-finger and rate-limit presets |
| Trace a fill back to the idea | Orders stamped with the strategy and experiment id; the blotter links back to the research run |

### 📁 Portfolio Managers — *"Where am I exposed, and which limit binds first?"*

| Need | Where |
|---|---|
| The book, not a position list | `/portfolio` and `GET /api/portfolio` |
| Is this one bet or a spread book? | Concentration: largest share, HHI, effective position count |
| Gross vs net — directional or hedged? | Both reported; a market-neutral book has large gross and ~zero net |
| How much room is left before trading stops | Headroom on every limit, and the **binding constraint** named explicitly |
| What is actually producing the P&L | Attribution by symbol and by strategy, from the append-only audit log |
| Is a −20% scenario a tail event today, or a Tuesday | Volatility regime as a percentile of the instrument's *own* history; named scenarios scale **up** with it, never down |
| Which scenario should I actually worry about | Every named scenario ranked by projected loss, each flagged if it would trip the halt |
| What *should* the book be, not just what it is | Risk-based allocation proposal — inverse-vol or equal-risk-contribution — clipped by the same limits the gate enforces, naming what clipped each weight |
| What would I have to trade to get there | Rebalance trade list with an adjustable drift band, composed but never sent |
| What did the book do this month | Persisted equity snapshots from the risk monitor: day, month-to-date and since-inception P&L that survive a reload |
| Which sleeve made the money | Realised P&L per strategy, replayed from audited fills through the same average-cost accounting the live book uses |

A trader's view answers a question about the *next order*; a PM's answers one
about the *whole book*. The same numbers do not serve both, which is why
`/api/portfolio` exists separately from `/api/risk/state`.

### 🔬 Quant Researchers — *"Does this strategy actually work?"*

| Need | Where |
|---|---|
| Test an idea across a parameter grid | Sweep in the Vercel workspace or submit through the authenticated backtest API; Telegram only monitors jobs and completed results |
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

### 🛡 Risk Managers — *"Is the model right, and will the limits hold?"*

| Need | Where |
|---|---|
| Checks that are strict, visible and hard to bypass | 14 pre-trade gates on the single order path; the full vector is audited for accepts *and* rejects |
| Limits that a compromised service cannot move | Limits are a frozen dataclass in `config.py` — changing one is a code change, a review and a deploy |
| A graduated response, not a cliff | Reduce-only mode from 80% of the drawdown budget: closing orders pass, opening orders do not. A desk in trouble needs a way *out* |
| Exposure, concentration and drawdown continuously | Live from the gateway, marked to market every 5 s by the same loop that trips the breaker |
| Tail risk, not just variance | Parametric **and** historical VaR/CVaR side by side — where they diverge is the fat tail the normal model cannot see |
| **Do I trust my own VaR?** | Kupiec proportion-of-failures backtest with a Basel traffic light. The forecast is re-fitted on a rolling window and scored on the *next* bar, never on data it was fitted to |
| Scenario loss on today's book | Named historical scenarios with **measured** betas. Every leg reports how its move was decided — explicit shock, measured beta, the scenario's blanket assumption, or left flat because none of those applied — so an assumption can never be read as a measurement |
| A limit on the risk number itself | Advisory VaR budget as a share of equity (prop-desk practice is 1–3%), reported and deliberately never used to block an order |
| Stop trading, from anywhere | Kill switch on the API, the console, the web workspace and Telegram — the last two behind a separate operator allow-list and a typed confirmation |
| A recovery procedure, not an improvised one | `POST /api/risk/resume` takes a reason that lands in the audit log beside what tripped the halt; `docs/RUNBOOK.md` has the sequence |

Risk here is a live guardrail, not an end-of-day report: the breaker trips
without a human, and every number a risk manager reads is the same number the
gate used.

### 🔧 Data Engineers — *"Can I trust this data?"*

| Need | Where |
|---|---|
| Ingestion that survives a bad feed | Sequence-gap detection forces a resubscribe; per-venue staleness clocks; automatic synthetic fallback, always tagged |
| Provider failover I can see | Ranked registry across 7 providers with circuit breakers, a quota ledger, and a failover graph showing which node a request would land on *and why each other was skipped* |
| Validation on content, not just transport | Data contracts on every normalised payload: prices positive and inside their range, bar timestamps unique and ordered, highs above lows, freshness within budget |
| The difference between bad data and a renamed field | Three severities — `fatal` (rejected, failed over), `warn` (served, labelled), `drift` (our mapping looks stale, not the market) |
| Somewhere to look at a suspect payload | Quarantine buffer on the Data tab with the violations and a redacted excerpt. A rejected payload is never cached, so failover gets a shot at a cleaner source |
| Lineage from vendor bytes to rendered number | Pipeline inspector: cache key, TTL, every skipped provider with its reason, and the raw upstream JSON |
| Cross-source agreement | Consensus quotes across providers, flagging any leg more than 50 bps from the median |
| Query the record without an ETL step | DuckDB, append-only: `SELECT quantile(latency_ms, 0.99) FROM orders` against the same file the gateway writes |
| Feed health as a time series | `/metrics` exports per-venue book age, update rate, reconnects and staleness |

The improvement that matters here is not more data — it is data whose
provenance and quality are visible at the point of use.

### 🚨 DevOps / SRE — *"Is it healthy, and what do I do at 3am?"*

| Need | Where |
|---|---|
| Health for every deployable unit | `GET /health` (gateway), `/telegram/health`, `/healthz` (OpenBB service), `/api/system/health` (web tier) |
| Metrics a scraper can act on | `GET /metrics` — Prometheus text exposition, hand-rolled, **no client library**: feed state, book age, kill switch, order counters, drawdown budget, queue depth, per-route latency percentiles |
| Alert rules I do not have to invent | `tools/alert-rules.example.yml` — every expression keyed to a metric this gateway actually exports, each linked to its runbook section |
| A procedure at 3am | `docs/RUNBOOK.md`: feed down, drawdown halt, rejection spike, gate latency, job backlog, provider degraded — each with a way to rehearse it locally |
| Whether the failure is compute, provider, cache or venue | Systems console: breaker state, p50/p95/p99 with sample counts, quota meters with the reserve boundary, failover graph |
| To break it on purpose and watch it recover | Bounded, self-expiring simulated outages from the operator panel |
| One command that proves the money path works | `python tools/synthetic_probe.py` — health → book → cost → risk gate → audit, in-process and offline, non-zero exit on any failure |
| A deploy that cannot ship a file that was never committed | `tools/check_repo_complete.sh` builds an export of HEAD, not the working tree |
| CI on every push | `.github/workflows/ci.yml`: three suites, lint, the OpenAPI contract snapshot, the repo guard and the journey probe |

### 🛠 Quant Developers — *"Can I change this safely?"*

| Need | Where |
|---|---|
| Typed contracts, not conventions | Pydantic models on every route, with `response_model` — the schema is the code |
| A published, versioned API | `/docs` live, plus a committed `tools/openapi.json` snapshot; a test fails if the API changes without regenerating it |
| Documented tunables | `BacktestRequest` carries bounds *and* descriptions, so `/docs` doubles as the researcher's parameter registry |
| Confidence that two implementations agree | Python↔TypeScript parity suites for the **backtest engine** and the **risk engine**, both driven by fixtures the Python reference emits |
| To debug a request without guessing | Pipeline inspector down to raw vendor JSON; bounded trace ring with redaction; `/api/system/inspect` |
| Tests that run anywhere | 241 gateway + 333 web + 12 service tests, all offline by construction — no network, no fixtures fetched at test time |
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

Live order books, the risk gateway and the optional text-only Telegram
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
npm test       # 333 tests
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

---

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
 text-only, operational      authenticated controls        portfolio proxy
 /portfolio /quote /status        │                              │
          │ read-only             │                              │
          └──────────────┬────────┘                              │
                         ▼                                       │
              FastAPI stateful gateway ◄─────────────────────────┘
              main.py · auth · routing
                    │       │       │
           ┌────────▼─┐ ┌───▼────┐ ┌▼──────────────┐
           │ A · TCA  │ │ B · risk│ │ C · backtest │
           │ L2 + VWAP│ │ 14 gates│ │ jobs + DSR   │
           └────┬─────┘ └────┬────┘ └──────┬───────┘
                └────────────┼──────────────┘
                             ▼
                      DuckDB audit log

 Next.js OpenBB adapter ──► standalone OpenBB_Service (stateless, read-only)
```

The stateful portfolio gateway and the production OpenBB service are separate
deployments. `ALPHAENGINE_GATEWAY_URL` points here; `OPENBB_API_URL` points to
[`OpenBB_Service/`](OpenBB_Service/). The separation prevents slow research
fetches and serverless scaling from sharing the gateway's mutable risk state.

Module B **depends on** Module A: the risk gateway prices every order against the
live ladder, and fills it at the smart route's VWAP. That coupling is the point —
a pre-trade check that assumes mid-price liquidity is a check that lies.

```
Part2_Infrastructure/
├── main.py                 FastAPI gateway: routes, auth, lifespan, book WebSocket
├── config.py               Every constant and risk limit (env-overridable)
├── celery_tasks.py         Celery task definitions (optional backend)
├── worker.py               Celery worker entrypoint (optional)
├── modules/
│   ├── tca_engine.py       A · L2 ingest, book state, VWAP/slippage, routing
│   ├── risk_proxy.py       B · pre-trade gates, positions, breaker, kill switch
│   ├── backtester.py       C · signals, engines, DSR/PSR, walk-forward, plots
│   ├── portfolio.py        PM view: concentration, headroom, binding constraint
│   ├── research.py         Local OpenBB bridge for bot/compatibility use
│   ├── jobs.py             Async job queue (in-process pool ⇄ Celery)
│   ├── audit.py            DuckDB append-only audit log
│   ├── telegram.py         Text-only read models, alerts, webhook/polling
│   ├── quant_risk.py       VaR/ES, risk contribution, Kelly, regime, dislocation
│   └── schemas.py          Pydantic contracts shared by API, UI and bot
├── templates/miniapp.html  Independent gateway console (single file, no build step)
├── tests/                  Gateway, risk, portfolio, research and bot tests
├── tools/                  Parity-fixture generator + committed-tree build guard
├── requirements.txt
│
├── web/                    Unit 2 — Next.js research portal (deployed to Vercel)
├── OpenBB_Service/         Unit 3 — stateless OpenBB API (deployed separately)
└── LICENSE
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

**The 14 gates**, evaluated cheapest-first:

| # | Gate | Guards against |
|---|---|---|
| 1 | `kill_switch` | everything — one boolean read, always first |
| 2 | `symbol_halt` | per-instrument suspension |
| 3 | `symbol_whitelist` | trading an instrument nobody approved |
| 4 | `duplicate_order` | a retrying algo double-firing |
| 5 | `rate_limit` | runaway loops and exchange bans (token bucket) |
| 6 | `price_available` | pricing an order with no live mark |
| 7 | `order_sized` | ambiguous quantity/notional |
| 8 | `max_order_notional` | **fat finger** — $50k cap |
| 9 | `symbol_concentration` | projected per-symbol exposure |
| 10 | `gross_exposure` | projected book-wide exposure |
| 11 | `price_band` | limit price far from mark (fat finger, part 2) |
| 12 | `daily_drawdown` | the bad day — hard stop at 5% of start-of-day equity |
| 13 | `reduce_only` | *adding* risk once 80% of the drawdown budget is spent, while still allowing the exit |
| 14 | `est_slippage` | illiquid size — measured on the **routed** execution, not the mid |

Measured on live books: **0.14 – 0.24 ms** per decision. Gate 13 was added with
the reduce-only work and the count moved from twelve to fourteen; the two that
were previously one row are now their own, because a hard stop and a graduated
throttle are different controls and a reader should be able to see both.

**Principles:**

1. **Deny on ambiguity.** No live mark ⇒ reject. The gateway never guesses a price.
2. **Every decision is evidence.** Accepted *and* rejected orders are written to
   the audit log with the full check vector. A post-mortem can answer "why did
   this get through?" without re-running anything. A rejection returns HTTP 200 —
   it is a business outcome, not an error.
3. **The breaker is automatic.** A background monitor marks positions to market
   every 5s and trips the kill switch itself at the drawdown limit, with a warning
   alert at 80% of budget. No human required.
4. **Limits live in code with env overrides.** A limit that a compromised service
   can mutate at runtime is not a limit. `Settings` is a frozen dataclass; changing
   a hard limit requires a deploy, and therefore a code review.
5. **The gate measures what the fill will do.** The liquidity check runs against
   the *routed* execution, not the best single venue — otherwise the gateway would
   reject orders the router could fill, and understate cost on ones it accepted.
   `tests/test_risk_proxy.py::test_slippage_check_and_fill_price_agree` pins this.

**Paper fills are priced off the ladder, not the mid.** Filling at mid is the most
common way a paper system flatters itself. Here the fill price is the smart
route's actual VWAP, so paper PnL carries live cost structure.

**Kill-switch control stays inside authenticated trading surfaces.** Use the
gateway console or `POST /api/risk/kill` and `/api/risk/resume`; every change is
audited with actor and reason. Telegram broadcasts the resulting state change
but deliberately has no `/kill` or `/resume` command.

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
  an isolated peak is an overfit. Telegram reports a compact text result for jobs
  submitted elsewhere; it cannot start a sweep.

---

## 6. Telegram

The companion is optional: the gateway, API and web workspace remain fully
functional with no Telegram token. When enabled, it is an independent text
interface for phone-friendly portfolio, OpenBB, execution and health cards. It
does not render a web page or send web links, and it cannot enqueue a backtest
or reset the book. Sixty-one of its sixty-four commands are read-only. The three
that are not — `/halt`, `/resume`, `/flatten` — require membership of
`TELEGRAM_CONTROL_USER_IDS` (§6.1), which is separate from the read allow-list
and empty by default. Notification preferences and liquidity watches also change
from chat.

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

#### Essentials

| Command | Purpose |
|---|---|
| `/start` | Open the text command centre; does not subscribe automatically |
| `/help [CATEGORY\|COMMAND]` | Category help or exact syntax, for example `/help markets` |
| `/commands` | Complete categorized command catalogue |
| `/status` | Gateway, feed, queue and OpenBB status |
| `/about` | Scope and read-only guarantees |
| `/whoami` | Show Telegram user ID and destination chat ID |
| `/version` | Gateway version and delivery mode |
| `/ping` | Command-path responsiveness |

#### Portfolio manager

| Command | Purpose |
|---|---|
| `/portfolio` | Whole-book equity, P&L, exposure, concentration and binding limit |
| `/positions [SYMBOL]` | All positions or one instrument |
| `/pnl` | Realized and unrealized P&L |
| `/exposure` | Gross, net and leverage |
| `/concentration` | Largest weights, HHI and effective bets |
| `/headroom` | Remaining capacity before deployed limits bind |
| `/risk` | Drawdown budget and gateway state |
| `/limits` | Active hard limits; informational only |
| `/attribution` | Audit-backed flow and cost by strategy |

#### Markets and OpenBB

| Command | Purpose |
|---|---|
| `/openbb` | OpenBB/provider readiness |
| `/quote SYMBOL [equity\|crypto]` | Normalized quote, for example `/quote AAPL` |
| `/bars SYMBOL [15m\|1h\|4h\|1d] [COUNT]` | Recent OHLCV rows, for example `/bars AAPL 1d 5` |
| `/trend SYMBOL [INTERVAL] [COUNT]` | Return and direction over recent bars |
| `/range SYMBOL [INTERVAL] [COUNT]` | Period high, low and range |
| `/volume SYMBOL [INTERVAL] [COUNT]` | Latest and average volume |
| `/news SYMBOL [COUNT]` | Recent company headlines |
| `/fundamentals SYMBOL` | Company profile and key metrics |
| `/snapshot SYMBOL [equity\|crypto]` | Quote, fundamentals and top headlines in one card |
| `/symbols` | Tracked instruments and examples |

#### Execution analytics

| Command | Purpose |
|---|---|
| `/book SYMBOL` | Top of book across connected venues |
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

#### Research and audit monitoring

| Command | Purpose |
|---|---|
| `/researchstatus` | OpenBB and job-system status |
| `/jobs [COUNT]` | Recent externally submitted research jobs |
| `/job JOB_ID` | Inspect one job without changing it |
| `/backtests [COUNT]` | Completed backtest history |
| `/strategies` | Supported strategy reference |
| `/intervals` | Supported market and backtest horizons |
| `/events [COUNT]` | Recent risk and audit events |
| `/incidents [COUNT]` | Warning and critical events only |

#### Notification preferences

| Command | Purpose |
|---|---|
| `/subscribe` | Opt this chat into optional operational notifications |
| `/unsubscribe` | Stop optional notifications; centrally managed destinations are identified clearly |
| `/subscriptions` | Current notification ownership and state |
| `/watch SYMBOL [NOTIONAL] [MAX_BPS]` | Alert when execution cost breaches a threshold and when it recovers |
| `/unwatch [SYMBOL]` | Remove one watch, or all watches when omitted |
| `/watches` | Active thresholds and current state |
| `/digest` | On-demand portfolio and systems digest |

### Security and delivery guarantees

- Operational commands require a user ID in `TELEGRAM_ALLOWED_USER_IDS`; an
  empty list exposes bootstrap identity/help only.
- The bot is read-only with respect to trading and research job state. There is
  intentionally no `/kill`, `/resume`, `/reset`, `/order` or `/backtest`
  submission command.
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
| `GET` | `/api/config` | symbols, venues, limits |
| `GET` | `/api/book/{symbol}` | per-venue L2 ladders |
| `GET` | `/api/tca/{symbol}` | VWAP, slippage, smart route |
| `WS` | `/ws/book/{symbol}` | consolidated book + TCA at 4 Hz |
| `POST` | `/api/orders` | **submit through the risk gateway** |
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

`requirements.txt` is the full set (verified on Python 3.11 – 3.14, including
vectorbt + numba on 3.14). If numba will not build on your platform, use
`requirements-core.txt` — the backtester falls back to its NumPy engine and
nothing else changes.

**Celery/Redis is optional.** Set `REDIS_URL` and the job queue switches from the
in-process thread pool to Celery automatically; `python worker.py` starts a
worker. Without a broker, the same task callables run in-process. The API,
gateway console and read-only companion consume the same job status contract;
that abstraction matters more than the broker choice.

---

## 9. Assessment criteria

### Implemented vs. mocked

**Live and real:** L2 WebSocket ingest from two venues with sequence handling and
reconnection; all TCA maths and the cross-venue router; all 14 pre-trade gates,
position accounting, the drawdown breaker and the kill switch; vectorbt parameter
sweeps on live Binance klines; DSR and walk-forward; the DuckDB audit log; and
the fail-closed, text-only Telegram webhook/polling companion.

**Mocked, deliberately:** order *execution*. Accepted orders fill on paper against
the live ladder rather than being sent to an exchange. This is exactly what a
pre-production risk gateway does before it is pointed at a venue, and it is the
only honest thing to do without a funded account. The synthetic order book (§3) is
a clearly-labelled offline fallback, never a silent substitute.

### Production scale-out

AWS ECS/Kubernetes behind an ALB; TimescaleDB or ClickHouse for tick storage with
DuckDB kept for ad-hoc analytics; direct FIX sessions instead of public WebSockets;
Redis-backed Celery workers on a separate autoscaling group; secrets in AWS
Secrets Manager with an HSM for signing keys; the risk gateway replicated with
shared limit state in Redis so a single instance failure cannot open the gate.

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
| **RBAC and SSO** | Every role shares one gateway token; the only identity distinctions are that token, the Telegram read allow-list and the narrower control allow-list | Real role separation needs an identity provider and a session layer, which is a system in its own right. The *controls* that matter — who can halt, who can flatten — are already gated separately from who can read |
| **Orchestration** | No Airflow/Dagster: ingestion is supervised in-process and backfill is manual | A scheduler is the right answer at multi-desk scale and pure overhead at one process. The pieces it would schedule — validation, failover, staleness — exist and are testable without it |
| **Log aggregation and tracing** | Logs are per-process; there is no request id threaded across the three units | The bounded trace ring and the pipeline inspector answer the debugging questions locally. Shipping logs needs somewhere to ship them |
| **Margin, financing, liquidation** | Risk is notional-based: no leverage, funding or liquidation modelling | The paper book is unlevered and cash-settled, so a margin model would be arithmetic about a fiction |
| **Full CPCV** | Overfitting is priced by DSR and a sequential PBO estimate, not combinatorially purged cross-validation | CPCV costs factorially more compute for a tighter estimate of the same quantity. The cheap version is honest about being the cheap version |
| **Feature store and shared experiment registry** | Experiment history is per browser; the gateway's own `backtest_runs` table is the durable record | A feature store is a team-scale answer to a team-scale problem |
| **Working-order lifecycle** | Fills are immediate against the live ladder — no resting limit orders, cancel/replace, or open-order panel | Order state machines are where execution systems get genuinely hard, and faking one would misrepresent what is proven here |
| **mypy** | Python is typed but not type-checked in CI | pydantic plugin plus third-party stubs is a day of work with little to show a reviewer; ruff catches the defects that matter |

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
| Silently bad vendor data | data contracts on every payload; fatal violations fail over, suspect ones are quarantined with the evidence |
| Overfit research reaching production | DSR + walk-forward reported on every sweep |
| Alerting outage | alert-hook failures are caught and never block the trade path |

---

## 10. Testing

```
tests/test_tca_engine.py   book state, delta application, VWAP/slippage vs
                           hand-computed ladders, routing, staleness
tests/test_risk_proxy.py   every gate, token bucket, position accounting,
                           automatic breaker, fill quality, gate/fill agreement
tests/test_backtester.py   signal definitions, look-ahead check, cost accounting,
                           engine agreement, DSR/PSR properties, noise-grid rejection
tests/test_api.py          REST contract, rejection semantics, job lifecycle,
                           webhook authentication and companion health
tests/test_telegram.py     command registry, fail-closed user authorization,
                           text rendering, OpenBB reads and transition alerts
tests/test_portfolio.py    concentration maths, netting, binding constraint,
                           attribution wiring, realised P&L per strategy sleeve,
                           persisted equity history and period returns
tests/test_research.py     OpenBB bridge: absence contract (ok:false, never 500),
                           NaN-cleaning, field-alias resolution, input validation
tests/test_quant_risk.py   covariance conventions, risk contributions, Kelly,
                           regime, historical VaR, Kupiec backtest, scenario
                           propagation with measured betas, allocation solver
tests/test_rehydration.py  position replay from audited fills, reset boundaries,
                           and the ambiguity that must fail closed
tests/test_telegram_controls.py
                           the gated controls: separate allow-list, single-use
                           confirmation codes, expiry
tests/test_openapi_contract.py
                           the committed API snapshot, so a contract change to
                           two independently deployed clients cannot be silent
```

The gateway test suite is deterministic and requires no external network: market
data is disabled, the backtester falls back to its NumPy engine, and every
fixture is committed. The same is true of the web and service suites.

---

## 11. Deployment

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
an authentication path for this workspace.

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

The risk maths is deliberately doubled the same way.
[`modules/quant_risk.py`](modules/quant_risk.py) and
[`web/lib/portfolio-risk.ts`](web/lib/portfolio-risk.ts) are two implementations
of one set of conventions — so that a VaR quoted in Telegram and the same VaR on
the risk tab cannot disagree, and neither depends on the other being
reachable. The shared constants (`Z95`, the 2.0627 expected-shortfall
multiplier, `ddof=1`, mid-rank percentiles) are pinned by tests on both sides.

---

## 13. Verifying this deliverable

Everything a reviewer needs to check runs offline:

```bash
pytest                                    # 241 gateway + companion tests
python tools/synthetic_probe.py           # end-to-end: book → cost → gate → audit
cd OpenBB_Service && pytest               # 12 stateless service tests
cd web && npm install && npm test         # 333 workspace tests, incl. both parity suites
bash tools/check_repo_complete.sh         # builds the *committed* tree
```

Two of those deserve a note. The **probe** is the one that proves the parts are
wired to each other rather than merely correct in isolation: it walks the money
path in-process, submits an order the risk gate *must* refuse, and exits
non-zero if any step fails. The **parity suites** are what make "one engine, two
implementations" a claim rather than an aspiration — `tools/make_parity_fixture.py`
and `tools/make_risk_fixture.py` emit the Python reference's answers, and the
TypeScript tests assert reproduction to the fourth decimal.

The same commands run in CI on every push (`.github/workflows/ci.yml`), plus
`ruff check .` and `python tools/export_openapi.py --check`.

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
- The Telegram companion cannot enqueue backtests, authenticate a browser, or
  open a web workspace. It *can* halt, resume and flatten — but only for user
  IDs in `TELEGRAM_CONTROL_USER_IDS`, only with a single-use user-bound
  confirmation code that expires in 90 seconds and is burned even on a wrong
  guess, and `/flatten` goes through the same fourteen pre-trade gates as any
  other order rather than around them.
- The web project keeps `ALPHAENGINE_GATEWAY_TOKEN` and `OPENBB_API_TOKEN`
  server-side and connects to two separate services with distinct URLs.
- Risk limits are a frozen dataclass with env overrides: changing a hard limit
  requires a deploy, and therefore a code review.
