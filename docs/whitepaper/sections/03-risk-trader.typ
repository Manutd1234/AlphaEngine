// Chapter 3 — Risk Manager and Quant Trader.
//
// Two roles, one chapter, because they share one object: the in-memory book
// and the consolidated ladder it is marked against. Splitting them would have
// meant describing that ladder twice, and the second description would drift.
//
// Every quantitative claim below is either read out of the tree — with the file
// named in the source bracket — or wrapped in #illustrative. Where a capability
// is absent, the closing section names it as absent rather than leaving the
// omission to be inferred from silence. Two figures here are findings about the
// repository rather than about the market: the expected-shortfall constant that
// differs between the two stacks, and the boundary the preamble benchmark never
// timed. Both are stated with what was actually measured.
//
// Cross-references are Typst labels, never hand-typed numbers — a section added
// in review would silently invalidate every literal "3.12" in the prose, which
// is the same class of drift the gate registry's single declared tuple prevents.

// `include` evaluates a section in its own scope, so the template helpers are
// imported here rather than inherited from main.typ. Helpers only: the page,
// the fonts and the numbering stay where they belong.
#import "../template.typ": illustrative, measured, note

= Risk Manager and Quant Trader

The risk manager asks two questions: how much can this book lose, and who can
stop the desk. The trader asks two more: what will this order cost, and where
should it go. All four are answered against the same two objects — an in-memory
position book marked once per second, and a cross-venue consolidated ladder
rebuilt at feed rate — so the four answers cannot be made to disagree by being
computed from different state. @sec-var through @sec-planes are the risk
manager's half; @sec-book through @sec-absent are the trader's.

The organising discipline of both halves is that a loss estimate is a *model
output*, and a model output that does not say what it assumed, how many
observations it had, and what it refuses to answer without, is a number wearing
a statistic's clothes. Every estimator below therefore has a refusal condition,
and every refusal returns a typed absence with a named reason rather than a
zero, an empty list or an exception.

== One loss, three estimators <sec-var>

The book's one-bar loss distribution is estimated three ways. They are not
redundant, and they are not averaged. Each makes a different assumption, and
the *spread between them* is the information a single number destroys.

=== Parametric normal

Let $bold(w) in RR^n$ be the signed position weights, $w_i = plus.minus |N_i| \/ E$
for notional $N_i$ and equity $E$, negative for a short. Let $Sigma$ be the
sample covariance of per-bar simple returns, estimated with $"ddof" = 1$ over
the window every symbol shares:

$ Sigma_(i j) = 1/(m-1) sum_(k=1)^m (r_(i k) - macron(r)_i)(r_(j k) - macron(r)_j) $

Book volatility and the parametric quantiles follow:

$ sigma_p = sqrt(bold(w)^top Sigma bold(w)), quad
  "VaR"_(95) = z_(95) sigma_p E, quad
  "CVaR"_(95) = kappa_(95) sigma_p E $

with $z_(95) = 1.6448536269514722$ and $kappa_(95) = phi(z_(95)) \/ 0.05$, the
normal expected-shortfall multiplier
#measured[$2.0627128027825736$][`modules/quant_risk/_common.py`].

The window is truncated to the shortest series rather than padded, and the
comment in `build_covariance` gives the reason: padding a short history with
zero-return days understates that instrument's variance and, because the zeros
line up across symbols, inflates every off-diagonal correlation toward one.
A diversification claim manufactured by missing data is the failure this
truncation exists to prevent.

Summation is sequential in both implementations — never `math.fsum`, never
`numpy.dot`. Pairwise summation rounds differently from JavaScript's
left-to-right accumulation, and the Python/TypeScript parity fixture exists to
catch exactly that class of drift, so the slower loop is the one that keeps the
two stacks provably identical.

*A seam worth naming.* The TypeScript constant is
#measured[$2.0627128054846826$][`web/lib/portfolio-risk/risk.ts`], which differs
from the Python constant in the ninth significant figure — a relative gap of
about $1.3 times 10^(-9)$, and neither equals $phi(z_(95))\/0.05$ evaluated in
double precision. No fixture pins the parametric CVaR across the two stacks
(`risk-parity.json` carries the *historical* CVaR, which is a tail mean and uses
no multiplier), and the Python-side assertion uses `pytest.approx` at its
default relative tolerance of $10^(-6)$, which cannot resolve the difference.
The gap is far below any precision a desk reads, and it is recorded here
because an unpinned seam between two implementations is the thing this
architecture otherwise refuses to have.

=== Historical replay

No distribution is assumed. Today's weights are applied to each past bar's
returns, producing a replayed per-bar book P&L series
$L_t = sum_i s_i r_(i t)$ with $s_i = plus.minus |N_i|$; the series is sorted
ascending, and with $k = max(1, ceil(0.05 m))$:

$ "VaR"_(95)^"hist" = -L_((k)), quad
  "CVaR"_(95)^"hist" = -1/k sum_(j=1)^k L_((j)) $

The tail is selected *by rank*, never by value. Selecting every observation at
or below the quantile is equal to the rank rule only when the quantile is not a
repeated value, and in a strategy that is flat most of the time it very often
is: a run holding nothing on most bars earns exactly zero, the fifth percentile
lands on that atom of zeros, and the "tail" silently becomes every non-positive
bar. The repository records the measurement that caught this — a default RSI run
understated $"CVaR"_(95)$ by #measured[19.8×][`web/lib/quant/tail-risk.ts`] and
$"CVaR"_(99)$ by #measured[99×][`web/lib/quant/tail-risk.ts`], printing the two
as the identical number, which is the visible tell that the selection was by
value.

=== Bootstrap terminal distribution

A single-bar VaR answers "how bad is one bad bar". A desk unwinding over several
bars wants the distribution of where the book *lands*. Each of $P$ paths draws
$h$ per-bar P&L figures from the replayed series and accumulates them; the
terminal values form the P&L distribution and the per-step columns form the
percentile cone:

$ T^((p)) = sum_(t=1)^h X_(i_t), quad X_j in {L_1, ..., L_m} $

Loss quantiles are read off the sorted terminal vector by the same nearest-rank
rule, at $k = max(1, ceil((100-C)\/100 dot P))$. The expression is written
$(100-C)\/100$ rather than $1 - C\/100$ deliberately: at $C = 95$ the first is
the double $0.05$ and the second is $0.05000000000000004$, which is a different
`ceil` for some path counts, and both stacks take the same route.

=== The conditions under which each is trusted

#table(
  columns: (auto, 1fr, 1.25fr, 1fr),
  [Estimator], [Trusted when], [Refuses below], [What it cannot see],
  [Parametric], [returns are near-normal and the covariance window is representative], [$m < 2$ aligned bars, or $sigma_p^2 <= 0$], [fat tails; it understates loss in exactly the conditions a risk manager cares about],
  [Historical], [the past window contains the kind of day being asked about], [20 aligned observations], [any loss larger than the worst day in the sample],
  [Bootstrap], [the sample is long enough to carry tail shape], [60 observations; horizon clamped to 60 bars, paths to $[200, 20\u{2009}000]$], [under i.i.d. draws, volatility clustering — a sustained drawdown arrives in runs],
)

Every refusal returns `None` and is rendered as a dash with its reason, never as
a zero. The floors are not arbitrary. Twenty observations is the point below
which a fifth percentile is a single data point wearing a statistic's name;
sixty is the point below which a bootstrap would be manufacturing tail shape
the sample never showed, and a cone drawn from a dozen days gives false
confidence to noise.

=== Validating the estimate: the Kupiec proportion-of-failures test

A VaR nobody has back-tested is an opinion. The forecast is re-estimated on a
rolling window of $w = 60$ bars and scored against the *next* bar's realised
book P&L, so it is never judged on data it was fitted to; a bar breaches when
$-L_t > z_(95) hat(sigma)_(t-w:t)$. With $x$ exceptions in $n$ scored bars at
level $alpha = 0.05$ and $hat(p) = x\/n$:

$ "LR"_"uc" = -2 ln( ((1-alpha)^(n-x) alpha^x) / ((1-hat(p))^(n-x) hat(p)^x) )
  #h(10pt) tilde.op #h(4pt) chi_1^2 $

The p-value is the exact survival function $"erfc"(sqrt("LR"\/2))$ in Python;
the browser has no `erfc`, so it uses the Abramowitz and Stegun 7.1.26 rational
approximation, accurate to about $1.5 times 10^(-7)$ — far tighter than the
$0.01$ and $0.05$ thresholds it feeds. The parity test asserts the *zone*, not
the p-value, because the zone is what a risk manager acts on and the sixth
decimal is not.

The verdict is two-sided, and that is the point. Too many exceptions means the
model understates risk. Too *few* means it overstates it, and the desk is
holding capacity it never uses — a model with zero exceptions is not
conservative, it is wrong in the expensive direction.

== The second implementation, and why one exists at all <sec-oracle>

`POST /api/oracle/var` runs a Monte Carlo *inside Oracle 23ai* and returns a
99% terminal-value VaR. It is not there because the database is faster or the
number is better. It is there because two independent implementations of one
quantity are two chances to be wrong and one chance to notice, and when they
disagree by more than sampling error, *the disagreement is the finding*.

The model is geometric Brownian motion under a drift adjustment, over a
365-day year with $T = "days"\/365$:

$ S_T = S_0 exp( (mu - 1/2 sigma^2) T + sigma sqrt(T) Z ), quad Z tilde.op cal(N)(0,1) $

$ "VaR"_(99) = max( S_0 - Q_(0.01)(S_T), #h(2pt) 0 ) $

The procedure generates paths in an inline view over `CONNECT BY LEVEL`, takes
`PERCENTILE_CONT(0.01)` over that view, and persists nothing at all. Four
properties of it are load-bearing, and each corrects a defect in the design it
was built from:

+ `FORALL i IN 1..p_simulations PARALLEL` does not compile — `FORALL` iterates a
  bound collection and has no `PARALLEL` clause. The generator is set-based
  instead.
+ The percentile was taken over a persisted table with no run predicate, so two
  callers read each other's paths and the reported VaR drifted further from the
  truth on every invocation. That is a wrong number that looks plausible, which
  is the worst kind.
+ It wrote #measured[100\u{2009}000][`oracle/02_monte_carlo.sql`] rows per call
  from a route reachable without authentication — a way for anonymous traffic to
  fill the tablespace of an Always Free instance.
+ The path cap is enforced *twice*: at
  #measured[50\u{2009}000][`oracle/02_monte_carlo.sql`] in PL/SQL and again in
  the route. The route is the layer a future contributor can edit and an
  attacker cannot; the database is the layer neither can. Duplicating the limit
  means neither one alone is load-bearing.

=== Reading the disagreement correctly

The panel compares the simulated figure against the *closed form of the same
model* — the lognormal quantile, not a normal approximation:

$ Q_(0.01)(S_T) = S_0 exp( (mu - 1/2 sigma^2) T - z_(99) sigma sqrt(T) ),
  quad z_(99) = 2.3263478740408408 $

This is worth the paragraph it costs, because the first version of the panel
compared the simulation against $z_(99) sigma sqrt(T) E$, the *zero-drift*
normal shortcut, while sending the procedure a modelled 8% annual drift. At a
30-day horizon the drift term alone accounted for the whole
#measured[$-22%$][`web/lib/portfolio-risk/risk.ts`] "divergence" the panel then
flagged as an input error. Same drift, same volatility, same lognormal
quantile, same 365-day year: what remains between the two figures is sampling
error, which is the only thing a divergence tile is entitled to measure. The
comparison reads the *echoed* assumptions off the response rather than the
component's own request, because the route clamps its inputs and a clamped
input read against the unclamped original resurfaces as method disagreement.

*The two VaRs are not interchangeable and the surface says so.* This one is a
terminal-value figure over a horizon; the covariance one is a one-bar figure on
the current book. A terminal-value VaR says nothing about the path, so it is not
comparable to a maximum-drawdown figure and must never be presented as one.
Presenting them as one number with two sources would be the actual error.

== The bootstrap's resamplers, and what clustering is worth <sec-resamplers>

Two resamplers are offered, named identically on both stacks so a run cannot be
called one thing on the chat card and another on the workspace card.

*The i.i.d. draw* takes each bar independently. Its limitation is stated in the
code rather than in a footnote: it has no volatility clustering, so it
understates a sustained drawdown where losses arrive in runs.

*The stationary bootstrap* (Politis and Romano, 1994) draws blocks of geometric
length with expected size $L$: at each step, with probability $1\/L$ a new block
starts at a uniform position, otherwise the cursor advances by one and wraps
modulo $m$. The wrap is what makes it stationary — without it, end-of-sample
bars are systematically under-drawn. Left unspecified, $L$ is the $sqrt(N)$
heuristic clamped to $[5, 100]$ bars:

$ L = min(100, max(5, floor(sqrt(N) + 1/2))) $

written as $floor(x + 1\/2)$ rather than as a rounding call because Python
rounds halves to even and ECMAScript rounds them up — a difference no integer
square root can actually reach, spelled out so the two stacks stay provably one
rule rather than two that happen to agree.

Three properties of this pair are design decisions rather than incidentals:

*A contradiction raises rather than resolving itself.* Asking for an i.i.d.
draw with a mean block of ten bars, or a stationary bootstrap with a block of
exactly one, refuses. Silently picking a winner would produce a run that used
the other resampler with no card able to report it afterwards.

*The i.i.d. path is a separate loop, deliberately.* The block loop consumes two
random values per step (a uniform to decide whether to start a block, then an
index) where the i.i.d. loop consumes one. Routing $L = 1$ through the block
loop would produce a different sequence for the same seed, so every existing
figure would move, silently, with no code that looks like it changed a number.

*The seed defaults to `zlib.crc32` of the input series*, so a refresh against the
same book redraws the same cone — reproducible without stored state.

*What the clustering premium is worth on this book is not measured.* The
repository pins the two resamplers against each other for naming, block
derivation, contradictions and loss-quantile rules
(#measured[5, 6, 2 and 3 cases respectively][`web/tests/fixtures/mc-resampler-parity.json`]),
but nothing in the tree records a measured ratio between a stationary-bootstrap
tail and an i.i.d. tail on real book returns. A plausible figure could be
asserted here in one line and it would be exactly the defect this document is
built to avoid. Directionally the block draw produces the *fatter* terminal
tail because runs of losses survive resampling; a figure such as
#illustrative[15% wider $"CVaR"_(95)$ at $L = 8$] would be an invention, and is
marked as one.

== Tail-risk stress testing and scenario construction <sec-stress>

A VaR is an estimate from history. A stress test is a hypothesis about a future
that history has not shown, and the two answer different questions on purpose.

Four scenarios are named in code — a leveraged liquidation cascade (majors gap
together, correlation goes to one), a broad risk-off, a melt-up (worth running
precisely because a short book fails there), and a flat baseline whose only
purpose is that any non-zero P&L on it would be a bug in the propagation. Each
is a shock table mapping symbols, plus an optional `*` wildcard, to fractional
moves.

The propagation rule is where the honesty lives. For each held position, the
applied move $delta_s$ is decided in four mutually exclusive ways, and the leg
records *which*:

#table(
  columns: (auto, auto, 1fr),
  [Basis], [Move applied], [What it means],
  [`explicit`], [$delta_s$ as given], [the scenario named this instrument directly],
  [`beta`], [$beta_s dot delta_"ref"$], [co-movement measured against the reference over $>= 20$ aligned bars],
  [`wildcard`], [the `*` move], [an assumption about an instrument whose co-movement could not be measured],
  [`unsupported`], [$0$], [no measurable beta and no blanket move: left flat, and the total is understated rather than invented],
)

with $beta_s = "cov"(r_s, r_"ref")\/"var"(r_"ref")$, returning a typed absence —
not $1.0$ — when it cannot be estimated. Defaulting an unmeasurable beta to one
is the quiet way a stress test starts inventing exposure and reporting it as a
measurement: every unmeasurable instrument would move exactly with the shocked
one, and the resulting number would look like evidence.

The `wildcard` and `beta` bases are kept apart for the same reason. A blanket
"everything falls 25%" is a legitimate thing for a scenario to mean, and it is a
*stronger* assumption than $beta = 1$ would have been, so the leg says so rather
than being folded into the beta count.

On the operator's side, a hand-set shock of zero survives conversion rather than
being dropped. "This instrument does not move" is a hypothesis an operator can
state, and it is a different hypothesis from "propagate this one by its beta" —
the first is a pinned zero, the second is an omission, and collapsing them would
quietly delete a position's exposure from the total.

=== Time to liquidate

A stress test prices the damage; the liquidity view prices the exit. For each
leg, against average daily volume $"ADV"$ derived from the same OHLCV every
other risk number is derived from, and a participation cap $rho$ defaulting to
#measured[0.10][`web/lib/liquidity.ts`]:

$ D_i = (|N_i|) / (rho dot "ADV"_i) $

Bands are `liquid` at $D <= 1$ session, `moderate` to 3, `illiquid` beyond, and
`unmeasurable` when ADV is absent or rests on fewer than
#measured[20][`web/lib/liquidity.ts`] observations. The book's figure is the
*maximum* over legs, not the mean: a book exits at the speed of its slowest
position. Concentration of that exit risk is reported as a Herfindahl index over
each leg's share of total liquidation days, which distinguishes "three positions
each needing a day" from "one position needing three".

== Factor exposures <sec-factors>

Two decompositions answer two different questions, and neither substitutes for
the other.

*Risk contribution* answers "which position carries the volatility". Share of
notional is not share of risk, and the gap is the reason the decomposition
exists. The standard Euler decomposition on the marginal vector $Sigma bold(w)$:

$ "MCR"_i = (Sigma bold(w))_i, quad
  "CTR"_i = w_i (Sigma bold(w))_i, quad
  sum_i "CTR"_i = sigma_p^2 $

A 13% sleeve in a volatile name can carry more risk than a 42% one in a quiet
name, and a short that hedges the book contributes a *negative* amount — a
number a notional-weighted view cannot produce at all. Beside it, the
diversification ratio $ (sum_i |w_i| sqrt(Sigma_(i i))) / sigma_p $ says how much
of the book's calm is real and how much is one position.

*Factor loading* answers "is this edge generic". Three factors are constructible
from a single instrument's bars: market (buy and hold), time-series momentum
(long after a positive trailing 30-bar return, short after a negative one), and
a volatility-regime factor (long while trailing volatility is below its
expanding average, short above). Two disciplines make the loadings
falsifiable:

*The factors are executed with the same one-bar lag as the strategy.*
Regressing a strategy that trades at $t+1$ against a factor that trades at $t$
credits the factor with information the strategy never had, and the resulting
beta is an artefact of the timing mismatch rather than an exposure.

*The volatility threshold is an expanding mean, not a full-sample median.* A
full-sample threshold would let the factor know at bar 100 what volatility looks
like at bar 1900. That is look-ahead in its *insidious* direction: a benchmark
built with hindsight is stronger than one anybody could have traded, so the
strategy's alpha against it comes out too low and a real edge can be argued away
by a factor that could not have existed. Bar $i$'s own volatility is excluded
from its own threshold, because a one-observation leak with a tidy explanation
is still a leak.

== The pre-trade limit ladder <sec-ladder>

Every order passes one choke point that can say no in microseconds. Seventeen
gates are defined; a crypto order can reach fifteen of them. The declaration
lives in one tuple that three things read and must agree on — the parity
harness, the Postgres enum mirror, and a test that harvests the names the
compiled `submit` method actually emits and asserts they are exactly that tuple.

#table(
  columns: (auto, auto, 1fr, auto),
  [\#], [Gate], [Predicate], [Applies],
  [1], [`kill_switch`], [halt not engaged — one boolean, always first], [always],
  [2], [`symbol_halt`], [this instrument not individually suspended], [always],
  [3], [`symbol_whitelist`], [symbol in the live L2 universe, or backed by a trusted quote], [always],
  [4], [`paper_execution_model`], [`MARKET` only: a quote is a price, not a book], [paper equity],
  [5], [`reference_freshness`], [quote age within bound, and not dated into the future], [paper equity],
  [6], [`duplicate_order`], [`client_order_id` unseen], [always],
  [7], [`rate_limit`], [token bucket admits one order], [always],
  [8], [`price_available`], [a live mark exists], [always],
  [9], [`order_sized`], [quantity and notional both derivable], [always],
  [10], [`max_order_notional`], [$N <= 50\u{2009}000$ USD], [sized],
  [11], [`symbol_concentration`], [projected per-symbol $<= 150\u{2009}000$ USD], [sized],
  [12], [`gross_exposure`], [projected book-wide $<= 500\u{2009}000$ USD], [sized],
  [13], [`price_band`], [limit within 500 bps of mark], [`LIMIT`],
  [14], [`working_book`], [resting book below 200 orders], [`LIMIT`],
  [15], [`daily_drawdown`], [session loss $< 5%$ of start-of-day equity], [always],
  [16], [`reduce_only`], [order reduces the position], [defensive regime, sized],
  [17], [`est_slippage`], [routed slippage $<= 75$ bps], [sized, routable],
)

All limits are #measured[defaults][`Part2_Infrastructure/config.py`], overridable by environment variable at deploy time only: `Settings` is a frozen
dataclass, so changing a hard limit requires a deploy and therefore a code
review. A limit a compromised service can mutate at runtime is not a limit.

=== The order of evaluation, and why it is that order

Cheapest first, and cheap here means "reads the least state". Rows 1 to 3 are
single boolean or set-membership reads on state already resident. Rows 6 and 7
touch small bounded structures. Rows 8 to 17 need a consolidated mark, which is
the first thing in the battery that has to fold across venues. Row 17 needs a
full merged-ladder walk and is last for that reason.

Two ordering decisions are worth defending. `kill_switch` is first because it is
the gate that must never be reached late — an order that is halted should not
have spent a token or a mark on the way to being told so. And `est_slippage` is
last because it is the only gate whose cost scales with book depth; putting it
earlier would make every rejected fat-finger order pay for a ladder walk it was
never going to use.

=== Halting semantics

The battery does *not* short-circuit. This is the property most often assumed
wrongly about a gate vector, so it is stated precisely:

```
for each gate g in GATE_ORDER:
    if g applies to this order:
        checks.append(CheckResult(name, passed, detail, observed, limit))
        # the return value is not branched on

rejected_by = [c.name for c in checks if not c.passed]
accepted    = (rejected_by == [])
```

Three consequences follow, and each is deliberate.

*A rejected order still reports every violation, not the first.* A trader who
fixes the notional and resubmits should not discover the price band on the
second attempt and the drawdown budget on the third. The vector is evidence, and
evidence that stops at the first problem is a worse post-mortem.

*A gate that did not apply and a gate that passed are different facts.* The
returned vector is the gates that *ran*, not a fixed-length row. Nine of the
seventeen are conditional on the order in front of them: the two paper-equity
rows need a quote; rows 10 to 12 each price a size and are skipped entirely when
the order could not be sized — which is exactly the feed-outage case, where a
`MARKET` order carrying a quantity but no live mark runs eight gates and never
reaches a notional limit because there is no notional to compare. Collapsing
"did not apply" into "passed" would be the same mistake as reporting a missing
measurement as zero.

*One gate mutates, and its position in the vector is therefore semantic.* The
rate-limit check *consumes* a token, so it runs exactly once and it runs even
when an earlier gate has already failed: a rejected order still spends its
token, because the bucket is defending the venue against request volume, not
against accepted orders. The idempotency key behaves oppositely — a
`client_order_id` is recorded only on acceptance, so a rejected order does not
burn its identifier and a corrected resubmission under the same key is admitted.

The whole battery runs under one lock with one consolidated mark memo per
symbol, cleared in a `finally` block so a raising gate cannot leave a monitor
loop reading a mark frozen at a failed decision. Post-decision side effects —
the audit write, the alert, and the automatic breaker check — run *outside* the
lock, so an audit backend under pressure cannot extend the time the book is
held.

=== The graduated regime

Between the soft threshold and the hard breaker the desk may still close
positions but not open or add to them. With drawdown $d$, limit $D = 5%$ and
threshold $theta = 0.80$, the regime is active when $d\/D >= theta$, and an
order is *reducing* when it is opposite in sign to the holding and no larger
than it:

$ "reducing" = ("held" != 0) and ("sign"("held") != "sign"(q_"signed"))
  and |q_"signed"| <= |"held"| + epsilon $

An over-sized "close" that flips the book is an opening trade in disguise, which
is why the magnitude condition is there. An unsized order is refused rather than
assumed either way: deriving the sign from a defaulted zero treated a missing
quantity as reducing on a long book and not on a short one — the same order,
two answers.

Reduce-only also reaches the *resting* book. A limit order placed before the
threshold was crossed does not know about it, and one that fills afterwards
makes the book bigger, which would make the regime a claim rather than a
control. The sweep therefore cancels resting orders that would add risk when the
regime engages. The same argument applies to the hard halt: a halt that does not
reach the resting book is not a halt.

*A known hole, left open deliberately and documented where it lives.* The
drawdown fraction is floored at zero and divides by start-of-day equity, so a
non-positive baseline disables both guards — an account that opened the session
already wiped out reports "no drawdown" however much further it falls. It reads
as good news, which is the class of wrong number nobody reports. It is not
patched unilaterally because the browser holds a bit-for-bit mirror of the
expression for the sandbox desk, and a Python-only clamp would make the sandbox
and the gateway disagree about whether an order is blocked. The honest repair is
a shared decision about what a fraction of a non-positive denominator *means*,
taken across both implementations at once.

=== Two engines, one battery, twenty scenarios

The arithmetic exists three times: the Python reference, a TypeScript mirror for
the browser, and a C++ core (pybind11) that owns the book ladders and every gate
that is arithmetic. Between Python and C++ the standard is not a tolerance but
*bit-exactness*. Twenty named scenarios are recorded from the reference into
#measured[`web/tests/fixtures/gate-parity.json`][20 scenarios, version 1], and
both engines must reproduce the same accept/reject verdict, the same gate order,
and the same `observed` and `limit` doubles:

#table(
  columns: (1fr, 1fr),
  [`happy_market`], [`happy_limit_resting`],
  [`kill_switch_on`], [`symbol_halted`],
  [`not_whitelisted`], [`duplicate_client_id`],
  [`rate_limited`], [`no_price`],
  [`oversize_notional`], [`concentration_breach`],
  [`gross_breach`], [`price_band`],
  [`working_book_full`], [`slippage_breach`],
  [`slippage_partial`], [`paper_equity_happy`],
  [`paper_equity_limit_rejected`], [`paper_equity_stale_quote`],
  [`drawdown_reduce_only_allows_close`], [`drawdown_reduce_only_blocks_opening`],
)

Getting to bit-exactness surfaced three silent-wrongness traps, each now pinned
by that fixture or by a differential test:

+ CPython's `sum()` uses Neumaier compensated summation, so a plain C++ `+=`
  fold lands one ULP off. The core reproduces each fold with the *matching*
  algorithm — compensated where Python used `sum()`, plain where it used an
  explicit loop — and the routed walk needs both in the same function.
+ FMA contraction fused a multiply-add one ULP off even under
  `-ffp-contract=off`, until pinned with `#pragma STDC FP_CONTRACT OFF`.
+ Python's `list.sort` is stable *and stays stable under* `reverse=True`, so two
  venues quoting the same price fill in feed-iteration order. Getting that
  tie-break backwards moves the blended VWAP by a ULP; a randomised
  differential test over #measured[400 cases][`docs/architecture/LATENCY_BUDGET.md` §2.1]
  on a shared price grid, of which
  #measured[106 of the 125 multi-venue cases][`docs/architecture/LATENCY_BUDGET.md` §2.1]
  diverge if the tie-break is reversed, is what holds it.

== Three latency planes, never blended <sec-planes>

The single most common way a latency claim becomes untrue is by blending units.
This system publishes three figures about three different things, in three
different units, and every surface that shows one names which.

#table(
  columns: (auto, auto, 1fr, 1.35fr),
  [Plane], [Unit], [What it measures], [Measured],
  [Decision], [µs], [the whole of `submit()` under the lock, including the check vector and the response object], [#measured[13.2 µs p50 native, 25.3 µs Python][`latency-bench.generated.json`, 2026-08-20]],
  [Core], [ns], [the compiled arithmetic battery, timed by `steady_clock` inside the engine], [#measured[83 ns p50, 84 ns p99][same run]],
  [Network], [ms], [order entry to the venue's matching engine], [#measured[72.7 ms Binance origin, 6.2 ms Bybit origin][`tools/colocation_probe.py`, OCI Singapore]],
)

The ratio is the argument. The compute is
#measured[0.02%][`docs/architecture/LATENCY_BUDGET.md`] of the path, and no
further optimisation of it changes the system's latency in any way a trader
could observe. Optimising the gate battery from 54.5 µs to 50.3 µs improved
end-to-end by #measured[0.006%][`docs/architecture/LATENCY_BUDGET.md` §2.3];
moving the whole battery into C++ afterwards improved it by another
#measured[0.01%][same]. Both were done for what they prove about the compute,
and neither is claimed as a win a trader would notice. The only lever that moves
the number by orders of magnitude is geography.

```
   72 700 us   order entry to Binance, origin   <- 5 860x the decision
   69 100 us   market data from Binance         <- 5 570x the decision
    6 160 us   order entry to Bybit, origin     <-   496x the decision
     12.4 us   the risk decision (native p50)
     0.08 us   the arithmetic core inside it
```

Three properties keep the planes from contaminating each other:

*The core figure is quantised, and the honest statistic is the fraction, not the
percentile.* `steady_clock` on the development machine advances in
#measured[41.677 ns][`latency-bench.generated.json`] steps and `duration_cast`
truncates, so 83 ns *is* two ticks and 125 ns *is* three. Quoting "84 ns p99"
alone would publish a rounding artefact as a speed-up. The figure with the
resolution is the fraction of calls finishing inside two ticks:
#measured[0.9952 of 5\u{2009}000][`latency-bench.generated.json`], across nine
runs ranging 0.9932 to 0.9976.

*The µs histogram is log-linear over the whole process life, never a sliding
window.* Eight linear sub-buckets per power of two gives about 12% resolution;
quantiles are nearest-rank over bucket upper edges, *clamped to the observed
maximum* — an unclamped p99.99 once reported 1152 µs against a real maximum of
1125 µs, and a quantile above the slowest decision ever recorded is not a
rounding artefact to explain in a footnote, it is a number that cannot be true.
A sliding window is refused because "we had a 4 ms decision last night" is
exactly the fact a window is designed to forget.

*Synthetic samples never enter the µs plane.* The gateway times the compiled
battery once at startup on a synthetic two-venue book — 50 warm-up calls
unrecorded, then #measured[300][`docs/architecture/LATENCY_BUDGET.md` §2.1]
recorded — so the nanosecond figure exists before the first order. Those samples
land only in the core histogram, are counted separately as
`core_self_test_samples`, and touch neither the decision histogram, the order
counters, the audit log, the token bucket nor the TCA engine. The desk chip
reads "no orders yet" for the µs plane while showing a real ns figure beside it,
and names the self-measure as its provenance.

*What the published figures exclude, and cannot include on this hardware.*
There is no NIC hardware timestamping and no PTP source on a cloud VM, so every
figure is in-process: it excludes the kernel network stack, the driver and the
wire. A published in-process number is a floor on the real latency, never the
real latency.

== The consolidated book and the liquidity surface <sec-book>

Two venues are streamed over WebSocket: Binance as `@depth20@100ms` and Bybit as
`orderbook.50`. The transport choice per venue is not stylistic. Binance's diff
stream requires a REST snapshot plus buffered-delta reconciliation and silently
corrupts the book if one message is dropped; the partial stream is self-healing
because every message is a complete top-20 snapshot. Bybit's feed *is*
sequence-tagged — `u` increments by exactly one per delta — so it is consumed as
snapshot plus delta, and any other step is a gap that forces a resubscribe
rather than trusting a book that may have holes.

The reference price is a depth-weighted consolidated mid, not a simple average:

$ M = (sum_v m_v w_v) / (sum_v w_v), quad
  w_v = max(1, "depth"_v^"bid"(5) + "depth"_v^"ask"(5)) $

A single venue's mid is unstable when that venue is thin; weighting by top-five
depth gives a reference that does not jump when one book momentarily crosses.
The *touch* is a separate query and deliberately not the same object: a resting
limit order crosses when somebody is actually showing a price through it, which
is the best bid or offer anyone displays, not a stable weighted reference.

Three surface properties are reported rather than smoothed away. A venue whose
book has not updated within its staleness clock is excluded from pricing before
it can poison a fill estimate. Crossed consolidated books are shown, not
clamped: across venues, best bid can genuinely exceed best ask for tens of
milliseconds, and that is exactly the signal a cross-venue arbitrage desk
watches. And when every feed is unreachable, a synthetic random-walk book keeps
the system demonstrable while every payload derived from it carries
`synthetic: true` and the surface marks it.

== Smart order routing <sec-routing>

The router merges every online venue's levels for the taking side into one
ladder sorted by price, and walks it greedily against the target notional $N$,
capping each level's contribution at its own notional $p_l q_l$:

$ "take"_l = min(p_l q_l, #h(2pt) N - sum_(j < l) "take"_j), quad
  Q = sum_l "take"_l / p_l, quad
  "VWAP" = (sum_l "take"_l) / Q $

*Proposition.* For a target notional fully absorbable by the merged ladder, the
greedy price-ordered walk maximises the filled quantity $Q$, and therefore
minimises the blended VWAP $= N\/Q$.

*Argument.* Any admissible allocation spends $N$ across levels subject to
$0 <= n_l <= p_l q_l$, yielding $Q = sum_l n_l\/p_l$. The objective is linear in
$n_l$ with coefficient $1\/p_l$, which is largest at the smallest price, so the
optimum fills levels in ascending price order until $N$ is exhausted — exactly
what the greedy walk does. Because $"VWAP" = N\/Q$ with $N$ fixed, maximising
$Q$ minimises VWAP. The per-venue split of that one walk *is* the routing
instruction.

*The assumption in that proposition is named rather than hidden.* It holds
because level notionals are independent and no venue-specific fee enters the
objective. This router models no per-venue fee differential and no size-tiered
schedule; fees are applied at fill time as one flat rate. On a live desk with
asymmetric maker/taker schedules the price-only optimum is not the cost optimum,
and that is an absence in this implementation, not a property of the method.

The exit condition and the fillable verdict both run against a relative
tolerance rather than an exact comparison:

$ "absorbs"(f, N) equiv f >= N(1 - 10^(-9)) $

A ladder walk reaches the requested notional by subtracting one level at a time,
so the total lands a few ULPs either side of the request, and a request not on a
cent boundary never matches a figure quantised to cents anywhere along the way.
Deciding fillability with a bare $>=$ reported "this book cannot absorb the
order" for orders the book demonstrably absorbed — the repository records a
`SELL` of 99.95002498750625 units rejected with "only \$10,095 of \$10,095
routable", the two figures identical to the dollar, while the same order at
exactly 99.95 went through. The tolerance is *relative* because this engine
prices instruments from cents to tens of thousands: a fixed dollar epsilon is
wrong at one end or the other. And the direction of the error matters more than
its size — a false accept releases an order into a book that cannot fill it,
whereas a false reject is cosmetic, so the tolerance is sized to absorb
arithmetic noise and nothing more. No caller may substitute the requested
notional for the measured one to make the comparison pass; that would make the
gate a tautology.

*The gate prices what the fill will do.* The liquidity check runs against the
routed execution, not the best single venue. Gating on the best venue alone
would reject orders the router could actually fill and understate cost on the
ones it accepted, and a dedicated test pins the slippage check and the fill
price to agree.

== Transaction cost analysis <sec-tca>

The per-venue and routed estimates are reported side by side with the saving the
route achieved against the *worst* fillable venue, in both bps and dollars —
against the worst rather than the best, because the saving a router is
responsible for is the one it avoided, and quoting it against the best venue
would report a number near zero on every well-behaved book.

Slippage on any walk is measured against the consolidated mid at decision time:

$ "slip"_"bps" = ("VWAP" - M)/M times 10^4 "  (BUY)", quad
  (M - "VWAP")/M times 10^4 "  (SELL)" $

For research rather than execution, the cost model is explicit and its
concavity is a *modelling choice a researcher makes*, not a fact a backtest
discovered:

$ c_"turnover" = ("fee"_"bps" + "slip"_"bps")/10^4 + k sqrt(min(1, Q\/"ADV")) $

The square-root law is the standard concave form — doubling order size costs
about $1.41 times$, not $2 times$, because a larger order is worked over more of
the book. The impact coefficient defaults to zero, so an unconfigured run
produces exactly the numbers the parity fixture pins, and a configured one is
labelled as a model on the surface that shows it. Holding costs are separate:
perpetual funding is charged on absolute exposure pro-rata to bar length against
an 8-hour period, and borrow only on short exposure pro-rata against a year.

== The order ticket and the paper-execution path <sec-ticket>

The ticket collects symbol, side, type, size (as quantity or notional), an
optional limit price, time in force and an optional `client_order_id`, and
returns the decision object with its full check vector, the failing gate named,
the latency and the fill. Three presets exist because a demonstration that
requires typing a plausible-looking bad order is a demonstration nobody runs: a
valid \$25k order, a \$500k fat finger blocked by the per-order cap, and a
twelve-order \$1k burst that the token bucket stops partway through.

Time in force has no default of its own; the sensible default differs by order
type, and is `GTC` for a `LIMIT` and `IOC` for a `MARKET`. Every client written
before resting orders existed therefore behaves exactly as it did.

=== Three fill models, and why they are three

*Taker.* A market order, or a limit that crosses the spread, fills at the smart
route's actual VWAP and pays `PAPER_FEE_BPS`
(#measured[4 bps][`Part2_Infrastructure/config.py`]). Filling at mid is the
single most common way a paper system flatters itself; walking the ladder means
paper P&L carries live cost structure.

*Maker.* A resting order fills when the consolidated touch crosses it, at *its
own limit price*, and pays `PAPER_MAKER_FEE_BPS`
(#measured[1 bp][`Part2_Infrastructure/config.py`]). It is on the other side of
that trade — somebody crossed the spread to reach it. Charging it a taker fee,
or filling it at a route VWAP that walked *through* its own limit, would report
a cost the desk did not pay. Its measured slippage against the mark is therefore
often negative, which is price improvement, and which makes maker-versus-taker
economics visible in the blotter rather than a footnote.

*Paper equity.* An order priced from a trusted vendor quote rather than an L2
ladder fills at $q(1 + delta dot s\/10^4)$ with
$s = #measured[8 bps][`Part2_Infrastructure/config.py`]$ fixed, and the gate
vector says so: no exchange depth is asserted, and the path accepts `MARKET`
only because a quote is a price and not a book.

=== Resting orders and the state that is deliberately absent

Five states cover a resting order's whole life: `WORKING`, `FILLED`,
`CANCELLED`, `EXPIRED` and `REJECTED`. A `DAY` order dies at the UTC session
boundary; an `IOC` with nothing to be immediate against is accepted — it passed
every gate — and immediately `EXPIRED`, which costs no machinery at all to say.

`PARTIALLY_FILLED` is absent, and its absence is load-bearing. The L2 feeds
carry ladder snapshots, not trade prints, so how much of a resting order a
crossing trade consumed *cannot be measured from this data*. A state that can
never be reached honestly is a state that advertises a model this system does
not have.

Committed capital is exposure whether or not it has landed. The concentration
and gross gates therefore price the resting book into their projections;
without that, two \$140k orders each pass a \$150k cap, both fill, and the book
sits at 187% of a hard limit with no gate having fired.

== Fill quality <sec-fillquality>

Realised cost is measured against the same reference the gateway priced the
decision at, which makes the effective spread exact rather than a stand-in:

$ "eff"_"bps" = 2|"slip"_"bps"|, quad
  "fee"_"bps" = ("fee"_"USD")/(|N|) times 10^4 $

Both are null-in, null-out. A fill nobody priced has no effective spread, and
zero would claim it traded exactly at the mid. Per-venue means are taken over
the count that *has* the measure, never the fill count, because averaging over
rows that carry no figure drags every mean toward zero. Fills carrying no venue
tag are reported as `unattributed` rather than absorbed, so the venue mix and
the headline fill count reconcile on screen.

*Realised spread is withheld, visibly.* Separating impact from reversion needs
the consolidated mid a few minutes *after* each fill. The gateway records mids
in its snapshot table but publishes no endpoint that serves them by timestamp,
so no post-trade reference exists on this surface. The column is drawn empty
rather than at zero, and that empty column is the point of the chart rather
than an apology for it: a two-bar chart of impact and fee would look complete
and quietly imply that cost has been fully decomposed. A spread measured at zero
and a spread nobody measured are opposite claims.

Price improvement is counted directly — the share of priced fills whose signed
slippage is negative, with the mean improvement over that subset — and the rate
is null when there are no priced fills at all, because "no fills" and "no
improvement" are different facts.

== The decision-latency distribution on the desk <sec-latdist>

A p50 and a p99 describe two points; the shape between them is where a bimodal
gate battery or a long tail shows up, so the desk draws the histogram as bars
rather than a line — these are counts per bin, and a line between bin centres
would imply a continuum the histogram is deliberately discretising. Below the
sample floor it renders the count instead of a chart, because a distribution
over a handful of decisions is a picture of nothing.

The same discipline governs the header chip. Its vocabulary distinguishes
`checking`, `no gateway`, `not published`, `no orders yet` and `measured`, each
carrying its own reason, and the p99.9 is withheld below
#measured[1\u{2009}000 samples][`web/lib/decision-plane.ts`] because
$ceil(0.999 times 1000) = 999$ — beneath that, the p99.9 is the maximum wearing
a decimal point. The chip also names which engine answered, so a container that
fell back to the Python reference is visible on the desk rather than only in a
warning nobody reads.

The tail beyond p99.9 is not the language. Disabling the cyclic garbage
collector around the same workload changed p50 not at all and p99 by about
#measured[0.1 µs][`docs/architecture/LATENCY_BUDGET.md` §2.2]. The core's own far
tail says the same thing from the other end of the scale: about six samples per
5\u{2009}000 land at 10 to 23 ticks, and they arrive in *bursts* — one slow call
immediately following another — which is the signature of preemption on a shared
hypervisor, not of a branch in the decision.

== What is not built, and why it waits <sec-absent>

#table(
  columns: (auto, 1fr),
  [Absent], [Reason it waits],
  [Live venue order entry], [Execution is paper-only. Fills are priced off the live ladder, but nothing is sent to an exchange; the surface says so on every fill.],
  [`PARTIALLY_FILLED`], [Unmeasurable from snapshot feeds. See @sec-ticket.],
  [Realised spread], [No endpoint serves a historical mid by timestamp. The column is drawn empty. See @sec-fillquality.],
  [Per-venue fee schedules in the router], [The route optimises price only. Naming the omission is cheaper than a router that looks fee-aware and is not.],
  [A measured clustering premium], [The two resamplers are pinned against each other for naming and rules, but no ratio between their tails on real book returns has been run. See @sec-resamplers.],
  [The parametric CVaR parity pin], [The two stacks carry expected-shortfall constants that differ in the ninth significant figure and nothing cross-checks them. See @sec-var.],
  [Co-location in the venue's region], [Not done, and the 68 ms to 0.1–0.5 ms figure is an expectation, not a measurement. The plan is probe-first: stand up an instance, run the same probe, migrate only if it confirms.],
  [Hardware timestamping], [Neither cloud tier exposes NIC timestamping or PTP, so no true tick-to-trade measurement is possible here and none is claimed.],
)

Every row above is a capability a competitor's document would omit. They are
listed because the alternative — inferring absence from silence — is how a
reader ends up trusting a number that was never measured, which is the single
failure this system, and this chapter, are built to prevent.
