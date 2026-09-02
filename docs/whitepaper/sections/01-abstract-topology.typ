// Chapter 1 — Executive abstract and system topology.
//
// This chapter carries the load-bearing claim of the whole document: that the
// system's discipline is arithmetic rather than assertion. Every quantitative
// statement below is either read off a named artefact in the tree or is marked
// illustrative. Where a figure appears in two places in the repository with two
// values, the generated artefact wins and the divergence is stated rather than
// quietly resolved — a whitepaper that silently picks the flattering number is
// exactly the defect this system is built to prevent.
//
// Sources read in full before writing: docs/architecture/ARCHITECTURE.md,
// docs/architecture/LATENCY_BUDGET.md, docs/architecture/DATA_OPS_BACKEND.md,
// docs/planning/PRD.md, Part2_Infrastructure/README.md (tech stack and unit
// sections), web/lib/test-counts.generated.ts, web/tests/fixtures/gate-parity.json,
// web/tests/gate-parity.test.ts, web/tests/parity.test.ts, web/tests/risk-parity.test.ts,
// modules/single_writer.py, modules/audit/store.py, modules/risk_proxy/rehydrate.py,
// modules/supabase_mirror.py, modules/research_stages.py, modules/research_rerank.py,
// modules/research_generate_vision.py, modules/tca_engine/{synthetic,supervision}.py,
// web/lib/{gateway,supabaseClient}.ts, web/lib/oracle/{client,health}.ts,
// oracle/{01_schema,02_monte_carlo}.sql, tools/{bench_decision,bench_rerank}.py.

// The template is imported here as well as in main.typ because `include`
// evaluates a file in its own scope: `measured`, `illustrative` and `note` are
// not inherited from the including document. This is an import of helpers only
// and sets no page, font or numbering — that stays template.typ's job.
// `illustrative` is deliberately NOT imported: every quantitative claim in
// this chapter is read from a named artefact in the tree, so there is nothing
// here to mark as not-a-measurement. If a later edit needs one, import it
// rather than dropping the marker.
#import "../template.typ": measured, note

= Executive abstract and system topology

== From market signal to governed decision

A trading desk is a machine for turning information into obligations. Market
data arrives as an unbounded, unordered, partially duplicated stream of
observations from venues that owe the desk nothing; what leaves is a set of
commitments that are legally and financially binding, and that a supervisor,
a regulator or an investor may later ask the desk to account for. Everything
between those two ends is the system. This document is about the argument that
the transformation is *governed*: that at each point where a number is produced
the number is reproducible, at each point where a number is missing the absence
is named, and at each point where the same arithmetic is written more than once
the copies are held to each other by a test rather than by a promise.

Stated as a pipeline, the desk is the composition

$ "tape" --> "consolidated book" --> "decision" --> "commitment" --> "ledger" --> "view" $

and the governance claim is a claim about each arrow. The first is a
deterministic fold of venue deltas into one price ladder. The second is a pure
function of that ladder, the held book, the configured limits and the kill
switch, evaluated under a single lock. The third is an append to a store from
which the second's inputs can be rebuilt. The fourth is a projection, and every
projection in this system is derived, droppable and re-creatable from the
ledger. The word doing the work is *pure*: everything that decides is a
function, everything that persists is append-only, and everything that is
neither is a view that may be thrown away without losing a fact.

The distinguishing property is not speed. The pre-trade decision measures
#measured[12.4 µs p50][latency-bench, native engine, dev Mac] against a
#measured[72.7 ms][`tools/colocation_probe.py`, 2026-08-17] round trip to the
venue that will actually match the order, so the compute is
#measured[0.02 %][`LATENCY_BUDGET.md` §2.3, against the ~68 ms one-way hop] of
the path and no further optimisation of it changes anything a trader can
observe. The system is fast because it is small and deterministic, not the
other way round; the speed is a consequence of the discipline, and the
discipline is the deliverable.

== What this system is, and what it refuses to be

AlphaEngine is three independently deployable units sharing one append-only
audit log: a stateful FastAPI *risk gateway* that owns everything which must
not be forked or forgotten, a serverless Next.js *desk workspace* whose eleven
tabs give eight desk roles one each and the quant engines three, and which
holds no backend credential in the browser bundle, and a stateless
*OpenBB research service* that can scale without touching risk
state. Around them sit six datastores of which exactly one is authoritative,
a Telegram companion inside the gateway process, and a research plane that
performs semantic recall over the desk's own output.

What it refuses to be is the more informative half of the description, because
each refusal is a capability that was available and was declined for a reason
recorded in the tree.

- *It refuses to route a real order.* Orders are paper, capped by the gateway's
  own gates. The venue adapters read; nothing writes. A system that claimed
  live routing on the strength of an untested code path would be asserting the
  one thing it cannot demonstrate.
- *It refuses to run more than one gateway process.* Not "has not yet scaled
  out" but refuses: a second worker forks the position book and localises the
  kill switch, and both the container contract test and a POSIX advisory lock
  on the state directory enforce it.
- *It refuses to coerce a null to zero.* A missing measurement renders as a
  dash and states why it is missing. `?? 0` on a nullable metric turns "we do
  not know" into "it is fine" and passes every type check on the way through.
- *It refuses to make an optional dependency load-bearing.* Every credential in
  the deployment is optional except the gateway's own auth token, and the whole
  test suite passes with an empty environment.
- *It refuses to depend on a package where the argument is the point.* The
  workspace ships on Next, React, `lucide-react`, `@supabase/supabase-js` and
  `oracledb` and nothing else; charts are hand-rolled SVG. A chart library would
  change what the project claims about itself.
- *It refuses to quote a benchmark it did not run.* Where the tree needs a
  number it does not have, the number is derived symbolically, marked
  illustrative, or absent with its reason.

#note[The rule this document is written under][
Every figure below is attributed to the artefact that produced it. Where two
places in the repository disagree, the generated artefact is quoted and the
disagreement is named. Two such disagreements are live as of this revision and
both are recorded in situ: the committed test counts against the prose copies
in `CLAUDE.md`, and the OpenAPI surface size in `README.md` against the
committed contract.
]

== The argument, in three properties

=== Determinism wherever a number is produced

Let $cal(O)$ be the space of order requests, $cal(B)$ the space of consolidated
books, $cal(P)$ the space of position books, $cal(L)$ the space of configured
limit sets and $cal(K)$ the space of control state (kill switch, symbol halts,
reduce-only override, duplicate-id set, rate-limit bucket, working-order book).
The pre-trade decision is a function

$ D : cal(O) times cal(B) times cal(P) times cal(L) times cal(K) times TT --> cal(V) $

where $TT$ is an explicitly injected clock and $cal(V)$ is the verdict space: an
accept-or-reject flag together with an ordered vector of check results, one per
gate that ran, each carrying the observed quantity, the limit it was compared
against and a rendered detail string. $D$ is pure. It reads no wall clock it was
not handed, opens no socket, and touches no store; the gateway's `submit()` is
$D$ composed with an append to the ledger and a non-blocking enqueue to a
mirror, and both of those are downstream of the verdict rather than inputs to
it.

Seventeen gates are defined and they run in a fixed order, which is itself part
of the cross-language contract:

```
kill_switch -> symbol_halt -> symbol_whitelist -> paper_execution_model
  -> reference_freshness -> duplicate_order -> rate_limit -> price_available
  -> order_sized -> max_order_notional -> symbol_concentration
  -> gross_exposure -> price_band -> working_book -> daily_drawdown
  -> reduce_only -> est_slippage
```

Fifteen of the seventeen are reachable by any single order on the crypto path;
the remaining two, `paper_execution_model` and `reference_freshness`, run only
for paper-equity orders, which are priced from a vendor quote rather than a
book. Order matters because a rejection cites the *first* gate that binds, and a
reordering would change which of two simultaneously breached limits is reported
as the cause. The order is asserted from both languages against one fixture
(`web/tests/gate-parity.test.ts` pins the gate names and their evaluation order
as a subsequence of the seventeen).

Determinism is what makes the audit log sufficient. Because $D$ is pure, the
tuple recorded at decision time is a complete description of the decision, and
replay is not a reconstruction but a re-evaluation. That is why startup
rehydration is defensible: a restarted process rebuilds the session baseline
from two numbers written at the boundary that produced them, then replays this
session's accepted fills, and refuses to start rather than begin on a fabricated
baseline if either read is unreadable or ambiguous.

=== Absence is a typed state, not an exception and not a zero

The second property is the one that shows up in every layer. For a measured
quantity of type $V$, the system does not use $V union {0}$ and does not use
$V union {"raise"}$. It uses

$ V^perp = V union {bot_r : r in R} $

where $R$ is a small, closed, enumerated set of reasons. The reason is carried
to the surface and rendered; the value is never invented. Concretely, the
gateway's boundary to Oracle types its failure as one of nine codes
(`oracle_not_configured`, `oracle_auth_failed`, `oracle_unreachable`,
`oracle_timeout`, `oracle_busy`, `oracle_schema_missing`,
`oracle_wallet_invalid`, `oracle_service_unknown`, `oracle_invalid_payload`),
and the workspace's boundary to the gateway types its own as one of seven
(`gateway_not_configured`, `gateway_misconfigured`, `gateway_auth_failed`,
`gateway_unreachable`, `gateway_timeout`, `gateway_rejected`,
`gateway_invalid_payload`). Neither ever renders as an empty array.

Three consequences follow, and each is enforced by a suite rather than by
convention.

*Not configured is not a fault.* The public deployment has no Oracle
credentials, and that state must never render as red. Distinguishing "no
credentials in this deployment" from "configured and did not answer" from
"answered, and found nothing" is the entire job of those boundary layers, and
collapsing the three into an empty result destroys the only information an
operator needs.

*A refusal is a result.* The research plane's `corpus_silent` verdict means the
corpus was searched and had nothing to say; it is a correct answer, not an
error, and it is distinct from `unavailable`, which means the corpus could not
be reached. "Could not search" and "found nothing" are different facts about the
world and the API keeps them apart.

*A zero vector is worse than no vector.* When the embedding function is
unreachable, an ingested document is stored with `embedding_status = 'pending'`
and no vector at all. The rejected alternative was a zero vector, which under
cosine similarity is equidistant from everything and therefore ranks as
plausibly similar to every query — an absence that has disguised itself as a
weak positive.

The same discipline governs statistics. Extrema and means over the audit log's
own backtest runs exclude NULL metrics *and report how many were excluded*, so a
mean over three of nine runs is not silently presented as a mean over nine. A
rank that a traversal never reached is `None`, never `0`, because zero would
sort ahead of first place.

=== The same arithmetic, implemented two and three times, held to a contract

Neither runtime in this system can call the other. The Telegram companion is a
Python process that cannot execute a browser bundle; the browser cannot reach
into the gateway's memory. So the risk arithmetic exists twice by necessity,
Python as the reference and TypeScript for the client, and the pre-trade
arithmetic exists a third time in C++ for speed. Two implementations of one
calculation is two chances to be wrong, and the characteristic failure is the
worst kind: a trader reads one value on a phone and a different one on a screen,
and neither is flagged as suspect.

The system answers this with two different relations held at two different
strengths, and the difference is deliberate.

*Bit-exactness*, for the pair that runs on the same machine over the same
IEEE-754 doubles. For the twenty-scenario fixture $S$, with $|S| = 20$ counted
from `web/tests/fixtures/gate-parity.json`:

$ forall s in S : quad "bits"_64 (D_"cpp" (s)) = "bits"_64 (D_"py" (s)) $

Equality of the 64-bit pattern is strictly stronger than `==` on doubles, since
it separates $-0.0$ from $+0.0$ and admits no NaN comparison. Holding it is not
free, and the costs are instructive. CPython's `sum()` performs Neumaier
compensated summation, so a plain C++ `+=` fold lands one unit in the last place
away and fails the fixture; the core reproduces each fold with the *matching*
algorithm, compensated where Python compensates and plain where an explicit loop
was written. Fused multiply-add contraction moved a result by one ULP even under
`-ffp-contract=off` until pinned with `\#pragma STDC FP_CONTRACT OFF`. And
Python's `list.sort` is stable and remains stable under `reverse=True`, so two
venues quoting the same price fill in feed-iteration order; getting that
tie-break backwards moves a blended VWAP by a ULP, which a randomised
differential test against the reference router catches because 106 of its 125
multi-venue cases diverge under the reversal.

*Tolerance*, for the pair that does not share a machine or a fold order. The
TypeScript side is an independent re-derivation for a different runtime, and the
contract there is

$ |x_"ts" - x_"py"| <= max(tau_"abs", tau_"rel" dot |x_"py"|) $

with the pair $(tau_"abs", tau_"rel")$ chosen per quantity rather than globally:
#measured[$10^(-9)$][`web/tests/parity.test.ts`] for exposure, turnover and win
rate; #measured[$(10^(-6), 10^(-9))$][same] for total return, CAGR, Sharpe,
Sortino, maximum drawdown and Calmar; #measured[$(10^(-6), 10^(-6))$][same] for
fees paid; and #measured[$10^(-3)$][`web/tests/risk-parity.test.ts`] absolute for
the Kupiec test statistic, whose inputs are counts.

The subtler contract is what the cross-language gate fixture asserts and what it
declines to assert. It pins gate *names* and *order*; it does not pin the
observed and limit numbers, because the browser sandbox has no ladder, reads its
caps off the book rather than off settings, and has no paper-equity or
per-venue routing. Those scenarios are structurally inexpressible on that side,
and asserting them anyway would be a looser test wearing a stricter name. The
gateway's own numbers are pinned in Python, where they are expressible. Naming
the boundary of a proof is part of the proof.

The practical effect is that a one-sided formula change is impossible to land
quietly: editing the arithmetic in either language turns the other language's
suite red, and the fixture must then be regenerated deliberately rather than
loosened.

== Global topology

Three deployment units, one shared ledger, and a strict rule that every arrow
into the ledger is a write and every arrow out of it is a view.

```
                     VENUES  --  keyless, public, no credential
                Binance L2 WebSocket            Bybit L2 WebSocket
                          |                             |
                          +--------------+--------------+
                                         |                   the browser takes
                                         v  depth deltas     the SAME feeds
 +=======================================================+   direct: 100 ms L2
 |  OCI VM, Singapore  --  always on                     |   snapshots, one hop,
 |                                                       |   no backend between
 |   Caddy sidecar :8443, pinned internal CA             |<-- Vercel, region sin1
 |        |                                              |   +-------------------
 |   +----v----------------------------------------+     |   | web/ desk workspace
 |   | RISK GATEWAY  --  FastAPI :8000             |     |   |   eleven tabs
 |   | ONE process, ONE worker, enforced 3 ways    |     |   | OpenBB_Service/
 |   |                                             |     |   |      stateless
 |   |  main.py     HTTP shell, middleware, routers|     |   +-------------------
 |   |  lifecycle   one owned application context |     |
 |   |  A  TCA      L2 ingest, book, VWAP, routing |     |
 |   |  B  Risk     17 gates, kill switch, breaker |     |
 |   |              + native core (C++), bit-exact |     |
 |   |  C  Backtest sweeps, DSR/PSR, walk-forward  |     |
 |   |  +  Telegram 138 commands, 6 gated controls |     |
 |   |  +  Research ingest, RRF fusion, CRAG, gen  |     |
 |   |  +  Mirror   bounded queue, counts its drops|     |
 |   +--------------------+------------------------+     |
 |                        | append-only                  |
 |         +--------------v--------------------+         |
 |         |  DuckDB AUDIT LOG, AUTHORITATIVE  |         |
 |         |  Docker volume, SQLite fallback   |         |
 |         +--------------+--------------------+         |
 |      [ DuckDB COHERENCE TAPE, DOMAIN RECORD ]         |
 +========================|==============================+
                          | best effort, bounded queue,
                          | NEVER on the order path
        +-----------------+------------------+
        v                                    v
 +--------------------------+   +-----------------------------+
 | Supabase Postgres        |   | data-ops store              |
 |  order_blotter  mirror   |   |  sqlite (default), or the   |
 |  desk_risk_limits        |   |  same Supabase over         |
 |  research_documents      |   |  PostgREST when selected    |
 |  pgvector 384-d, HNSW    |   +-----------------------------+
 +------------+-------------+
              |  6h reconcile sweep: projects only, never the reverse
              +---------------->  [ Neo4j Aura ]   OPTIONAL, rebuildable

  [ Oracle ADB ]   OPTIONAL, and no decision path reads it:
                   VECTOR(384) corpus + in-database GBM terminal VaR
```

Why three units and not one: the gateway needs a long-lived process because it
holds sockets and mutable risk state open; the workspace is serverless because a
research portal should scale to zero and be redeployed without touching risk
state; the OpenBB service is separate so that a slow upstream fetch can never
queue behind, or crash beside, the process deciding orders. A fourth tracked
application in the tree is experimental, deployed nowhere, and shares no code or
data with the three; it is named here so the tree and the documentation agree.

=== Unit 1: the risk gateway

A single Uvicorn process on an always-on virtual machine in Singapore. Region is
load-bearing rather than incidental: egress from the United States receives
HTTP 451 from one venue and 403 from the other, so the host's jurisdiction is a
functional requirement and not a latency preference. The process owns the venue
WebSocket subscriptions, the consolidated book, the paper position book, the
resting-order book, the token bucket, the kill switch, the seventeen gates and
the audit log. Its HTTP surface is a committed contract of
#measured[76 paths carrying 79 operations][`tools/openapi.json`, counted
2026-08-29] whose SHA-256 the workspace's build verifies before Next.js starts;
a mismatch fails the build with the reason inline. That is two separately
deployed units asserting their interface against each other before either ships.
The Telegram companion rides inside this process rather than forming a fourth
unit, with #measured[138 registered commands, 100 in the pushed menu and exactly
six gated controls][`modules/telegram/registry.py`, tabulated by
`tools/telegram_catalogue.py`, whose `--check` is green on this tree]; each
control requires membership of an allow-list separate from the read allow-list
and empty by default, so the
bootstrap fails closed and the bot cannot open a position.

Note how a divergence of this kind is resolved, because this document has
watched one close. The tech-stack table in the gateway's own README recorded 38
paths and 39 operations as of 2026-08-17, counted from the route decorators
declared in `main.py` at that date, while the committed contract already carried
more; the prose had drifted, which is precisely the failure mode that motivated
counting from the artefact in the first place. That table has since been
rewritten against the artefact and now states its basis, and gives the
route-decorator total separately as what it is --- a different count of a
different thing, since four decorators never reach the schema: the
`/ws/book/{symbol}` WebSocket, which OpenAPI does not describe, and three HTML
console routes marked `include_in_schema=False`. Two counts on two stated bases
is the resolution. One count with no basis was the defect.

=== Process composition and lifecycle ownership

`main.py` is now the HTTP composition shell rather than the owner of every
startup detail. `modules/application_lifecycle.py` builds one lifespan-owned
service graph under an `AsyncExitStack`, registers each cleanup before starting
the next component, and unwinds in reverse order. A partial startup therefore
cannot strand an acquired single-writer claim or a background task; cleanup
failures are isolated so one failed closer cannot prevent the remaining graph
from releasing.

The graph is published as an immutable `ApplicationContext` containing the
runtime, market-data and execution services, risk manager, jobs, audit service,
Telegram runtime, health service and latest-state book stream. The lifecycle
owns the separate coherence and data-operations stores without exposing either
as an alternate trading-state context.
Routes obtain that context and act as adapters over its service facades. They do
not instantiate shadow books or alternate gateways. The split is pinned by
`tests/test_application_lifecycle.py` for partial-start cleanup and by
`tests/test_application_runtime_contracts.py` for context immutability, service
delegation, route ownership, request-budget envelopes and the shared book topic.

=== Unit 2: the desk workspace

A Next.js application on serverless infrastructure in the same city as the
gateway, presenting eleven tabs. The first eight are the decision loop itself:
Overview, Research, Execution, Portfolio, Risk, Data, Reliability, Developer. The
last three are the quant-engine workbench: Markets for executable market
structure, Proofs for exact coherence and basket mathematics, and Diffusion for
event-response and absorption diagnostics. Their URL ids are `markets`,
`coherence` and `diffusion`; the first two predate their visible labels and stay
unchanged so published links continue to resolve. The eleven tabs carry
#measured[70 addressable rail sections][`web/lib/sections.ts`, counted
2026-09-02]. The three engines expose #measured[71 non-placeholder views - 26
Markets, 29 Proofs and 16 Diffusion][`web/lib/section-views.ts`, counted
2026-09-02]. Every view is URL-addressable under `#tab/section/view`; the
default view omits the third segment without losing its stable identity. The
navigation rail is pinned to the tour documentation by tests so the two cannot
drift apart silently. The browser bundle holds zero
backend credentials. The workspace contains #measured[65 same-origin API route
handlers, of which 44 import the gateway boundary][`web/app/api/**/route.ts`,
counted 2026-08-29]; the server-side proxy is the only path to
the gateway's address and token, and the one credential that *is* published to
the browser is an anonymous key whose scope is enforced in Postgres by row-level
security rather than by client-side filtering, because a client-side filter is a
suggestion and a policy is a boundary.

=== Unit 3: the OpenBB research service

A second serverless project with no Telegram lifecycle, no trading route, no
portfolio state, no database and no writable runtime dependency. Because it
holds nothing it scales horizontally without coordination, and because it is a
separate deployment its cold starts and upstream timeouts are structurally
incapable of reaching the process that decides orders. Its committed suite is
#measured[24 tests][`web/lib/test-counts.generated.ts`], which is small because
the unit is small; a stateless adapter that grew a large suite would be evidence
that it had stopped being stateless.

== The six datastores, and which one is authoritative

Exactly one store is authoritative, and the choice is unusual: it is the
embedded one.

#table(
  columns: (0.85fr, 1.08fr, 0.7fr, 1.42fr),
  [Store], [What it holds], [Status], [Why it sits there],
  [DuckDB audit log], [orders, risk events, backtest runs, equity snapshots, session rollovers], [*Authoritative*], [Embedded on purpose: the desk must keep deciding and recording when every network dependency is gone. Append-only by convention enforced in the module; nothing issues UPDATE or DELETE against orders or risk events.],
  [DuckDB coherence tape], [prediction-market quotes, episodes, outcomes and derived coherence history], [Domain record], [Separate from the decision ledger so research retention and query shape cannot widen the authoritative order-history boundary. It is owned by the gateway lifecycle and exposed through coherence services.],
  [Supabase Postgres], [`order_blotter` decision mirror, `desk_risk_limits`, `research_documents` under a 384-dimension pgvector HNSW cosine index], [Derived], [Durability and reach beyond one volume, plus the research corpus. Never a second decision-maker; the write path cannot block an order.],
  [Data-operations store], [data quality findings and escalations, schedule runs, work items], [Operational], [SQLite on the mounted volume by default, the same Supabase over PostgREST when selected. Selecting Postgres without credentials raises at startup rather than falling back, so a deployment can never report one backend and use another.],
  [Neo4j Aura], [community labels and centrality scores over the research corpus], [Optional projection], [Postgres owns the edges; the graph is MERGEd from that derived state on a sweep. A dual write was the rejected alternative because two systems that must agree drift undetectably.],
  [Oracle Autonomous DB], [`VECTOR(384, FLOAT32)` research corpus with an HNSW index, and an in-database terminal-value VaR under geometric Brownian motion], [Optional], [Demonstrates the arithmetic executing inside the database rather than beside it. Nothing is persisted per call: the simulated paths live in an inline view and vanish when the statement ends.],
)

Redis is an additional optional dependency and is deliberately not on this list,
because it is a broker and not a store: setting `REDIS_URL` switches the job
queue from an in-process pool to Celery with the *same task callables* either
way, and no fact lives only there.

The authoritative choice deserves its own defence. A managed Postgres would be
the conventional answer, and it is the one this system declines. The audit log
is the input to rehydration and the arbiter of what the desk believes it did; if
it lives across a network, then a network partition does not merely degrade the
desk, it removes the desk's memory of its own actions at exactly the moment when
that memory matters most. Placing it on a mounted volume beside the process
inverts the dependency: the managed store becomes the thing that may be absent,
and the embedded store becomes the thing that cannot be. Everything downstream,
the mirror, the corpus, the workspace blotter, is a view of decisions the log
has already recorded.

The fallback inside that store is itself a lesson the tree records. The audit
connection used to catch every exception from `duckdb.connect` and fall back to
SQLite at a different path, which is correct for one of the two things that
exception can mean and catastrophic for the other. If DuckDB is simply
unavailable on this platform, SQLite is exactly the right fallback and nothing
is lost but analytical SQL. If instead *another live process already holds this
database*, the same fallback opened a private ledger and began writing a
divergent history while the health endpoint reported the SQLite backend as
though somebody had chosen it. An append-only ledger silently forking in two is
the worst outcome this subsystem admits, and the bare exception handler was the
reason it was silent. The second case is now a raised conflict, never a
fallback.

== One process, no workers, and why the mutable book forces it

The single most consequential architectural constraint in the system is that the
gateway runs one process with one worker, and that this is enforced rather than
recommended.

The position book, the resting-order book, the token bucket and the kill switch
are plain objects on the heap, mutated under one `asyncio.Lock` and read on the
sub-millisecond order path. Suppose that constraint is violated and $N$
independent workers serve the same traffic, each holding its own copy of that
state. Four failures follow, and they are ordered by how much they cost.

The *kill switch becomes local*. A halt request lands on whichever process
served it; the remaining $N - 1$ keep accepting. The probability that a single
halt request reaches every worker is $N^(-1)$ under uniform load balancing, so
the halt is effective with probability $1/N$ and silently ineffective otherwise.
This is the failure that matters most, because the halt is the last line of
defence and the one an operator most believes in.

The *token bucket multiplies*. Each worker enforces its own rate $r$, so the
system emits at up to $N r$ against a venue that measured one desk. The bucket
exists specifically to keep the desk off an exchange's ban list, and sharding it
defeats it exactly.

The *limits become systematically permissive*. If the true gross exposure is $G$
and orders are distributed uniformly across workers, each worker evaluates its
concentration, gross-exposure and drawdown gates against an expected $G \/ N$.
The limits do not drift randomly; they are biased loose by a factor of $N$, and
loose in the direction that admits more risk.

The *audit log hides all three*, through precisely the silent-fallback path
described above.

Enforcement is layered, because the three ways to violate the rule are visible
at three different times. A contract test reads the committed container
definition and fails the build if `--workers` or a pre-forking server appears in
it. That catches the committed configuration and cannot catch anything typed at
a shell. So a POSIX advisory lock on one file in the state directory is taken
when the gateway starts and held for the life of the process, and a second
writer on the same state directory refuses to start and says why. And the audit
store's conflict detection sits behind both, because an audit log is opened by
several things that are not the gateway: the Telegram companion, the job runner,
the command-line tools and the tests.

What this explicitly does *not* claim is that the gateway is now
multi-process-safe. Nothing here shares a book. The boundary is exactly as true
as it was; what changed is the failure mode, from a shadow desk running quietly
to a refusal that names itself. Overstating that distinction would be worse than
not shipping the lock at all.

The storage half of the boundary is separable from the state half and has been
separated: moving the four data-operations tables to Postgres frees them from
one filesystem, so a redeploy reads the same rows. It does not make a second
gateway possible, and the documentation says so in the same paragraph that
describes the migration, because a reader who conflates the two will draw
exactly the wrong conclusion about scale-out.

== State synchronisation

Three mechanisms move state between the units, and each is constrained so that
it cannot become load-bearing for the order path.

=== Bounded queues that count what they drop

The decision mirror and the research corpus writer share one discipline. The
enqueue operation is non-blocking: it cannot block, cannot raise past its own
frame, and on a full queue it *counts the drop* rather than waiting. The queue
is bounded, at a default depth of
#measured[1000][`config.py`, `SUPABASE_MIRROR_QUEUE_MAX`]. A single drain task
batches and delivers, retrying with capped exponential backoff and then giving
up into a counter.

The invariant this maintains is a conservation law, and it is the reason the
mechanism is defensible at all. Writing $n_"enq"$ for decisions offered,
$n_"del"$ for rows confirmed, $n_"drop"$ for enqueue refusals on a full queue,
$n_"fail"$ for deliveries abandoned after the retry budget, and $q$ for current
queue depth:

$ n_"enq" = n_"del" + n_"drop" + n_"fail" + q $

Every term is published on the health endpoint. Loss is permitted; *unmeasured*
loss is not. A mirror that can slow an order down has become load-bearing, and
this one is structurally incapable of it, because the only operation the order
path performs against it is one that cannot wait.

The research writer reaches the same discipline from the other end and the gap
is recorded rather than smoothed over. Its queue always matched the mirror's,
but for a period only the queue did: the drain made one delivery attempt and
discarded, where the mirror retried three times with backoff. That asymmetry is
now closed with the mirror's own attempt count, curve and reason vocabulary,
with authentication failures held apart from rejections because an expired
service-role key is an operator's problem and a rejected row is a developer's. A
document that never lands goes to a bounded in-memory dead-letter book that
reports its depth, its recent entries, and what it discarded when full. That is
a diagnosis and explicitly not a durable replay queue; replaying a dead letter
remains the backfill tool's job, and calling the dead-letter book a replay queue
would be claiming durability the memory does not have.

=== The decision mirror

Every gateway decision streams into `public.order_blotter` with provenance, the
measured decision latency, and the full check vector: every gate that ran, out
of the seventeen defined. The mapping from gate name to the Postgres enum label
is an explicit dictionary asserted against *both* sides, the engine's own
emission sites and the committed enum, so a rename on either side becomes a red
test rather than a silently dropped mirror row. The mapping is the identity
today; the indirection exists for the day it is not.

=== The realtime tape

The workspace subscribes to new blotter rows through an anonymous client whose
scope is one thing: gateway-decided, unowned rows on the public demo desk,
enforced by Postgres policy. The tape is deliberately *not* an alternative data
path. The ledger stays authoritative, the workspace still polls it, and every
number the desk acts on comes from there; what the tape adds is new decisions
appearing as they land, which is the one thing a poll genuinely cannot do well.
A deployment without the two public variables loses the tape and nothing else.

The same restraint governs the server-sent stream between the workspace and the
gateway, whose transport is chapter 6's subject. The stream carries risk
*state* and a sequence number that moves only when the state actually changed;
the panels' numbers still come from the larger portfolio payload. Rebuilding the
panels on the stream's shape would give one set of figures two sources that can
disagree, which is what the reconciliation tests exist to prevent. A signal is
not a second copy of the data.

== Degraded operation and disaster recovery

This is the strongest single property of the deployment, and it is worth stating
precisely rather than as a slogan. The claim is *not* high availability in the
replicated sense; there is one gateway process and it is a single point of
failure for order decisions. The claim is that the set of things whose absence
stops the desk is very small, that every other absence produces a named,
reported state, and that the whole test suite passes with an empty environment.

Availability under this design does not compose multiplicatively. If the desk's
function were a series chain over $m$ dependencies, its availability would be
$A = product_(i=1)^m a_i$ and every added integration would reduce it. Here the
integrations are not in series with the decision path. Writing $F$ for the
decision function and $g_i$ for an optional dependency, the design property is

$ F(x; g_1, ..., g_m) = F(x; bot_(r_1), ..., bot_(r_m)) $

for the verdict component of the output, with the $g_i$ affecting only which
reasons are reported alongside it. The decision is invariant to the presence of
every optional dependency; only the *reporting* varies, and it varies in a
typed, enumerated way.

#table(
  columns: (0.5fr, 1.2fr, 1.3fr),
  [Absent], [What still works], [What is lost, and how it says so],
  [Supabase], [Everything on the order path. Decisions are made, gated and written to the authoritative ledger; the workspace's blotter reads the gateway.], [Mirror writes become no-ops with counted drops. Every research route returns a typed `unavailable`, never an empty list. The browser tape disappears. Data-operations state falls to the SQLite backend if it was not explicitly switched.],
  [Neo4j], [Everything, including request-time graph traversal, which runs as a recursive CTE in Postgres and never depended on the graph being up.], [The community and centrality reports fall back to the in-process computation and *mark which one answered*. The projection sweep reports a named reason rather than raising.],
  [Oracle], [Everything. The Oracle surface is a demonstration of in-database analytics, not a dependency of any decision.], [The readiness probe reports "not configured" as a first-class state that must never render as a fault, or "unavailable" if configured and unanswering, since an idle Always Free instance auto-stops and "did not answer" genuinely does not mean "broken".],
  [Model providers], [Everything. Retrieval, fusion, re-ranking and grading are all deterministic arithmetic over stored signals.], [Generation reports `verdict: refused` with its reason, and the spend bound goes inert by design, since refusing a free query because a paid one would be expensive is an outage rather than a bound.],
  [The re-ranker weights], [Retrieval at the caller's requested width, with the fusion order passing through untouched.], [`rerank_state` names the absence, and the grader's fifth signal is simply not read rather than being defaulted.],
  [The venue feeds], [The gateway, its gates, its ledger and its API. Price-dependent gates refuse on absent price rather than guessing.], [A watchdog classifies a venue as down, transitions an alert, and only then may substitute a synthetic book, which is gated behind an explicit environment flag and tags every downstream payload so nothing derived from it can be mistaken for market data.],
  [The gateway itself], [The workspace's keyless crypto surface: live order books straight from the venues to the browser, depth, TCA and a sandbox backtest.], [Every gateway-backed panel reports which of seven failure codes applies, and the three ways a gateway URL can be wrong are three distinct statements so that a typo is never reported as an outage.],
  [The network entirely], [The gateway decides, gates and records. The ledger is on a local volume; rehydration reads it.], [Every outbound integration reports its own absence. No decision is blocked and no figure is invented.],
)

Recovery has the same shape as the steady state, which is the point. On restart
the gateway reads two numbers written at the session boundary that produced them
(what closed sessions banked, and the equity this session opened on), then
replays this session's accepted fills from the ledger. Both reads are strict: an
unreadable or ambiguous record aborts construction rather than starting the desk
on a fabricated baseline. That strictness matters more than it looks, because
the naive version of the same fix merely relocated its discontinuity. A process
restarted after a session rollover republished an equity lower by the entire
banked carry, a step inside one session's equity curve with no order behind it
and nothing in the panel able to explain it, and re-anchored the drawdown
baseline to the configured starting balance, which after a losing session
quietly handed back drawdown budget the desk had already spent. Absence of a
rollover record is correctly *not* an error: a first-ever session has genuinely
banked nothing.

The projection is disposable by the same logic: if the graph is wrong the
response is to drop it and re-project, never to reconcile two writers.

== Units, responsibilities and failure modes

#table(
  columns: (0.7fr, 1fr, 0.8fr, 1.3fr),
  [Unit], [Owns], [Scaling], [Dominant failure mode and its containment],
  [Risk gateway (FastAPI, always-on VM)], [Venue subscriptions, consolidated book, position and resting books, seventeen gates, kill switch, token bucket, authoritative ledger, Telegram companion, research plane], [Vertical only. One process, no workers, enforced by container contract test and a `flock(2)` claim], [*Process loss stops order decisions.* Contained by: the ledger surviving on a mounted volume; strict rehydration on restart; a refusal-to-start on a second writer rather than a shadow desk. Not contained by replication, and this is stated rather than implied.],
  [Desk workspace (Next.js, serverless)], [Eleven tabs --- eight desk roles plus Markets, Proofs and Diffusion; 70 rail sections; 71 quant-engine views; server-side proxy, provider registry with quota budgeting and ranked failover, operator write path behind a token], [Horizontal, scale-to-zero. Holds no risk state], [*Upstream provider failure or a gateway outage.* Contained by: seven typed gateway failure codes that keep "not configured" apart from "unreachable"; keyless crypto surface that works with no gateway at all; per-provider circuit breaking.],
  [OpenBB service (FastAPI, serverless)], [Quotes, bars, company news, fundamentals through pinned fetchers], [Horizontal, unconstrained. No state, no database, no writable dependency], [*Cold start or slow upstream.* Contained by separation: it is a different deployment, so its latency cannot queue behind or crash beside the decision process. That separation is the entire reason it is a third unit.],
  [Shared ledger (DuckDB on a volume)], [Orders, risk events, backtest runs, equity snapshots, session rollovers], [Not scaled. Single writer by construction], [*Two writers forking the history.* Contained by raising a ledger conflict instead of falling back to a private SQLite file, behind the advisory lock, behind the container contract.],
)

== What is not built, and why each waits

Naming an absence costs nothing and buys the reader calibration on everything
else in the document. Six are load-bearing at this scale.

*Real order routing is not built.* Orders are paper, capped by the gateway's own
gates. Live routing would need venue credentials, a fills reconciliation path
and an operational risk posture that a case-study deployment cannot honestly
claim to have.

*Multimodal generation over chart images is not built.* The embedding runtime
available here exposes a text model and nothing in its inference interface takes
an image. The substitution that holds meanwhile is exact where a vision model
would be approximate: every figure a model would read off the pixels is a number
the desk computed in order to draw the chart, so the chart's meaning is rendered
as a sentence and the sentence is embedded. Where a vision path *does* exist it
carries its own wall-clock budget, set at
#measured[45 s][`modules/research_generate_vision.py`] against the text path's
20 s, from two live calls measured at
#measured[20,590 ms and 29,924 ms][same]. A ceiling set at the slowest observed
sample aborts roughly half the population by construction; 45 s is one and a
half times the slower measurement, and 30 s was rejected for sitting exactly on
the data.

*Row-level security on the research corpus is bypassed.* The gateway reads with
a service-role key and the writer sets no user identity, so the scope is
per-desk rather than per-user. What landed instead is an optional desk
predicate applied inside the candidate selection *before* either ranking is
taken, so a scoped rank is a rank among rows the caller was allowed to see
rather than a position among everybody. One shared gateway token means there is
no per-user identity to key on yet, and that is the blocker, not effort.

*Live emission of session execution summaries is not built.* The renderer, its
figures and its document are built and tested and a backfill tool calls them,
but nothing emits one in process, because that needs a hook at the
session-rollover site. On a running desk the summaries appear when the backfill
is run and not before.

*The re-ranker's weights do not run in continuous integration.* The suite is
network-free by construction and the model would have to be downloaded, so what
the pipeline proves is the wiring and the arithmetic around the model, exercised
through a fake cross-encoder at the import seam. It is not proof of the model.
The model's cost, measured directly, is what sets its concurrency limit: twenty
pairs of roughly 200-character rows took
#measured[197 ms of wall clock and 1,776 ms of CPU][`modules/research_rerank.py`,
18-core arm64 laptop] across roughly nine cores, and twenty pairs at the
2,000-character truncation ceiling took about #measured[1.5 s][same]. Running two
at once bought #measured[1.30 to 1.37 times the throughput for 1.46 to 1.54 times
the latency on every request][`modules/research_stages.py`], and four at once
reached only #measured[1.52 times][same]. Since this event loop also serves
pre-trade risk, whose budget is microseconds, the bulkhead is a semaphore of one.
Research may wait; that was always the premise, and this is the version of the
number that acts on it rather than asserting it.

*Multi-process scale-out is not built, and at this architecture it is not a
roadmap item.* Sharing a position book across processes requires either a shared
mutable store on the order path, which reintroduces the network into the
sub-millisecond section, or a partition of the book, which makes every
portfolio-level limit unenforceable. Both are real designs; both are a different
system.

== How the rest of this document is organised

The chapters that follow take these claims into depth from the direction of the
people who use them: the researcher and portfolio manager on whether a strategy
is evidence or a search artefact, the risk manager and trader on whether the
limits hold and what an order will cost, the data engineer, site-reliability
engineer and quantitative developer on trust in the data and safe change, then
the mathematics in full, then the infrastructure and the telemetry that measures
it.

Two artefacts in the tree carry the numbers this chapter has summarised and
should be read against it: the latency budget, which defends every timing figure
with its method and machine and refuses to merge two machines into one
flattering number, and the committed test counts, generated because the prose
copies had drifted three times before the generator existed. As of this revision
those counts read
#measured[3,496 gateway tests - 3,495 passed and one skipped][`web/lib/test-counts.generated.ts`,
generated 2026-09-02],
#measured[6,846 web tests across 1,461 suites][same] and
#measured[24 service tests][same]. A skip count is
not evidence about its cause; that belongs to the runner output that produced
the dated record. The generated file is therefore the display contract for the
totals, while a fresh suite run remains the authority for a new measurement.
