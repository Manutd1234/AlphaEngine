# AlphaEngine — Unified Execution Gateway & Risk Portal

**NUSSIF Developer Analyst Case Study — Part 2**

A single FastAPI service that combines all three assessment options into one
institutional-grade system, reachable from a Telegram bot and a Telegram Mini App
(which is also a standalone web portal).

| | Module | What it does |
|---|---|---|
| **A** | **Cross-Venue TCA & Order Book Depth** | Live L2 books from Binance + Bybit, VWAP / slippage for a target order size, smart cross-venue routing |
| **B** | **Pre-Trade Risk Gateway & Kill-Switch** | 12 pre-trade gates in ~0.2 ms, automatic drawdown circuit breaker, one-command emergency stop |
| **C** | **Asynchronous Parametric Backtester** | vectorbt parameter sweeps off the request path, **deflated** for multiple testing, walk-forward validated |

Everything writes to an append-only DuckDB audit log.

---

## 1. Quick start

```bash
cd Part2_Infrastructure
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt          # or requirements-core.txt (see §8)
uvicorn main:app --port 8000
```

Open **<http://localhost:8000/app>**.

That is the whole setup. No API keys, no Redis, no database server, no Telegram
token — the portal comes up with live market data and a working risk gateway. The
optional pieces are in §6 (Telegram) and §7 (Celery).

Run the tests:

```bash
pytest                                   # 115 tests, ~9s, no network required
```

---

## 2. Architecture

```
      ┌──────────────────────────┐        ┌──────────────────────────────┐
      │  Telegram text commands  │        │  Telegram Mini App / Web UI  │
      │  /kill  /risk  /tca ...  │        │  DOM · TCA · Risk · Research │
      └────────────┬─────────────┘        └───────────────┬──────────────┘
                   │ webhook or long-poll                 │ REST + WebSocket
                   └──────────────────┬───────────────────┘
                                      ▼
                      ┌───────────────────────────────┐
                      │   FastAPI Central Gateway     │
                      │   main.py · auth · routing    │
                      └───┬───────────┬───────────┬───┘
                          │           │           │
              ┌───────────▼──┐  ┌─────▼───────┐  ┌▼─────────────────┐
              │ A tca_engine │  │ B risk_proxy│  │ C backtester     │
              │ L2 WS ingest │◄─┤ 12 gates    │  │ vectorbt sweep   │
              │ VWAP / slip  │  │ kill switch │  │ DSR + walk-fwd   │
              │ smart router │  │ breaker     │  │ ↕ jobs.py queue  │
              └───────┬──────┘  └──────┬──────┘  └────────┬─────────┘
                      └────────────────┼──────────────────┘
                                       ▼
                          ┌─────────────────────────┐
                          │  DuckDB audit log       │
                          │  orders · risk_events   │
                          │  tca_snapshots · runs   │
                          └─────────────────────────┘
```

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
│   ├── jobs.py             Async job queue (in-process pool ⇄ Celery)
│   ├── audit.py            DuckDB append-only audit log
│   ├── telegram.py         Bot commands, webhook/polling, Mini App HMAC auth
│   └── schemas.py          Pydantic contracts shared by API, UI and bot
├── templates/miniapp.html  The Mini App / web portal (single file, no build step)
├── tests/                  115 tests
└── requirements.txt
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

**The 12 gates**, evaluated cheapest-first:

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
| 12 | `daily_drawdown` + `est_slippage` | the bad day; illiquid size |

Measured on live books: **0.14 – 0.24 ms** per decision, twelve gates.

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

**Kill switch** is reachable four ways — `/kill` in Telegram, an inline button, the
red button in the Mini App, and `POST /api/risk/kill`. Global or per-symbol. Every
engage/release is audited with actor and reason, and broadcast to Telegram.

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
  an isolated peak is an overfit. Both are pushed straight into the Telegram chat.

---

## 6. Telegram

Works with **no token at all** — the REST API and web portal are fully functional
without it. To enable the bot:

1. `@BotFather` → `/newbot` → copy the token.
2. `cp .env.example .env`, set `TELEGRAM_BOT_TOKEN`.
3. Restart. Message the bot `/whoami`, put the chat id in
   `TELEGRAM_ALLOWED_CHAT_IDS`, restart again.

**Transport is automatic.** With a public `https://` `PUBLIC_URL` the bot
registers a webhook. Without one it long-polls instead — so it works on a laptop
with no tunnel. Behaviour is identical either way; only delivery differs. Force it
with `TELEGRAM_MODE=webhook|polling`.

For webhook mode locally: `ngrok http 8000`, then set `PUBLIC_URL` to the https URL.
The Mini App button also requires https (Telegram's rule) — without it the bot
sends the portal URL as text instead.

### Commands

```
/kill  [SYMBOL]     halt all trading, or one instrument      ← the important one
/resume [SYMBOL]    resume
/status             gateway + per-venue feed health
/risk               equity, PnL, drawdown budget bar
/positions          open paper positions
/orders             last 10 gateway decisions
/limits             active hard limits
/book BTCUSDT       top of book, every venue
/tca BTCUSDT 100000 BUY    VWAP, slippage, smart route, $ saved
/backtest BTCUSDT 1h ma_cross    queue a sweep → chart pushed back
/jobs               job queue status
/app  /start        open the Mini App
```

### Security

- Webhook requests verified against `X-Telegram-Bot-Api-Secret-Token`.
- **Mini App requests authenticated by re-deriving Telegram's `initData` HMAC**
  (`HMAC(HMAC("WebAppData", bot_token), data_check_string)`), with an expiry
  check. A tampered or unsigned payload cannot reach a mutating endpoint.
- Chat-ID allow-list gates command execution; an empty list runs open and logs a
  warning (dev only). `REQUIRE_AUTH=1` closes the anonymous browser path too.
- The webhook always returns 200 and processes updates out-of-band, so a slow
  command never causes Telegram to retry and double-fire.

---

## 7. API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | all three modules + feed health |
| `GET` | `/api/config` | symbols, venues, limits |
| `GET` | `/api/book/{symbol}` | per-venue L2 ladders |
| `GET` | `/api/tca/{symbol}` | VWAP, slippage, smart route |
| `WS` | `/ws/book/{symbol}` | consolidated book + TCA at 4 Hz |
| `POST` | `/api/orders` | **submit through the risk gateway** |
| `GET` | `/api/risk/state` | equity, PnL, drawdown, positions |
| `POST` | `/api/risk/kill` · `/resume` · `/reset` | emergency control |
| `POST` | `/api/backtest` | queue a sweep → `job_id` |
| `GET` | `/api/jobs/{id}` | progress, then the full result |
| `GET` | `/api/audit/orders` · `events` · `backtests` · `stats` | audit log |
| `POST` | `/telegram/webhook` | Telegram updates |

Interactive docs at `/docs`.

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
worker. Without a broker, the same task callables run in-process. The API, the
Mini App and the bot never learn which backend is running — that abstraction
matters more than the broker choice.

---

## 9. Assessment criteria

### Implemented vs. mocked

**Live and real:** L2 WebSocket ingest from two venues with sequence handling and
reconnection; all TCA maths and the cross-venue router; all 12 pre-trade gates,
position accounting, the drawdown breaker and the kill switch; vectorbt parameter
sweeps on live Binance klines; DSR and walk-forward; the DuckDB audit log; the
Telegram webhook/polling bot and Mini App HMAC authentication.

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
shared limit state in Redis so a single instance failure cannot open the gate;
Prometheus metrics on gate latency, feed staleness and rejection rates.

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
| Bad day | automatic drawdown breaker at 5%, warning at 80% of budget |
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
                           initData signature and expiry validation
tests/test_telegram.py     command dispatch, authorisation, rendering, alerts
```

115 tests, ~9 s, no network required.
