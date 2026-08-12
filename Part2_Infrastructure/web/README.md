# AlphaEngine — Integrated Investment Infrastructure (Vercel)

The desk-facing half of AlphaEngine as a deployable Next.js app: one shared
instrument and decision context across portfolio oversight, strategy research,
live execution-cost analysis, market-data lineage and developer operations.
Research still gives an explicit answer to **"does this strategy actually
work?"** with the multiple-testing correction applied, not just the headline
Sharpe; the result now carries forward into the execution and data workflows.

The public market, research and data workflows need no backend, database or API
keys. An optional server-side connection to the stateful AlphaEngine gateway
adds the authoritative portfolio/risk view without exposing gateway credentials
to the browser. A separate stateless OpenBB service adds quotes, bars, news and
fundamentals. Provider keys (also optional) extend coverage through the
seven-provider registry — see [Data providers](#data-providers).

The Telegram companion is a separate text-only notification client. The header
carries a one-way deep link out to it, but the web workspace never embeds it and
never authenticates through it, and the bot never opens or controls this UI.

---

## Tech stack

**This app:** Next.js 16 (App Router, Turbopack), React 19, TypeScript 5,
Tailwind 4 utilities over a hand-written token system (`app/globals.css` owns
every colour, both theme palettes and the AA contrast contract that
`tests/theme.test.ts` enforces). Charts are hand-rolled SVG on one scale kit
(`components/chart-kit.tsx`) — no chart library. Deployed on Vercel, region
`sin1` (venue egress — see the region note under Deploy).

**Behind it** (documented once, in
[`../README.md` §2 Tech stack](../README.md#2-architecture) — this section
deliberately summarises rather than restates, so the two files cannot drift into
different claims): a Python 3.12 / FastAPI gateway in Docker on port 8000 with
an authoritative DuckDB audit log; a Supabase Postgres mirror + pgvector RAG
layer (off by default, server-side only); a stateless OpenBB research service.

**Credential rule:** the browser bundle contains **zero backend env vars**.
`ALPHAENGINE_GATEWAY_URL` must be `https://` (the proxy rejects `ws://` and any
non-http(s) scheme, and rejects loopback/private hosts in production). The
`NEXT_PUBLIC_SUPABASE_*` variables are public by design and now carry three
browser surfaces: the decision tape, the optional sign-in at `/login`, and the
preference sync that mirrors theme, detail level and last-open tab to the
signed-in account. Unset remains safe — each of those reads as not configured
and nothing else changes. `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` is public for the
same reason and, when unset, simply removes the header's Telegram button. The
bot token, the service-role key and every gateway credential stay server-side.

---

## Deploy to Vercel

1. Import the GitHub repo at <https://vercel.com/new>.
2. Set **Root Directory** to `Part2_Infrastructure/web`. Everything else
   auto-detects (Next.js 16) — `Part2_Infrastructure/web/vercel.json` pins
   `"framework": "nextjs"` so the build cannot fall back
   to the static "Other" preset, which looks for a `public/` output directory
   and fails **after** a successful `next build` with
   *"No Output Directory named 'public' found"*.
3. Deploy. There are no required variables for keyless crypto research. For the
   integrated PM view, set `ALPHAENGINE_GATEWAY_URL` to the long-lived gateway
   and `ALPHAENGINE_GATEWAY_TOKEN` to its `WEB_API_TOKEN`. For OpenBB, deploy
   [`../OpenBB_Service`](../OpenBB_Service) separately and set
   `OPENBB_API_URL` plus the matching `OPENBB_API_TOKEN`. To make Artifact
   custody pass, pin the approved public-key SPKI SHA-256 fingerprint in
   `lib/artifact-trust.mjs`, then add the matching Ed25519 PEM as
   `ALPHAENGINE_ARTIFACT_SIGNING_KEY`; the build signs its commit/environment
   plus a digest of its Git tree, dependency lock, toolchain, and deployment
   identity without compiling the private key into the app. Then redeploy.

```text
ALPHAENGINE_GATEWAY_URL=https://stateful-gateway.example.com
ALPHAENGINE_GATEWAY_TOKEN=<gateway WEB_API_TOKEN>

OPENBB_API_URL=https://openbb-service.example.com
OPENBB_API_TOKEN=<OpenBB service token>
```

These URLs must not be collapsed into one production origin. The gateway owns
mutable portfolio and risk state; the OpenBB service is read-only and stateless.

Locally:

```bash
cd web
npm install
npm run dev        # http://localhost:3000 (Turbopack)
npm run build      # Turbopack production build
npm run typecheck  # tsc --noEmit
npm test           # 680 tests, no network required
```

Built on **Next.js 16** with **Turbopack**, which is the default bundler for both
`dev` and `build` in 16 — no `--turbopack` flag is needed, and passing one is a
no-op. `next lint` was removed in 16; since this project carries no ESLint config
or dependency, the script slot is a real `tsc --noEmit` typecheck rather than a
new dependency tree.

---

## What it does

**One tab per desk role** — the workspace has eight tabs: an overview that
launches into the other seven, and one each for the roles the platform is built
for.

| Tab | Role | What it answers |
| --- | --- | --- |
| Research | Quant researcher | Is this candidate real, or did the search find noise? |
| Execution | Quant trader | What is the book doing right now, and what would this order cost? |
| Portfolio | Portfolio manager | What do we hold, and is the capital where it was meant to be? |
| Risk | Risk manager | How close are we to a limit, and what does the tail look like? |
| Data | Data engineer | What needs attention, where did this number come from, and can it be trusted? |
| Reliability | DevOps / SRE | Is the platform healthy, and which layer broke? |
| Developer | Quant developer | What is the contract, and what proves it still holds? |

Panels have exactly one home. Where a second role needs a figure — a PM checking
headroom before adding to a sleeve, an SRE glancing at quarantine during an
incident — that tab carries a compact summary tile that links to the full panel
rather than a copy of it, so two tabs can never disagree about the same number.

Portfolio and Risk read one gateway snapshot through a shared hook; Data,
Reliability and Developer share one health poll the same way. Splitting the tabs
without sharing the fetch would have given each of them its own idea of the
book.

The Data workspace opens on an overview-first trust cockpit for the active
instrument. It combines market-data freshness, quote/bar validation evidence,
quarantine, lineage and provider capacity into one triage view, then drills into
**Quality & Incidents**, **Lineage & Payloads**, **Providers & Capacity** and
**Work Queue**. A trust verdict is evidence-backed: the validation window is
bounded and local to one function instance, and zero evaluated payloads is
reported as insufficient evidence rather than healthy. On entry, an on-demand
quote inspection attaches the contract outcome to that exact active-symbol
payload, so the verdict does not rely on module memory being shared across
separate Vercel route instances.

Lineage follows the workspace's active symbol and selected interval through the
cache key, TTL, provenance, skipped providers, upstream calls, raw vendor JSON
and normalised output. The Work Queue is deliberately mocked sample data held
only in browser memory for the current session; it is not a durable ticketing
or incident system. This scope keeps the assessment's market-data
quality/freshness monitor useful to a trader while making infrastructure
quality, reliability and implemented-vs-mocked boundaries reviewable.

**Connected desk context** — instrument and horizon remain shared application
state, edited inside the workspaces that use them rather than in a permanent
header row. Research winners retain their modeled slippage budget when handed
to the live TCA probe; quote lookups and portfolio positions can focus the
other workspaces without re-entry.

<a id="systems-console"></a>
**Reliability console** — an observability surface, not a second quote lookup.
It answers the questions an SRE actually arrives with:

- **One source-aware status strip** — overall, trading-path and research-path
  posture are derived once. A provider-only deployment is degraded rather than
  nominal; stale gateway evidence is unknown; an unreachable configured gateway
  is critical; and an authoritative risk halt stays distinct from a research
  provider outage.
- **Authoritative gateway components** — when `ALPHAENGINE_GATEWAY_URL` is
  connected, the FastAPI gateway contributes a versioned snapshot of venue-feed
  freshness, risk mode, queue configuration, audit availability and bounded
  per-route latency. Source observation time travels with the payload, so a
  last-good snapshot cannot silently remain green.
- **Upstream health matrix** — per provider: circuit state with its failure
  count and cooldown, p50/p95/p99 latency *with the sample count that produced
  them* (a p99 over four calls is not a p99), quota consumption, failover rank,
  and per-row actions. The two direct exchange clients that `/api/depth` and
  `/api/tca` reach without the registry are measured separately and labelled as
  such, because they have no failover chain and no breaker.
- **Failover path** — the ranked chain for a capability/asset pair, evaluated
  with the same checks in the same order as the dispatch loop, marking the node
  a request issued right now would land on. `Simulate outage` holds a provider
  out server-side so failover can be *watched* rather than believed; it is
  bounded, self-expiring and reported as its own skip reason (`simulated_outage`)
  so a fault someone caused is never mistaken for one they did not.
- **Quota meters** — with the reserve boundary drawn on each bar. A provider at
  82% of Alpha Vantage's 25/day is not "nearly out"; it is already refusing
  background refreshes and saving the rest for a person, and one threshold
  cannot show that.
- **Pipeline inspector** — cache hit or miss, the exact key, TTL remaining and
  how old the served value was, the lineage, every provider skipped and why,
  each upstream HTTP call, and the vendor's raw JSON before normalisation. A
  second tab taps the browser's WebSocket frames, which never reach the server
  and are labelled accordingly.
- **Logs & traces** — server dispatch decisions and browser-side frames merge
  into a cursor-aware timeline with a structured detail pane. Provider and venue
  rows jump here with a contextual filter already applied; a discontinuity is
  rendered rather than hidden.
- **Guarded remediation** — disruptive provider-routing actions stop at a
  keyboard-focusable preview showing target, control plane, blast radius and
  consequence. Resetting a quota ledger clears *our* count, not the vendor's
  meter, and says so.

Reads are always available. Writes are gated by `ALPHAENGINE_OPERATOR_TOKEN`:
open outside production, refused in production when unset, so a public
deployment cannot have its data plane poked by a stranger. These mutations are
explicitly instance-local provider-routing controls; the Python gateway kill
switch remains on its authenticated trading surfaces.

For an assessment deployment, `ALPHAENGINE_PAPER_ORDER_DEFAULT=1` may reuse the
server-held operator token only for a missing credential on new paper orders.
The secret is never returned to the browser. Any pasted credential is validated
as a strict override, while kill/flatten, cancel/replace, and remediation remain
explicitly token-gated.

The four stable subtab IDs now present the incident workflow as **Telemetry &
SLIs → Services & Circuits → Logs & Traces → Remediation**. The compact strip is
the only repeated posture summary; the overview begins with active attention
and evidence scope instead of restating the same latency and success figures.

**Portfolio oversight** — when `ALPHAENGINE_GATEWAY_URL` is configured, the
read-only server proxy renders authoritative equity, day P&L, gross/net
exposure, concentration, binding limits, positions, risk headroom and
audit-backed strategy flow. Gateway credentials remain server-side. The UI
retains a last-good snapshot only with an explicit stale warning, disables its
execution handoff while stale, and validates the gateway schema before calling
the book live.

The tab is four sub-tabs — **Overview**, **Positions**, **Allocation**,
**Performance** — on the same `WorkspaceSubtabs` roving-tablist primitive the
other six dense workspaces already use. Portfolio was the last one still a single
scroll, and a PM checking exposure had to travel past a rebalance table and an
attribution table to reach it. The split duplicates nothing: the Overview's
largest-exposure summary is five columns against the full table's nine — no mark,
no beta, no volatility contribution, no row actions — and *links to* Positions
rather than repeating them. Both read the same snapshot,
so they cannot disagree — but only one of them is the place to act on a position.

<a id="research-lab"></a>
**Research lab** — the Research tab is a validation pipeline, not a parameter
sweep with a chart. Beyond the verdict and the Sharpe surface it answers the
questions a researcher asks *after* a result comes back red:

- **Parameter stability** — every grid point is classified by what its
  *neighbours* do. A plateau degrades smoothly as parameters move; a cliff
  collapses one grid step away and is a coordinate the search found in noise.
  Adjacency is in grid-index space, because with a step of 5 the neighbour of 25
  is 20 — 24 was never tested.
- **Walk-forward timeline** — in-sample and out-of-sample Sharpe per fold on one
  axis, with walk-forward efficiency and parameter drift. One aggregate number
  cannot distinguish steady decay from a single regime break, and those imply
  different next experiments. Efficiency is blank where in-sample lost money,
  because OOS ÷ a negative IS returns a *positive* ratio for a fold that lost
  twice.
- **Factor exposure** — strategy returns regressed on three time-series factors
  built from the same instrument: market, trend (TSMOM) and volatility regime.
  Not Fama–French, and labelled as such: one symbol's OHLCV cannot produce a
  cross-sectional factor. Reports alpha with its t-statistic, R², the
  idiosyncratic share and the pairwise factor correlations that make an
  individual loading unstable.
- **Tail risk** — VaR/CVaR (expected shortfall over the worst *k* order
  statistics, not everything below a threshold), the Ulcer index, and a monthly
  return grid. Sharpe divides by standard deviation and so treats a fat left tail
  as ordinary variance.
- **Microstructure frictions** — optional square-root market impact
  (`k·√(order ÷ ADV)`), perpetual funding and short borrow. All default to zero,
  and at zero the run is arithmetically identical to the Python gateway's flat-bps
  engine — which the parity fixture pins. Any non-zero value makes the run a model
  of your assumptions, and the UI says so where the switch is.
- **Promotion gate** — six vetoes (DSR, OOS Sharpe, walk-forward efficiency,
  parameter neighbourhood, alpha t-statistic, trade count), all shown pass or
  fail. Hand-off to Execution is disabled until every one clears, and moves the
  candidate to paper pricing only.
- **Experiment history** — every run saved locally, with the count stated
  prominently: a per-run Deflated Sharpe prices the grid *inside* that run and
  knows nothing about the other thirty-nine hypotheses tested that afternoon.

**Trend & signal view** — price with the lines the model *actually trades on*
(SMAs for the crossover, breakout/trailing bands for Donchian, the trend filter
for RSI), and the bars where it held a position shaded behind them. Two moving
averages crossing is abstract; "you were long here and flat there" is not.

**Parameter controls** — symbol, interval, history depth, model, direction, the
fast/slow grid (from / to / step for each), fees and slippage in bps, and the
number of walk-forward folds. The combination count updates live, because a wider
search is not free: it raises the statistical hurdle the winner has to clear.

**The verdict, stated first** — before any chart, the page says PASS / MARGINAL /
FAIL and why, showing four numbers side by side:

| | |
|---|---|
| In-sample Sharpe | the number a naive backtest would report |
| Hurdle from the search | what a *random* search of the same size would have produced |
| Deflated Sharpe (DSR) | P(true Sharpe > 0) after paying for that search |
| Walk-forward OOS Sharpe | measured on data the parameters never saw |

**Equity curve vs buy & hold**, indexed to 1 so both share one axis, with the
drawdown underneath in its own panel.

**Sharpe surface** over the whole grid. The shape is the message: a broad plateau
means the edge survives small parameter changes; a lone bright cell surrounded by
neutral is an overfit that happened to win this particular search. Click any cell
to re-run that single combination and see what it actually did.

**Walk-forward folds** and the **top-15 table** — the full ranking behind the
winner, and the in-sample → out-of-sample gap that reveals overfitting.

---

## API

Every endpoint below the first group is public, needs no key, and hits the
exchanges live. `GET /api/markets` returns this list at runtime.

| Endpoint | Returns |
|---|---|
| `GET /api/markets` | symbols, venues, strategies, limits, endpoint index |
| `GET /api/ticker?symbols=BTCUSDT,ETHUSDT` | last price, 24h change, high/low, volume |
| `GET /api/depth?symbol=&limit=&depth=` | live L2 book per venue **and** the consolidated ladder, with cumulative notional |
| `GET /api/tca?symbol=&side=&notional=` | VWAP, slippage in bps, fillability per venue, and the cross-venue routing split |
| `GET /api/ohlcv?symbol=&interval=&bars=` | historical candles — crypto keyless via Binance; equities via the provider registry |
| `GET /api/gateway/portfolio` | same-origin read-only proxy to the authoritative FastAPI portfolio/risk book (optional gateway connection) |
| `POST /api/gateway/orders` | submit one order through the gateway's pre-trade gates; every field validated, never coerced |
| `GET /api/gateway/orders/working?symbol=` | the gateway's resting order book — what is still open, and therefore still actionable |
| `POST /api/gateway/orders/{id}/cancel` | pull one resting order |
| `POST /api/gateway/orders/{id}/replace` | cancel-and-new; relays the replacement's own check vector, not the original's |
| `POST /api/backtest` | parameter sweep with deflated Sharpe and walk-forward |

The read is ungated, exactly like every other read in this app; the two mutators
sit behind `ALPHAENGINE_OPERATOR_TOKEN` alongside `POST /api/gateway/orders`,
because reaching a book and being allowed to *move* it are separate questions. A
gateway rejection still comes back with HTTP 200 and its full check vector — a
blocked order is the system working, not a failed request — and on a replace that
matters twice over, because a rejected replacement still means the original is
gone, and the decision is the only place the client can learn it. An id that has
stopped resting is a 404 with its own sentence rather than the shared boundary's
blanket 502: the order filled or expired between reading the book and pressing
the button, which is the ordinary race, not an outage.

The research-data group routes through the [provider registry](#data-providers):

| Endpoint | Returns |
|---|---|
| `GET /api/quote?symbols=AAPL,BTCUSDT` | normalised quotes with provenance (which provider, latency, delayed?, quota left) |
| `GET /api/quote?symbols=AAPL&consensus=1` | every configured source at once: per-leg deviation from the median in bps, staleness, outliers |
| `GET /api/news?symbols=AAPL&limit=20` | normalised headlines; `sentiment` only where a provider actually scores it |
| `GET /api/fundamentals?symbol=AAPL` | company profile & valuation, edge-cached for a day |
| `GET /api/research?q=bitcoin+etf+flows` | open-web search returning readable markdown documents |
| `GET /api/research?url=https://…` | one page fetched as markdown (public HTTP(S) targets only) |
| `GET /api/providers` | the supply chain: per provider — configured? actively ready? circuit open? quota spent? which env var enables it |

The systems group backs the [developer console](#systems-console):

| Endpoint | Returns |
|---|---|
| `GET /api/system/health[?priority=]` | provider breakers, latency, failover, cache and guard state plus an optional validated FastAPI `/api/ops/snapshot`; provider and gateway freshness remain independent, while bounded health-route-instance quote/bar totals expose their limited evidence window and leave zero observations unknown |
| `GET /api/system/events?since=<seq>&limit=` | structured trace cursored by sequence, with the oldest sequence still retained so a lagging client can detect dropped lines |
| `GET /api/system/inspect?symbol=&capability=&raw=1&refresh=1` | one lookup taken apart: cache key + TTL remaining, exact-payload contract result, lineage, every provider skipped and why, each upstream HTTP call, and the vendor's raw JSON before normalisation |
| `POST /api/system/actions` | purge cache, reset breaker, simulate/clear an outage, reset a local ledger, probe a provider, reload configuration, clear telemetry |

Common query params on the research group: `provider=` pins one adapter
(`?provider=tiingo`), `priority=interactive` marks a human-driven call that may
spend into the reserved quota — the default `background` is fenced out of each
provider's reserve so an auto-refreshing panel can never exhaust a monthly
budget a person needs later.

```bash
curl "https://<your-app>.vercel.app/api/tca?symbol=BTCUSDT&side=BUY&notional=100000"
curl "https://<your-app>.vercel.app/api/quote?symbols=AAPL,BTCUSDT&consensus=1"
```

## Data providers

Seven upstreams behind one registry (`lib/providers/`). Routes ask for a
*capability* — quote, bars, news, fundamentals, search, scrape — and the
registry picks the highest-ranked provider that is configured, under quota and
not circuit-broken, then attaches provenance and the list of everything it
skipped and why. **With no keys at all, crypto still works** through Binance's
public endpoints; each key adds capability without touching code.

| Provider | Capabilities | Free tier assumed | Env var |
|---|---|---|---|
| Binance (public) | crypto quote, bars | keyless | — |
| Financial Modeling Prep | quote¹, fundamentals¹, bars, news | 250/day | `FMP_API_KEY` |
| Tiingo | quote, bars, news¹ (IEX + crypto) | 1,000/day | `TIINGO_API_KEY` |
| Massive (ex-Polygon.io) | bars¹, quote, news, reference | 5/min, EOD | `MASSIVE_API_KEY` |
| Alpha Vantage | quote, bars, fundamentals, news+sentiment | 25/day | `ALPHAVANTAGE_API_KEY` |
| Firecrawl | web search¹, scrape¹ | 1,000 credits/mo | `FIRECRAWL_API_KEY` |
| OpenBB | stateless OpenBB/YFinance service | n/a | `OPENBB_API_URL` + `OPENBB_API_TOKEN` |

¹ = ranked first for that capability. Full signup pointers in
[`.env.example`](.env.example).

The reliability layer (`lib/providers/runtime.ts`) is what makes seven flaky
free tiers behave like one dependable feed:

- **Quota ledger** — calls are counted *before* they are made, per calendar
  window (Alpha Vantage's 25/day would otherwise be gone in half an hour of
  polling); background refreshes are fenced out of a per-provider reserve so
  interactive lookups still have budget at 4pm.
- **Circuit breaker** — 3 consecutive failures open the circuit for 60s, so one
  dead vendor stops costing every request its timeout.
- **Failover with provenance** — the response names who answered *and* who was
  skipped (no key / quota spent / circuit open / failed), so a degraded answer
  is visibly degraded.
- **Consensus mode** — the failure that costs money is not an outage, it is a
  feed quietly serving Friday's close with HTTP 200. `?consensus=1` fans out to
  every configured source and flags legs > 50bps from the median.
- **Honest limitation** — the ledger lives in the function instance's memory;
  on a multi-instance deployment each instance counts its own spend. `Store` is
  an interface with one in-memory implementation precisely so Vercel KV/Redis
  is a drop-in swap, and `/api/providers` states the scope in its payload.

OpenBB is the odd one out: it is a Python library, so this repository packages
it as an independent API in [`../OpenBB_Service`](../OpenBB_Service). That
service uses pinned provider fetchers directly and exposes only health, quote,
bars, news and fundamentals routes. It has no trading endpoints, Telegram
lifecycle, portfolio state, database or writable runtime dependency. Deploy it
as its own Vercel project and point `OPENBB_API_URL` to that project—not to the
stateful portfolio gateway. `/api/providers` actively probes the OpenBB
readiness route, so a non-empty but stale URL is never shown as ready.

### Streaming vs snapshots

A serverless function cannot hold a WebSocket subscription open between
invocations, so tick-by-tick L2 does not go through the API at all — the **Live
market** tab opens sockets straight from the browser to Binance and Bybit. No
backend, no key, no CORS (the WebSocket handshake is not subject to it), and one
hop of latency instead of two. `/api/depth` and `/api/tca` serve the same numbers
as REST snapshots for non-browser callers, computed with identical maths and
against the same ladder depth (Binance 20 / Bybit 50, matching the gateway) so a
probe answers the same question in both places.

The arithmetic is a port of Module A in the Python gateway, and
`tests/venues.test.ts` replays the gateway's own hand-computed ladders through
it — so a slippage number here and one from the Telegram bot cannot disagree.

### Depth is measured in a price band, not a level count

`depthUsd` within **±10 bps of mid**, not "the top 20 levels". Level counts are
not comparable: 20 levels of a merged two-venue book spans a far narrower band
than 20 levels of one venue, and a fine-tick instrument packs more levels into
the same band. Measured by level count the same book read 93.9% bid-imbalanced;
measured in a band it reads +0.34, which is the number that means something.

---

## Architecture

```
web/
├── app/
│   ├── page.tsx              research console (client)
│   ├── layout.tsx            theme bootstrap, metadata
│   ├── globals.css           design tokens (palette, light + dark)
│   └── api/
│       ├── backtest/route.ts parameter sweep
│       ├── depth/route.ts    live L2 books + consolidated ladder
│       ├── tca/route.ts      VWAP, slippage, cross-venue route
│       ├── ticker/route.ts   last price and 24h stats
│       ├── markets/route.ts  endpoint + instrument index
│       ├── ohlcv/route.ts    historical candles (crypto keyless; equities via registry)
│       ├── quote/route.ts    multi-provider quotes, incl. consensus mode
│       ├── news/route.ts     normalised headlines
│       ├── fundamentals/route.ts  company profile & valuation
│       ├── research/route.ts open-web search + page-to-markdown (Firecrawl)
│       └── providers/route.ts  supply-chain health: keys, quotas, breakers
├── lib/
│   ├── engine.ts             vectorised backtester — port of the Python reference
│   ├── indicators.ts         O(n) SMA / rolling extremes / RSI kernels
│   ├── stats.ts              PSR, Deflated Sharpe, verdict logic
│   ├── marketdata.ts         Binance klines + deterministic synthetic fallback
│   ├── venues.ts             live venue adapters + book/TCA maths
│   ├── livebook.ts           browser WebSocket L2 client (Binance + Bybit)
│   ├── params.ts             NaN-safe query-parameter coercion for the routes
│   ├── format.ts             number/date formatting shared by the UI
│   ├── types.ts              shared contracts
│   └── providers/            the seven-provider registry
│       ├── types.ts          capability contracts, normalised payloads, provenance
│       ├── runtime.ts        quota ledger, circuit breaker, cache, dispatch
│       ├── registry.ts       ranked routing, consensus quotes, status
│       ├── symbols.ts        asset classification (BTCUSDT≠BTC-the-stock)
│       ├── parse.ts          NaN-safe coercion funnel (vendor JSON is hostile)
│       ├── http.ts           route glue: one error shape, edge cache headers
│       └── …one adapter per vendor (binance, fmp, tiingo, massive,
│            alphavantage, firecrawl, openbb)
├── components/               charts (hand-rolled SVG), controls, tables
└── tests/                    680 tests incl. cross-engine and risk-engine parity
```

**Why the sweep runs server-side.** Binance's public API is called from the
serverless function, not the browser: no CORS, the per-IP rate limit is pooled at
the function rather than spread across users' networks, and identical requests
are cached at the edge. A 74-combination sweep over 2000 bars takes **~20 ms**.

**Why the engine is reimplemented in TypeScript.** The Python gateway uses
vectorbt/numba, which cannot run in a serverless function. Two implementations of
the same accounting is two chances to be wrong, so
`tests/parity.test.ts` replays real Binance bars through the TS engine and
asserts it reproduces what `Part2_Infrastructure/modules/backtester.py` produced
from identical input — across all three models and both directions. Trade counts,
exposure and turnover must match exactly; return statistics to 1e-6.

That test earned its keep: it caught two real bugs in the port — pandas applies
the exit mask *after* the entry mask (so exit wins when both fire, which turned
RSI reversion from 2 trades into 70), and position must be driven by crossover
*events* rather than the raw comparison (otherwise long/short mode opens a short
the instant the warmup ends, on a signal that never fired).

Regenerate the fixture after changing either engine:

```bash
cd ../Part2_Infrastructure && python tools/make_parity_fixture.py
```

---

## Visualisation notes

Charts are hand-rolled SVG rather than a charting library, so the colour roles
survive contact with the defaults.

- **Categorical hues are assigned in fixed order and never cycled.** Strategy is
  always slot 1, benchmark always slot 2 — filtering or re-running never repaints
  a series.
- **One axis, always.** Strategy and buy & hold are indexed to 1 at t0 rather
  than plotted on two y-scales, which would invent a correlation that isn't in
  the data. Drawdown gets its own panel for the same reason.
- **The Sharpe surface is diverging, not a rainbow.** Sharpe is signed around a
  meaningful zero, so it uses two hues that read as opposite with a *neutral*
  midpoint — zero reads as "nothing". (A red-yellow-green ramp puts a hue at the
  midpoint, and yellow/green is the first pair colour-blind readers lose.)
- **Palette validated, not eyeballed.** The categorical slots clear the
  colour-vision-deficiency separation, lightness-band, chroma and contrast checks
  in both light and dark mode. One light-mode slot sits below 3:1 contrast, which
  obliges the relief rule — hence the direct end-labels on every series and a
  table view of every number.
- **Dark mode is selected, not inverted** — its own steps chosen for the dark
  surface, reachable via the OS setting or the header toggle.
- **Every chart has a hover layer**: crosshair and tooltip on the line charts,
  per-cell hover and click-through on the heatmap.

---

## Relationship to the rest of the system

This portal is Module C (research). The full AlphaEngine gateway in
[`../Part2_Infrastructure`](../Part2_Infrastructure) adds the two modules that
need a long-lived process, which is why they are not deployed here:

- **Module A** — live L2 order books from Binance and Bybit over WebSocket, with
  VWAP, slippage and cross-venue smart routing.
- **Module B** — a pre-trade risk gateway (15 gates in ~0.2 ms), a resting-order
  book with cancel and replace, and an emergency kill switch controlled only
  through authenticated gateway surfaces — engaging it also cancels the resting
  book, because a halt that leaves orders working is not a halt.

Serverless functions cannot hold a WebSocket subscription open or keep risk state
between invocations, so those run on the always-on gateway. This workspace reads
portfolio state through its server-only proxy. The Telegram companion is a
separate, text-only client of the same authoritative state: it reports halts,
risk, portfolio and execution quality, and it cannot open this workspace, submit
orders or queue a backtest. It *can* halt, resume and flatten — those three
commands are reserved for a second, narrower operator allow-list and each needs
a single-use confirmation code, because a desk that can only be stopped from a
laptop is a desk that cannot be stopped from a train.

OpenBB is separate again: the web adapter calls the stateless
[`../OpenBB_Service`](../OpenBB_Service) using `OPENBB_API_URL` and
`OPENBB_API_TOKEN`. Portfolio reads call the long-lived gateway using
`ALPHAENGINE_GATEWAY_URL` and `ALPHAENGINE_GATEWAY_TOKEN`. Both token pairs stay
server-side and should be independently rotatable.

---

## Extending the system

The two extension points a developer reaches for, and the contract each one has
to honour.

### Adding a data provider

1. **Implement `Adapter`** (`lib/providers/types.ts`). Every capability method is
   optional and capability-declared, so a provider that only serves quotes
   simply omits the rest — the registry never offers it work it cannot do.
2. **Register it** in `lib/providers/registry.ts` with its quota shape and
   breaker defaults. Rank matters: the list is the failover order.
3. **Throw, do not coerce, on a missing primary field.** A quote with no price
   must fail loudly so the chain moves on. Returning a null price instead
   converts a failover into a silently wrong number.
4. **Add a case to `tests/providers.test.ts`** with a canned vendor payload —
   fixtures are committed, so no test reaches the network.

Quote and bar data contracts (`lib/providers/contracts.ts`) then apply
automatically: the capability façade attaches the expectations, and a payload
that fails them is failed over and quarantined without the adapter having to
know. The contract result travels with each inspected payload; health counters
and excerpts are separate bounded, route-instance diagnostics, not a durable
platform-wide quality ledger.

### Adding a panel

1. Components live in `components/` by audience — `portfolio/`, `research/`,
   `execution/`, `systems/`.
2. Read through a **same-origin route**, never a vendor directly: the credential
   stays on the server and the browser bundle never sees it.
3. Use the existing tokens. `--status-*` are fill colours at 3:1 and must never
   be a `color:` value; the `--*-text` roles exist for that and a test enforces
   it (`tests/theme.test.ts`).
4. State always encodes as **icon + word + colour**, never colour alone.

### Adding a gateway endpoint

That one lives in the gateway's own README (§7): define the shape in
`modules/schemas.py`, add the route with `response_model=`, test it, and
regenerate `tools/openapi.json`. The committed snapshot is what stops a rename
here from 404ing a browser there.
