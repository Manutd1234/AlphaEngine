// The template's helpers (#measured, #illustrative, #note) are module-scoped:
// `include` evaluates this file as its own module, so main.typ's import does
// NOT reach here. Importing the template is a scope fix, not layout — this file
// still sets no page, font or numbering.
#import "../template.typ": illustrative, measured, note

// Chapter 4 — the data engineer, the reliability engineer and the quant
// developer. Content only; layout is template.typ's job.
//
// Every quantitative claim below is either read from a named file in the tree
// or wrapped in #illustrative. Where the tree has no measurement, the text says
// so rather than supplying a plausible one.

= Data, reliability and the developer plane

Three roles share one property the preceding chapters did not need: they are
answerable for the system when it is *wrong*. A data engineer owns the claim
that the number on the screen came from somewhere; a reliability engineer owns
the claim that the system said so at the time; a quant developer owns the claim
that two independently deployed units, written in two languages, agree about
what the number is. This chapter is the machinery behind those three claims. It
is deliberately specific about thresholds --- a staleness rule with no number in
it is a sentiment, not a control --- and equally specific about where each is
set, because a constant nobody can find is a constant nobody can change.

== Part A. The data engineer

=== What "stale" means, and where it is set

The system holds two independent staleness thresholds because it has two
independent ingest paths for the same L2 data, and merging them would be a lie
about topology: the gateway subscribes to venue WebSockets in a long-lived
Python process, and the browser subscribes to the *same venues directly*, one
hop, so the order book on screen is not a relay of a relay.

#table(
  columns: (auto, auto, auto, auto),
  [Plane], [Constant], [Default], [Where it is set],
  [Gateway feed], [`VENUE_STALE_AFTER_S`], [10.0 s], [`config.py:110`],
  [Browser ladder], [`STALE_AFTER_MS`], [8 000 ms], [`web/lib/livebook-socket.ts`],
  [Ops snapshot], [`SNAPSHOT_STALE_AFTER_SECONDS`], [65.0 s], [`modules/operations.py`],
  [Provider health], [`PROVIDER_HEALTH_STALE_AFTER_MS`], [60 000 ms], [`web/lib/reliability.ts`],
  [Shared ops overlay], [`SHARED_STALE_MS`], [90 000 ms], [`web/lib/observability/ops-ledger.ts`],
  [Vendor quote contract], [`FRESHNESS_LIMIT_MS`], [24 h], [`web/lib/providers/contracts/shared.ts`],
)

The gateway's rule is one line of `BookState`: a book is stale when
`age_s > settings.venue_stale_after_s`, where `age_s` is
$t_"now" - t_"last update"$ in wall-clock seconds and is $+infinity$ for a book
that has never updated. Formally, for venue $v$ and symbol $s$,

$ "stale"(v, s, t) = [ t - tau_(v,s) > Theta ], quad Theta = 10 "s", quad tau_(v,s) = -infinity "until the first update" $

That threshold is not decoration. It is read by the `reference_freshness`
pre-trade gate on the paper-equity path, and `tests/test_tca_patch_points.py`
exists to prove the gate reads `settings.venue_stale_after_s` rather than a copy
of it; it is also carried on every parity scenario (`LIMIT_FIELDS` in
`tools/gate_fixture.py`), so changing the default cannot silently change what
the fixture pins. The 65-second snapshot budget is derived rather than chosen:
the web tier polls every 30 s, so two missed polls plus a scheduling margin is
the point past which a last-good observation stops being evidence --- and the
source states that derivation, which is the difference between a tunable and a
magic number.

=== Hysteresis, and why the rule is asymmetric

A single threshold applied to a feed updating at roughly that threshold is an
oscillator. The browser's venue-status strip demonstrated it: the predicate was
recomputed on every 5 Hz publish tick and any arriving frame set the status
straight back to live, so a thin instrument in a quiet hour flipped between
`live` and `stale` several times a minute. That is not a badge problem ---
`useLiveBook` merges only the venues it currently calls live, so the
consolidated book that prices an order gained and lost a side of liquidity on
the same flip. A twitching badge and a twitching price are the same defect seen
twice.

`VenueLiveness` (`web/lib/venue-liveness.ts`) makes the rule asymmetric. Let
$u(t)$ be the count of parsed books received, $tau$ the arrival time of the
last, and $m$ the value of $u$ at the moment the venue was last marked stale
($m = "nil"$ when it is not). With $Theta = 8000$ ms and promotion streak
$k = 2$:

$ "status"(t) = cases(
  "stale" & "if" t - tau > Theta,
  "live" & "if" t - tau <= Theta "and" m = "nil",
  "live" & "if" t - tau <= Theta "and" u - m >= k,
  "stale" & "otherwise"
) $

Demotion is immediate because silence past the threshold means the book on
screen is not the book at the venue, and a stale ladder must not price an
order. Promotion requires $k$ further updates because one straggling frame is
precisely what caused the flip. A feed genuinely updating at the threshold
therefore settles on `stale` --- which is the honest reading of a venue you hear
from every eight seconds --- rather than alternating. The value
#measured[$k = 2$][`web/lib/venue-liveness.ts`, `PROMOTION_UPDATES`] is the
smallest number that cannot be satisfied by the single late frame, matching
`PROMOTION_STREAK` in `desk-source.ts` for the same reason.

Two subtleties survive review if got wrong. The stale mark is armed inside
`update()` --- when a book *arrives* and closes a gap --- not only inside the
status read: arming it on observation alone would make the hysteresis depend on
somebody having looked during the quiet period, and the only caller is a
`setInterval`, which browsers throttle to roughly once a minute in a background
tab. Reading the inter-arrival time at the arrival site makes the decision a
property of the data rather than of the observation schedule. The mark is also
re-armed on every silent tick rather than only when unset: a venue that goes
silent, sends one frame and goes silent again would otherwise keep the mark from
the *first* silence, and the second frame would satisfy a streak that was never
about it.

Venue liveness is then lifted to feed health in the gateway
(`modules/tca_engine/supervision.py`), where the classification is over the set
of symbols a venue is carrying:

#table(
  columns: (auto, 1fr),
  [Status], [Condition],
  [`down`], [not connected, or connected and publishing no book at all],
  [`stale`], [every book with data is stale],
  [`degraded`], [some but not all books are stale],
  [`up`], [no book is stale],
)

and lifted once more to the platform level in `modules/operations.py`, where
`market_data.status` becomes `critical` when no real feed is usable,
`degraded` when a synthetic feed is active or any real feed is not `up`, and
`disabled` when market data is switched off entirely. Four states, each with a
named reason, and none of them is an exception or an empty list.

=== The provider registry, ranking and the failover chain

The research and reference-data path is a different problem from the venue
feeds: #measured[eight vendor adapters][`web/lib/providers/adapters.ts`,
`ADAPTERS`], six of which need an environment value and two of which are keyless
public APIs, with different licences, quotas and asset coverage.
`web/lib/providers/` is the façade over them. Routes call `getQuote("AAPL")`;
they do not name a vendor, do not learn
which one answered, and do not change when a key is added or a provider fails.

Selection is by capability and asset class: `candidatesFor` filters the roster
to adapters declaring that capability for that asset class and sorts by
`meta.rank[capability]`, absent ranks last at 99. The result is a chain, and
`dispatch` walks it, adding the *reliability policy* whose order is
load-bearing:

+ *Simulated outage* --- an operator knocked this provider out on purpose. Checked
  first so the reason shown is the one the operator caused; a deliberately
  disabled provider reporting "quota spent" sends someone hunting a problem
  that does not exist.
+ *Not configured* --- no credential. An empty `keyEnv` declares a keyless public
  API, which is why a fresh clone with no secrets is still a working system.
+ *Circuit open* --- recent consecutive failures; see *Circuit breakers* below.
+ *Unlicensed* --- a capability-scoped refusal remembered from a previous 4xx, so
  the next dispatch skips without a call.
+ *Quota* --- exhausted, or reserved against background traffic; see *The quota ledger* below.

Only then is a call made. Every refusal is pushed onto an `attempts` list that
travels with the answer rather than being logged and dropped, because a failover
the reader cannot see is a failover they will trust wrongly.

The error taxonomy on the way back out is equally deliberate. A thrown
`ProviderError` carries a kind, and each kind has a different cost to the
vendor's record:

#table(
  columns: (auto, auto, auto, 1fr),
  [Kind], [Latency sample], [Breaker], [Meaning],
  [`failed`], [recorded, not ok], [counts], [the vendor broke],
  [`no_data`], [recorded, ok], [no], [the vendor correctly answered that there is nothing here],
  [`unlicensed`], [none], [no], [a refusal, not an answer],
  [`quota`], [none], [no], [a decline],
)

Before this distinction existed, four "no profile for this symbol" answers made
four healthy vendors read as degraded. The same distinction decides the status
code when the whole chain is exhausted: if every provider that was actually
asked answered `no_data`, the request is a 404 --- the pool is healthy and the
symbol is the problem --- and anything else keeps the 503, because then a retry
or a different key could change the answer.

A contract failure is treated exactly as a thrown error: the provider is
failed, the breaker counts it, the chain moves on. The ordering inside the `try`
block is the kind of bug that leaves no trace, so it is written down:
`recordSuccess` *deletes* the breaker's failure count, so evaluating the
contract after it would clear the counter on every broken response and the
breaker could never trip. A vendor emitting duplicated bar timestamps would be
retried forever, burning quota, while the health matrix showed a zero per cent
error rate.

Caching sits under all of it, a quota defence first and a latency optimisation
second, with a TTL per capability because a fundamentals record is good for a
day and a quote for seconds:

#table(
  columns: (auto, auto, auto, auto, auto, auto),
  [quote], [bars], [news], [fundamentals], [search], [scrape],
  [15 s], [5 min], [3 min], [24 h], [15 min], [1 h],
)

read from `TTL_MS` in `web/lib/providers/dispatch.ts`.

=== The quota ledger

Alpha Vantage's free plan is twenty-five calls per *day*; Firecrawl's is a
thousand credits per *month*. Nothing about a naive integration warns you before
a dashboard that auto-refreshes spends a day's allowance before lunch. The
ledger counts calls *before* they are made, and fences background traffic out of
a reserve.

For an adapter with limit $L$, reserve fraction $rho$ and observed spend $U$ in
the current window, define $R = L - U$ and the reserve $ R_0 = ceil(rho L) $.
A request of priority $p$ is admissible exactly when

$ "admit"(p) = (R > 0) and (p = "interactive" or R > R_0) $

so background polling stops early and a human lookup at four in the afternoon
still has budget. Windows are *calendar-aligned*, not rolling: vendors reset on
calendar boundaries, and a rolling window would let the ledger believe it had
budget on the first of the month that the vendor had already reset --- and
vice versa. The month key uses UTC, whereas most vendors reset on the account's
signup anniversary; that makes the count conservative near a boundary, which is
the direction that fails safely.

Three properties were decisions against an obvious alternative.
*Spend is counted before the call, not after*, because a request that times out
still hit the vendor's meter, and counting only successes under-counts exactly
when the system is failing most. *The merged total replaces the local count
rather than taking the maximum*: each serverless instance holds its own counter
and the gateway merges them through the ops-sync round trip, so replacement is
what lets an operator's reset propagate instead of every instance re-asserting a
stale high-water mark --- spends between push and response are under-counted
until the next sync, which is convergence rather than a race worth a lock. And
*threshold warnings fire on the crossing, not on the condition*: comparing the
count before and after each spend fires each of the three lines
(#measured[0.5, 0.8, 0.95][`web/lib/providers/quota.ts`, `QUOTA_THRESHOLDS`])
exactly once per window, because a log repeating "above 80%" twenty times is a
log nobody reads.

The operator reset is honest about its limits: it zeroes *this ledger*, not the
vendor's meter. It exists because the ledger is a floor derived from one
instance's memory and can be badly pessimistic after a deploy --- so the person
pressing it needs to know they may be about to spend a real allowance.

=== Lineage, from vendor bytes to rendered number

`GET /api/system/inspect` answers a different question from `GET /api/quote`.
The latter says what the price is; the former says how that number got here. It
returns a seven-stage lineage, and it returns it *even when the lookup failed*
--- HTTP 200 with `ok: false` and the full attempt list, because the trace is
the product and a 503 would throw away the answer the caller came for.

#figure(
  ```
  Request           quote for BTCUSDT, classified as crypto, priority interactive
     |
  Registry          4 candidates ranked for a crypto quote      [bybit, binance, fmp, ...]
     |
  Cache             miss on quote:BTCUSDT                       (hit => no provider contacted)
     |
  Reliability       alphavantage: quota_reserved; fmp: circuit_open
     |
  Upstream          1 HTTP call, 0 failed                       (raw=1 retains the body)
     |
  Adapter           Bybit answered in 11 ms
     |
  Normalised        coerced to the shared quote shape;
                    provenance attached, NOT folded into the data
  ```,
  caption: [The seven lineage stages assembled by
  `web/app/api/system/inspect/route.ts`. The stage names and their order are read
  from that file; the values shown against them are #illustrative[an example
  trace], not a captured run.],
)

Two flags change behaviour rather than presentation. `refresh=1` evicts the
cache entry first, because a debugger a cached value can satisfy is not
debugging anything. `raw=1` retains the vendor's own JSON before normalisation
--- the difference between "the change field is null" and "the vendor renamed
the change field and our parser silently coerced it".

Holding raw bodies safely is the interesting engineering. Two
`AsyncLocalStorage` scopes exist: `trace.ts` for the opt-in inspector capture,
and `raw-sink.ts` for the *always-on* raw-contract sink, because a contract
check nobody switched on is not a check. Both refuse a module-level "current
capture" variable --- a route handler serves concurrent requests, and a bare
global would attribute one provider's malformed payload to another provider's
quarantine sample, a bug that appears only under concurrency, which is exactly
when nobody is looking.

Redaction is by environment-variable *name* pattern
(`/(_API_KEY|_APIKEY|_KEY|_TOKEN|_SECRET|_PASSWORD|_PWD)$/i`, with an allow-list
for public identifiers) rather than a hand-maintained list of secrets, whose
failure mode is a credential in a screenshot: two vendors carry the key in the
query string and answer an authentication failure with an HTML page echoing the
request URL, which the error path would otherwise quote into a public response.

=== L2 reconstruction and sequence-gap detection

The two venues are consumed under two different disciplines, and the choice is
made per venue by what the venue's protocol can prove.

*Binance* is consumed as `<symbol>@depth20@100ms`
(`modules/tca_engine/binance.py`, `web/lib/livebook-socket.ts`) --- a
self-contained top-20 snapshot every 100 ms. The diff stream would need a REST snapshot plus
buffered-delta reconciliation, and it silently corrupts the book if a single
message is dropped. The partial stream self-heals; the next frame is a complete
book.

*Bybit* is consumed as `orderbook.50` (`modules/tca_engine/bybit.py`) snapshot
plus deltas, because it is
sequence-tagged and a dropped frame is *detectable*. Detecting it is the whole
reason the incremental path is safe here.

The ladder is a price $arrow.r$ size map per side, and the delta semantics are
the reason deltas cannot be skipped: a level is removed by a delta carrying size
zero. Writing $B_t$ for the bid map at time $t$ and $delta$ for an arriving
delta,

$ B_(t+1) = { (p, q) : (p, q) in B_t, p in.not "dom"(delta) } union { (p, q) in delta : q > 0 } $

Now the gap test. Bybit increments `u` by exactly one per delta, so the correct
predicate is

$ "gap"(u_"prev", u_"new") = (u_"prev" != 0) and (u_"new" != 0) and (u_"new" != u_"prev" + 1) $

The obvious-looking test $u_"new" < u_"prev"$ catches only a *backward* jump,
which ordered TCP delivery makes impossible --- the repository's note records
that it never fired once in roughly ten thousand live messages, while a genuine
forward gap sailed straight through into `apply()`. The consequence of applying
a book with a hole is specific: deltas are the only source of level *removals*,
so one dropped frame leaves a filled bid in the ladder forever, sitting above
the true ask. That is a permanently crossed book, and the UI reports it as a
cross-venue arbitrage that does not exist.

Both zero-guards matter: a fresh subscription with no baseline, and a venue that
omitted the field, must not be treated as gaps. On a real gap the gateway raises
out of the read loop (`RuntimeError: bybit sequence gap on SYM: prev -> new`),
which the supervisor turns into a reconnect and a fresh snapshot; the browser
closes the socket for the same effect. Neither trusts a holed book.

Reconnection is exponential with jitter. With base $d_0$ and ceiling $D$:

$ d_(n+1) = min(2 d_n, D), quad "wait"_n tilde d_n + "U"(0, 0.3 d_n) $

with #measured[$d_0 = 1$ s, $D = 30$ s][`config.py`, `WS_RECONNECT_BASE_S` /
`WS_RECONNECT_MAX_S`] in the gateway and
#measured[$D = 20$ s][`web/lib/livebook-socket.ts`, `MAX_BACKOFF_MS`] in the
browser. The browser
adds one rule the gateway does not need: the backoff resets only once a socket
has *proven stable* for ten seconds, not on handshake. Resetting on handshake
defeats the ceiling on an accept-then-drop path --- a proxy or a flapping venue
completes the upgrade, drops, and every retry starts from one second again. The
source records #measured[54 reconnects in 60 s][`web/lib/livebook-socket.ts`]
before that change.

An operator-forced restart is a distinct path from a failure reconnect, and
every line of it repairs something the naive `ws.close(); open()` gets wrong:
the pending retry timer is cleared (or two live sockets write into one ladder),
handlers are detached before `close()` (or the dying socket's `onclose`
schedules a third), the backoff resets (a reconnect somebody asked for is not
evidence of instability), `seq` resets to zero (carrying the old session's
sequence into a new one fails the gap test on the first delta and looks exactly
like a venue outage in a reconnect loop), and the ladder is emptied ---
republishing the pre-restart book would be a stale price wearing a fresh
timestamp. The venue drops out of the merged book until its next snapshot, and
that gap is honest.

Inside the gateway the same ladders are mirrored into the C++ core. The mirror
is refreshed in the two mutation funnels rather than maintained as a delta, so
"the mirror is never stale" is a property of `BookState` rather than a rule
every caller must remember. That funnel was measured and optimised: rebuilding
the ladder mirror by sort-and-dedupe over a reused buffer instead of a hash map
took `apply_snapshot` from
#measured[8.06 to 6.65 µs p50][`docs/architecture/LATENCY_BUDGET.md` §2.1] and
`apply_delta` from
#measured[5.06 to 3.40 µs p50][`docs/architecture/LATENCY_BUDGET.md` §2.1],
two rounds each, alternating builds at identical flags. The feed updates roughly
sixty times a second per book while decisions are per order, so this is the
right side of the boundary to spend on.

=== Schema validation and the quality ledger

Adapters already throw when a *primary* field is missing: a quote with no price
fails loudly and the chain fails over. That covers the loud case. It does not
cover the quiet one, which is the one that costs money --- a bar series with a
duplicated timestamp, a high below its low, a "live" quote stamped four days
ago, a change field that silently became null when the vendor renamed it. Every
one of those parses, validates, renders, and is wrong.

The contract suite (`web/lib/providers/contracts/`) evaluates expectations after
normalisation and before anything is cached or shown, under three rules:

+ *Violations are attached, not thrown.* A stale timestamp does not justify
  discarding a price a trader can see is stale; it justifies saying so. Only
  `fatal` rejects, and `fatal` is reserved for data that is internally
  impossible.
+ *A check that cannot run is not a check that passed.* A provider that
  publishes no timestamp cannot fail a freshness check, and pretending it
  passed would make the least transparent vendor look like the most reliable.
  Such checks are listed in `notEvaluated`, which is carried on the wire and
  rendered, never folded into the pass count.
+ *Drift is reported separately from failure.* When a secondary field coerces to
  null while the rest of the payload is intact, the likely cause is a renamed
  vendor field, not a bad market.

#table(
  columns: (auto, auto, 1fr),
  [Check], [Severity], [Why],
  [`bars.prices_finite`], [fatal], [a null or non-positive price is not a bar],
  [`bars.high_ge_low`], [fatal], [not a market condition, a broken record],
  [`bars.unique_timestamps`], [fatal], [a duplicated timestamp double-counts a return and understates volatility],
  [`bars.monotonic`], [fatal], [out-of-order bars backtest history backwards],
  [`bars.no_gaps`], [warn], [irregular spacing points at a hole a strategy trades through],
  [`quote.price_positive`], [fatal], [a quote with no positive price is not a quote],
  [`quote.freshness`], [warn], [older than 24 h; `not_from_the_future` warns above 60 s ahead],
  [`quote.change_derivable`], [drift], [null beside a present previous close],
)

The gap check shows a threshold that had to be *measured* rather than reasoned.
It compares the largest inter-bar interval to the median, not a count of gaps,
because a count cannot separate a weekend from a hole. The original 3x fired on
every US equity daily series the application can load ---
#measured[AAPL's largest gap is exactly 4.0x the median][`web/lib/providers/contracts/bars.ts`,
recorded in the check's own comment], because a holiday Monday makes a four-day
weekend and there are roughly nine a year. It is now
#measured[4.5x][`web/lib/providers/contracts/bars.ts`, `MAX_GAP_MULTIPLE`],
which keeps every routine exchange holiday and still catches a genuine hole ---
a full missing week. A check that warns on every complete series is one a reader
learns to scroll past, which costs more than the hole it was written to catch.

Flagged payloads go to a bounded quarantine ring ---
#measured[50 records][`web/lib/providers/quarantine.ts`, `CAPACITY`] of
#measured[400 characters][`web/lib/providers/quarantine.ts`, `SAMPLE_CHARS`]
each, redacted. It is a diagnostic buffer and not a data lake --- an unbounded
list in a long-lived process is a memory leak wearing an audit trail's clothes
--- and *a quarantined answer is never cached*, so the failover chain gets a
chance at a cleaner source. The sample held is the *raw* body, not the
normalised object, which is what the `raw-sink` scope exists to make possible.

Per-instance evidence is not enough: each serverless instance kept its findings
in a per-lambda ring, so two polls landing on two instances described two
different worlds and a restart forgot everything. Findings are now pushed
through the ops-sync round trip the instance already makes and persisted in the
gateway's durable quality ledger --- four tables, `data_quality_findings`,
`data_quality_escalations`, `data_schedule_runs` and `data_work_items`. Ingest
de-duplicates on `(instance, seq)` and refuses both the stale and the future: a
finding outside $[t - "retention", t + "slack"]$ is a replay or a broken clock.
Two rules then run on the window, per provider:

$ "fatal burst": quad F_"fatal" >= 3 quad "over a" 15 "min window" $
$ "fail rate": quad N >= 8 quad "and" quad F/N > 0.25 $

with all five constants read from `config.py` (`DATA_QUALITY_ESCALATE_*`) and
default retention of seven days. One escalation per `(rule, provider)` per
#measured[60 min cooldown][`config.py`, `DATA_QUALITY_ESCALATE_COOLDOWN_MINUTES`].
An escalation *auto-resolves when the condition clears* --- it is not
acknowledged away. Acknowledging is recorded and resolves nothing, which is the
correct relationship between a human's attention and a machine's evidence.

Resolution carries a subtlety with an operational cost. `_resolve_cleared`
originally ran only inside `ingest`, so an escalation cleared when the *same
provider* sent more findings --- and a provider that stops reporting entirely,
which is what a badly broken one does, left its escalation open forever while
the cooldown stopped a new one opening. The desk showed a permanent red against
a condition that had ended. `resolve_loop` is the repair: an independent sweep,
by default every sixty seconds, over a table holding at most a handful of open
rows, doing nothing when there are none.

The backend is selected by `DATA_OPS_BACKEND`. Choosing `postgres` without
credentials *raises at startup* rather than falling back, and an unknown value
is refused for the same reason: a fall-back would leave a deployment reporting
one backend and using another while the wire said `sqlite`. The aggregate read
path is pinned across both --- `_AGGREGATE` in Python and the
`data_quality_rollup` view in SQL are asserted to produce the same six figures,
because if one moves without the other both answer, neither errors, and they
disagree.

=== Absence as a typed state

The rule that null is never coerced to zero appears three times in the data
plane, each a different shape of one idea. *A check that could not run* is
`notEvaluated`, counted and rendered apart from `passed`; with zero evaluated
payloads the trust verdict is "Not yet proven --- zero evidence is not a clean
bill of health", not green. *A document with no embedding* is
`embedding_status = "pending"`, counted as `pending_embeddings` beside
`indexed`, rather than written as an indexed document with a zero vector --- a
zero vector is a *point in the space* and would answer similarity queries.

*A document that could not be delivered* is counted *and kept*. A counter alone
said that some documents had been lost and never which ones, so there was
nothing to replay and no way to tell a rejected schema from an unreachable
corpus. The dead-letter store publishes its depth, its discard count and a
recent sample, because an operator needs to know there is something to replay
before they can decide to.

== Part B. The reliability engineer

=== Telemetry and the p99 tail

Two latency windows exist, deliberately not one, because they measure different
things on different machines.

#table(
  columns: (auto, auto, auto, auto),
  [Window], [Capacity], [Time bound], [Key space],
  [Gateway HTTP], [200 per route], [900 s], [60 routes, then `unmatched`],
  [Web upstream], [120 per key], [15 min], [per provider],
)

read from `modules/metrics/request_latency.py` and
`web/lib/observability/latency.ts` respectively.

Both bounds are load-bearing on the gateway side. Without the time bound a
single slow request during a cold start pins p99 for days on a quiet desk, and
the alert that fires on it sends an operator hunting a problem that ended long
ago. Without the route bound, an internet scanner hitting a few thousand
distinct 404 paths adds a permanent series each --- and `/metrics` is
unauthenticated, so that budget is attacker-controlled. Unmatched paths are
*aggregated* rather than dropped, because losing the fact that requests happened
is worse than losing which path they were for. The `/metrics` route itself is
excluded, so a scrape cannot perturb what it measures.

Quantiles are nearest-rank, in all three implementations:

$ q_p = x_((i)), quad i = min(n, max(1, ceil(p n))) $

over the sorted sample. Not linear interpolation: with $n$ in the tens,
interpolation invents a value no call actually took, whereas nearest rank always
returns a latency some request genuinely experienced --- a number an operator
can go and find in the log. The Python implementation carries a scar worth
repeating: an earlier `round(q*n + 0.5) - 1` looked equivalent to
$ceil(q n) - 1$ and was not, because Python rounds halves to even, so an exact
$q n$ returned the next index and p99 collapsed onto the maximum for any window
under a hundred samples.

The tail is also governed by sample floors, which is the discipline that keeps a
percentile from being theatre. A p99 is withheld below
#measured[20 samples][`web/lib/overview-latency.ts`, `LATENCY_MIN_SAMPLES`] and
a p99.9 below
#measured[1 000 samples][`web/lib/decision-plane.ts`, `DECISION_P999_MIN_SAMPLES`]
--- $ceil(0.999 times 1000) = 999$, so below a thousand the p99.9 is the maximum
wearing a decimal point. In both cases the surface renders a dash with its
reason ("collecting, n=7 of 20"), never a number and never a zero.

The measured figures the desk quotes against these floors are in
`docs/architecture/LATENCY_BUDGET.md`, and the discipline is that three planes
are never blended:

#table(
  columns: (0.72fr, 2.28fr),
  [Plane], [Measured figure and source],
  [Whole decision, µs], [#measured[12.4 µs p50 native, 23.1 µs Python][`LATENCY_BUDGET.md` §2.1].
    `tools/bench_decision.py`, dev Mac, `submit()` under the lock.],
  [Arithmetic core, ns], [#measured[83 ns p50, 84 ns p99][`latency-bench.generated.json`].
    `steady_clock` inside the C++ engine, same run.],
  [Same core, production], [#measured[320 ns p50, 352 ns p99][`LATENCY_BUDGET.md` §2.1].
    Live `/metrics`, OCI `VM.Standard3.Flex`, observed 2026-08-17.],
  [Order entry, ms], [#measured[72.7 ms origin RTT to Binance, 6.2 ms to Bybit][`LATENCY_BUDGET.md` §2.3].
    `tools/colocation_probe.py`.],
)

The nanosecond row carries a caveat the desk is required to repeat: on that
machine `steady_clock` advances in
#measured[41.677 ns steps][`latency-bench.generated.json`, `core_ticks.tick_ns`],
so 83 and 84 ns are both
*two ticks* and nothing between them is representable. The figure with the
resolution is not the p99 but the *fraction of calls finishing inside two
ticks*, #measured[0.9952 over 5 000 samples][`latency-bench.generated.json`],
with nine repeats spanning 0.9932 to 0.9976. Quoting the 84 ns alone would be
publishing a rounding artefact as a speed-up.

The far tail is attributed rather than assumed. Disabling the cyclic garbage
collector changed p50 not at all and p99 by about
#measured[0.1 µs][`LATENCY_BUDGET.md` §2.2]; the
#measured[six samples per 5 000 at ten to twenty-three ticks][`LATENCY_BUDGET.md` §2.1]
arrive *in bursts*, with seven of thirty slow samples immediately following
another slow one, which is the signature of preemption rather than of code. Nothing in `decide()` can take
8.6 µs, so nothing in `decide()` caused the 8.6 µs outlier. The gateway runs on
a virtualised two-OCPU shape; the hypervisor is the constraint, and the document
says so instead of blaming the language.

=== The health and operations snapshot

`/api/ops/snapshot` is a typed, secret-free read model assembled in-process at
read time from the same accessors that back `/health` and `/metrics`. It
performs no network call and no storage query, so polling it cannot contend with
the order path or turn a downstream outage into a gateway outage.

Because it crosses a deployment boundary, the web tier validates it at runtime
rather than trusting the generated types: `isGatewayOpsSnapshot` checks
`schema_version === 1`, a parseable `observed_at`, a positive
`stale_after_seconds`, and every nested field of market data, risk, queue,
audit, Telegram and route latency. Types are a compile-time agreement between
two repositories' *sources*; a runtime gate is an agreement between two
*deployed artefacts*, which can differ.

Freshness is computed from the snapshot's own budget and never borrowed from the
local route:

$ "age" = max(0, t_"received" - t_"observed"), quad "state" = cases(
  "invalid" & "if" t_"observed" - t_"received" > 5 "s" quad ("MAX_FUTURE_CLOCK_SKEW_MS"),
  "stale" & "if" "age" > "stale after",
  "fresh" & "otherwise"
) $

A snapshot stamped more than five seconds *ahead* of the reader's clock is
`invalid`, not `fresh` --- a clock skew is a reason to disbelieve a timestamp,
not to accept it.

Posture is then derived over three planes, ranked, in `deriveReliabilityPosture`:

#table(
  columns: (auto, 1fr),
  [Plane], [Rule],
  [Trading], [`halted` if the kill switch is on or the gateway says halted; `critical` if a critical component or the audit log is unavailable; `degraded` for reduce-only, synthetic market data, or a degraded venue set; `unknown` when telemetry is stale],
  [Research], [`critical` only when every configured provider is unavailable; `degraded` on a reduced set],
  [Notifications], [never worse than `degraded`, and never allowed to impersonate either money plane],
)

Three properties fall out and each is a decision. A research outage never paints
the money path critical. A notification outage never paints either --- the
Telegram companion used to report through `platform.status`, so one chat
transport blip announced a degraded *trading* path to a desk whose orders were
routing normally; taking it off the money path entirely would have made an
outage invisible instead of wrong, so it reports on its own axis. And *stale
monitoring is `unknown`, while a configured gateway that cannot be reached is
`critical`* --- the difference between not knowing and knowing something bad.

The snapshot fetch has its own short timeout,
#measured[1 500 ms][`web/lib/reliability.ts`, `OPS_SNAPSHOT_TIMEOUT_MS`],
with the reason written in the source: health must stay responsive even when the
trading plane is the incident.

=== Circuit breakers and their state machine

The breaker exists to stop one dead provider adding its full timeout to every
request on a route that has three working alternatives. Three states, with
#measured[$T = 3$ consecutive failures and cooldown $C = 60$ s][`web/lib/providers/breaker.ts`,
`BREAKER_THRESHOLD` / `BREAKER_COOLDOWN_MS`], and the breaker record held for
$4C$ so a probe failure counts from a known state:

#table(
  columns: (auto, auto, 1fr),
  [State], [Entered when], [Behaviour],
  [`closed`], [no record, or a success], [calls pass; failures accumulate],
  [`open`], [failures reach $T$], [calls skipped for $C$],
  [`half_open`], [$C$ elapsed], [the record is zeroed and flagged `probing`; the next call is the probe],
)

Two details are structural rather than cosmetic. First, when the cooldown
elapses the record is *zeroed, not deleted*. Deleting it reset the failure count
correctly and also erased the only evidence that a circuit had been open, so the
success that followed emitted nothing and the remediation ledger showed every
self-healed circuit as still open, forever. Second, the state literals `"open"`,
`"closed"` and `"half_open"` are a *contract*: `lib/remediation.ts` pairs events
into incidents by matching them exactly, `half_open` is deliberately neither
open nor closed (counting it as a closure would end an incident that is still
open), and the strings are pinned by test rather than derived, because changing
one renders the remediation ring empty while the breaker keeps working --- a
silent break.

`breakerSnapshot` is a separate, *non-mutating* read for the operator console.
`breakerOpen` answers a boolean and, as a side effect, retires an expired
breaker; a status panel that silently resets breakers by rendering is not a
status panel. And an operator's manual close emits its own transition with
`by: "operator"`, only when a circuit was actually holding, which is what makes
the split between automatic and manual recovery a measurement rather than a
guess.

=== Escalation rules, hysteresis and the resolve sweep

The same asymmetry that governs feed liveness governs alerting, for the same
reason: an alert that repeats is an alert that trains people not to read the
next one.

The risk monitor's drawdown warning is edge-triggered with a rearm below the
fire threshold. With limit $Lambda$ and drawdown $d$: warn on the first tick
where $d >= 0.8 Lambda$, and rearm only once $d < 0.7 Lambda$
(`modules/risk_proxy/monitor.py`). Before that, the
alert fired on every tick spent above the threshold --- roughly seven hundred
and twenty messages an hour at the old five-second cadence, and the monitor tick
is now one second. The gap between 0.8 and 0.7 is what stops a drawdown hovering
on the threshold from flapping once a second.

The feed watchdog transitions on *change* only, and treats the first observation
as a baseline rather than an incident: a venue that is already down when the
process starts does not page anyone at startup for a condition nobody caused.
Every transition writes a risk event to the audit log with severity and reason,
and then --- separately --- attempts to alert. The two are ordered so that an
alert transport failing cannot be the reason the audit write is missed, and the
health check is wrapped so that observability failing cannot be the reason the
synthetic-book failover stops running.

Escalation delivery is addressed by *role*: a provider failing contract checks
is a data engineer's problem first and a developer's second, and a portfolio
manager receiving it learns nothing they can act on. A chat with no role
receives it regardless. The channel actually reached is recorded on the
escalation row, so "escalated to log" is never mistaken for a page.

The on-call rota is a mechanism shipped without a roster, and says so. Entries
parse as `who@days=start-end`, first match wins so order is precedence, and a
window whose end precedes its start wraps past midnight --- which is what a
night shift is. The wrapped case is handled by matching the after-midnight tail
against the day the shift *began*, because testing the calendar day of the
moment covers Monday 03:00 and leaves Saturday 03:00 uncovered, which is the one
hour a weekday rota most needs to reach. An unparseable entry is *kept*, with
its error published, and skipped only for resolution: a rota that silently
ignores the line with the typo in it pages nobody and says nothing. An empty
`DATA_ONCALL` is a supported state that reports itself, not a misconfiguration.

=== Failover topology

#figure(
  ```
  MARKET DATA      Binance WS --+
                   Bybit WS   --+--> TCAEngine books --> consolidated ladder
                   SIM        --+          ^
                                           |  only when EVERY real feed is dark
                                           |  AND ALLOW_SYNTHETIC_BOOK=1, and
                                           |  every payload is tagged synthetic

  REFERENCE DATA   ranked chain per (capability, asset)
                   sorted by meta.rank[capability]; absent ranks last at 99
                   each hop may be skipped: outage / unconfigured / breaker
                                            / unlicensed / quota

  DESK DATA        live --(any failure)--> cached --(2 successes)--> live
                    |                        |
                    +-- never ---------------+--> sandbox   (see The sandbox
                                                             doctrine, below)

  PERSISTENCE          quality ledger : sqlite | postgres   (no silent fallback)
                       job queue      : in-process pool | Celery
                       audit log      : DuckDB | SQLite     (fallback only for absence,
                                                             NEVER for a lock conflict)
  ```,
  caption: [Four failover surfaces, each with a different rule about what may substitute for what.],
)

The audit log's asymmetry is the one worth dwelling on. `duckdb.connect` reports
two very different conditions as the same exception: *DuckDB is unavailable
here*, for which the SQLite fallback is exactly right and nothing is lost but
analytical SQL; and *another live process already holds this database*, for
which falling back meant the second gateway did not fail --- it opened a private
ledger beside the first and began writing a divergent history, while `/health`
reported `backend: sqlite` as though somebody had chosen it. An append-only
ledger silently forking in two is the worst thing that subsystem can do, and a
bare `except Exception` was the reason it was silent. The lock conflict is now a
typed error and it is raised, as defence in depth behind the `flock(2)` claim
`modules/single_writer.py` takes in `RiskGateway.start()`.

The same boundary explains why the gateway refuses to run multiple workers.
`tests/test_container_contract.py` fails the build on `--workers` or `gunicorn`,
with the reason inline: a second worker forks the in-memory book and localises
the kill switch. Moving the four data-operations tables to Postgres removes the
*storage* half of that constraint --- a redeploy or a second container reads the
same rows --- and does not remove the other half, and the document says which is
which rather than implying that a database made the process stateless.

=== The sandbox doctrine

The desk can show three tiers of number, and the tier decides what the reader
is allowed to *do*, not merely what the caption says:

#table(
  columns: (auto, 1fr, auto),
  [Tier], [What it is made of], [Writes],
  [`live`], [a payload the backend returned just now], [enabled],
  [`cached`], [a payload the backend returned earlier, carried with its age], [disabled],
  [`sandbox`], [a payload this browser generated, seeded and self-consistent], [disabled],
)

Two rules govern movement between them, and both are enforced by a state machine
(`DeskSourceMachine`) rather than by a component.

*Measured data is never replaced by generated data.* Once a probe has succeeded
even once, a failure demotes `live` to `cached` and stops there. The sandbox is
reachable only from a desk that has never had a reading, or by a human pressing
Sandbox.

*Demotion is immediate; promotion requires a streak of two.* Falling to `cached`
on the first failure is the conservative direction, because writes are disabled
there. A gateway alternating success and failure settles at `cached` and stays
there, which is also the honest description of a gateway you can reach half the
time.

#note[During an incident, generated data may not stand in. The argument in full.][
The temptation is strong and the reasoning is superficially good: a panel that
says "gateway unreachable" is useless, a generated panel is at least
*demonstrative*, and a banner can say which it is. That reasoning fails on four
counts, and the failures compound.

*First, it destroys the evidence at the moment it is worth most.* An incident is
precisely the interval during which someone is trying to establish what the
system last knew. `cached` preserves that: real numbers from forty seconds ago,
carried with their age, from which an operator can reason about what changed.
Generated numbers preserve nothing. Substituting them converts an incident into
an absence of an incident, and the reader loses the only artefact that could
have told them when the desk stopped being right.

*Second, it is a provenance failure, not a rendering failure, and no label
repairs it.* This repository has the counterexample in its own history: one hook
discarded the last good book on a failed poll, so the whole execution cockpit
--- blotter, alerts, P\&L strip, fill quality --- swapped to a generated desk and
swapped back on the next successful poll. At a four-second cadence against a
gateway dropping one poll in three, that is a desk visibly alternating between
real fills and invented ones every few seconds. Every frame of it was correctly
labelled. The label did not help, because a reader integrating a number over
seconds does not re-read the banner between frames.

*Third, it breaks the one safety property that is not advisory.* Only `live`
enables a write. If an incident could route the desk to `sandbox`, then the
tier that a human reaches for during an outage would be the tier whose numbers
were invented --- and every gate above it (the order ticket, the kill-switch
arming, the operator actions) would be defending against a book that no venue
ever quoted. Keeping the incident path at `cached` keeps writes disabled *and*
keeps the numbers real, which are two different guarantees that happen to point
the same way.

*Fourth, it makes the outage unmeasurable.* A surface that always renders
something cannot report how often it had nothing. The reliability posture
depends on the difference between "no authoritative source is configured" (a
deployment fact) and "a configured source did not answer" (an incident), and a
sandbox that fills both cases erases the distinction that the whole posture
model is built on.

*Where generated data is therefore permitted, and only there:* on a desk that
has never held a reading; when a human explicitly presses Sandbox; and on a
deployment where no gateway is configured at all, which is the normal, designed
state of the public workspace rather than a fault. In each of those the cause is
named on the wire (`not-configured`, `chosen`) and is not `incident`.

The gateway's own synthetic feed obeys the same doctrine one layer down. It is
enabled only when *every* real venue is dark and `ALLOW_SYNTHETIC_BOOK` is set;
every downstream payload is tagged `synthetic: true`; the platform reports
`market_data.status = degraded`; and the trading posture reads "the gateway is
using synthetic market data and is not live-trading ready". It exists so that an
offline demonstration has a ladder to draw, not so that an incident has one.
]

== Part C. The quant developer

=== The compiled decision core and its binding

`native/decision_core/decision_core.cpp` is one of two implementations of the
same seventeen-gate battery. The Python reference in `modules/risk_proxy/` is
authoritative; the C++ core is a *delegate* for the book arithmetic and the
numeric gates. The boundary between them is drawn for bit-for-bit parity, not
for size, and it is written down in the translation unit's own header comment.

#table(
  columns: (1fr, 1fr),
  [In the core, and timed], [In Python, before the clock starts],
  [`BookLadder` with dict-snapshot semantics; best bid/ask, mid, depth folds], [kill switch, symbol halt, whitelist, paper-execution model, reference freshness, duplicate order],
  [the consolidated depth-weighted mark for the order symbol], [the rate-limit token consume --- it *mutates*, so it must run exactly once],
  [qty/notional derivation, `price_available`, `order_sized`], [`working_book`, a bare length comparison],
  [`max_order_notional`, `symbol_concentration`, `gross_exposure`, `price_band`, `daily_drawdown`, `reduce_only`], [per-position marks (each an independent multi-venue consolidation)],
  [`est_slippage` --- the cross-venue merged-ladder walk], [every `round()`, every f-string, every `CheckResult`],
)

Three constraints make the parity claim survivable.

*Fold algorithms are matched, not approximated.* CPython 3.12's `sum()` uses
Neumaier compensated summation, so a plain `+=` fold in C++ lands one ULP away.
The Python reference is split down that exact line --- `BookState.depth_usd` and
the P\&L functions go through `sum()`, while `consolidated_mid` and
`gross_exposure` are hand-rolled `+=` loops --- and the core reproduces *each*
fold with the matching algorithm. The routed walk needs both in one function.

*Fused multiply-add is forbidden.* `-ffp-contract=off` in the build plus
`#pragma STDC FP_CONTRACT OFF` in the translation unit, because an FMA rounds
once where CPython rounds twice, and that was measured as a one-ULP parity
break. `-march=native` is deliberately absent: the Docker builder stage and a
developer's Mac must emit the same doubles.

*Tie-breaks are part of the specification.* Python's `list.sort` is stable and
*stays stable under* `reverse=True`, so two venues quoting the same price fill
in feed-iteration order. Getting that backwards moves the blended VWAP by a ULP.
A randomised differential test against the reference router covers
#measured[400 cases on a shared price grid][`LATENCY_BUDGET.md` §2.1], of
which
#measured[106 of the 125 multi-venue cases][`LATENCY_BUDGET.md` §2.1] diverge if
the tie-break is reversed --- which is what makes that test the control rather
than a comment.

The binding is pybind11, and two of its properties cost real engineering.
Argument passing is *positional*, twenty-six arguments in the order of the C++
signature, because pybind11 resolves `py::arg` names through a dictionary on
every call; the interleaved A/B measured the decision p50 faster in all five
rounds by
#measured[1.37, 1.58, 1.21, 0.83 and 0.91 µs][`LATENCY_BUDGET.md` §2.1]. And
object lifetime is not automatic: the mirror stores `BookLadder` pointers past
the single synchronous call that `BookState.native_ladder()` documents them as
valid for, which segfaulted the suite until each entry kept a `py::object`
alongside the pointer.

The mirror also costs vigilance in exchange for its speed, and the source says
so: every mutation of the position book must re-sync it --- both fill sites, the
paper execution, the audit replay and the session rollover, the last of which
was found by a test rather than by inspection. When the mirror cannot be trusted
--- a venue joined or dropped, or any book has no native ladder --- the *whole*
decision falls back to the Python path rather than half of it deciding natively.

Finally, the core measures itself at startup. `run_core_self_measure` runs the
same compiled `decide()` the order path runs, against two synthetic ladders
built directly from the extension: fifty warm-up calls unrecorded, then three
hundred recorded. The count of synthetic samples is published beside the total
(`core_self_test_samples`) so a reader can tell provenance rather than infer it.
What it deliberately never touches is the microsecond histogram, the order
counters, the audit log, the token bucket or the TCA engine --- a self-measure is
evidence about the core, and nothing synthetic may enter the plane that measures
whole decisions under the lock.

=== Engine selection and the bit-exact parity fixture

`DECISION_CORE` takes three values and each encodes a different deployment
intent:

#table(
  columns: (auto, 1fr),
  [`auto`], [native if importable, else the Python reference with a warning. The default.],
  [`native`], [refuse to start without the extension. For a deploy that must not degrade quietly.],
  [`python`], [the reference, always available.],
)

The selected engine is published on `/health`, `/metrics`
(`alphaengine_decision_engine{engine="native"}`) and the ops snapshot, and the
desk marks a gateway that fell back --- a deployment-integrity signal, not a
correctness one, since the Python reference is exact.

One trap here is recorded in the source and is easy to reintroduce. The book
mirror keys on whether the extension *imports*, not on which engine
`DECISION_CORE` selected --- different questions. A caller that forces the
native engine (the parity suite does, so a quietly degraded build turns CI red)
would otherwise find every book unmirrored under `DECISION_CORE=python` and fall
back without saying so: the silent fallback that suite exists to catch, caused
by the mechanism meant to make it fast.

Parity is pinned by `web/tests/fixtures/gate-parity.json`:
#measured[20 scenarios][`web/tests/fixtures/gate-parity.json`] against the
seventeen gates in evaluation order. Each scenario carries a fixed clock, a seeded
position book, resting orders, seen client ids, and *every one of the fifteen
settings fields a gate reads* --- so a change to a default cannot silently change
what the fixture pins.

#table(
  columns: (1fr, 1fr),
  [Scenario], [Scenario],
  [`happy_market`, `happy_limit_resting`], [`kill_switch_on`, `symbol_halted`],
  [`not_whitelisted`, `duplicate_client_id`], [`rate_limited`, `working_book_full`],
  [`no_price`, `oversize_notional`], [`concentration_breach`, `gross_breach`],
  [`price_band`, `slippage_breach`], [`slippage_partial`],
  [`drawdown_reduce_only_blocks_opening`], [`drawdown_reduce_only_allows_close`],
  [`paper_equity_happy`, `paper_equity_limit_rejected`], [`paper_equity_stale_quote`],
)

"Parity" here is stronger than "same verdict". The assertion is the same
accept or reject, the same gate names in the same order, *and the same observed
and limit doubles* --- which is why the fixture caught the Neumaier and FMA
defects, both of which produced identical verdicts and different bits.

The fixture is shared rather than duplicated: `tools/make_gate_fixture.py`
records what the Python reference decides and `tests/test_gate_parity.py`
asserts that the running engine still decides the same, through one loader
(`tools/gate_fixture.py`). A recorder and a checker that build their gateway
differently are two things to keep in step; one loader is one.

=== Application ownership and the bounded blocking boundary

The current gateway composes one application in
`modules/application_lifecycle.py`. An `AsyncExitStack` registers cleanup before
each component starts and unwinds the graph in reverse order. The resulting
frozen `ApplicationContext` is the route boundary: market data, execution, risk,
jobs, audit, Telegram, health and the shared book stream are services owned by
the lifespan, not globals re-created by individual handlers. Partial-start
cleanup and context immutability have dedicated contract tests.

Blocking datastore calls cross `BackendRuntime`, an owned pool with four
workers and twelve queued admissions by default. It propagates the web proxy's
fixed H1-H5 request budget, cancels work that has not started when the deadline
expires, drains work already running, and records queue time, duration p95 and
event-loop lag. `RequestBudgetMiddleware` answers an exhausted deadline with
504 and a saturated admission boundary with 503. This is separate from the job
queue below: the runtime protects bounded reads serving a request; the job
system owns long-running research work.

=== The API and WebSocket protocols

The REST surface is #measured[76 paths, 79 operations and 150 component
schemas][`tools/openapi.json`, counted 2026-08-29], exported from the running FastAPI application and
committed. WebSockets are *deliberately outside* that contract --- OpenAPI does not describe them --- and
their shapes are pinned by tests instead of by the schema, which the module
docstring states rather than leaving a reader to infer that the socket was
forgotten.

Three transports carry live data, and they are chosen by what each hop can
actually do:

+ *Browser to venue, direct.* `wss://stream.binance.com` and
  `wss://stream.bybit.com`, 100 ms depth frames, published to React at 5 Hz
  (`web/lib/livebook.ts`). One hop, no backend; routing it through the gateway
  would make it slower.
+ *Gateway `/ws/book/{symbol}`.* The consolidated ladder plus a live TCA report
  on one shared 300 ms latest-state producer per `book:{SYMBOL}` topic
  (`modules/api/tca.py`, `modules/latest_state_stream.py`), for the depth-of-market
  visualiser. Every consumer receives a size-one queue, so a slow browser
  coalesces only a superseded snapshot instead of multiplying book computation.
  The payload is a tagged object
  (`type: "book"`) carrying the consolidated mid, the venues online, each
  venue's book and, when a report exists, the TCA block, plus heartbeat,
  freshness and cumulative coalescing state.
+ *Server-sent events, `/api/stream/desk`.* Risk state, proxied. A browser
  cannot open an `EventSource` to the gateway directly --- the page is HTTPS and
  the gateway is plain HTTP, which is blocked as mixed content with no override
  --- so this is proxied through a route handler.

The SSE proxy carries a design constraint worth recording because a previous
attempt was removed over it. `EventSource` exposes neither the status code nor
the body, so a deliberate 503 on a gateway-less deployment was invisible to the
client and the panel read "Connecting..." forever --- on precisely the
deployment where that is the normal condition. The proxy now answers *200 in
every case* and puts the state in the first frame:

```
event: desk-state
data: {"state":"unavailable","reason":"gateway_not_configured"}
```

On `unavailable` the hook closes the source rather than letting `EventSource`
retry every three seconds, which would be a poll wearing a push's clothes. The
stream is a *signal*, not a second source of the numbers: rebuilding the panels
on its shape would give the same figures two sources that can disagree. Its
sequence number moves only when the risk state actually changed, so an idle desk
costs nothing and a moving one is refetched because something moved rather than
because a timer expired.

=== The job queue and its two backends

A parameter sweep can take tens of seconds. Running it inside the request
handler would block the event loop that also carries the kill switch --- the one
path that must never queue behind a backtest. Two interchangeable backends sit
behind one interface: a bounded `ThreadPoolExecutor` by default (NumPy and Numba
release the GIL in the numeric inner loops, so thread parallelism is genuinely
parallel here), and Celery when a broker URL is configured. The API surface, the
console and the notification companion never learn which one is running.

Retries are opt-in *by job kind*, and each entry in the table is a claim that
running the work twice is indistinguishable from running it once:

#table(
  columns: (auto, auto, 1fr),
  [Kind], [Attempts], [Idempotence argument],
  [`data.backfill`], [3], [merges bars keyed by (symbol, interval, ts); a repeated merge overwrites identical rows],
  [`data.replay`], [2], [a second finding is a second observation, which is what the ledger is for --- but it costs a provider call, hence 2 not 3],
  [`ml.fit`], [2], [a retry writes a second run row, which is honest: two fits are two runs, and the seed and data hash say so],
  [anything else], [1], [`backtest` is deliberately absent --- it pushes a corpus card and a chat message on completion, and repeating those is visible to a reader],
)

with backoff from #measured[2 s to a 30 s ceiling][`modules/jobs.py`,
`RETRY_BASE_S` / `RETRY_CEILING_S`]. Persistence happens in the completion hook,
on the gateway's own event loop, for *both* backends: a worker fetches and
validates and returns, and the gateway writes. That keeps a single writer to the
ledger regardless of where the compute ran.

The queue's own telemetry is redacted more aggressively than a URL redactor
would manage: the broker is reported as a transport *identity* --- one of a
known set of schemes, or `other` --- rather than as a redacted URL, because even
a redacted URL exposes host, port, database index and virtual host, none of
which an operator needs in a queue summary.

=== The append-only audit log

One DuckDB handle (SQLite when DuckDB will not load) behind one lock, on a Docker
volume, holding orders, order events, risk events, TCA snapshots, equity
snapshots and job status. Every statement in the DDL is
`CREATE TABLE IF NOT EXISTS`; columns added after the first databases existed are
widened by an explicit migration step rather than by editing the DDL, because a
column added to that list would be created on a fresh database and missing on
every existing one.

The ledger is the system's memory across restarts, which is why the position
book is *rehydrated by replay* rather than checkpointed, and why the lock
conflict discussed under *Failover topology* must be raised rather than absorbed. It is also why
the mirror to Supabase is a bounded, best-effort queue that is never on the
order path: the authoritative record is local and append-only, and a managed
database being slow must not be able to slow an order down or to lose one.

=== The generated-gate discipline

Eight files in this repository are generated, and three of them are gated by a
checker that *recomputes the artefact itself*. Those three are the pattern worth
reading, because it is the same each time: a generator writes a file, a checker
recomputes it and fails the build on drift, and the file itself carries a header
saying it must not be hand-edited.

#table(
  columns: (0.8fr, 2.2fr),
  [Artefact], [Generator, checker and failure meaning],
  [OpenAPI digest], [Path: `web/lib/gateway-openapi-digest.generated.ts`.
    Generated by `tools/export_openapi.py`; checked by
    `check-gateway-openapi-digest.mjs`. Drift means the web client describes a
    gateway contract that is no longer deployed.],
  [Repository catalogue], [Path: `web/lib/repository-manifest.generated.json`.
    Generated and checked by `generate-codebase-manifest.mjs --check`. Drift
    means the Developer catalogue lists missing files or omits current ones.],
  [Test count record], [Path: `web/lib/test-counts.generated.ts`.
    Generated by `refresh-test-counts.mjs`; the web line is checked by
    `check-test-counts.mjs`. Drift means the desk quotes a suite size nobody
    measured.],
)

The other five generated artefacts are the typed gateway contract, the Monte
Carlo parity reference, the bundled Supabase migrations, the historical
decision-latency record, and the native-boundary qualification record. They are
owned respectively by their client, parity, migration and benchmark generators.
The two latency files retain their own observation dates; being listed in a
2026-08-29 architecture revision does not make either benchmark a live reading.

The OpenAPI gate hashes *canonical* JSON --- keys sorted recursively --- so that
a re-export which reorders a dictionary does not read as a contract change. The
committed digest today is
#measured[`6f50ebe…82321`][`web/lib/gateway-openapi-digest.generated.ts`, verified
against `tools/openapi.json` on 2026-09-02].

The manifest gate compares *only the file list*, not the commit or the
generation date, because those change on every commit by design and gating on
them would fail every push. It also skips itself, with a message, when git is
unavailable --- a tarball build has nothing to compare against, and the gate
holds where drift can actually happen. The current manifest carries
#measured[2 422 files][`web/lib/repository-manifest.generated.json`, verified
2026-09-02].

The counts gate is the most interesting of the three, because it cannot live
inside the thing it measures: *a test that checks the test count changes the
test count*. So the check runs outside the suite, against the runner's own
summary line teed to a log file. The committed figures, measured on
#measured[2026-09-02][`web/lib/test-counts.generated.ts`], are
#measured[3 492 gateway tests - 3 491 passed and one skipped][`web/lib/test-counts.generated.ts`],
#measured[6 846 web tests across 1 461 suites][`web/lib/test-counts.generated.ts`]
and #measured[24 service tests][`web/lib/test-counts.generated.ts`]. Only the web
figure is gated: CI runs `check-test-counts.mjs` with the argument `web` and it
reads that line alone, so the gateway and service lines beside it are dated
records rather than contracts, and may legitimately differ from what a
differently configured run prints --- which is why the gateway figure here is
quoted with the shape it was taken in. Nothing
regenerates them automatically, because running three suites inside a production
build would make every deploy pay for them --- so the header names the date each
figure was printed, and the desk renders that date beside the number.

The separate rendered release qualification was also executed on 2026-08-29:
#measured[872 of 872 geometry states passed][`web/scripts/engine-layout-audit.mjs`],
covering 109 addressable workspace states at eight responsive viewports with no
geometry failure and no console error. Typed gateway-unavailable responses were
recorded separately rather than mistaken for successful live reads.

This is what "keeping two deployed units honest with each other" means in
practice. The web tier and the gateway are separate deployments on separate
platforms with separate release cadences. Types shared through a generated
client are an agreement between two *sources*; the digest, the runtime payload
gate on the ops snapshot and the parity fixture are agreements between two
*artefacts*. Only the second kind survives one side being redeployed and the
other not.

== What is not built, and why it waits

Stating this is a strength of the document rather than an omission, and the
product requirements already do it.

*A second gateway process.* The position book, the resting-order book, the token
bucket and the kill switch are process-local mutable state. Moving the four
data-operations tables to Postgres removed the storage half of that boundary and
not the other half, and a test fails the build on any attempt to add workers.
Horizontal scale needs those four structures externalised with a real
concurrency story, which is a design, not a flag.

*Tokyo co-location.* The expected improvement from moving the gateway into the
region where the matching engine already runs is an *expectation*, not a
measurement, and the plan is probe-first: stand up an instance, run the same
`time_connect` probe, and migrate only if it confirms. The free half of the same
finding --- that Bybit's origin answers in
#measured[6.2 ms][`LATENCY_BUDGET.md` §2.3] from the existing Singapore VM
against #measured[72.7 ms][`LATENCY_BUDGET.md` §2.3] for Binance --- has been
taken for research bar loading and deliberately *not* for order routing, because
nearer is not deeper and conflating a latency decision with a routing decision
is the mistake the whole latency document exists to prevent.

*A green CI run has not reached Postgres.* The live data-operations test skips
with its reason printed unless credentials are present, because CI is
network-free by design. What CI does prove is the *request* --- the `Prefer`
headers, the filter grammar, the conflict target --- asserted against a mock
transport, because that is where the translation lives and a test checking only
the parsed response would pass with `Prefer` missing entirely.

*The venue failover chain has no live exercise.* Of
#measured[Binance's 489 USDT pairs, 247 are absent from Bybit][`LATENCY_BUDGET.md` §2.5],
but every symbol the workspace currently offers is on both --- so no real
request can exercise the fallback. The chain is therefore
injectable and the fallback is tested with a stubbed venue, rather than left as
an untested promise.

*Hardware paths are out of scope with reasons.* No crypto venue rents an FPGA
feed-handler path; there is no microwave route into a cloud region, because the
relevant distance is a VPC hop; and kernel bypass needs hardware this instance
does not expose. With the decision at
#measured[12.4 µs][`LATENCY_BUDGET.md` §5] against a
#measured[69 ms][`LATENCY_BUDGET.md` §5] market-data round trip, none of the
three has anything to save.

The honest summary of this chapter's three roles is the same sentence in three
registers. The data engineer's numbers are traceable to a vendor byte or they
are marked as not traceable; the reliability engineer's status is derived from
an observation with an age on it or it is `unknown`; the developer's two
implementations agree to the bit or the build is red. In every case the
alternative --- a plausible number with no provenance --- is available, cheap,
and refused.
