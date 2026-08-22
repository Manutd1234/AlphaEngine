# Feature tour — the whole infrastructure, walked as the decision loop

This is the guided walkthrough of AlphaEngine: the Vercel portal, the OCI gateway behind it,
the operator modes, and the Oracle/Supabase persistence layer. It is structured as the decision
loop itself — **Overview → Research → Execution → Portfolio → Risk → Data → Reliability →
Developer** — because that is the order a desk makes decisions in, and the workspace's tabs are
that loop made navigable.

*Walked against the deployed system on 2026-08-17. The panel descriptions were re-read against
the tree on 2026-08-22, when the Remediation and API & Schema sections changed shape — those two
are described from the source, not from a walk, and the two stamps are kept apart rather than
merged into one flattering date. The rail lists are pinned to `lib/sections.ts` by
`web/tests/tour-truth.test.ts`, so a rail here cannot drift from the app without the suite saying
so; a **pane** inside a section is component state and has no such guard, which is why the pane
lists below are the part of this document most worth distrusting.*

**Live URLs.**
- Portal: <https://alphaengine-workspace.vercel.app> (also answers on `developer-analyst-infra.vercel.app`)
- Gateway (OCI, Singapore): `http://149.118.48.255:8000` — `GET /health` answers keyless and
  names the decision engine (`native` on 2026-08-17); `https://149.118.48.255:8443` is the same
  gateway behind the Caddy sidecar's pinned internal CA (`docs/engineering/TLS_FLIP.md`).
- Local: `cd Part2_Infrastructure/web && npm run dev:all` starts both (gateway on `:8000`,
  portal on `:3000`).

**Keyboard access, everywhere:** `Alt+1` through `Alt+8` switch tabs in the order above.
`⌘K` / `Ctrl+K` opens the command palette — it fuzzy-matches every tab, every rail section,
all 46 models ("hull" finds Hull trend) and every research symbol, and opens on this browser's
recent commands when the query is empty. On Research, `⌘Enter` runs the sweep and records it.
On Chromium, tab switches cross-fade under the fixed header via View Transitions; elsewhere,
and always under reduced motion, they cut cleanly.

**The header, on every tab.** One row, one structure for guest and signed-in alike: the brand,
the eight tabs (13px), and a utility strip whose words are all 12px — the data-tier chip, the
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
command palette, the hash whitelist and "Copy link to this view" all read. **47 sections across
the eight tabs.** Three ids deliberately disagree with their labels, because the deep link came
first and ids never change: view `live` renders "Execution", section `codex` renders
"Strategies", section `activity` renders "Blotter". If a rail here disagrees with the app,
`sections.ts` is right and this file is stale — fix it here, not there.

---

## What runs with no keys at all

The honest capability map, before the tour — because "does this need setup?" is the first
question a visitor asks.

Signing in is orthogonal to every tier below: it stores workspace preferences
against an account and unlocks no capability. Every tier reads the same for a
guest as for an account holder.

The desk itself now sits at `/dashboard` behind a routing guard, so the question
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
| **Zero-config** | Keyless Binance + Bybit market data: parameter sweeps, all 46 strategies, L2 depth, TCA, the full Research tab on crypto symbols | nothing |
| **Keyed** | Equities and benchmarks via FMP / Tiingo / Massive / AlphaVantage, with provider failover | API keys in env |
| **Gateway-backed** | The live consolidated book, paper orders through the pre-trade gates — **17 defined, 15 reachable by any order** — kill switch state, decision histograms | the OCI gateway reachable |
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

**60 seconds:** rail: **Decision loop → Desk roles → Audit trail**. Land on the page. The KPI
deck reads the book's equity, day P&L, tail risk and system latency from the same snapshots
every other tab uses. Below it, the **DecisionLoopPipeline** draws the loop this tour follows —
each stage is a link. Desk roles gives one surface per role; Audit trail is every paper order,
accounted. The header on every tab shows provider readiness and the decision p99; if the
gateway is unreachable it says so here first.

**The moment worth showing:** the pipeline. It is the product's thesis as a diagram — research
flows to execution only through a risk gate.

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

**The moment worth showing:** the promotion gate clearing — six vetoes (DSR among them)
staggering in one by one, the cleared-count ticking up, and a Promote button that stays dead
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

**Why the gate count has two numbers.** `modules/risk_proxy.py` defines **17** gates; a crypto
order can reach **15** of them. The two it never reaches — `paper_execution_model` and
`reference_freshness` — exist only for the paper-equity path, where an order is priced from a
vendor quote rather than a live L2 ladder, and a quote can be stale or refuse to honour a
resting `LIMIT` in a way a ladder cannot. Quote 15 when describing what an order goes through
and 17 when describing what the module implements; the full table, with what each gate guards
against, is in [`Part2_Infrastructure/README.md` §4](../../README.md).

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
covariance is estimated from real venue bars, and when it cannot be, the panel says "Pending"
rather than substituting an assumption.

## Tab 5 — Risk (`#risk`, Alt+5)

**The question it answers:** how much can we lose, and who can stop the desk?

**60 seconds:** rail: **Limits → VaR & model → Risk drivers → Monte Carlo → Oracle VaR →
Stress tests → Controls**. Limits shows the binding constraint and its utilisation. VaR & model
carries the validated loss estimate with its traffic-light backtest zone and the
forecast-against-realised chart that scores it. **Risk drivers** answers the next question
separately — which positions carry the volatility, and how much of the diversification is real
— because a contribution table and a correlation matrix sharing a row with a time series gave
all three too little width to be read. **Monte Carlo** bootstraps the research winner's
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

**The blast-radius map is new, and it is the thing to open Remediation on.** Under the five
mutation buttons is a drawing of what each one reaches: five server writes on the left, the seven
stores on the right, and an arrow only where a write actually touches a store. Hover or focus a
mutation and the rest dim. Below it the same relation is a table — 5 × 7 = **35 cells**, each
carrying the reason it says what it says, every one read out of the write path in `lib/operator.ts`
rather than paraphrased from the prose it replaced (two cells came out *different* from that prose
once the code was open: `clear_telemetry` zeroes the cache counters while leaving cached responses
in place, and `reload_providers` drops the cached OpenBB readiness verdict while leaving the
response cache alone). Four effects, never three — `● cleared`, `→ re-read`, `○ left intact`,
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
generated measurement with a date, not a contract, and it is behind the tree as this tour is
written. [`TESTING.md`](../testing/TESTING.md) is the argument for why, and the one document
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
(`main.py` routes → `tools/export_openapi.py` → `tools/openapi.json` → canonicalise and SHA-256 →
`lib/gateway-openapi-digest.generated.ts`, gated at `prebuild` and again by
`python tools/export_openapi.py --check` in CI), and in the Contracts pane it is still a verdict
pill with no digest visible at all. The components take a caption, a hex, a note and a mark and
know nothing about Monte Carlo, so drawing it needs a second chain array and a caller — not new
machinery.

**The three route figures, and why they disagree without contradicting.** State the basis or a
reader will "correct" one of them into agreement with another:

| Figure | Count | Basis |
|---|---|---|
| Route decorators in the tree | **60** | 3 `@app.get` left in `main.py` (the HTML routes) + 57 across the eight routers in `modules/api/` — 36 `get`, 19 `post`, 1 `patch`, 1 `websocket` |
| Operations in the OpenAPI schema | **56** | the 60 less the WebSocket, which OpenAPI does not describe, and less the three HTML routes (`/`, `/app`, `/ui`) marked `include_in_schema=False` |
| Paths in the OpenAPI schema | **54** | the 56 operations, less two — `/api/orders` and `/api/data/work-items` each serve `GET` and `POST`, so two operations share one path twice |

Counted 2026-08-22. The first figure moved with the split that emptied `main.py`: the routes now
live in `modules/api/`, so `grep -cE '^@app\.' main.py` alone answers 4 (three routes and an
exception handler) and would understate the tree by an order of magnitude. Re-derive with
`grep -rhcE '^@(app|router)\.' main.py modules/api/*.py` for the first, and `len(paths)` against
the summed verb count in `tools/openapi.json` for the other two.

**The moment worth showing:** API & Schema's contract drift check — the portal carries a
committed digest of the gateway's OpenAPI and compares it against the live one.

---

## Telegram — the companion behind the Connect chip

**The question it answers:** can the desk be read, and stopped, from a phone — without becoming
a second way in?

This is not a ninth tab. It is the one control a visitor meets on all eight of them: every
header carries a **Connect** chip. The bot is
[`@alpha_engine_nussif_bot`](https://t.me/alpha_engine_nussif_bot), and it is a companion, never
an auth provider: a binding runs **one way**, from a web identity to a Telegram read, and the
bot never authenticates the website.

**What the companion is, today.** 135 commands from one registry that also drives dispatch and
the `/` menu (README §6 and the live checklist are generated from it, and a test fails when
they drift); the command centre, the tab cards and the section cards carry **inline
keyboards**, so a read is a tap rather than a typed command, taps are authorised on the tapper
and never on the tapped message's author, and a refresh edits the card in place rather than
sending another; sixteen matplotlib chart
generators (series, bars, depth, drawdown, histogram, heatmap, equity, paired bars, gate
ladder, latency CDF, scatter, multi-series, VaR breach, pipeline, cone, status grid); and eight
tab commands — `/overview` … `/developer` — that mirror the desk's eight tabs with a chart
apiece. `/sli` and `/latency` quote the native core's nanosecond figure beside the decision's
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
browser — which is why the binding is not an authentication bypass. It cannot reach the five
controls. `/halt`, `/resume`, `/flatten`, `/reduceonly` and `/resetbook` answer to
`TELEGRAM_CONTROL_USER_IDS` and nothing else — a separate allow-list, **empty by default**,
changed only by someone with deploy access — plus a single-use typed confirmation code. A
connected chat that is not on that list gets a refusal naming the allow-list rather than a
silent no-op. `/flatten` is worth naming: it submits real closing `MARKET` orders through the
same pre-trade gates as any other order, so it is gated as a control, not as a read.

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
this order; the list doubles as a checklist for a manual tour:

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
    is **five**-armed: four always on — dense pgvector, Postgres FTS, Okapi BM25
    and the derived edge graph's own walk — plus the optional CLIP image arm
    over `image_embedding`, which runs only with `RESEARCH_IMAGE_MODEL_PATH`
    set and is the one arm that can *add* a document rather than only reorder.
    All five fuse by RRF at the same k=60, because an arm joining on a different
    constant is a second fusion wearing the first one's name. Then
    cross-encoder re-ranked when `RERANK_MODEL_PATH` is set, graded by
    the CRAG bands — all three of which now decide, so a middling result that
    its one rewrite does not rescue is refused rather than served — and, with a
    `GEMINI_API_KEY`, answered in prose that must cite the documents it was
    handed and quote their figures verbatim, or refuse. That answer route is
    rate- and spend-bounded, and its refusals are typed so "over budget" can
    never be read as "the corpus is silent". The derived edge graph is also
    projected into Neo4j (when configured) as a rebuildable read model, with a
    daily sweep writing back both the Louvain community labels and the PageRank
    scores; the two graph report routes read those back and fall back to the
    in-process computation, saying which answered.

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

*All eight slices of the UI overhaul are shipped — the audit they answer and the plan that
sequenced them are working notes kept outside this repository, and each rule they raised is
now a test rather than a paragraph. Their moments are woven into the tabs above: the Strategies
section and the gate-clear pulse on Research,
the order-gate cascade and tick flashes on Execution, drawing charts throughout, ⌘K fuzzy
search with recents, and View Transitions between tabs. The passes that followed — one type
scale, the moving desk, the decision chip and its three planes, the header's priority ladder
and larger type, the interactive Telegram companion — are recorded in the audit's closing table
(to 2026-08-17). This tour doubles as the acceptance script: walking it end to end — once with
motion on, once with the OS reduce-motion switch set, and once at ~1200px wide to watch the
header fold without clipping — is the manual verification pass.

That pass is not optional politeness, and one item on it is now load-bearing. The web suite has
no DOM and no layout engine: it reads source and stylesheet text, so it can prove a rule is
present and correct in the cascade and can prove nothing about where the pixels land
([`TESTING.md` §"No DOM, and therefore no layout"](../testing/TESTING.md)). Three surfaces
described above are argued rather than observed and want a human at ~1000px and ~1400px: the
blast-radius map and the eight-column mutation matrix on Reliability → Remediation → Mutations
(the matrix scrolls inside its own container, so the check is that the **page** does not scroll
sideways), and the two 64-character digest rows on Developer → API & Schema → Numerics.*
