# AlphaEngine Trading Automation — NUSSIF Developer Analyst Case Study

Unified execution-quality, pre-trade-risk and strategy-research infrastructure,
reachable from a **Telegram bot**, a **Telegram Mini App** and a **Vercel web
portal**.

| | Module | Where it runs |
|---|---|---|
| **A** | Cross-venue TCA & L2 order-book depth (live Binance + Bybit) | gateway |
| **B** | Pre-trade risk gateway & emergency kill-switch | gateway |
| **C** | Asynchronous parametric backtesting, deflated for multiple testing | gateway **and** Vercel |

```
     Telegram bot            Telegram Mini App            Vercel research portal
   /kill /risk /tca         DOM · risk · research          trends · params · verdict
          │                          │                              │
          └────────────┬─────────────┘                              │
                       ▼                                            ▼
          FastAPI gateway (always-on)                    Next.js serverless
        A: L2 ingest, VWAP, smart routing                C: parameter sweeps
        B: 12 pre-trade gates, kill switch                  DSR + walk-forward
        C: vectorbt sweeps via job queue
                       │
              DuckDB audit log
```

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
| Stop everything, now | `/kill` — three characters, works one-thumbed on bad wifi |
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
| Test an idea across a parameter grid | Sweep in the Vercel portal, or `/backtest` from the bot |
| Not be fooled by the best of N draws | **Deflated Sharpe Ratio** — the hurdle a random search of the same size clears |
| Know it generalises | Walk-forward: parameters chosen in-sample, scored on the next unseen fold |
| See *robustness*, not just a winner | Sharpe surface — a plateau survives; an isolated peak is an overfit |
| Realistic costs | Fees and slippage charged on turnover; fills at the next bar, never at mid |

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

## Two deployables

### 1. `Part2_Infrastructure/` — the gateway (Python / FastAPI)

Live order books, the risk gateway and the Telegram bot. Needs a long-lived
process: it holds WebSocket subscriptions open and keeps risk state between
requests.

```bash
cd Part2_Infrastructure
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add TELEGRAM_BOT_TOKEN to enable the bot
uvicorn main:app --port 8000  # portal at http://localhost:8000/app
pytest                        # 134 tests
```

Full documentation: [`Part2_Infrastructure/README.md`](Part2_Infrastructure/README.md)

### 2. `web/` — the research portal (Next.js / Vercel)

Module C as a standalone deployable. No backend, no database, no API keys.

**Deploy:** import this repo at <https://vercel.com/new> and set **Root
Directory** to `web`. Everything else auto-detects.

```bash
cd web
npm install
npm run dev    # http://localhost:3000
npm test       # 83 tests
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

Full documentation: [`web/README.md`](web/README.md)

---

## Deployment

### Vercel — research portal (`web/`)

Set **Project → Settings → Build & Deployment → Root Directory** to `web`.
That is the only required setting; `web/` is a standard Next.js 16 app and
every environment variable is optional (provider keys extend coverage — see
[`web/.env.example`](web/.env.example)).

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

**Turn off Deployment Protection.** Settings → Deployment Protection → Vercel
Authentication → **Disabled**. While it is on, every request redirects to
`vercel.com/login`, so the Telegram Mini App webview opens a Vercel login page
instead of the portal, and the `/research` button does nothing useful. The portal
holds no secrets and has no mutating endpoints — the sweep API is a pure function
of its query — so there is nothing here that protection is buying.

### Telegram webhook — gateway

The bot runs in **webhook** mode whenever `PUBLIC_URL` is an `https://` origin,
and falls back to **long-polling** when it is not. Nothing else changes: every
command behaves identically on both transports.

The kill switch is why the webhook must point at the gateway and not at Vercel.
`/kill` has to reach the process that owns the risk state, and a serverless
function cannot hold that state (nor the L2 WebSocket subscriptions Module A
needs) between invocations.

Give the gateway a public HTTPS origin — free, no account:

```bash
cloudflared tunnel --url http://localhost:8000
#   https://<name>.trycloudflare.com
```

Put it in `.env` and restart; the bot registers the webhook itself on startup:

```bash
PUBLIC_URL=https://<name>.trycloudflare.com
RESEARCH_PORTAL_URL=https://<your-project>.vercel.app
TELEGRAM_MODE=auto        # -> webhook, because PUBLIC_URL is https
```

Verify Telegram's own view of it:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
# url set, pending_update_count 0, and no last_error_message
```

A quick tunnel's hostname changes each restart. For anything long-lived use a
named Cloudflare tunnel or a host with a stable domain, and update `PUBLIC_URL`.

Webhook requests are rejected unless they carry the
`X-Telegram-Bot-Api-Secret-Token` shared secret, so a forged POST to the public
URL cannot trip the kill switch.

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
cd Part2_Infrastructure && pytest        # 134 Python tests, ~10 s, no network
cd web && npm install && npm test        # 83 TypeScript tests, no network
bash tools/check_repo_complete.sh        # builds the *committed* tree, not the working tree
```

The last one exists because of a real incident: a bare `lib/` pattern inherited
from GitHub's Python `.gitignore` template silently swallowed `web/lib/`, so the
working tree built while the pushed repo did not. The guard exports `HEAD` via
`git archive` and builds *that*, then checks every tracked `.gitignore` for
unanchored directory patterns, scans for committed credentials, and verifies
import-path case (macOS is case-insensitive; the deploy target is not).

---

## Security

- `.env` is gitignored. **No token, key or secret is committed** — the Telegram
  bot token lives only in a local `.env` and in the host's environment variables.
- Mini App requests are authenticated by re-deriving Telegram's `initData` HMAC;
  webhook requests are verified against a shared secret header.
- Risk limits are a frozen dataclass with env overrides: changing a hard limit
  requires a deploy, and therefore a code review.

---

## Submission checklist

| # | Item | Where |
|---|---|---|
| 1 | Up-to-date CV | `CV_Ian_Wangsa.pdf` (placed alongside this README in the zip) |
| 2 | HTML export of the Part 1 notebook | `Part1_Data_Handling/Part1_Data_Handling.html` |
| 3 | Original Part 1 notebook | `Part1_Data_Handling/Part1_Data_Handling.ipynb` |
| 4 | All code, outputs and supporting files for Part 2 | `Part2_Infrastructure/` + `web/` |

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
