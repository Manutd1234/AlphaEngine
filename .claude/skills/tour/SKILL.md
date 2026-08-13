---
name: tour
description: Walk the AlphaEngine architecture — the three deployment units, the two-implementation parity argument that pins Python against TypeScript, the honesty doctrine (null never coerced to zero, withheld values dashed, sample floors), the eight tabs, and which of the seven quant-desk roles each surface serves. Use whenever the user says explain, walk me through, tour, overview, "how does this work", "what is this", "give me the architecture", "where is X", "why is it built this way", "onboard me", "I am reviewing this repo", or asks about parity, fixtures, the audit log, the gateway proxy, or where a role's questions get answered.
---

# Tour AlphaEngine

Give the argument, not a file listing. Every claim below is anchored to a file —
open it and quote it rather than paraphrasing, and check the line before you
cite it.

Ask what the user came for. A reviewer, a new contributor and someone hunting
one specific number want different tours. If they do not say, lead with §1 and
§2 — those are the two ideas the rest hangs off.

---

## 1. Three deployment units, and why three

`Part2_Infrastructure/README.md`, under *Three deployment units in this
directory*, puts it plainly: they are separate because they have genuinely
different runtime needs — **one holds sockets open, one is serverless, one must
scale without touching risk state.**

| Unit | Where | Runtime need |
|---|---|---|
| **Risk gateway** | `Part2_Infrastructure/main.py`, `config.py`, `modules/` | Long-lived. WebSocket subscriptions, portfolio state, the kill switch, the audit log. Deploys to OCI compute from `main` via `.github/workflows/deploy.yml`. |
| **Desk workspace** | `Part2_Infrastructure/web` | Serverless. Next.js on Vercel, region `sin1`. |
| **Research service** | `Part2_Infrastructure/OpenBB_Service` | Stateless and read-only. Its own Vercel project, its own `OPENBB_API_TOKEN` — so market-data access and portfolio access never share a credential. |

`Part2_Infrastructure/developer-console/` is **not** a fourth unit. The README
says so in its own heading — *Also in this directory: developer-console/ —
experimental, not a deployment unit*: deployed nowhere, shares no code or data,
not part of the assessed deliverable. Do not include it in an architecture
answer unless asked about it directly.

**How the browser reaches the gateway.** Never directly. Server-side proxy
routes under `web/app/api/gateway/*` — `portfolio`, `portfolio/history`,
`orders`, `orders/working`, `orders/[id]/cancel`, `orders/[id]/replace`, `risk`,
`audit`, `research/rag`. `web/lib/gateway.ts` is the boundary: the URL and token
are read there and nowhere in the client bundle. Its `gatewayState()` returns
four distinct kinds — `url`, `absent`, `invalid`, `loopback` — because "a
serverless function fetching 127.0.0.1 fetches *itself*", and that mistake once
read as a gateway outage for a day.

Write paths carry a **second** gate, and the distinction is the interesting
part: `web/app/api/gateway/risk/route.ts` — the gateway token says "this
deployment may talk to that gateway", the operator token
(`ALPHAENGINE_OPERATOR_TOKEN`) says "this *request* may change something".

`web/proxy.ts` is Next 16's renamed middleware and is routing only, explicitly
not authorisation: "a forged cookie here buys the application shell and no data
whatsoever." `/api/*` is deliberately outside its matcher.

**The audit log** is DuckDB, `modules/audit.py`: append-only by convention —
nothing in the application issues UPDATE or DELETE against `orders` or
`risk_events`. DuckDB rather than Postgres because the same file answers
`SELECT quantile(latency_ms, 0.99) FROM orders` with no ETL step. Path resolves
via `config.py:87-91`. In Docker it lives on a **named volume**, and the
compose file explains why: a bind mount breaks uid 10001's writes and silently
degrades DuckDB to an unwritable SQLite fallback.

---

## 2. Two implementations, one test that proves it

**The problem.** The maths that matters exists twice — Python for the gateway
and the Telegram companion, TypeScript for the browser — because neither runtime
can call the other. Two implementations of the same accounting is two chances to
be wrong. The failure mode is specific and awful: *a trader reads one VaR on
their phone and a different one on the screen, and neither is flagged as
suspect.*

**The resolution.** Python is the reference. `tools/` emits its own answers as
committed fixtures. The TypeScript suites assert the browser reproduces them.

| Emitter | Fixture | Covers |
|---|---|---|
| `tools/make_parity_fixture.py` | `web/tests/fixtures/parity.json` | Backtest engine. 48 cases × 1200 live Binance bars, every strategy in the catalogue × 4 param combos. Warns if the bars are not live. |
| `tools/make_risk_fixture.py` | `web/tests/fixtures/risk-parity.json` | Risk arithmetic: VaR backtest, historical VaR, allocation proposals, rebalance trades, scenarios, covariance. Input is **deterministic, not fetched** — "a parity fixture that depends on a network call is a parity fixture that fails for reasons unrelated to the code it pins." |

The three assertion suites, and the judgement in their tolerances — this is
where the tour gets good:

- **`web/tests/parity.test.ts`** opens with a *coverage* gate before any
  numerical one: it asserts the fixture contains every strategy id the API
  accepts, not a sample of them. Then position sizing and cost accounting
  (exposure, turnover, win rate) must match to `1e-9`, because those are
  bookkeeping; the ratios (Sharpe, Sortino, Calmar, CAGR, max drawdown) get
  `1e-6`; trade *count* must be exactly equal.
- **`web/tests/risk-parity.test.ts`** — the Kupiec statistic matches to `1e-3`
  but the **zone matches exactly**. The reasoning is the tour's best single
  quote: TypeScript uses an error-function approximation where Python has an
  exact `erfc`, so the p-values can differ in the last places — but the zone is
  what a risk manager acts on, and that must not differ.
- **`web/tests/mc-parity.test.ts`** — Monte Carlo, **byte-exact, zero
  tolerance**, three legs: the committed reference (canonical JSON plus a
  SHA-256 self-check), this Node runtime, and the browser worker program,
  executed and canonicalised. Seeded at `MC_PARITY_SEED = 0xa1fa0007` over 2000
  paths (`web/lib/mc-parity.ts`).

The same instinct produces the **OpenAPI digest gate**: `npm run build` runs
`scripts/check-gateway-openapi-digest.mjs` first, which SHA-256s
`tools/openapi.json` against a digest committed in
`web/lib/gateway-openapi-digest.generated.ts`. Two separately deployed units
cannot drift apart silently.

---

## 3. The honesty doctrine

The house position: **zero is a measurement and absence is not.** From
`web/tests/null-honesty.test.ts` — a beta of 0.00 invents an exposure, a latency
of 0 ms invents the fastest possible response, and $0 of depth invents an empty
book where there is only an unread one.

Three enforced mechanisms:

**(a) Null is never coerced to zero.** `null-honesty.test.ts` scans source and
bans the specific coercions that would do it — `beta ?? 0` in
`components/portfolio/StressTest.tsx`, `p99 ?? 0` in
`components/systems/LatencyTrend.tsx`, `depthUsdBid ?? 0` in
`components/LiveMarket.tsx`. It strips comments first, so the explanation is not
read as the offence. The same file pins order-timeout honesty: the browser's
timeout must exceed the gateway's, and an abort must say the order *may still
have been decided* rather than claim nothing was sent.

**(b) Withheld values render as a dash.** `web/lib/format.ts` is the single
choke point — `fmt`, `pct`, `signedPct` and `usd` all return `"—"` on null or
non-finite, and `sign()` returns `muted` for null so colour never implies a
direction that was never measured. Guarded by `tests/format.test.ts`,
`data-trust.test.ts` ("`${tile.label}` invented a value with no snapshot"),
`drift-bars.test.ts`, `no-dead-ends.test.ts`.

**(c) Sample floors.** Every statistic has a named minimum below which it
returns `null` rather than a number, and says how far off it is:

| Constant | Floor | File |
|---|---|---|
| `LATENCY_MIN_SAMPLES` | 20 | `web/lib/overview-state.ts` |
| `MIN_SAMPLES` (signal path) | 20 | `web/lib/signal-path.ts` — renders `collecting · n=4 of 20` |
| `TRUST_MIN_SAMPLES` | 20 | `web/lib/data-trust.ts` — "a thin window, not a failure" |
| `MIN_ADV_OBSERVATIONS` | 20 | `web/lib/liquidity.ts` — band `unmeasurable`, `daysToLiquidate: null` |
| `MIN_SHARPE_OBSERVATIONS` | 20 | `web/lib/portfolio-analytics.ts` — the rolling line **breaks rather than bridges** |
| `MIN_TRIPS_FOR_RATE` | 3 | `web/lib/remediation.ts` — "1/1 rendered as 100% is theatre" |
| `MIN_TRADES_FOR_SIZING` | 30 | `web/lib/quant.ts` — same hurdle the promotion gate uses |

The house rules in `web/tests/house-rules.test.ts`, `motion.test.ts` and
`forced-colors.test.ts` are the same doctrine applied to the interface: no emoji
(the status vocabulary is typographic marks that inherit the text colour), no
colour-only meaning, `prefers-reduced-motion` honoured everywhere, empty results
reported rather than hidden. That test file's own header is worth quoting: the
rules were written in two plans and enforced by neither, and by the time it was
written four emoji had shipped — into the provider health counts and the kill
switch, the two most safety-critical surfaces in the product. *A rule documented
in two plans and enforced by neither is a preference.*

---

## 4. Eight tabs, seven roles

Tab ids live in `web/components/WorkspaceHeader.tsx`; sections in
`web/lib/sections.ts`, whose ids never change because they are public deep links
(`#<view>/<section>`).

| Tab id | Label | Role | Sections |
|---|---|---|---|
| `overview` | Overview | all | loop, desks, audit |
| `research` | Research | Quant researcher | summary, parameters, walkforward, attribution, lineage, decision, runs, codex |
| `live` | **Execution** | Trader | trade, liquidity, routing, quality, activity |
| `portfolio` | Portfolio | Portfolio manager | overview, equity, positions, allocation, performance |
| `risk` | Risk | Risk manager | limits, model, montecarlo, scenarios, controls |
| `data` | Data | Data engineer | overview, feeds, quality, lineage, providers, queue |
| `reliability` | Reliability | SRE | overview, planes, services, events, controls |
| `developer` | Developer | Quant developer | overview, readiness, quality, apis, codebase, work |

Three ids deliberately disagree with their labels, because the deep link came
first: view `live` renders "Execution", section `codex` renders "Strategies",
section `activity` renders "Blotter". Worth flagging — it is the kind of thing a
reader assumes is a bug.

**The seven roles.** `Part2_Infrastructure/README.md`, under *Who this is for*,
opens with a coverage
matrix: each role's question, where it is answered, and — the part that makes it
worth reading — **what is honestly still missing**. Traders get 15 pre-trade
gates and cross-venue TCA but paper fills only, with no queue position.
Researchers get Deflated Sharpe, walk-forward and PBO but no feature store. Risk
managers get a Kupiec VaR backtest and a kill switch but no margin or
liquidation modelling. Point the user at that table rather than reciting it; the
gaps column is the argument.

That table's test counts were last re-measured against a green run on
2026-08-14 — 692 gateway, 2,174 web across 548 suites, 13 service. Cite them if
you must, but the standing rule outranks the sentence: **never quote a test
count from prose.** Run the `verify` skill and read the number off the output.
Every count in this repository has drifted at least once.

---

## 5. Suggested walk

If they want to see it rather than read about it, use the `start` skill, then:

1. **Overview → loop** — the pipeline end to end, and the next action.
2. **Research → walkforward** — where a good-looking equity curve is told it
   fails out of sample.
3. **Execution → trade** — send a paper order and watch every gate's verdict
   render, for accepts as well as rejects.
4. **Risk → controls** — the kill switch, reachable from four surfaces.
5. **Data → overview** — the trust cockpit, and the panels that say "Collecting,
   4/20 samples" instead of drawing a line through four points.

With no gateway running, all of it works on the tagged sandbox and every write
is disabled. That is itself part of the tour: the workspace degrades to an
honest read-only state rather than to a blank one.
