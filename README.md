# AlphaEngine Trading Automation — NUSSIF Developer Analyst Case Study

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
and `/flatten` submits through the same twelve pre-trade gates as a manual order
rather than around them.

| | Module | Where it runs |
|---|---|---|
| **A** | Cross-venue TCA & L2 order-book depth (live Binance + Bybit) | gateway |
| **B** | Pre-trade risk gateway & emergency kill-switch | gateway |
| **C** | Asynchronous parametric backtesting, deflated for multiple testing | gateway **and** Vercel |

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

Three people use a trading desk and they ask different questions. The system is
organised around that rather than around a feature list.

### 🎯 Traders — *"Can I send this, and what will it cost?"*

| Need | Where |
|---|---|
| See real liquidity before committing | Consolidated L2 ladder, streaming from Binance + Bybit |
| Know the cost *before* the fill | `/tca BTCUSDT 100000 BUY` — VWAP, slippage in bps, routing split |
| Not send the order with the extra zero | 12 pre-trade gates in ~0.2 ms; a rejection returns the full check vector |
| Stop everything, now | Authenticated gateway console, `POST /api/risk/kill`, the web workspace's risk panel, or `/halt` in Telegram — the last two gated by a separate operator allow-list and a typed confirmation |
| Know when something breaks without watching a screen | Push alerts on breaches, halts, and `/watch` liquidity thresholds |

### 📁 Portfolio managers — *"Where am I exposed, and which limit binds first?"*

| Need | Where |
|---|---|
| The book, not a position list | `/portfolio` and `GET /api/portfolio` |
| Is this one bet or a spread book? | Concentration: largest share, HHI, effective position count |
| Gross vs net — directional or hedged? | Both reported; a market-neutral book has large gross and ~zero net |
| How much room is left before trading stops | Headroom on every limit, and the **binding constraint** named explicitly |
| What is actually producing the P&L | Attribution by symbol and by strategy, from the append-only audit log |

A trader's view answers a question about the *next order*; a PM's answers one
about the *whole book*. The same numbers do not serve both, which is why
`/api/portfolio` exists separately from `/api/risk/state`.

### 🔬 Researchers — *"Does this strategy actually work?"*

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
| Not re-test the same idea, or forget how many were tried | Local run history that states the cross-run count: a per-run DSR prices one grid, not forty hypotheses |

The research portal will tell you a strategy **fails** even when the equity curve
looks good. That is the feature: a +82% backtest with DSR 0.71 and negative
out-of-sample Sharpe gets a red FAIL, not a green tick.

### What ties them together

The audit log. Every gate decision, kill-switch event, TCA snapshot and backtest
run is appended to DuckDB and is queryable with plain SQL. A trader's rejected
order, a PM's exposure figure and a researcher's sweep all reconcile to the same
rows — so "why does it say that?" has an answer that does not depend on anyone's
memory.

---

## Three deployment units

### 1. `Part2_Infrastructure/` — the gateway (Python / FastAPI)

Live order books, the risk gateway and the optional text-only Telegram
companion. This unit needs a long-lived process because it owns WebSocket
subscriptions, portfolio state, the kill switch and the audit log.

```bash
cd Part2_Infrastructure
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # optional: configure the Telegram companion
uvicorn main:app --port 8000  # gateway console at http://localhost:8000/app
pytest
```

Full documentation: [`Part2_Infrastructure/README.md`](Part2_Infrastructure/README.md)

### 2. `web/` — the research portal (Next.js / Vercel)

The integrated desk workspace. It works keylessly for crypto; optional
server-side variables connect its read-only portfolio proxy to the stateful
gateway and its OpenBB adapter to the separate stateless service.

**Deploy:** import this repo at <https://vercel.com/new> and set **Root
Directory** to `web`. Everything else auto-detects.

```bash
cd web
npm install
npm run dev    # http://localhost:3000
npm test       # 237 tests
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
and `POST /api/system/actions` for operator controls) back the **Systems
console** — the developer-facing tab. Its write path is gated by
`ALPHAENGINE_OPERATOR_TOKEN`: open outside production, refused in production
when unset, because a cache purge and a health probe both spend real quota.

Full documentation: [`web/README.md`](web/README.md)

### 3. `OpenBB_Service/` — stateless research data (Python / FastAPI / Vercel)

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
`OpenBB_Service`, then use its HTTPS origin as `OPENBB_API_URL`. Full details:
[`OpenBB_Service/README.md`](OpenBB_Service/README.md).

---

## Deployment

### Vercel — research portal (`web/`)

Set **Project → Settings → Build & Deployment → Root Directory** to `web`.
That is the only required setting; `web/` is a standard Next.js 16 app and
every environment variable is optional for the keyless crypto experience
(provider keys extend coverage — see [`web/.env.example`](web/.env.example)).
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

There is deliberately **no root-level `vercel.json`**: a root config that ran
`cd web && npm install` works only while the Root Directory is the repo root —
once it is `web`, the build already starts there and the same command fails
with `cd: web: No such file or directory`. The one config that does exist,
[`web/vercel.json`](web/vercel.json), contains no paths at all — it only pins
`"framework": "nextjs"` so the build can never fall back to the static "Other"
preset, which expects a `public/` output directory and fails *after* a
successful `next build`.

`next` is pinned exactly (not `^`) so a deployment can never resolve to a
different build than the one tested here.

**Turn off Deployment Protection** only if this case-assessment URL must be
public. Gateway and OpenBB credentials remain server-only in Vercel; the
browser can access only the explicit same-origin proxy routes. Telegram is not
an authentication path for this workspace.

### Vercel — standalone OpenBB service (`OpenBB_Service/`)

Create a second Vercel project with Root Directory `OpenBB_Service`. Configure
a long random `OPENBB_API_TOKEN` there, then set the matching token and the new
project's HTTPS origin in the `web` project. Keep the service read-only and do
not add portfolio, order, Telegram, database or background-worker concerns to
it. See [`OpenBB_Service/README.md`](OpenBB_Service/README.md) for its routes and
deployment checks.

### Telegram companion — gateway process, independent interface

The bot runs in **webhook** mode whenever `PUBLIC_URL` is an `https://` origin,
and falls back to **long-polling** when it is not. Polling is the simplest local
setup because it needs no public gateway URL. Webhook mode requires a stable
HTTPS gateway origin and a unique random `TELEGRAM_WEBHOOK_SECRET` of at least
32 characters:

```bash
PUBLIC_URL=https://gateway.example.com
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_SECRET=<unique-random-32+-character-secret>
```

The bot sends phone-friendly text cards and pushed alerts. It has no web button
or link and no backtest submission command. Sixty-one of its sixty-four commands
are read-only; the exceptions are `/halt`, `/resume` and `/flatten`, which
require membership of `TELEGRAM_CONTROL_USER_IDS` — separate from the read
allow-list and empty by default — plus a single-use confirmation code bound to
the requesting user. Subscription and watch preferences also change through
chat.

#### Safe bootstrap and token rotation

1. Create or rotate the bot token with `@BotFather`. Store it only in an
   ignored `.env` file or deployment secret; never commit it or paste it into
   source, screenshots, tickets or documentation.
2. Start once with `TELEGRAM_ALLOWED_USER_IDS` empty. The bot fails closed and
   exposes only `/start`, `/help`, `/commands`, `/about`, `/whoami` and
   `/version`.
3. Send `/whoami`, copy the reported **user ID** into
   `TELEGRAM_ALLOWED_USER_IDS`, and restart. User IDs authorize commands;
   destination chat IDs belong separately in `TELEGRAM_ALERT_CHAT_IDS`. Run
   `/subscribe` once in each destination to bind it to an allow-listed owner.
4. If a token appears in chat history or logs, use BotFather to revoke it,
   replace the environment secret, and restart. Do not reuse the exposed value.

#### Command catalogue

The Telegram menu contains the full registry; `/help CATEGORY` and
`/help COMMAND` provide syntax and examples without opening another interface.

| Category | Commands |
|---|---|
| Essentials | `/start` `/help` `/commands` `/status` `/about` `/whoami` `/version` `/ping` |
| Portfolio | `/portfolio` `/positions` `/pnl` `/exposure` `/concentration` `/headroom` `/risk` `/limits` `/attribution` |
| Markets / OpenBB | `/openbb` `/quote` `/bars` `/trend` `/range` `/volume` `/news` `/fundamentals` `/snapshot` `/symbols` |
| Execution analytics | `/book` `/spread` `/depth` `/tca` `/route` `/liquidity` `/venues` `/feedstatus` `/orders` `/fills` `/rejections` `/slippage` `/fees` |
| Research monitoring | `/researchstatus` `/jobs` `/job` `/backtests` `/strategies` `/intervals` `/events` `/incidents` |
| Alert preferences | `/subscribe` `/unsubscribe` `/subscriptions` `/watch` `/unwatch` `/watches` `/digest` |

Representative examples:

```bash
/snapshot AAPL
/bars AAPL 1d 5
/portfolio
/tca BTCUSDT 100000 BUY
/watch BTCUSDT 100000 25
/help markets
```

Webhook requests are accepted only with Telegram's matching
`X-Telegram-Bot-Api-Secret-Token` header. Long-polling and webhook delivery
produce identical command responses.

---

## One engine, two implementations, one test that proves it

The gateway runs parameter sweeps through vectorbt/numba; Vercel's serverless
runtime cannot. So the engine is reimplemented in TypeScript — and
[`web/tests/parity.test.ts`](web/tests/parity.test.ts) replays real Binance bars
through it and asserts it reproduces what the Python reference produced from
identical input, across all three models and both directions.

That test caught two real bugs in the port. It is regenerated with:

```bash
cd Part2_Infrastructure && python tools/make_parity_fixture.py
```

---

## Verifying this repo

Everything a reviewer needs to check runs offline:

```bash
cd Part2_Infrastructure && pytest         # stateful gateway + companion
cd OpenBB_Service && pytest               # isolated stateless OpenBB API
cd web && npm install && npm test         # TypeScript workspace
bash tools/check_repo_complete.sh         # builds the *committed* tree, not the working tree
```

The last one exists because of a real incident: a bare `lib/` pattern inherited
from GitHub's Python `.gitignore` template silently swallowed `web/lib/`, so the
working tree built while the pushed repo did not. The guard exports `HEAD` via
`git archive` and builds *that*, then checks every tracked `.gitignore` for
unanchored directory patterns, scans for committed credentials, and verifies
import-path case (macOS is case-insensitive; the deploy target is not).

---

## Security

- `.env` is gitignored. **No token, key or secret is committed.** Telegram,
  gateway and OpenBB tokens belong only in local or hosted environment secrets.
- Telegram authorization uses stable `message.from.id` values from
  `TELEGRAM_ALLOWED_USER_IDS`, not group chat membership. An empty allow-list is
  fail-closed and exposes bootstrap help only.
- Webhook mode requires a non-default high-entropy secret and validates
  `X-Telegram-Bot-Api-Secret-Token`. Polling mode needs no public endpoint.
- The Telegram companion cannot submit orders, trip or release the kill switch,
  enqueue backtests, authenticate a browser, or open a web workspace.
- The web project keeps `ALPHAENGINE_GATEWAY_TOKEN` and `OPENBB_API_TOKEN`
  server-side and connects to two separate services with distinct URLs.
- Risk limits are a frozen dataclass with env overrides: changing a hard limit
  requires a deploy, and therefore a code review.

---

## Submission checklist

| # | Item | Where |
|---|---|---|
| 1 | Up-to-date CV | `CV_Ian_Wangsa.pdf` (placed alongside this README in the zip) |
| 2 | HTML export of the Part 1 notebook | `Part1_Data_Handling/Part1_Data_Handling.html` |
| 3 | Original Part 1 notebook | `Part1_Data_Handling/Part1_Data_Handling.ipynb` |
| 4 | All code, outputs and supporting files for Part 2 | `Part2_Infrastructure/` + `web/` + `OpenBB_Service/` |

### Part 1 — data handling

`Part1_Data_Handling/` holds the notebook, its executed HTML export, the source
workbook, and `build_notebook.py` (the notebook is generated from that script so
the narrative is diff-able as text rather than buried in cell JSON).

It finds and documents **seven defects in 298 rows** — a mixed date format, two
label variants, a duplicated export, two missing measures, a negative request
count and a 4.8× billing anomaly — then answers the three questions:

* **Trend:** requests +22%, tokens +27%, cost +33% across the window. Cost
  outrunning tokens means the model mix is drifting toward the premium tier, not
  just that volume is rising.
* **Cost driver:** `doc-analysis` is 52% of spend on 6.5% of requests. Decomposed,
  request volume is ×0.45 (it makes *fewer* calls) while tokens/request is ×6.1
  and unit price is ×4.1 — so one request costs ~25× a `ticket-summarizer` one.
  The lever is model choice and context size, not call volume.
* **Assumptions:** every transformation is logged as it happens and printed as a
  register, with a raw→clean reconciliation of every total.
