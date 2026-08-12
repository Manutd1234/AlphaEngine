# Feature tour — the whole infrastructure, walked as the decision loop

This is the guided walkthrough of AlphaEngine: the Vercel portal, the OCI gateway behind it,
the operator modes, and the Oracle/Supabase persistence layer. It is structured as the decision
loop itself — **Overview → Research → Execution → Portfolio → Risk → Data → Reliability →
Developer** — because that is the order a desk makes decisions in, and the workspace's tabs are
that loop made navigable.

**Live URLs.**
- Portal: <https://developer-analyst-infra.vercel.app>
- Gateway (OCI, Singapore): `http://149.118.48.255:8000` — `GET /health` answers keyless.
- Local: `cd Part2_Infrastructure/web && npm run dev:all` starts both (gateway on `:8000`,
  portal on `:3000`).

**Keyboard access, everywhere:** `Alt+1` through `Alt+8` switch tabs in the order above.
`⌘K` / `Ctrl+K` opens the command palette — it fuzzy-matches every tab, every rail section,
all 46 models ("hull" finds Hull trend) and every research symbol, and opens on this browser's
recent commands when the query is empty. On Research, `⌘Enter` runs the sweep and records it.
On Chromium, tab switches cross-fade under the fixed header via View Transitions; elsewhere,
and always under reduced motion, they cut cleanly.

---

## What runs with no keys at all

The honest capability map, before the tour — because "does this need setup?" is the first
question a visitor asks.

Signing in is orthogonal to every tier below: it stores workspace preferences
against an account and gates nothing. Each tier reads the same signed out.

| Tier | What you get | Needs |
|---|---|---|
| **Zero-config** | Keyless Binance + Bybit market data: parameter sweeps, all 46 strategies, L2 depth, TCA, the full Research tab on crypto symbols | nothing |
| **Keyed** | Equities and benchmarks via FMP / Tiingo / Massive / AlphaVantage, with provider failover | API keys in env |
| **Gateway-backed** | The live consolidated book, paper orders through 14 pre-trade gates, kill switch state, decision histograms | the OCI gateway reachable |
| **Operator-gated** | Actions that mutate: sending orders, halt/flatten, cache purges, simulated outages | see guard modes below |

**The three guard modes** (`lib/operator.ts:90`, `guardMode()`):

- `locked` — production default: every mutating surface explains itself but stays dead.
- `token` — `ALPHAENGINE_OPERATOR_TOKEN` set: paste the token once in the header; length-checked
  constant-time comparison server-side.
- `open-demo` — `ALPHAENGINE_OPERATOR_OPEN=1`: every operator surface works for anyone who can
  reach the URL. Correct for exactly one situation — a paper-trading assessment demo — and
  survivable only because nothing an operator can do is permanent: orders are paper and capped
  by the gateway's own gates, the kill switch is reversible, purged caches refill, simulated
  outages expire.

(Locally, `NODE_ENV !== "production"` gives a fourth, implicit mode: `open-dev`.)

---

## Tab 1 — Overview (`#overview`, Alt+1)

**The question it answers:** what is the state of the whole desk, right now, in one screen?

**60 seconds:** land on the page. The KPI deck reads the book's equity, day P&L, tail risk and
system latency from the same snapshots every other tab uses. Below it, the
**DecisionLoopPipeline** draws the loop this tour follows — each stage is a link. The system
strip at the top of every tab shows provider readiness and p99 latency; if the gateway is
unreachable it says so here first.

**The moment worth showing:** the pipeline. It is the product's thesis as a diagram — research
flows to execution only through a risk gate.

## Tab 2 — Research (`#research`, Alt+2)

**The question it answers:** is this strategy evidence, or noise that survived a search?

**60 seconds:** the rail reads **Summary → Parameters → Walk-forward → Attribution → Decision →
Runs**. A sweep auto-runs on load (BTCUSDT daily by default — zero-config tier). Summary opens
with the reproducibility capsule (data hash, source, bar count, combos, runtime, build commit),
the PASS/MARGINAL/FAIL verdict, and the equity chart with its Monte Carlo band. Parameters
shows the stability heatmap — click any cell to inspect that pair without losing the sweep.
Walk-forward is the out-of-sample table; Attribution the factor and regime decomposition;
Decision the six-veto promotion gate beside position sizing; Runs the experiment trail, recorded
from this browser only, capped at 60, deduplicated.

**The moment worth showing:** the promotion gate clearing — six vetoes (DSR among them)
staggering in one by one, the cleared-count ticking up, and a Promote button that stays dead
until every gate clears, then pulses exactly once. That pulse is the single overshoot easing in
the product, and its scarcity is the point. Also worth ten seconds: drag the fast/slow sliders
and watch Auto re-run, then note the trail does *not* grow — auto-runs are deliberately not
recorded, because the trail is an honest count of hypotheses, not keystrokes.

**The Codex** (rail, after Runs): all 46 models in seven families, browsable before any run
exists. Each card carries the summary, the first sentence of *when it fails*, and an
explored-state chip — `●  best: PASS` versus `◌ not yet run` — derived live from this browser's
run log and honestly regressing if you clear it. Nothing is locked; clicking a card selects the
model and jumps to Summary. The picker mirrors it: seven optgroups, "— run" on tried models.

## Tab 3 — Execution (`#live`, Alt+3)

**The question it answers:** what would it cost to trade this, and what stops a bad order?

**60 seconds:** rail: **Trade → Liquidity → Routing & TCA → Activity**. On Trade, the order
ticket carries three presets — **Valid $25k** (passes every gate, fills on the live ladder),
**Fat finger $500k** (blocked by the per-order notional cap), **Rate-limit burst** (twelve $1k
orders; the token bucket stops the tail). Fire all three. Each decision comes back with its
full gate vector — up to 14 checks with the one that failed named — decided in ~0.2 ms by the
gateway. Liquidity is the consolidated Binance+Bybit L2 book; click a ladder price to stage a
limit order back on Trade. Routing & TCA prices the same order across venues against the routed
execution, not the mid.

**The moment worth showing:** a rejected preset's gate vector — the checks now cascade in at
40ms steps per decision, the verdict banner slides in, and "decided in X ms" counts up to its
sub-millisecond figure. A rejection that names its gate is the whole pre-trade thesis in one
row, and with motion off the failing gate is still findable instantly by its ✗ mark. This is
the guided demo of Module B. The watchlist beside it flashes a directional wash on real price
movement only — the signed 24h% next to each price stays the accessible signal.

## Tab 4 — Portfolio (`#portfolio`, Alt+4)

**The question it answers:** what does the book hold, and which sleeve earned the P&L?

**60 seconds:** rail: **Overview → Positions → Allocation → Performance**. The book snapshot is
the same one Risk reads — the intro card says so ("shared with Risk"), and Sandbox is labelled
when the gateway is unreachable. Positions link back to Research and Execution with the symbol
kept in context.

**The moment worth showing:** the risk-model card reading "Measured · N aligned bars" — the
covariance is estimated from real venue bars, and when it cannot be, the panel says "Pending"
rather than substituting an assumption.

## Tab 5 — Risk (`#risk`, Alt+5)

**The question it answers:** how much can we lose, and who can stop the desk?

**60 seconds:** rail: **Limits → VaR & model → Stress tests → Controls**. Limits shows the
binding constraint and its utilisation. VaR & model carries the validated loss estimate with
its traffic-light backtest zone. Stress tests apply forward shocks by hand — drag the shock
sliders and watch damage propagate through the book. Controls holds the kill switch and
reduce-only mode.

**The moment worth showing:** the kill switch (operator-gated; in `open-demo` it works, and it
is reversible). Second: hand-shocking a stress scenario — forward-looking damage, not
historical replay.

## Tab 6 — Data (`#data`, Alt+6)

**The question it answers:** can the numbers upstream of every other tab be trusted?

**60 seconds:** rail: **Overview & Trust → Quality & Incidents → Lineage & Payloads →
Providers & Capacity → Work Queue**. Trust scores per source, freshness clocks, contract
checks, and per-request lineage — which provider answered, what was cached, what got coerced.
The Work Queue is labelled **"Mocked, session-only workflow"** — the honest-labels rule applied
to a whole section.

**The moment worth showing:** lineage on the symbol you were just researching — the sweep's
data hash traces back to a provider, a cache state and a validation pass.

## Tab 7 — Reliability (`#reliability`, Alt+7)

**The question it answers:** is the platform up, and what degraded first?

**60 seconds:** rail: **Telemetry & SLIs → Services & Circuits → Logs & Traces →
Remediation**. SLIs with error budgets, provider circuit breakers, cross-origin event
investigation, and guarded remediation actions (cache purge, simulated outage — both expire).

**The moment worth showing:** the provider-health drilldown the header's latency chip links to
— the same chip visible on every tab resolves here to per-provider circuits. The numbers under
it are **fleet truth, not lambda truth**: every serverless instance syncs its latency samples,
quota spend and outage flags with the gateway's shared web-ops ledger each poll, so a
simulated outage binds instances that never saw the click and the p99 pool survives instance
rotation (`instance.scope` in `/api/system/health` names which mode you are reading, and
degrades honestly to "per-instance" if the gateway is unreachable).

## Tab 8 — Developer (`#developer`, Alt+8)

**The question it answers:** how is this built, and does the running system match the repo?

**60 seconds:** rail: **Overview → CI/CD → API & Schema → Code & Diffs → Task Queue**.
Topology, the four network-free CI jobs (396 gateway + 711 web + 13 service tests), the
34-route OpenAPI contract with drift detection, and the repository manifest.

**The moment worth showing:** API & Schema's contract drift check — the portal carries a
committed digest of the gateway's OpenAPI and compares it against the live one.

---

## Verify it yourself — the 11 E2E probes

`Part2_Infrastructure/tools/e2e_smoke.py` runs eleven probes against the live deployment; the
list doubles as a checklist for a manual tour:

1. Gateway `/health` answers.
2. Venue feeds — both Binance and Bybit books are flowing.
3. Gateway auth — `/api/portfolio` rejects keyless, accepts the token.
4. Decision histogram — pre-trade decisions are being recorded.
5. RAG embed — the research-corpus embedding path answers.
6. Vercel app — the portal serves.
7. Vercel `/api/system/health` — the portal can see its providers.
8. Oracle ADB — the VaR persistence layer answers.
9. Supabase — the audit-log mirror answers.
10. Market data — a real bar series comes back.
11. Backtest — a sweep runs end to end and returns a verdict.

**The five-minute ops drill.** `python3 tools/e2e_smoke.py --drill` adds two *mutating but
reversible* proofs on top of the read-only probes: it simulates a provider outage and asserts
at least three dependent surfaces react in one round trip (provider matrix, incident row,
failover graph, health summary) before restoring the provider, then trips the gateway kill
switch, confirms the live book reports `trading_halted`, and resumes. Everything is paper-only;
the outage self-expires in 60 seconds even if the restore step is interrupted. This is the
push-button version of the demo a reviewer would otherwise click through by hand.

**The Oracle keepalive caveat:** the VaR panel reading "unavailable" usually means the
Always-Free Autonomous Database has auto-stopped from inactivity — `tools/oracle_keepalive.py`
exists for exactly this. It is the known operational sharp edge of the free tier, documented
rather than hidden.

---

*All eight slices of [`UI_OVERHAUL_PLAN.md`](../UI_OVERHAUL_PLAN.md) are shipped, and their
moments are woven into the tabs above: the Strategy Codex and the gate-clear pulse on Research,
the order-gate cascade and tick flashes on Execution, drawing charts throughout, ⌘K fuzzy
search with recents, and View Transitions between tabs. This tour doubles as the acceptance
script: walking it end to end — once with motion on, once with the OS reduce-motion switch set —
is the manual verification pass.*
