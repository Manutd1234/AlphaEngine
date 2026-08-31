# Feature tour — the whole infrastructure, walked as the decision loop

**Last verified: 2026-08-29.** The source-level topology and release evidence
below were reconciled with the [current-state ledger](../CURRENT_STATE.md).
Historical deployment walks and benchmark readings retain their observation
dates; a current document is not evidence that an external origin was re-probed.

This is the guided walkthrough of AlphaEngine: the Vercel portal, the OCI gateway behind it,
the operator modes, and the Oracle/Supabase/Neo4j persistence layer. Eight of its eleven tabs are
structured as the decision loop itself — **Overview → Research → Execution → Portfolio → Risk →
Data → Reliability → Developer** — because that is the order a desk makes decisions in, and the
workspace's tabs are that loop made navigable. The last three, **Markets** (`#markets`),
**Proofs** (`#coherence`) and **Diffusion** (`#diffusion`), are not stops on that loop: they are
one self-contained prediction-market research engine — what the venue quotes, what follows from
those quotes, then how information moves through them — with no order path at all.

*Walked against the deployed system on 2026-08-17. The panel descriptions were re-read against
the tree on 2026-08-22, when the Remediation and API & Schema sections changed shape, and again on
2026-08-24, when this engine was restructured six times in one day. The current three-tab engine
was re-read from the tree on 2026-08-30 — those parts are described from source, not from a live
walk, and the stamps stay separate. Rails are pinned to `lib/sections.ts`; all 64 engine views are
pinned to `lib/section-views.ts` and each has a canonical hash, palette entry and sweep cell.*

**Live URLs.**
- Portal: <https://alphaengine-workspace.vercel.app> (also answers on `developer-analyst-infra.vercel.app`)
- Gateway (OCI, Singapore): `http://149.118.48.255:8000` — `GET /health` answers keyless and
  names the decision engine (`native` on 2026-08-17); `https://149.118.48.255:8443` is the same
  gateway behind the Caddy sidecar's pinned internal CA (`docs/engineering/TLS_FLIP.md`).
- Local: `cd Part2_Infrastructure/web && npm run dev` starts both (gateway on `:8000`,
  portal on `:3000`); `dev:all` is an alias and `dev:web` is frontend-only.

**Keyboard access, everywhere:** `Alt+1` through `Alt+9` and then `Alt+0` switch the first ten
tabs in order. Diffusion, the eleventh, is reached from the tablist or `⌘K`; there is no claimed
`Alt+11` control. The
listener is in `lib/use-tab-shortcuts.ts` (it left `components/WorkspaceHeader.tsx` when the
tenth tab pushed that file over its 400-line ceiling) and matches on `event.code` rather than
`event.key`, because on macOS `Option+digit` types `¡™£` and a key-range test never fires; it
also stands down inside a text field, where `Alt+digit` composes a character.
`⌘K` / `Ctrl+K` opens the command palette — it fuzzy-matches every tab, every rail section,
all 46 models ("hull" finds Hull trend) and every research symbol, and opens on this browser's
recent commands when the query is empty. `?` opens the shortcuts-and-tour overlay. Those are the
only three global keystrokes the shell owns. On Research, `⌘Enter` runs the sweep and records it.
On Chromium, tab switches cross-fade under the fixed header via View Transitions; elsewhere,
and always under reduced motion, they cut cleanly.

**The header, on every tab.** One row, one structure for guest and signed-in alike: the brand,
the eleven tabs (14px, the fixed --fs-chrome-tab token), and a utility strip whose words are all 12px — the data-tier chip, the
providers sentence, the **DECISION P99** chip, Connect, the Kill switch, Settings and the account
chip or Sign in. The decision chip is the one figure on every screen and it headlines the
gateway's own in-process decision p99 in **microseconds**, with the compiled core's
**nanosecond** figure beside it (`15.0 µs · core 84 ns`-shaped on the dev Mac; `core 352 ns` on
the production VM); the network p99 lives in its title and on Reliability, never under the
decision label. Before the first order of a session it reads `— · core N ns · no orders yet` —
the core figure is real, because the gateway times its own compiled battery at startup on a
synthetic two-venue book, and the title says exactly that. The row never clips: a
nine-rung **priority ladder** (`globals.css`, "The header's priority ladder") folds secondary
context first as the viewport narrows (re-measured by script for the 2026-08-17 chrome lift;
the reader's Text-size preference under the gear scales the workspace and never this row) —
Search label, the chip's state word, the Settings
label, the data-tier label, the Connect label, the providers chip to its dot, the brand
tagline, the decision figure to its gauge, and last the Kill switch and Sign in labels — and
Settings, the account chip, the kill switch and the tabs are never on it. Every fold keeps
its aria-label and title; HALTED is never folded.

**Where the rail lists below come from.** Every rail in this document is transcribed from
`Part2_Infrastructure/web/lib/sections.ts`, which is the single definition the rails, the
command palette, the hash whitelist and "Copy link to this view" all read. **70 sections across
the eleven tabs** — 48 on the eight decision-loop tabs, 8 on Markets, 7 on Proofs and 7 on
Diffusion — a total
`web/scripts/desk-sweep-plan.mjs` mirrors by hand as `EXPECTED_SECTIONS = 70` and the tour test
asserts against the arrays themselves. Six ids deliberately disagree with their labels, because
the deep link came first and ids never change: view `live` renders "Execution", view `coherence`
renders "Proofs", section `codex` renders "Strategies", section `activity` renders "Blotter",
and two different sections called `model` render
something else — Diffusion's renders "Measurement", because since 2026-08-25 it is one half of
the estimator and its peer is "Instrument", so calling one half "Model" while the other is named
for what it holds would be a category error on the rail; and Risk's renders "Risk engine" — it
carried a label combining the forecast and the chart that scores it until those were split onto
two subtabs, and a section-level alias was considered and rejected, because nothing is broken and
it would be a migration mechanism for no migration. If a rail here disagrees with the app, `sections.ts` is
right and this file is stale — fix it here, not there.

---

## What runs with no keys at all

The honest capability map, before the tour — because "does this need setup?" is the first
question a visitor asks.

Signing in is orthogonal to every tier below: it stores workspace preferences
against an account and unlocks no capability. Every tier reads the same for a
guest as for an account holder.

The desk itself sits at `/dashboard` behind a routing guard, so the question
"who is this?" is answered before anything renders rather than after the whole
shell has been painted at a stranger. That is a change of *timing*, not of
access: `/login` offers **Continue as guest**, which opens the full workspace on
a desk seeded for that browser, and a deployment with no Supabase credentials —
the public one — is admitted as a guest automatically rather than being shown a
form it cannot complete. `/profile` manages the account itself — display name,
avatar, linked sign-in methods, active sessions and password — and grants no
capability the desk does not already give a guest.

| Tier | What you get | Needs |
|---|---|---|
| **Zero-config** | Keyless Binance + Bybit market data: parameter sweeps, all 46 strategies, L2 depth, TCA, the full Research tab on crypto symbols — plus the Markets and Proofs reads over Kalshi's public endpoints and deterministic sparse-state instruments across the three-tab engine | nothing |
| **Keyed** | Equities and benchmarks via FMP / Tiingo / Massive / AlphaVantage, with provider failover | API keys in env |
| **Gateway-backed** | The live consolidated book, paper orders through the pre-trade gates — **17 defined, 15 reachable by any order** — kill switch state, decision histograms | the OCI gateway reachable |
| **Operator-gated** | Actions that mutate: sending orders, halt/flatten, cache purges, simulated outages | see guard modes below |

**The three guard modes** (`guardMode()` in `lib/operator-guard.ts`, re-exported through
`lib/operator.ts`):

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

**60 seconds:** rail: **Decision loop → Desk roles → Audit trail**. Land on the page. The KPI
deck reads the book's equity, day P&L, tail risk and system latency from the same snapshots
every other tab uses. Below it, the **DecisionLoopPipeline** draws the loop this tour follows —
each stage is a link. Desk roles gives one surface per role — seven cards, one per quant-desk
role, each opening exactly one tab and doing nothing else (`components/overview/RoleCards.tsx`;
a test derives every card's wording from the header's own `NAV_ITEMS`, so a tab rename fails the
suite rather than leaving a card pointing at a name the desk no longer uses). Audit trail is
every paper order, accounted. The header on every tab shows provider readiness and the decision
p99; if the gateway is unreachable it says so here first.

**The moment worth showing:** the pipeline. It is the product's thesis as a diagram — research
flows to execution only through a risk gate.

**What it will not claim:** a percentile it has not got the samples for. The decision chip reads
"collecting" until twenty decisions exist (`LATENCY_MIN_SAMPLES`, `lib/overview-latency.ts`).

## Tab 2 — Research (`#research`, Alt+2)

**The question it answers:** is this strategy evidence, or noise that survived a search?

**60 seconds:** the rail reads **Summary → Parameters → Walk-forward → Attribution → Lineage →
Decision → Runs → Fitted models → Strategies**. A sweep auto-runs on load (BTCUSDT daily by default —
zero-config tier). Summary opens with the reproducibility capsule (data hash, source, bar count,
combos, runtime, build commit), the PASS/MARGINAL/FAIL verdict, and the equity chart with its
Monte Carlo band. Parameters shows the stability heatmap — click any cell to inspect that pair
without losing the sweep. Walk-forward is the out-of-sample table; Attribution the factor and
regime decomposition. **Lineage** is the signal path and the desk's memory: the DAG from raw
venue bars through the risk gateway to an execution report, beside the research corpus this
desk has actually embedded. Decision holds the six-veto promotion gate beside position sizing;
Runs the experiment trail, recorded from this browser only, capped at 60, deduplicated.
**Fitted models** is the supervised half — `POST /api/research/ml/fit` on the gateway's jobs
engine, with the folds it was scored on.

**The moment worth showing:** the promotion gate clearing — six vetoes (deflated Sharpe among
them) staggering in one by one, the cleared-count ticking up, and a Promote button that stays dead
until every gate clears, then pulses exactly once. That pulse is the single overshoot easing in
the product, and its scarcity is the point. Also worth ten seconds: drag the fast/slow sliders
and watch Auto re-run, then note the trail does *not* grow — auto-runs are deliberately not
recorded, because the trail is an honest count of hypotheses, not keystrokes.

**Strategies** (the last rail entry, after Fitted models — the section id stays `codex` because ids are
public deep links, so the rail reads "Strategies" and the URL still says `#research/codex`):
all 46 models in seven families, browsable before any run exists. Each card carries the summary, the first sentence of *when it fails*, and an
explored-state chip — `●  best: PASS` versus `◌ not yet run` — derived live from this browser's
run log and honestly regressing if you clear it. Nothing is locked; clicking a card selects the
model and jumps to Summary. The picker mirrors it: seven optgroups, "— run" on tried models.

**What it will not claim:** an in-sample number as a result. `modules/ml/runner.py` computes
every metric on the concatenated out-of-sample predictions and puts **no in-sample figure in the
result object at all**, because one travelling beside the out-of-sample figure eventually gets
read as if it were one. The splitter (`modules/ml/splits.py`) is purged and embargoed and reports
`embargoed_bars == 0` on every fold — a measured zero: with contiguous expanding test windows no
training row ever follows a test window, so the embargo is vacuous here by construction, and the
parameter is kept for the combinatorial purged CV where it is not.

## Tab 3 — Execution (`#live`, Alt+3)

**The question it answers:** what would it cost to trade this, and what stops a bad order?

**60 seconds:** rail: **Trade → Liquidity → Routing & TCA → Fill quality → Blotter** (the last
id is still `activity`, so the deep link reads `#live/activity` while the rail says "Blotter").
On Trade, the order ticket carries three presets — **Valid $25k** (passes every gate, fills on
the live ladder), **Fat finger $500k** (blocked by the per-order notional cap), **Rate-limit
burst** (twelve $1k orders; the token bucket stops the tail). Fire all three. Each decision
comes back with its full gate vector — **15 checks on any order path, with the one that failed
named** — decided by the gateway in tens of microseconds (**13.2 µs p50** on the compiled engine,
**25.3 µs** on the Python reference, read off `docs/architecture/latency-bench.generated.json`,
regenerated 2026-08-20; the budget's §2.1 carries the same block with its machine and its caveat —
that run was unpinned on a loaded laptop, and the Python reference reads 23.1 µs on a quiet one). Liquidity is the consolidated Binance+Bybit L2
book; click a ladder price to stage a limit order back on Trade. Routing & TCA prices the same
order across venues against the routed execution, not the mid. **Fill quality** closes the loop
the other three open: realised cost against the cost the model predicted, which is the only
honest test of a TCA number. Blotter is orders, tape and alerts.

**The moment worth showing:** a rejected preset's gate vector — the checks now cascade in at
40ms steps per decision, the verdict banner slides in, and "decided in X ms" counts up to its
figure — a fraction of a millisecond for the whole decision under the lock, while the header
chip shows the same decision's p99 in microseconds and the arithmetic core inside it in
nanoseconds. A rejection that names its gate is the whole pre-trade thesis in one row, and
with motion off the failing gate is still findable instantly by its ✗ mark. This is
the guided demo of Module B. The watchlist beside it flashes a directional wash on real price
movement only — the signed 24h% next to each price stays the accessible signal.

**Why the gate count has two numbers.** `GATE_ORDER` in `modules/risk_proxy/gates.py` — a
package now, not the single `risk_proxy.py` older links point at — declares **17** gates; a
crypto order can reach **15** of them. The two it never reaches, `paper_execution_model` and
`reference_freshness`, are added by `modules/risk_proxy/decision.py` only when
`req.paper_execution is not None`, which is the paper-equity path, where an order is priced from
a vendor quote rather than a live L2 ladder and a quote can be stale or refuse to honour a
resting `LIMIT` in a way a ladder cannot. Quote 15 when describing what an order goes through
and 17 when describing what the module implements; the full table, with what each gate guards
against, is in [`Part2_Infrastructure/README.md` §4](../../Part2_Infrastructure/README.md).

**What it will not claim:** a fill it cannot observe. There is no partial-fill model and no queue
position, because the venue feeds carry ladders rather than trade prints — modelling one would
report an assumption as measured execution.

## Tab 4 — Portfolio (`#portfolio`, Alt+4)

**The question it answers:** what does the book hold, and which sleeve earned the P&L?

**60 seconds:** rail: **Overview → Equity & P&L → Positions → Allocation → Performance**.
Overview leads with alerts, headroom and exposure. **Equity & P&L** is the session curve drawn
against the start-of-day mark and the level at which the drawdown breaker halts the desk, beside
the P&L waterfall that says which sleeve earned it — and both are tagged generated when the book
is the sandbox. Positions and Allocation each carry an in-panel `.seg` switcher rather than a
longer rail — Positions splits
into **Holdings · Shape · Exit**, Allocation into **Mix · Targets · Composition** — so a pane
that needs a covariance can go quiet and say why instead of leaving a dead slab between two
charts that are working. The book snapshot is the same one Risk reads — the intro card says so
("shared with Risk"), and Sandbox is labelled when the gateway is unreachable. Positions link
back to Research and Execution with the symbol kept in context.

**The moment worth showing:** the risk-model card reading "Measured · N aligned bars" — the
covariance is estimated from real venue bars, and when fewer than 20 align the panel says
"Pending" rather than substituting an assumption (`components/portfolio/RiskEngine.tsx`).

## Tab 5 — Risk (`#risk`, Alt+5)

**The question it answers:** how much can we lose, and who can stop the desk?

**60 seconds:** rail: **Limits → Risk engine → Risk diagram → Risk drivers → Monte Carlo →
Oracle VaR → Stress tests → Controls**. Limits shows the binding constraint and its
utilisation. **Risk engine** carries the validated loss estimate with its traffic-light
backtest zone; **Risk diagram** is the forecast-against-realised chart that scores it, on a
subtab of its own because a 361-line time series and a four-tile scorecard were sharing one
card and the chart got whatever width was left. When the book has fewer than 80 aligned daily
bars the diagram says so and names the floor, rather than leaving the subtab blank. **Risk
drivers** answers the next question separately — which positions carry the volatility, and how
much of the diversification is real — because a contribution table and a correlation matrix
sharing a row with a time series gave all three too little width to be read. **Monte Carlo** bootstraps the research winner's
realised returns into a terminal-outcome distribution, computed in a dedicated worker so the
main thread only draws it. **Oracle VaR** asks the same question a second way — a terminal-value
GBM simulated inside Oracle 23ai, read against its own closed-form quantile — and the two
sections deliberately share one forward horizon (the seg on either subtab sets both), because
loss estimates that disagree are signal about method, not error. Stress tests apply forward
shocks by hand — drag the shock sliders and watch damage propagate through the book. Controls
holds the kill switch and reduce-only mode.

**The moment worth showing:** the kill switch (operator-gated; in `open-demo` it works, and it
is reversible). Second: hand-shocking a stress scenario — forward-looking damage, not
historical replay.

**What it will not claim:** a database it cannot reach. The Oracle path returns a typed result
and never throws, and `oracle_not_configured`, unreachable and found-nothing are three distinct
codes carrying no credential, hostname or raw `ORA-` text (`lib/oracle/client.ts`).

## Tab 6 — Data (`#data`, Alt+6)

**The question it answers:** can the numbers upstream of every other tab be trusted?

**60 seconds:** rail: **Trust Summary → Feeds & Contracts → Quality → Incidents → Lineage &
Payloads → Providers & Capacity → Work Queue**. The Trust Summary is itself three switchable
panes (**Verdict · Response · Composition**), so the posture, the response clocks and the
contract re-checks are one derivation seen three ways rather than one very long scroll.
**Feeds & Contracts** is the same derivation turned outward, per source: how fresh each feed
is, whether its last payload validated, and — the part that makes it a section rather than a
table — what to do next about the ones that did not. Quality holds reconciliation and the
gateway's durable quality ledger with its escalations; Incidents holds the operator-simulated
outages and the quarantine buffer; Lineage & Payloads is per-request provenance — which provider
answered, what was cached, what got coerced — plus replay and backfill: one capability re-run
through the workspace's own validated path, or bars for a date range contract-checked and
merged into the gateway's bar cache, on demand or on the gateway's configured schedule;
Providers & Capacity is failover, quota and reserve. The Work Queue is persisted on the gateway — versioned rows, audit-logged
edits — and its pill says so, or says "edits held locally" when the gateway cannot be
reached: the honest-labels rule applied to a whole section.

**The moment worth showing:** lineage on the symbol you were just researching — the sweep's
data hash traces back to a provider, a cache state and a validation pass.

**Why this one is not in the audit log.** The queue, the quality findings, the escalations and
the schedule runs live in SQLite (`modules/data_ops_store.py`), not in the DuckDB audit ledger,
and the split is deliberate: this is state a person just edited or another instance is about to
read, so it needs a write that *raises* and an UPDATE that reports whether it hit a row. The
audit log's write helpers are fire-and-forget by the opposite argument — a lost TCA snapshot
must never take the order path down.

## Tab 7 — Reliability (`#reliability`, Alt+7)

**The question it answers:** is the platform up, and what degraded first?

**60 seconds:** rail: **Attention & SLIs → Dependencies → Services & Circuits → Logs & Traces →
Remediation**. Attention & SLIs is triage first and telemetry second — what needs a human, then
the signals and the path into an incident, with error budgets. Provider circuit breakers,
cross-origin event investigation, and guarded remediation actions (cache purge, simulated
outage — both expire) follow. Remediation splits across five in-panel panes —
**Mutations · Scope · Session · Recovery · History** — and the split is along one seam: what
changes server state, what merely describes it, and what only touches this browser tab.
**Mutations** is the default and holds everything a reader needs before pressing a button: the
blast-radius banner, the operator guard and its token field, the last action's result, the five
server writes with every price stated inline, and the map below. **Scope** is the reference half
— the provider-routing donut and the counts that answer "what would a write reach in this
instance, right now", which is a question asked *before* deciding rather than while pressing.
**Session** is this tab's own sockets and poll cadence, and touches no server at all. Recovery is
how a tripped circuit comes back on its own with the cooldown left; History is which ones actually
tripped here and how each closed.

**The blast-radius map is the thing to open Remediation on.** Under the five
mutation buttons is a drawing of what each one reaches: five server writes on the left, the seven
stores on the right, and an arrow only where a write actually touches a store. Hover or focus a
mutation and the rest dim. Below it the same relation is a table — 5 × 7 = **35 cells**, each
carrying the reason it says what it says, every one read out of the write path in `lib/operator.ts`
rather than paraphrased from the prose it replaced (two cells came out *different* from that prose
once the code was open: `clear_telemetry` zeroes the cache counters while leaving cached responses
in place, and `reload_providers` drops the cached OpenBB readiness verdict while leaving the
response cache alone). Both halves render `SERVER_MUTATIONS` and `MUTATION_STORES` from
`components/systems/mutation-scope.ts`, so the drawing and the table cannot disagree. Four
effects, never three — `● cleared`, `→ re-read`, `○ left intact`,
`◌ out of reach` — because the mark carries the meaning, the word repeats it, and colour is the
third carrier and never the first.

**The seventh store is the point of the drawing.** Six of them live in this instance and can be
counted. The vendor's meter cannot: it is held by the provider, no route in this deployment reads
it, and no button on this pane can reset it. "Reset a quota ledger" is the one control on the desk
whose name most invites the opposite belief, so the store it does **not** touch is drawn beside
the ones it does — dashed, with the reason attached — rather than left out. An absence a reader
has to notice is not an absence a reader will notice.

**Dependencies** is the section worth stopping on, and it answers a question the other four
cannot: *when something breaks, how much of the desk goes with it?* It draws the topology twice.
`DependencyTree` is a nested list with CSS connectors rather than a graph — an indented outline
at any width, so there is no breakpoint to get wrong, no coordinates to animate for reduced
motion to strip, and no `forced-color-adjust` exemption to add. `DependencyMix` draws the same
topology as composition, and its state ring exists to make one invariant legible: when the
gateway stops answering, every component behind it flips to **`unknown` — never `down`** —
because you cannot read a component's health through a dead transport. A gateway outage paints
a large grey wedge here, not a large red one, and "one transport died" versus "six components
failed" is readable without opening a row. That is `lib/dependency-graph.ts` drawn rather than
described. Nothing on this panel is an availability figure: it is one snapshot of a live poll,
and this system publishes no uptime percentage anywhere.

**Attention & SLIs is also where the three latency planes are taught apart.** Three tiles that
never blend: the whole decision in µs (the gateway's in-process histogram, `n=` since start
printed beside it, and the header chip says "collecting" rather than quoting a p99 until twenty
orders have been decided, because a p99 of one sample is a maximum wearing a decimal point),
the compiled core in ns (`native · p50 320 ns · max 2.75 µs · self-measure 300`
on the production VM on 2026-08-17 — the last figure saying how many of the core's samples came
from the startup self-measure rather than orders), and the network to the venue in ms. A
gateway that fell back to the Python engine says so here and in the header, with a mark, not
only in a deploy log.

**The moment worth showing:** the provider-health drilldown the header's decision chip links to
— the same chip visible on every tab resolves here to per-provider circuits. The numbers under
it are **fleet truth, not lambda truth**: every serverless instance syncs its latency samples,
quota spend and outage flags with the gateway's shared web-ops ledger each poll, so a
simulated outage binds instances that never saw the click and the p99 pool survives instance
rotation (`instance.scope` in `/api/system/health` names which mode you are reading, and
degrades honestly to "per-instance" if the gateway is unreachable).

## Tab 8 — Developer (`#developer`, Alt+8)

**The question it answers:** how is this built, and does the running system match the repo?

**60 seconds:** rail: **Topology → Readiness → CI / CD → API & Schema → Code & Diffs → Task
Queue**. Topology is the runtime map and the context the three deployment units share.
**Readiness** is the gate in front of a release — launch gates, schema state and artifacts —
and it is separate from CI / CD on purpose: a green pipeline says the code compiles and the
tests pass, which is not the same claim as "this is safe to ship". CI / CD carries the four
network-free jobs and the test counts for all three suites — read off
`web/lib/test-counts.generated.ts`, which is the only place in this system allowed to carry
them. **Do not quote the figure this panel shows without re-running the suite**: it is a
generated measurement with a date, not a contract, and only its **web** line is checked by CI
(`scripts/check-test-counts.mjs`, which accepts `suite === "web"` and nothing else), so the
gateway and service lines in it can legitimately differ from what a run prints.
[`TESTING.md`](../testing/TESTING.md) is the argument for why, and the one document
that carries the conditions attached to each figure. API & Schema is the committed OpenAPI
contract with drift detection, Code & Diffs the repository manifest, Task Queue the
engineering-impact work.

**API & Schema splits three ways — Contracts · Routes · Numerics — and Numerics is where the
custody argument got drawn.** That card used to be a status pill and one sentence: *byte-exact,
this browser reproduced sha256 009be58f34bb… exactly*. The digest is the end of a five-link
chain of artefacts in this repository and none of the links were on screen, so the panel
asserted custody and showed none. It now draws the chain as the path it is — the bootstrap that
produces the distribution, the canonicaliser, the SHA-256, the comparison, and the committed
reference module — using `SignalDAGViewer`'s own idiom rather than a second dialect for the same
job. Press the button and the computing links resolve; **before you press it they all read "not
run"**, because a row of ticks at rest would be the panel congratulating itself on a measurement
it never took. The one thing knowable without pressing anything is whether the committed module
is self-consistent, and the panel re-hashes it on load rather than assuming so.

Three verifiers check the same claim, which is the point: the committed reference
(`tests/mc-parity.test.ts`), this deployment's Node runtime, and the browser reading the page.
**What is not drawn** — named because the panel now sets an expectation the neighbouring pane
does not meet — is the *other* digest chain. The gateway OpenAPI contract has exactly this shape
(routes in `modules/api/` → `tools/export_openapi.py` → `tools/openapi.json` → canonicalise and
SHA-256 → `lib/gateway-openapi-digest.generated.ts`, gated at `prebuild` and again by
`python tools/export_openapi.py --check` in CI), and in the Contracts pane it is still a verdict
pill with no digest visible at all. The components take a caption, a hex, a note and a mark and
know nothing about Monte Carlo, so drawing it needs a second chain array and a caller — not new
machinery. That is **planned, not built**.

**The digest is a canonical-JSON hash, not a file hash**, and the distinction is why the gate
survives a reformat. `scripts/check-gateway-openapi-digest.mjs` re-serialises
`tools/openapi.json` with sorted keys through its own `canonicalJson()` and SHA-256s *that*.
Adding one field to a `modules/schemas_*.py` model therefore cascades to **three committed
artefacts in order** — `tools/openapi.json` (`python tools/export_openapi.py`), the digest module
above, and `lib/gateway-contract.generated.ts`
(`node --import tsx scripts/generate-gateway-client.ts`) — and `npm run build` refuses in
`prebuild` until the first two agree. A second `prebuild` gate compares the committed repository
manifest's file list against `git ls-files`, which is why `npm run catalog:refresh` is part of
landing a new file rather than an afterthought.

**The three route figures, and why they disagree without contradicting.** State the basis or a
reader will "correct" one of them into agreement with another:

| Figure | Count | Basis |
|---|---|---|
| Route decorators in the tree | **83** | 3 `@app.get` console aliases in `main.py` (`/`, `/app`, `/ui`) + 80 across the twelve routers in `modules/api/` — 60 `get`, 20 `post`, 1 `patch`, 1 `delete`, 1 `websocket` in total |
| Operations in the OpenAPI schema | **79** | the 83 less the WebSocket, which OpenAPI does not describe, and less the three console aliases, all marked `include_in_schema=False` |
| Paths in the OpenAPI schema | **76** | the 79 operations, less three — `/api/orders`, `/api/data/work-items` and `/api/data/work-items/{item_id}` each serve two verbs |

Recounted 2026-08-29. `main.py`'s docstring now records the same 76-path,
79-operation contract. The router split is why
`grep -cE '^@app\.' main.py` alone answers 4 (three routes and an exception handler), which
would understate the tree by an order of magnitude. Re-derive with
`grep -rhcE '^@(app|router)\.' main.py modules/api/*.py` for the first, and `len(paths)` against
the summed verb count in `tools/openapi.json` for the other two.

**The moment worth showing:** API & Schema's contract drift check — the portal carries a
committed digest of the gateway's OpenAPI and compares it against the live one.

---

## Tab 9 — Markets (`#markets`, Alt+9)

**The question it answers:** what is this exchange actually quoting, and what does a whole
dollar of it cost?

A prediction-market contract pays $1 if an event happens, so its price *is* a probability, and
the exchange publishes the logical structure between contracts in its own metadata. That makes a
whole family of markets one dollar sold in pieces. This tab is the reading of it — the families,
their ladders, the structure between their outcomes, what a real position pays, and the same
universe walked as a filesystem. Page header: kicker **Markets**, title **"The exchange as it is
quoted"**, and metric tiles that are readings rather than claims — Exchange, Families priced,
Books recorded. The "it sends nothing" safety tile sits once, on Tab 10, where a reader has just
been handed a certificate that is literally a portfolio with legs, quantities and fees on it and
"and then it is traded" is the reachable misreading.

**The tab id and label are both Markets.** `#markets/books` is the durable address and
"Markets → Books" is the current product vocabulary. Other ids still intentionally preserve
older public links: `live` renders "Execution", `coherence` renders "Proofs", `codex` renders
"Strategies", `activity` renders "Blotter", and the two `model` section ids render "Risk engine"
and "Measurement" in their respective tabs.

**One day, six shapes.** On 2026-08-24 this engine was one tab of eleven sections. It was
**split** into two; six in-pane `.seg` views were
**promoted** to rails, taking the pair to seventeen; Fees and Combos **moved** across the seam;
the two tabs were **merged** back into one; the eleven were **consolidated** to nine; and the
nine were **split again**, divided by what they are for — the reading on this tab, the argument
about that reading on the next. The history matters because it established two current rules:
one question per rail section, and stable ids across presentation changes. The 2026-08-25 split
then separated Diffusion and brought the current engine to 8 + 7 + 7 sections.

**Published links still resolve.** `RELOCATED_SECTIONS` in
`web/lib/workspace-hash.ts` now carries only the section ids whose tab or owner actually moved;
restored ids such as `portfolio`, `combos` and `index` resolve natively and therefore do not keep
unreachable migration entries. The routing tests pin each remaining relocation and require the
resolved screen, section and corrected URL to agree.

**60 seconds:** rail: **Universe → Settlement → Books → Makers → Lattice → Stake → Fees →
Shell**. Eight sections, each asking ONE question and splitting its answer across an in-pane
`.seg` switcher rather than one long scroll. Eight and not six since 2026-08-25: Universe was
carrying what a family costs AND what it settles against on one five-button row, and Books was
carrying the exchange's two ladders AND what independent makers say. A switcher holds views of
one question, so each split at the seam it already had, under ids this engine had published
before — which shortened the relocation table rather than lengthening it. That control
is structural, not cosmetic: `WorkspaceSubtabs` publishes `--rail-h` onto
`document.documentElement`, so a nested rail inside a section would be a second instance writing
the custom property the outer rail owns, and the two would fight. A `.seg` is plain CSS keyed off
`aria-pressed` and publishes nothing.

**Every view is now a place.** The third hash segment names one of the 64 engine views; the
router, command palette and browser sweep consume the same `lib/section-views.ts` registry. The
default keeps the compact two-segment URL, while a non-default such as
`#markets/fees/comparison` is independently linkable and testable. The sweep covers 70 section
landings plus 43 non-default view cells across the whole workspace (42 in this engine and
Research Setup).

| Section | Views | What it answers |
|---|---|---|
| **Universe** | Baskets · Families | What does a whole mutually exclusive family cost against the dollar it is certain to pay? Both directions are priced, because buying every outcome needs every ask and selling needs every bid — and in the tails a market routinely has an ask and no bid, so a family that cannot be SOLD as a basket can often still be BOUGHT as one. One figure carries every watched family on a single dollar axis, with each family's outcome table behind a disclosure that states its row count: measured live, four watched families carry 80, 188, 6 and 6 markets, and drawing them all was 280 rows of quotes above the fold. **Families** cuts the universe by Kalshi's own `category` — "Crypto", "Climate and Weather" — read from `GET /series/{ticker}` and never inferred from a ticker prefix; a series the exchange will not categorise is grouped as uncategorised rather than guessed at. |
| **Settlement** | Index · Formation · Pending | What does the contract actually resolve against, given it is not the price on the screen? A weather contract settles on the MEAN of a published index over a window, and the gap between that and the latest print is basis a position carries for free. **Index** draws the published series against the window it settles on; **Formation** draws the chain that produces it — stations, quality control, a published minute, a sixty-minute mean — as a pipeline rather than a table, because a table cannot show that the figure a contract settles on is four transformations away from a thermometer; and **Pending** is the trailing minutes the stations have reported and the exchange has not published, drawn with the station DISAGREEMENT as the bar, because a provisional mean built from readings 3.6° apart is a different object from the same figure built from readings that agree. Three views of Universe until 2026-08-25, and a section again under the id it was published under. |
| **Books** | Ladder · Identity · History | What does this market look like as the exchange really publishes it? Two BID ladders and no asks; the offer ladder is IMPLIED and is the one the exchange never sends you. **Identity** makes `yes_ask + no_ask = 1 + spread` inspectable piece by piece; **History** adds an exact snapshot scrubber over the recorded book without synthesising missing observations. |
| **Makers** | Dispersion · Channel | What do several professionals say when the book shows one opinion, or none? A book publishes the most aggressive resting order rather than the typical view, and for a combo it publishes nothing at all; the request-for-quote channel is the only place the venue exposes N independent answers to a question it never asked. **Dispersion** ranks each panel's lowest-to-highest range on one dollar axis and keeps `spread` (what the makers disagree about) apart from `median_width` (one maker's own bid-offer), because a wide panel of tight makers and a tight panel of wide makers are opposite situations that read identically if either number stands alone. **Channel** is the four answers the channel itself can give — unsigned, refused, read-and-empty, quotes-in-hand — drawn as a figure and tabulated with what each one is NOT, because all four would be reported as "no data" by a panel that only tracked whether it had quotes. Two views of Books until 2026-08-25, and a section again under the id it was published under; the label is "Makers" because the section is about who is quoting, and a reader scanning a rail should not need the statistic to find the people. |
| **Lattice** | Survival · Mass · Moments | What measure do these prices imply? **Survival** is the function the strikes sample, **Mass** what differencing leaves between them, and **Moments** the summary that falls out. The redesigned mass reservoir and selectable moment tiles keep every exact input beside the structural shape. |
| **Stake** | Plan · Capital · Method · All outcomes | What would it be right to bet against that measure? The bankroll vault exposes plan, capital split, growth method and every ranked or declined outcome. Worst-case wealth stays beside growth because log-optimal is not riskless. It sizes and sends nothing. |
| **Fees** | Worked example · Cost shape · Ablation · Replay table | What does a real position pay, and does the cost model change the answer? The defaults reproduce Kalshi's documented case. The receipt stack makes every component selectable; the counterfactual switchboard replays the tape under four configurations, including `no_fees`; Replay table preserves that run row by row. `/replay?limit=20000` is gated on the two replay views and warmed by nothing. |
| **Shell** | Map · Browse | Where does a market live, and what has actually been derived about it? The filesystem lens maps directories and lets a reader browse the listing and live tape. Missing path, unavailable reading, empty directory and unreachable venue remain four distinct outcomes. |

**The interaction is quantitative, not ornamental.** Every redesigned family has a real button
or range control, explicit selected state and an atomic exact-value output. Dense selectors use
one roving tab stop with arrow, Home and End navigation. The family constellation, settlement
board, book identity pieces, lattice reservoir, bankroll vault, fee switchboard and filesystem
lens are purpose-built HTML/CSS instruments rather than generic line, bar or SVG chart shells;
they only transform values already present in the payload.
---

## Tab 10 — Proofs (`#coherence`, Alt+0)

**The question it answers:** do those quoted prices admit any probability at all, and if not,
what is the portfolio that profits whichever way the world goes?

Coherence is a property you can test rather than a pattern you scan for, and this tab is the
test plus everything that survives it — what the cost model does to the edge, how far from
coherent the venue sits over time, and whether the prices were right once settled. Information
absorption is now Tab 11. Page header: kicker **Proofs**, title **"Prices as probabilities,
tested for coherence"**, and the **Order path — none** tile, noted "this engine reads, records
and certifies; it sends nothing". That tile sits here and is deliberately not repeated on Tab 9:
a head metric is per-tab either way, and this is the tab where a reader meets a certificate that
is literally a portfolio with legs, quantities and fees on it.

**The tab id is `coherence` and the label is "Proofs".** `coherence` is the only Kalshi tab id
`origin/main` ever published, so it keeps the half that carries the proof and every
`#coherence/<section>` link in the world still resolves natively. The six-shape history and the
relocation table are described under Tab 9 and apply here unchanged. Its 25 views use the same
address grammar and shared view control as Markets.

**60 seconds:** rail: **Coherence test → Basket → Parlays → Coherence index → Scorecard → Corpus → Lessons**.
Seven sections, Lessons carried as secondary because it is reference material rather than a step.
The first three were one section, "Dutch book", until 2026-08-25: three groups over six views
over a family picker, which is three rows of chrome before any drawing. They are three questions
— is there a Dutch book, what portfolio does that hand back, and the same test on the venue's own
parlays — so they are three sections, each one read and one control row. Both restored ids were
already published, so the split shortened the relocation table rather than lengthening it.
**Corpus** was the seventh, added 2026-08-25. Scorecard was answering two questions — were the
prices right, and what were they right ABOUT — and at 2,273px it was the tallest thing on the tab.
The second question decides whether the first means anything, because a Brier score is a score of
whatever settled: a corpus that is 81% one series scores that series under the whole exchange's
name. It also took **Score trend** from Coherence index, which had been reading the settled
history beside two views reading the unsettled tape — two clocks under one label, which that
section's own header admitted. Every section on this rail is now one question.

| Section | Views | What it answers |
|---|---|---|
| **Coherence test** | Verdict · Proof · Prices | Do these prices admit a probability measure? Almost always yes — and that is the CLAIM, not a disappointment: a detector that spoke only when it found something would leave "no opportunity" and "the feed is down" looking identical. Which is why the verdict now reports the programme's own margin, the signed figure it was read off, rather than four money rows that are correctly empty whenever no portfolio exists. **Proof** is the whole certificate in a fixed-width block you can check by hand or paste elsewhere, because "arbitrage, 3.2 cents" is not evidence. |
| **Basket** | Cover · Basket · Size | The portfolio the test hands back, drawn state by state — the constructive half of the theorem and the reason this engine tests for coherence instead of scanning for arbitrage shapes. Where no measure fits a family's prices, duality returns the basket that wins in every state, so the certificate of infeasibility IS the trade. Every leg carries all three fee components, because a gross edge is not an answer. |
| **Parlays** | Bands · Comparison · Parlays · Legs · Bounds | The same test run on the parlays the venue states rather than on a family's strikes: two probabilities never determine the probability of both, so the legs give a Fréchet band and never a price, and the band's width is how far the parlay can move with no leg moving at all. Comparison keeps the venue quote beside that band; Legs makes the inputs inspectable. It takes no family picker, and that is the structural reason it is its own section: a parlay is a listing the exchange publishes, not a family this engine chooses. |
| **Coherence index** | By poll · By family | How far do these prices sit from admitting a probability, right now? The Scorecard scores a SETTLED corpus against what paid; this measures the L1 distance from the quoted price vector to the nearest one summing to a dollar, on every poll, on markets that have not settled and may never. One is a verdict about the past and the other a time series about the present — they shared a section for a day on the argument that both ask "were these prices right", which is a question rather than a subject. The score trend moved to Corpus on 2026-08-25 for the same reason in reverse: it reads the settled history, so it belongs beside the settled corpus rather than beside a live distance. Unmeasurable readings are drawn as gaps, never dropped or zeroed, because a line closing over them would claim continuity nobody observed. |
| **Scorecard** | Overview · Decomposition · Measures · Reliability · Bands | Were these prices right once settled? Overview leads into the Murphy decomposition; the waterfall and exact term inspector share one selected term, while Measures keeps the exact score table separate. Reliability and Bands link each calibration cell's quote, realised frequency, count and contribution on one keyboard-operable Brier surface; what the score was taken over is next door, in Corpus. |
| **Corpus** | Composition · Score trend | What was that score computed on, and how did it accrue? A Brier score is a score of whatever happened to settle, so the mixture decides what the figure next door is a figure about — the composition names each series' share and its own favourite–longshot slope, and refuses to let the aggregate stand in for a series, because the aggregate averages series that are not the same question. **Score trend** is the settled score as it was recorded, accruing forward only: nothing back-fills it, so the first point is where the recorder started rather than where the venue did. Runs that could not be scored are drawn as gaps, never as zeroes. |
| **Lessons** | Prices · Structure · Bounds · Record · Coverage · Episode states | What is the curriculum, and what guards each claim? Fourteen lessons rendered from `lib/coherence/lessons.ts`, each naming the code and tests that pin it. The selectable verification loom reveals full module and suite paths; the detail sheet keeps long formulae readable and actionable instead of making labels themselves the click target. |

**Every engine view is an address.** The grammar is `#<tab>/<section>/<view>` —
`#coherence/certificate/proof`, `#markets/fees/comparison`,
`#diffusion/sandbox/spectrum` — declared once in `web/lib/section-views.ts` and
read by the router, command palette and browser sweep. A bare two-segment link
opens the section default; an unknown third segment falls back and corrects the
URL; selecting a view replaces the address so Back still steps through sections.

**The proof is directly inspectable.** Verdict checkpoints, constraint slack,
state payoffs, basket size, Fréchet marks, coherence polls, Murphy terms,
calibration cells and corpus rows use stable-key selection shared across every
representation. Pointer and keyboard focus drive the same exact readout, so a
highlight never becomes a colour-only claim. The common coherent/zero-leg case
keeps a quantitative, pinnable lifecycle instead of degrading into an empty
white panel.

**Reads are gated on the open section *and*, where a view alone is expensive, on the open view.**
The universe read asks for `?max_events=2` because four events took 10.1 s before the reads were
parallelised and 6.4 s after, against `callGateway`'s eight-second deadline; it is shared by
Universe, Lattice and the Coherence test — across both tabs — so it is deliberately *not* gated on the
sub-view. The request-for-quote route is a signed private-channel call on a 25 s budget and must
never be in flight beside the public book read; that used to be a `booksView` state in the
console, then one predicate inside `BooksSection`, and since the split of 2026-08-25 it is
neither — **Makers** is its own section, so each read is gated on its own section and there is no
second read in either file to be exclusive with. It is also the one section on the tab the rail
warms with NOTHING, because on a keyless deployment it answers "no view, unsigned" every time and
warming would pre-fetch a refusal.
`/replay?limit=20000`, the largest read on either tab, is gated on Fees → Ablation and Replay
table the same way, and is the one read the rail warms with nothing at all — pre-fetching it
would put the desk's heaviest read on the exchange for a view nobody has opened.

**A gated read is not a cold one, and that is the other half of the decision.** Gating on the
open section is right for the exchange and was wrong for the reader: the live reads take
*seconds* by design, so every first visit to every section met "Reading the exchange…". Three
mechanisms answer that, all in `web/lib/coherence/`. Every URL is built once in `routes.ts`, so
a query string cannot differ between the pane that asks for it and anything that pre-fetches it.
`read-cache.ts` holds one answer per URL and joins a read already in flight — three panes shared
the universe read and each held its own latch, so opening the tab could put three identical live
reads on the exchange's token bucket at once. And `use-section-warming.ts` sweeps the rest of the
rail once the tab is on screen: on `requestIdleCallback`, one URL every 600 ms, which is inside
the five-a-second the gateway budgets itself. The rail also warms the section a pointer is
crossing. A warmed payload paints only while it is under 100 s old — past that a cold section
shows its loading line again rather than a figure from a different market — and the section's own
poll is `immediate`, so a live answer replaces the warm one within a tick either way.

**The moment worth showing (Markets):** Books → Ladder — the implied offer ladder drawn as a
ghost one spread away from the YES bids. It is the ladder you would trade against and the one the exchange
never sends you. Then press Identity and watch the two bars land on the same tick.

**What it may not claim.** Nothing on Markets, Proofs or Diffusion places an order, and that is
structural rather than a setting: all 18 `/api/coherence/*` routes are `GET`, and
`tests/test_coherence_security_auth.py` sweeps every one of them against the app's own OpenAPI
document so a route added without an entry fails the suite. The workspace's own proxies —
18 under `app/api/gateway/coherence/` and three under `app/api/gateway/diffusion/` — export
`GET` and nothing else. The gateway has one additional authenticated, idempotent Diffusion stage
write for recording a research observation; it is not a trade route. Turning `DRY_RUN` off is
still insufficient to trade because this engine contains no executor.

Three more refusals are worth pressing on, because each sits where the opposite would be
believed:

- **Calibration built from last traded prices scores almost perfectly and means nothing about
  foresight.** The section turns on one field, `engine`, which says *when* the price was read. On
  the live sample the `final_trade` engine returns a Brier of 0.00010533 and a skill of
  0.99935238 — a last trade happens when the answer is already in plain sight. So the caveat is a
  banner above the switcher, not a footnote; it is repeated in the cell beside every figure it
  invalidates; and `median_horizon_s` — zero, meaning the price was read *at* settlement — is
  printed as the tell.
- **"Inside the band" is not "fairly priced".** Every price between the two Fréchet bounds is
  consistent with *some* dependence between the legs, and nothing on this exchange quotes
  dependence. The band width leads, the position inside it is called a position, and "mispriced"
  appears only where a price is outside its band and a portfolio proves it.
- **An ablation is not a P&L.** Replaying an arbitrage engine over its own recorded quotes cannot
  say what it would have earned, because it could not have traded against every quote it
  recorded. It says what each cost model would have *seen*.

**The Diffusion verdict, and it is a null — do not read it as anything else.** The study asks
whether the resolution at which a rate statement's headline explains its body predicts how fast
the price finishes absorbing it. It is now scored **out of sample** by
`modules/coherence/diffusion/skill.py` (21 tests in `tests/test_diffusion_skill.py`), which
replaced a criterion resting on the largest of eight **in-sample** univariate |t| values against a
half-life that only existed where the move cleared two sigma — 26 of 62 release meetings. The
result:

> The absorption clock **is** predictable — out-of-sample **R² +0.144** from stage and rate move
> alone, with the press conference about **7.0 minutes slower** than the statement — but adding
> the text changes that by **−0.343** (shuffled **p 0.875**). Over a declared **3×3 grid** of
> specifications the gain was negative in **all nine cells**, including the one with the largest
> in-sample |t| of **2.85**.

So the headline is a null, and a stronger one than the criterion it replaced: the clock has real
structure and the statement's information spectrum is not part of it. Four changes make the
verdict about the market rather than about the estimator, each argued in the module as not a
choice of answer — the target became a **residence time**, the area above the absorption curve,
which for an exponential approach *is* the time constant, so it needs no signal gate and is
defined for **62 of 62** meetings per stage; the two-sigma cut became a **precision weight**; the
two stages are **pooled with a call indicator** and the policy move enters as a **control, not a
rival**; and scoring is **leave-one-meeting-out**, because folding by row leaks when both stages
share a statement. Five `skill_*` fields carry it on the study row
(`modules/schemas_diffusion.py`) and two `InstrumentFit` rows render it in a deliberate order:
*"The clock is predictable at all"* sits **above** *"The text predicts it"*, because if the first
fails the second means nothing at all. The figures quoted are from the run recorded on
2026-08-24; re-running the study replaces them, which is why they live in fields rather than in
prose.

**Read with no keys.** Every price here comes from Kalshi's public endpoints; no API key is
configured or needed for the read path. The recorder is off unless `COHERENCE_SERIES` and
`COHERENCE_POLL_S` are both set on the gateway, and when it is off the sections state what they
will show and what has to exist first, rather than rendering an empty chart frame: an axis with
nothing on it and an axis whose data failed to load look identical, and one of those is a fault.

---

## Tab 11 — Diffusion (`#diffusion`)

**What it answers:** how long does it take a price to finish moving on something it did not
already know?

**Why it is a tab and not a Proofs section.** Every section of Proofs argues from ONE poll of the
exchange: does this family's prices admit a probability, what portfolio does the failure hand
back, how far from coherent are the quotes right now. This argues from a recorded research panel —
two hundred runs, a control arm of matched half-hours in which nothing was announced, an
out-of-sample verdict — and answers a question about DURATION rather than about what a price
implies. It shared a rail with the coherence engine because both are research, which is a category
rather than a question. It had also stopped fitting: four groups over eleven views is a rail's
worth of subject behind one button, and it had grown a THIRD switcher level to hold the findings.
`#coherence/diffusion` and `#coherence/findings` both cross tabs now, which is the one kind of move
`RELOCATED_SECTIONS` cannot stop being needed for.

**60 seconds:** rail: **Announcement arm → Meetings → Kalshi episodes → Measurement →
Instrument → Sandbox → Findings**. Seven sections; the three that read nothing are carried as
secondary, because they are the instrument rather than a reading of it.

| Section | Views | What it answers |
|---|---|---|
| **Announcement arm** | Absorption · Control · Clocks | How much of the move had arrived, and by when? A stage is measured against matched windows in which nothing was announced, so a fast absorption has to be faster than the market is anyway — **Control** is that comparison drawn, and it is what stops a decay curve being read as a finding. It stays inside this section deliberately: a section boundary is how a reader stops encountering something, and a reader who could reach the curve without its control could take a half-life away without the caveat that makes it one. **Clocks** is the second control: the same stages ranked by the wall clock and by a clock built from matched windows, where a crossing means a path stopped moving because the market had rather than because it had finished. |
| **Meetings** | Meeting by meeting · Calendar · Mechanism | What did each decision do? The same ledger the arm reads, cut per meeting and calendar state rather than only by stage — a blank stage never moved enough to measure, which is a property of the decision rather than of the data. **Mechanism** reads nothing: its drawing is two stage constants, and it is here because the two windows being the same length is what a reader has to accept before any per-meeting number means anything. |
| **Kalshi episodes** | Survival · Episodes | How long does a published mispricing survive? An episode earns a lifetime only by CLOSING, which is why the survival curve is drawn from closed episodes alone and why the median can be withheld while episodes are still open. This is the measurement that says whether the executor is worth building — half-life before P&L. |
| **Measurement** | one view | What does the estimator compute on a price path? Seven cards: the absorbed fraction, the gate that decides whether there was a move at all, the crossing, and the two fits that are reported but are never the verdict. Every card names the reference module it is a port of and states what BREAKS it above what it measures. |
| **Instrument** | one view | What is built on top of the measurement? Six cards: a clock that is not made of the event, the control percentile, and the closed-form information spectrum the study reads. Split from Measurement because they are two questions — and because the thirteen cards together measured 2,724px, four times the next largest view on the tab. |
| **Sandbox** | Half-life · Simulator · Spectrum | What happens when you move the model inputs? These are the tab's browser-computed what-if views, and the interesting case is the refusal: each can be driven to a state where the honest output is a named reason rather than a number. Every figure computes in this browser from `lib/coherence/diffusion-model.ts`, a TypeScript port held to the Python original by a committed parity fixture — which is what makes a slider possible at all, since a round trip per keystroke would make all three unusable. |
| **Findings** | Effect plot · Findings table · Instrument | What did the study conclude, and was it fit to? The reported run finds no qualifying text effect, but has not itself been scored out of sample; the Instrument view says so instead of borrowing the score stored on a different run. A stage selector plus adjustable t and shuffled-p thresholds recompute the evidence gate locally over the full finding rows; **Instrument** keeps the verdict separated from the mechanism that produced it. |

`d6:s7` is a run key, not a tab or view id. Find it under **Diffusion → Findings →
Instrument**, then open **The run, and what it was held to**. `d6` means six latent
dimensions and `s7` means random seed 7; the pair was selected by the pre-registered
rule for best recovery of the known fact among well-conditioned candidates.

The Diffusion figures keep their complete source arrays while exposing local analytical lenses:
either or both absorption lines; solid-cleared, dotted-refused or all measured returns;
statement, conference or both control-rank strips; dotted background, solid main or all
clock-ranked paths; calendar all/cleared/refused state; an arbitrary episode-lifetime probe; and
effect stage, |t| and shuffled-p thresholds. The announcement curves include their measured
middle-50% shadows. Both stage colours can be solid in Clocks, while gray dotted lines stay in
the backdrop; the readout reports 248 total input paths and 89 clock-ranked paths without
pretending the other 159 have clock values. The Findings thresholds span |t| 0–5 (or the payload
maximum when larger) and shuffled p 0–1. Each control is labelled and keyboard reachable. Filters
keep axes and panel positions fixed without reranking; sliders recompute the loaded payload;
neither path refetches or fabricates a market observation. During a cold reload, the selected
Announcement-arm view reserves its settled stack height only until its first read resolves;
terminal failures and genuine empty reads stay compact.

---

## Telegram — the companion behind the Connect chip

**The question it answers:** can the desk be read, and stopped, from a phone — without becoming
a second way in?

This is not another tab. It is the companion a visitor can reach from every workspace tab: each
header carries a **Connect** chip. The bot is
[`@alpha_engine_nussif_bot`](https://t.me/alpha_engine_nussif_bot), and it is a companion, never
an auth provider: a binding runs **one way**, from a web identity to a Telegram read, and the
bot never authenticates the website.

**What the companion is, today.** 138 commands from one registry that also drives dispatch and
the `/` menu — README §6 and the live checklist are generated from it, and
`tests/test_telegram_docs.py` runs the generator's own `--check` inside the suite, so a new
command that never reached the tables turns the suite red rather than shipping a stale count. The
command centre, the tab cards and the section cards carry **inline
keyboards**, so a read is a tap rather than a typed command, taps are authorised on the tapper
and never on the tapped message's author, and a refresh edits the card in place rather than
sending another; sixteen matplotlib chart
generators in `modules/telegram_charts/` (series, bars, depth, drawdown, histogram and heatmap;
equity, paired bars, gate ladder, latency CDF and scatter; multi-series, VaR breach, pipeline,
cone and status grid) draw what they were handed or return `None`, never a placeholder captioned
as data; and **eleven tab commands**, one for every workspace tab. `/markets` occupies a menu
slot; `/proofs` and `/diffusion` remain available through `/commands` and inline buttons so the
Telegram API's 100-entry menu cap is respected. `/coherence` remains a compatibility alias for
`/proofs`; `modules/telegram/registry.py` is the authority and its tables in
`Part2_Infrastructure/README.md` §6 are generated, never hand-edited.
`/sli` and `/latency` quote the native core's nanosecond figure beside the decision's
microseconds — the same two planes the header chip keeps apart.

**What connecting does.** The chip mints a single-use token and hands it to Telegram as a deep
link. Following it binds that chat to the web desk identity you already hold — an account, or
the guest pass the workspace seeds for a browser, both work. The chip then reads **Connected**
with a `✓` beside it; the mark sits outside the collapsing label so the state survives the
narrow widths where the header hides the word, which is the no-colour-only-meaning rule applied
to a chip. Account bindings are recorded against the account and do not age out; guest bindings
are held by the gateway alone and do.

**What a binding grants, exactly: read parity with a desk pass, and nothing more.** The same
book, the same kill-switch state, the same risk reads a desk pass already shows you in the
browser — which is why the binding is not an authentication bypass. It cannot reach the six
gated controls. `/halt`, `/resume`, `/flatten`, `/reduceonly`, `/resetbook` and `/replay` answer to
`TELEGRAM_CONTROL_USER_IDS` and nothing else — a separate allow-list, **empty by default**,
changed only by someone with deploy access — plus a single-use typed confirmation code. A
connected chat that is not on that list gets a refusal naming the allow-list rather than a
silent no-op. `/flatten` is worth naming: it submits real closing `MARKET` orders through the
same pre-trade gates as any other order, so it is gated as a control, not as a read. There is
deliberately no `/order` command at all, so the bot can stop the desk and never open a position.

Reads themselves are fail-closed behind two named grants and only two —
`TELEGRAM_ALLOWED_USER_IDS`, or a binding. With neither, the bot answers only bootstrap
commands such as `/whoami`, so an operator can obtain their own Telegram user ID without
already being trusted.

**Setup:** `TELEGRAM_LINK_SECRET` must hold the *same value* on the gateway and on Vercel,
because one process mints the token and a different process on a different host verifies it.
Unset is fail-closed — the chip renders a refusal naming the missing secret rather than a link
that cannot complete. `TELEGRAM_BOT_TOKEN` lives in the gateway's `.env` and nowhere else.
Leave both empty and the gateway and workspace run unchanged. See
[`SETUP.md` §Telegram](../../SETUP.md).

---

## Verify it yourself — the 13 E2E probes

`Part2_Infrastructure/tools/e2e_smoke.py` runs thirteen probes against the live deployment, in
this order; the list doubles as a checklist for a manual tour. It is scheduled twice a day
(`.github/workflows/e2e.yml`, `23 6,18 * * *`) and **never on push** — a venue outage or an idle
database is not a reason to block a code change — and its authenticated checks *skip* rather
than fail when secrets are absent, so a fork gets a partial run instead of a red one.

1. Gateway `/health` answers.
2. Venue feeds — both Binance and Bybit books are flowing.
3. Gateway auth — `/api/portfolio` rejects keyless, accepts the token.
4. Decision histogram — pre-trade decisions are being recorded.
5. Vercel app — the portal serves.
6. Vercel root guard — `/` still redirects rather than answering 200, so the desk is never
   served to a visitor with no session.
7. Vercel `/api/system/health` — the portal can see its providers.
8. Vercel → gateway — the hop the workspace actually depends on, probed from outside through
   `/api/gateway/portfolio` rather than inferred from a `/health` that was green from three
   other vantage points while this one was down.
9. Market data — a real bar series comes back.
10. Backtest — a sweep runs end to end and returns a verdict.
11. Oracle ADB — the VaR persistence layer answers.
12. Supabase — the audit-log mirror answers.
13. RAG embed — the research-corpus embedding path answers. Retrieval behind it
    fuses **four arms inside `search`** — dense pgvector over gte-small at 384
    dimensions, Postgres full-text `ts_rank_cd` over the generated `search_tsv`,
    Okapi BM25 re-scoring the rows those two returned, and the optional CLIP
    image arm over `image_embedding`, which runs only with
    `RESEARCH_IMAGE_MODEL_PATH` set and is the one arm that can *add* a document
    rather than only reorder. A **fifth**, the derived edge graph's own walk, is
    fused one stage later by the router's execution path
    (`modules/research_router_exec.py`), not inside `search` — say which, because
    the two are different stages of the same pipeline. All five fuse by RRF at
    the same **k = 60**, defined once in `modules/research_bm25.py` and imported
    rather than restated, because an arm joining on a different constant is a
    second fusion wearing the first one's name. Then cross-encoder re-ranked
    when `RERANK_MODEL_PATH` is set — off by default, and falling back returns
    the candidates in their original fused order with `reranked: False` and a
    named reason — graded by the CRAG bands, all three of which decide, so a
    middling result its one rewrite does not rescue is refused rather than
    served; and, with a `GEMINI_API_KEY`, answered in prose that must cite the
    documents it was handed and quote their figures verbatim, or refuse. That
    answer route is rate- and spend-bounded, and its refusals are typed so "over
    budget" (HTTP 429 with a `Retry-After`) can never be read as "the corpus is
    silent" (HTTP 200 with a verdict). The derived edge graph is also projected
    into **Neo4j Aura** when configured — a one-way, rebuildable read model that
    nothing else writes to, with a daily sweep writing back Louvain community
    labels and PageRank scores. Only two routes read it back,
    `GET /api/research/graph/communities` and `/centrality`, and both mark
    `source: "neo4j"` or `"corpus"`; Aura Free has no GDS, so those two
    algorithms actually run in process over the edge list via networkx. Postgres
    stays authoritative and **no request path depends on the graph being up** —
    request-time traversal is a Postgres recursive CTE capped at depth 4.

**The five-minute ops drill.** `python3 tools/e2e_smoke.py --drill` adds two *mutating but
reversible* proofs on top of the read-only probes: it simulates a provider outage and asserts
at least three dependent surfaces react in one round trip (provider matrix, incident row,
failover graph, health summary) before restoring the provider, then trips the gateway kill
switch, confirms the live book reports `trading_halted`, and resumes. Everything is paper-only;
the outage self-expires in 60 seconds even if the restore step is interrupted. This is the
push-button version of the demo a reviewer would otherwise click through by hand.

**The Oracle keepalive caveat:** the VaR panel reading "unavailable" usually means the
Always-Free Autonomous Database has auto-stopped from inactivity — it stops itself after seven
consecutive idle days and there is no "do not auto-stop" switch, which is why
`tools/oracle_keepalive.py` exists and why `.github/workflows/oracle-keepalive.yml` connects once
a day at 02:17, off the top of the hour. It is the known operational sharp edge of the free tier,
documented rather than hidden.

---

*All eight slices of the UI overhaul are shipped — the audit they answer and the plan that
sequenced them are working notes kept outside this repository, and each rule they raised is
now a test rather than a paragraph. Their moments are woven into the tabs above: the Strategies
section and the gate-clear pulse on Research,
the order-gate cascade and tick flashes on Execution, drawing charts throughout, ⌘K fuzzy
search with recents, and View Transitions between tabs. The passes that followed — one type
scale, the moving desk, the decision chip and its three planes, the header's priority ladder
and larger type, the interactive Telegram companion, and the Kalshi engine's six restructures
in one day, followed by the current Markets, Proofs and Diffusion instrument architecture. This
tour doubles as the acceptance script:
walking it end to end — once with motion on, once with the OS reduce-motion switch set, and once
at ~1200px wide to watch the header fold without clipping — is the manual verification pass.

That pass is not optional politeness. The Node suite has no DOM or layout engine: it can prove a
rule is present and correct in source and cannot prove where Chromium placed the pixels
([`TESTING.md` §"No DOM, and therefore no layout"](../testing/TESTING.md)). The browser-backed
`npm run audit:layout -- --url=http://localhost:3000` closes that boundary by measuring local
ownership, named scrollports, sibling intersections, sticky occlusion and framework errors over
109 addressable states at eight viewport sizes. The 2026-08-29 release sweep passed all
**872/872** combinations with zero geometry failures and zero console errors. A source-only green
run is never reported as a geometry pass. The manual pass still checks meaning — linked exact readouts, full long labels,
focus order, motion and the absence of colour-only state — because collision-free pixels do not
prove that an instrument is understandable.*
