// Chapter 5 — Mathematical foundations and model specifications.
//
// The formal core. Every equation here is either derived on the page from
// stated assumptions or read out of a named file in the tree, and every
// numeric figure carries one of those two provenances. Nothing is a plausible
// benchmark: the one number in this chapter that was produced by running
// something today (the i.i.d. vs block bootstrap tail comparison in §5.9.4)
// states the exact call that produced it, the seed, and the three-seed
// reproduction, because a Monte Carlo result quoted without its seed is not a
// measurement.
//
// Sources read in full before writing: web/lib/stats.ts,
// web/lib/quant/{ols,factors,sizing,tail-risk,cost-model,walk-forward,promotion,
// stability,common}.ts, web/lib/{engine,benchmark,liquidity,montecarlo,
// mc-distribution,portfolio-analytics,correlation}.ts,
// web/lib/portfolio-risk/{covariance,risk,var-validation,stress}.ts,
// web/lib/venues/fill-tolerance.ts, web/lib/blotter/fill-quality.ts,
// modules/backtester/statistics.py, modules/quant_risk/{_common,covariance,var,
// montecarlo,backtest,allocation,sizing}.py, modules/risk_proxy/accounting.py,
// config.py, tools/make_risk_fixture.py, web/lib/seed-run.json,
// web/lib/test-counts.generated.ts, web/tests/fixtures/gate-parity.json,
// docs/architecture/LATENCY_BUDGET.md, docs/planning/PRD.md.
//
// Every figure attributed to seed-run.json was re-derived from the file's own
// bestRunReturns before being quoted: the PSR, DSR, expected-max hurdle and
// MinTRL in §5.3 and §5.4 all reproduce the committed values to eleven
// significant figures, which is the check that the numbers quoted here are the
// numbers the engine actually produces rather than the numbers it records.

// The template is imported here as well as in main.typ because `include`
// evaluates a file in its own scope: `measured`, `illustrative` and `note` are
// not inherited from the including document. This is an import of helpers only
// and sets no page, font or numbering — that stays template.typ's job.
#import "../template.typ": illustrative, measured, note

= Mathematical Foundations and Model Specifications

This chapter is the formal core of the document. Every model the desk runs is
stated in the notation it is derived in, every symbol is defined, and every
equation is numbered. For each model three things are given: the derivation,
the assumption that makes it true, and the failure mode when that assumption
breaks. Where the implementation departs from the textbook form the departure
is named and argued, because the departures are the interesting part --- a
formula reproduced faithfully teaches nothing about the system that runs it.

Two facts about the codebase shape everything below. Almost every quantity
here exists twice --- once in Python for the gateway and the Telegram
companion, once in TypeScript for the browser, because neither runtime can
reach the other --- and the pairs are pinned against recorded fixtures, because
two implementations of one calculation are two chances to be wrong. And the
arithmetic refuses more often than it approximates: a percentile over twelve
observations, a payoff ratio with no losing trades, a covariance with a singular
design each return a typed absence carrying its reason. That is a mathematical
commitment rather than a presentational one, because it changes what the
estimators are allowed to return.

The worked example running through this chapter is one recorded sweep committed
as `web/lib/seed-run.json`: a moving-average crossover on BTCUSDT 4h bars,
#measured[1200][seed-run.json] bars from
#measured[2026-01-22 to 2026-08-10][seed-run.json], over
#measured[74][seed-run.json] parameter combinations. Where a figure below is an
evaluation of an equation on this page rather than a reading from the tree, it
says so.

== Notation and conventions

#table(
  columns: (auto, 1fr),
  [Symbol], [Meaning],
  [$r_t$], [Per-bar arithmetic return of the strategy or book at bar $t$],
  [$mu, sigma$], [Population per-bar mean and standard deviation of $r_t$],
  [$hat(mu), hat(sigma)$], [Their sample estimates, $hat(sigma)$ always with $"ddof" = 1$],
  [$n$], [Number of return observations],
  [$a$], [Bars per year for the interval in question --- the annualisation constant],
  [$S$], [Per-bar Sharpe ratio, $mu slash sigma$; $hat(S)$ its estimate],
  [$gamma_3, gamma_4$], [Sample skewness and raw (Pearson) kurtosis; normal $gamma_4 = 3$],
  [$Phi, phi$], [Standard normal CDF and density; $Phi^(-1)$ the quantile function],
  [$z_alpha$], [$Phi^(-1)(alpha)$, the one-tailed normal quantile],
  [$N$], [Number of trials in a parameter search],
  [$bold(w)$], [Vector of position weights as fractions of equity, signed],
  [$bold(Sigma)$], [Sample covariance matrix of per-bar returns, $p times p$],
  [$sigma_p$], [Per-bar portfolio volatility, $sqrt(bold(w)^T bold(Sigma) bold(w))$],
  [$E$], [Account equity in quote currency],
  [$Q$], [Order notional in quote currency; $"ADV"$ average daily volume in the same],
)

Three conventions hold throughout and are worth stating before they are used,
because each one is a decision that could have gone the other way.

*Per-bar is the unit of inference; annualised is a unit of display.* Every
inferential quantity in this chapter --- the probabilistic Sharpe, the deflated
Sharpe, the minimum track record length --- is computed on per-bar Sharpe
ratios. The annualised figure exists only to be printed. The engine
de-annualises before it corrects for multiple testing and re-annualises only
the reported hurdle (`web/lib/engine.ts`, lines 137 and 324). #ref(<sec:psr>)
shows what feeding an annualised Sharpe into a per-bar formula does; it does
not produce a slightly wrong answer, it produces certainty.

*The annualisation constant is a calendar fact, not a market fact.* The desk
trades instruments that do not close, so

#table(
  columns: 5,
  [interval], [15m], [1h], [4h], [1d],
  [$a$], [35 040], [8 760], [2 190], [365],
)

read from `modules/quant_risk/_common.py` and mirrored in the TypeScript's
`BARS_PER_YEAR`. Note 365, not the 252 an equity desk would use: a
continuously-traded instrument has no non-trading days to exclude. An unknown
interval falls back to 8 760 in the TypeScript
(`web/lib/quant/common.ts`) rather than raising, which is a defensible default
for hourly data and a silent error for anything else --- it is the one
annualisation path in the tree that does not refuse.

*A missing measurement is a typed state, never a zero.* Every estimator below
that can fail returns `null` with a reason attached rather than a number that
happens to be small. The sample floors are stated with each model.

== The Sharpe ratio and its scaling in time

=== Definition and estimator

For a return series with no risk-free deduction,

$ hat(S) = hat(mu) / hat(sigma), quad hat(mu) = 1/n sum_(t=1)^n r_t, quad hat(sigma) = sqrt(1/(n-1) sum_(t=1)^n (r_t - hat(mu))^2) $ <eq:sharpe>

The risk-free rate is zero in the numerator throughout, and that is a modelling
choice rather than an oversight. Financing is charged as an explicit cost
instead: `holdingCost` in `web/lib/quant/cost-model.ts` debits perpetual funding
at a rate in basis points per eight hours against absolute exposure, and an
annual borrow rate against short exposure. Subtracting a financing rate in the
numerator as well would charge the same cost twice. The consequence is that
$hat(S)$ here is a ratio of *net* return to volatility, not an excess return
over cash, and it is not directly comparable to a published Sharpe that
deducts a bill rate.

The Bessel correction is not optional anywhere in this tree. Both stacks use
$"ddof" = 1$ (`_stdev` in `modules/quant_risk/_common.py`, `stdev` in
`web/lib/stats.ts`), and both return exactly zero when $n - "ddof" <= 0$ rather
than dividing.

=== Scaling from per-bar to annual <sec:scaling>

Let $r_t (q) = sum_(j=0)^(q-1) r_(t-j)$ be the return over $q$ consecutive
bars. Under stationarity with autocorrelations $rho_k = "Corr"(r_t, r_(t-k))$,

$ bb(E)[r_t (q)] = q mu, quad "Var"[r_t (q)] = q sigma^2 + 2 sigma^2 sum_(k=1)^(q-1) (q - k) rho_k $ <eq:varq>

so the $q$-bar Sharpe is

$ S(q) = (q mu) / sqrt(q sigma^2 + 2 sigma^2 sum_(k=1)^(q-1) (q-k) rho_k) = S dot.c eta(q), quad eta(q) = q / sqrt(q + 2 sum_(k=1)^(q-1) (q-k) rho_k) $ <eq:eta>

The universal practice --- and the practice in this tree --- is
$S(q) = S sqrt(q)$. Comparing that with @eq:eta gives the exact condition under
which it is correct:

$ eta(q) = sqrt(q) quad <==> quad sum_(k=1)^(q-1) (q - k) rho_k = 0 $ <eq:naive>

Not $rho_k = 0$ for all $k$, but a weighted sum of them equal to zero: a series
whose positive and negative autocorrelations cancel under the triangular weight
$q - k$ scales by $sqrt(q)$ exactly, and a series with $rho_1 > 0$ does not.
For an AR(1) process with $rho_k = rho^k$ the sum closes:

$ sum_(k=1)^(q-1) (q-k) rho^k = (rho [(q-1) - q rho + rho^q]) / (1 - rho)^2 $ <eq:ar1>

*The failure mode.* Positive autocorrelation makes $eta(q) > sqrt(q)$, so naive
scaling *understates* the annual Sharpe of a trending series and *overstates*
that of a mean-reverting one. The direction most often complained about in the
literature is the opposite of this: a monthly-reported illiquid book with
smoothed marks has $rho_1$ strongly positive, and its naive annualised Sharpe
is too high --- because the smoothing suppresses $hat(sigma)$ at the reporting
frequency rather than because @eq:eta was applied wrongly. Both errors live in
the same equation and they are not the same error.

*What this series actually does.* Autocorrelations of the winning run's per-bar
returns, computed from the 1 200 values in `seed-run.json`:

#table(
  columns: 6,
  [lag $k$], [1], [2], [3], [4], [5],
  [$rho_k$ of $r_t$], [#measured[-0.0048][seed-run.json]], [#measured[-0.0267][seed-run.json]], [#measured[-0.0068][seed-run.json]], [#measured[0.0139][seed-run.json]], [#measured[0.0254][seed-run.json]],
  [$rho_k$ of $|r_t - hat(mu)|$], [#measured[0.4201][seed-run.json]], [#measured[0.3365][seed-run.json]], [#measured[0.3137][seed-run.json]], [#measured[0.2750][seed-run.json]], [#measured[0.3286][seed-run.json]],
)

Evaluating @eq:eta on the sample autocorrelations gives
$eta(5) = 2.2817$ against $sqrt(5) = 2.2361$, and
$eta(10) = 3.2445$ against $sqrt(10) = 3.1623$: naive scaling understates by
2.0% and 2.6% at those horizons. Both are evaluations of @eq:eta on the series
in `seed-run.json`, not separate measurements.

*And here is the limit the tree respects.* The annualisation actually applied
is $eta(2190)$. Estimating that from @eq:eta requires $rho_k$ out to lag 2 189
from 1 200 observations, which is not an estimation problem, it is an absence
of data. There is no honest correction factor to quote at the annual horizon,
so none is quoted and none is applied. What the tree does instead is confine
every *inference* to the per-bar quantities, where the sample supports it, and
treat the annualised Sharpe as a display figure. That is why the deflated
Sharpe machinery in the next two sections never touches an annualised number.

#note[The correction that is not implemented][
Lo (2002) gives $eta(q)$ from @eq:eta with a consistent estimator of the
autocovariance sum. It is not implemented in this tree, for the reason above:
at $q = a$ the estimator has no data. Applying it at a short horizon and
extrapolating would be worse than not applying it, because the result would
carry a precision the sample cannot support.
]

== The Probabilistic Sharpe Ratio <sec:psr>

=== Derivation

The Sharpe estimator @eq:sharpe is a ratio of two sample moments and is
therefore itself random. Under i.i.d. returns with finite fourth moment, the
delta method gives its asymptotic variance in terms of the higher moments of
the return distribution:

$ "Var"[hat(S)] approx 1/(n-1) (1 - gamma_3 S + (gamma_4 - 1)/4 S^2) $ <eq:varsharpe>

Two terms, two effects, and they pull in opposite directions. Positive
skewness *reduces* the variance of the Sharpe estimator; excess kurtosis
*increases* it. Treating @eq:varsharpe as the variance of an asymptotically
normal estimator and asking for the probability that the true Sharpe exceeds a
benchmark $S^*$ gives the Probabilistic Sharpe Ratio:

$ "PSR"(S^*) = Phi( ((hat(S) - S^*) sqrt(n - 1)) / sqrt(1 - gamma_3 hat(S) + (gamma_4 - 1)/4 hat(S)^2) ) $ <eq:psr>

implemented as `probabilisticSharpe` in `web/lib/stats.ts` and
`probabilistic_sharpe_ratio` in `modules/backtester/statistics.py`, with the
radicand clamped below at $10^(-12)$ in both so that an extreme skew cannot
produce a negative variance and a complex denominator.

=== The measured effect of non-normality, and the scale trap

The winning run's per-bar returns have
$gamma_3 = #measured[1.1618][seed-run.json]$ and
$gamma_4 = #measured[14.917][seed-run.json]$ --- right-skewed and very fat
tailed --- at $hat(S) = 0.032510$ per bar. The two correction terms are then

$ -gamma_3 hat(S) = -0.037769, quad (gamma_4 - 1)/4 hat(S)^2 = +0.003677 $

The skew term is an order of magnitude larger than the kurtosis term, and the
reason is structural rather than particular to this run: the skew term is
$O(hat(S))$ and the kurtosis term is $O(hat(S)^2)$, so at per-bar Sharpes of
order $10^(-2)$ the kurtosis correction is negligible however fat the tails
are. The denominator comes to 0.98281 against 1.00026 if normality had been
assumed, and

$ "PSR"(0) = #measured[0.87398][seed-run.json] quad "against" quad 0.86980 "under" gamma_3 = 0, gamma_4 = 3 $

*The scale trap.* Both terms are functions of a *per-bar* Sharpe, and the
kurtosis term is quadratic in it. Substituting the annualised
$hat(S) = 1.5214$ into @eq:psr gives a denominator of
$sqrt(1 - 1.7676 + 8.0530) = 2.699$ and a $z$-score of 19.5, so
$"PSR" = 1.000$: the same data, the same formula, one unit error, and the
answer is certainty. This is why both implementations state the per-bar
convention in the docstring of every function that takes a Sharpe, and why the
engine de-annualises the candidate vector explicitly before calling them.

=== Minimum track record length

@eq:psr inverts in closed form for $n$. The observation count at which
$"PSR"(S^*)$ first reaches confidence $c$ is

$ n^* = 1 + (1 - gamma_3 hat(S) + (gamma_4 - 1)/4 hat(S)^2) ((z_c) / (hat(S) - S^*))^2 $ <eq:mintrl>

`minTrackRecordLength` in `web/lib/stats.ts` and `min_track_record_length` in
`modules/backtester/statistics.py`, using the identical variance clamp so that
the two remain exact inverses under extreme skew. For the worked example
against $S^* = 0$ at $c = 0.95$, @eq:mintrl gives 2 473.55, reported as
#measured[2474 bars][seed-run.json] --- #measured[1.13 years][seed-run.json] of
4h bars, against the 1 200 bars the run actually has. The response records
`sufficient: false`.

Against the multiple-testing hurdle of the next section, $hat(S) < S^*$ and
@eq:mintrl diverges. Both implementations return $+infinity$, and the engine
converts that to `bars: null` rather than a large integer, because no finite
record can establish an edge that is not there. The absence is the answer.

*Failure mode.* @eq:varsharpe assumes i.i.d. returns --- the $sqrt(n-1)$ is the
independent-sample scaling --- so under autocorrelation the effective sample
size is smaller than $n$ and the PSR is overconfident by roughly the $eta$
factor of @eq:eta. Uncorrected, and it compounds with the uncorrected
annualisation: both errors point the same way for a positively autocorrelated
series.

== The Deflated Sharpe Ratio and the expected maximum of $N$ trials

=== The null

A parameter sweep does not estimate an edge; it reports a *maximum*. Running 74
combinations over a pure random walk reliably produces an impressive winner,
and the whole apparatus of this section exists to price that. Under the null
that every trial has true Sharpe zero and the trial Sharpes
$\{hat(S)_i\}_(i=1)^N$ are i.i.d. $cal(N)(0, V)$, what should the best of them
look like?

Let $M_N = max_i Z_i$ for $Z_i$ i.i.d. standard normal. With
$b_N = Phi^(-1)(1 - 1/N)$ and $a_N = 1 slash (N phi(b_N))$, the normalised
maximum $(M_N - b_N)/a_N$ converges to a standard Gumbel, whose mean is the
Euler--Mascheroni constant $gamma = 0.5772156649015329$. Hence
$bb(E)[M_N] approx b_N + gamma a_N$. Using the standard approximation
$a_N approx Phi^(-1)(1 - 1/(N e)) - Phi^(-1)(1 - 1/N)$ and collecting terms
gives the two-quantile form the code implements:

$ S^*_0 = sqrt(V[\{hat(S)_i\}]) [ (1 - gamma) Phi^(-1)(1 - 1/N) + gamma Phi^(-1)(1 - 1/(N e)) ] $ <eq:expmax>

The Deflated Sharpe Ratio is then simply the PSR measured against this hurdle
instead of against zero:

$ "DSR" = "PSR"(S^*_0) $ <eq:dsr>

The hurdle grows like $sqrt(2 ln N)$ --- slowly, and without bound. Evaluating
@eq:expmax:

#table(
  columns: 6,
  [$N$], [10], [74], [100], [1 000], [10 000],
  [$S^*_0 slash sqrt(V)$], [1.5746], [2.4228], [2.5306], [3.2551], [3.8607],
)

Those are evaluations of @eq:expmax, not measurements. The shape is the point:
a hundredfold increase in the size of the search raises the hurdle by about
50%, so the correction is real but never punitive enough to make a large grid
safe by itself.

=== The worked example, end to end

Every figure here is read from `web/lib/seed-run.json` or reproduces from it.

#table(
  columns: (1fr, auto, auto),
  [Quantity], [Per bar], [Annualised ($times sqrt(2190)$)],
  [Trials $N$], [#measured[74][seed-run.json]], [---],
  [$sqrt(V[\{hat(S)_i\}])$], [0.015667], [0.73316],
  [$Phi^(-1)(1 - 1 slash N)$], [2.21113], [---],
  [$Phi^(-1)(1 - 1 slash (N e))$], [2.57782], [---],
  [Hurdle $S^*_0$ (@eq:expmax)], [0.037957], [#measured[1.77628][seed-run.json]],
  [Selected $hat(S)$], [0.032510], [#measured[1.52140][seed-run.json]],
  [$"PSR"(0)$], [#measured[0.87398][seed-run.json]], [---],
  [$"DSR" = "PSR"(S^*_0)$], [#measured[0.42391][seed-run.json]], [---],
)

The selected Sharpe sits *below* the hurdle the search alone would have
produced. Stated in one sentence: an annualised Sharpe of 1.52, which is 87%
likely to beat zero, is only 42% likely to beat the best of 74 coin flips over
the same 1 200 bars. The promotion gate's threshold is
#measured[DSR $>=$ 0.95][promotion.ts], and this candidate fails it.

=== The departure, and why it matters

Both implementations compute the dispersion $V$ of the trial Sharpes and
deliberately *discard their mean*. Adding the sample mean back --- the common
implementation slip, named as such in the docstrings of both `deflatedSharpe`
and `deflated_sharpe_ratio` --- would make the hurdle
$macron(S) + S^*_0$. On a grid that is uniformly unprofitable $macron(S) < 0$,
the hurdle goes negative, and a losing strategy clears it. The mean candidate
Sharpe of this particular grid is 0.0177 annualised, barely positive; a grid
one degree less lucky would have demonstrated the failure directly.

*Failure mode: trials are not independent.* The 74 combinations of a
moving-average grid overlap heavily --- $(30, 60)$ and $(30, 80)$ share most of
their trades --- so the effective number of independent trials is well below
74. Since $bb(E)[max]$ of $N$ dependent draws is below that of $N$ independent
ones, @eq:expmax overstates the hurdle and the DSR is *conservative*. That is
the safe direction, and it is the reason no effective-trial estimator is
implemented: a correction that raises a passing probability needs a much
stronger argument than one that lowers it. What is not available anywhere in
the tree is an estimate of how far the hurdle is overstated.

*Failure mode: the search and the test share the data.* @eq:dsr conditions on
the selected Sharpe as though it were one draw when it was chosen for being the
largest, and the PSR sampling distribution is not adjusted for that selection
beyond the shift in the benchmark. Walk-forward, in #ref(<sec:gate>), is the
independent evidence; DSR is a price, not a proof.

== The promotion gate as a joint test <sec:gate>

Six vetoes stand between a candidate and execution, read from
`web/lib/quant/promotion.ts`, and each is shown whether it passes or fails,
because a panel that appears only on success teaches readers that silence means
safety.

#table(
  columns: (auto, auto, 1fr),
  [Gate], [Hurdle], [What it prices],
  [Deflated Sharpe], [$>= 0.95$], [The search itself, @eq:dsr],
  [Walk-forward OOS Sharpe], [$> 0$], [Performance on bars the parameters never saw],
  [Walk-forward efficiency], [$>= 0.5$], [Median $"SR"_"oos" slash "SR"_"is"$ across folds, defined only where $"SR"_"is" > 0$],
  [Parameter neighbourhood], [plateau or slope], [Neighbour Sharpe retention on the grid lattice],
  [Alpha $t$-statistic], [$|t| >= 2$], [Return not explained by the three factors of @eq:factors],
  [Trade count], [$>= 30$], [Sample supporting every ratio above],
)

The efficiency gate's domain restriction is the interesting one: dividing by a
negative in-sample Sharpe yields a *positive* ratio for a fold that lost money
in both windows, so such folds report `null` and are counted separately rather
than folded into a median that would flatter the strategy.

The worked example passes #measured[2 of 6][seed-run.json] --- parameter
neighbourhood (`slope`) and alpha $t$-statistic
(#measured[3.25][seed-run.json]) --- and fails DSR
(#measured[0.424][seed-run.json]), out-of-sample Sharpe
(#measured[-1.06][seed-run.json]), efficiency
(#measured[-0.26][seed-run.json]) and trade count
(#measured[8][seed-run.json]), at an overfitting probability across four folds
of #measured[0.75][seed-run.json].

*What the gate is not.* Six thresholds applied conjunctively is not a test of
size $alpha$. The joint distribution of the six statistics under the null is
not known, is not estimated anywhere in the tree, and cannot be recovered from
the marginals --- DSR and the walk-forward statistics are computed on
overlapping data and are strongly dependent. The gate is a set of vetoes chosen
so that each failure is individually interpretable; its joint false-pass rate is
unquantified, and saying so is cheaper than implying otherwise.

== Multi-factor risk decomposition

=== The factor set

Three factors, all constructible from one instrument's bars, all executed with
the same one-bar lag as the strategy (`web/lib/quant/factors.ts`):

$ f^"mkt"_t = r^"px"_t, quad
  f^"trend"_t = "sgn"(product_(j=t-L)^(t-1)(1 + r^"px"_j) - 1) dot.c r^"px"_t, quad
  f^"vol"_t = cases(+r^"px"_t &"if" hat(sigma)_(t-1,L) <= macron(sigma)_(t-1), -r^"px"_t &"otherwise") $ <eq:factors>

with $L = 30$ bars. The threshold $macron(sigma)_(t-1)$ is an *expanding* mean
of every trailing volatility observed strictly before $t$, not a full-sample
median, and the reason is the direction of the leak: a full-sample threshold
would let the factor at bar 100 know what volatility looks like at bar 1 900,
producing a benchmark stronger than anything anyone could have traded and
making the strategy's alpha against it too *low*. Look-ahead that flatters the
benchmark argues away real edge, and it is the direction nobody checks for.

=== Ordinary least squares, and the standard errors that are not corrected

With design matrix $bold(X) in RR^(n times k)$ (intercept in column zero),

$ hat(bold(beta)) = (bold(X)^T bold(X))^(-1) bold(X)^T bold(y), quad
  hat(sigma)^2_epsilon = (bold(e)^T bold(e)) / (n - k), quad
  "se"(hat(beta)_a) = sqrt(hat(sigma)^2_epsilon [(bold(X)^T bold(X))^(-1)]_(a a)) $ <eq:ols>

solved by Gauss--Jordan with partial pivoting on the augmented
$[bold(X)^T bold(X) | bold(I)]$, which yields the inverse as a by-product ---
required anyway, since its diagonal is what turns a coefficient into a
$t$-statistic. A pivot below $10^(-12)$ returns `null` rather than emitting
infinities: a perfectly collinear factor set is a modelling error, and `NaN`
propagating into a screen of plausible numbers is worse than an honest gap.

Measured on the worked example, $n = 1200$:

#table(
  columns: (1fr, auto, auto, auto),
  [Regressor], [$hat(beta)$], [$t$], [$p$],
  [Intercept (per bar)], [#measured[0.00033033][seed-run.json]], [#measured[3.2457][seed-run.json]], [#measured[0.00117][seed-run.json]],
  [Market], [#measured[0.38935][seed-run.json]], [#measured[33.97][seed-run.json]], [$< 10^(-15)$],
  [Trend (TSMOM)], [#measured[0.26116][seed-run.json]], [#measured[22.50][seed-run.json]], [$< 10^(-15)$],
  [Volatility regime], [#measured[0.09274][seed-run.json]], [#measured[8.05][seed-run.json]], [#measured[8.9e-16][seed-run.json]],
)

with $R^2 = #measured[0.5928][seed-run.json]$, idiosyncratic share
#measured[0.4072][seed-run.json], annualised intercept
#measured[0.7234][seed-run.json] and information ratio
#measured[4.397][seed-run.json] --- the last defined against *residual*
volatility rather than total, since the risk actually taken beyond the factors
is what the ratio is meant to price.

*The departure.* These are plain OLS standard errors. Strategy returns are
heteroskedastic and mildly autocorrelated, so a heteroskedasticity- and
autocorrelation-consistent estimator

$ hat(bold(Omega))_"HAC" = hat(bold(Gamma))_0 + sum_(k=1)^(m) w_k (hat(bold(Gamma))_k + hat(bold(Gamma))_k^T), quad w_k = 1 - k/(m+1) $ <eq:hac>

would *widen* them. The significance reported above is therefore, if anything,
generous. This is stated in the source rather than assumed away, and it is why
the interface frames a significant intercept as "not explained by these three
factors" and never as "real alpha". @eq:hac is not implemented.

=== The covariance estimator, and its conditioning

Both stacks compute the plain sample covariance over the window every symbol
shares:

$ hat(Sigma)_(i j) = 1/(n-1) sum_(t=1)^n (r_(i,t) - hat(mu)_i)(r_(j,t) - hat(mu)_j) $ <eq:cov>

Series are *truncated to the shortest common length, never padded*, because the
padding failure is silent: zeros read as zero-return days, which understates
that symbol's variance and --- because the padded zeros line up across symbols
--- inflates every correlation toward one. Both errors make the book look safer
than it is. Summation is sequential in both implementations, never `math.fsum`
and never `numpy.dot`: pairwise summation rounds differently from JavaScript's
left-to-right accumulation, and the parity fixture exists to catch that drift.

*Conditioning.* @eq:cov has rank at most $min(n - 1, p)$. Under the
Marchenko--Pastur law with aspect ratio $c = p slash n$, the eigenvalues of a
sample covariance from i.i.d. Gaussian data with true covariance $sigma^2 bold(I)$
spread over $[sigma^2 (1 - sqrt(c))^2, sigma^2 (1 + sqrt(c))^2]$, giving a
condition number

$ kappa approx ((1 + sqrt(c)) / (1 - sqrt(c)))^2 $ <eq:mp>

At twelve symbols and sixty observations $c = 0.2$ and
$kappa approx #illustrative[6.9]$; at twelve symbols and the twenty-observation
floor $c = 0.6$ and $kappa approx #illustrative[62]$. Both are evaluations of
@eq:mp under an assumption --- i.i.d. Gaussian returns --- that the desk's data
does not satisfy, which is why they are marked illustrative rather than
measured. The qualitative statement they support is the one that matters: the
estimator degrades sharply as $p$ approaches $n$, and the minimum-variance
solver of #ref(<sec:euler>) inverts against it.

*No shrinkage is applied.* The Ledoit--Wolf estimator
$hat(Sigma)_delta = delta F + (1 - delta) hat(Sigma)$, with $F$ a structured
target and $delta$ chosen to minimise expected Frobenius loss, is not
implemented. The honest reason is that the shrinkage intensity $delta$ would
become a number the desk would have to defend on every screen that quotes a
VaR, and the alternative --- a documented sample floor with a refusal below it
--- is auditable in a way a shrunk matrix is not.

*A divergence between the two implementations, and the fixture that cannot see
it.* The TypeScript requires at least twenty observations per symbol *and* at
least twenty in the common window (`web/lib/portfolio-risk/covariance.ts`),
returning `null` otherwise. The Python requires two
(`build_covariance` in `modules/quant_risk/covariance.py`). A book whose
history is short therefore gets a refusal in the browser and a
two-observation covariance from the gateway --- one estimate, two floors. The
parity fixture cannot detect this: `tools/make_risk_fixture.py` generates
#measured[220 observations][make_risk_fixture.py] with a
#measured[60-bar window][make_risk_fixture.py], so no scenario in it ever
presents a series short enough for the floors to disagree. This is stated here
because it is exactly the class of defect that two implementations plus a
fixture are supposed to prevent, and in this instance do not.

=== Euler allocation of risk to positions <sec:euler>

Portfolio volatility $sigma_p (bold(w)) = sqrt(bold(w)^T bold(Sigma) bold(w))$
is homogeneous of degree one in $bold(w)$: $sigma_p (lambda bold(w)) = lambda sigma_p (bold(w))$
for $lambda > 0$. Euler's theorem for homogeneous functions therefore gives an
*exact* additive decomposition, not an approximation:

$ sigma_p = sum_(i=1)^p w_i (partial sigma_p) / (partial w_i), quad
  "MCR"_i = (partial sigma_p) / (partial w_i) = (bold(Sigma) bold(w))_i / sigma_p, quad
  "CCR"_i = w_i "MCR"_i $ <eq:euler>

The additivity is the entire point. A "risk contribution" that does not sum to
the total is a ranking, not an attribution, and cannot answer the only question
a risk manager asks of it: what do I cut to lose the most risk per dollar. The
guard suite pins the identity directly --- the components must sum to
$sigma_p$ to within $10^(-12)$, and the shares to one
(`web/tests/portfolio-risk-contributions.test.ts`).

Two implementation decisions follow from @eq:euler and are worth naming.

*Weights are fractions of equity, not of gross.* Risk is measured against the
capital that absorbs the loss. Using gross notional would report identical
volatility for a book at $1 times$ and one at $5 times$ leverage. The suite
pins the consequence: five times the exposure is five times the VaR, to
$10^(-9)$.

*Contributions are signed.* A hedge enters the quadratic form with a negative
weight, its covariance with the longs subtracts, and its component contribution
is *negative*. A position can be 30% of the notional and reduce total risk.
That number cannot be produced by a notional-weighted view at all, which is why
it exists.

The two stacks then diverge in what they summarise. The Python reports a
diversification ratio $sum_i |w_i| sigma_i slash sigma_p$; the TypeScript
reports the largest absolute pairwise correlation in the book. Both are
defensible; they are different statistics, computed from the same matrix, and
no fixture requires them to agree because they are not the same quantity.

=== Marginal, component and incremental VaR

Under the parametric model of #ref(<sec:var>), $"VaR"_alpha = z_alpha sigma_p E$
inherits the homogeneity of $sigma_p$, so the decomposition carries over
directly:

$ "MVaR"_i = z_alpha E (bold(Sigma) bold(w))_i / sigma_p, quad
  "CVaR"^"comp"_i = w_i "MVaR"_i, quad sum_i "CVaR"^"comp"_i = "VaR"_alpha $ <eq:cvar>

*Incremental* VaR --- the change in book VaR from removing position $i$
entirely --- is a different object and does not sum to the total:

$ "IVaR"_i = z_alpha E ( sigma_p - sqrt(sigma_p^2 - 2 w_i (bold(Sigma) bold(w))_i + w_i^2 Sigma_(i i)) ) $ <eq:ivar>

@eq:ivar is exact, needs no new estimation, and costs one square root per
position. It is *not implemented anywhere in this tree*. For small $w_i$ it
converges to $"CVaR"^"comp"_i$; for a large position the two diverge by the
concavity of $sigma_p$, and the gap is precisely the interaction term a risk
manager wants when the question is "what if we exit this line entirely" rather
than "what is this line's share". Naming the absence is cheaper than letting a
reader assume the component figure answers the incremental question.

== Value at Risk and its validation <sec:var>

=== The parametric figure

$ "VaR"_alpha = z_alpha sigma_p E, quad
  "ES"_alpha = (phi(z_alpha)) / (1 - alpha) sigma_p E $ <eq:parvar>

with $z_(0.95) = 1.6448536269514722$ and $z_(0.99) = 2.3263478740408408$,
identical literals in both stacks. The expected-shortfall multiplier
$phi(z_(0.95)) slash 0.05$ is where they part company:

#table(
  columns: (1fr, auto, auto),
  [Source], [Constant], [Deviation from $phi(z_(0.95)) slash 0.05$],
  [`modules/quant_risk/_common.py`], [#measured[2.0627128027825736][\_common.py]], [$-4.7 times 10^(-9)$],
  [`web/lib/portfolio-risk/risk.ts`], [#measured[2.0627128054846826][risk.ts]], [$-2.0 times 10^(-9)$],
  [Exact, double precision], [2.0627128075074275], [---],
)

The two implementations differ by $1.3 times 10^(-9)$ relative and neither
equals the exact value. The consequence is bounded: on a book with $sigma_p E$
of ten thousand dollars the two expected shortfalls differ by about
$3 times 10^(-5)$ dollars, far below the cent at which any surface rounds. It is
recorded because the fixture tolerance, not the constants, is what keeps them
agreeing --- `web/tests/parity.test.ts` compares Sharpe and its relatives at
$10^(-6)$ relative, three orders of magnitude looser than the gap, so the
divergence is invisible to the mechanism built to catch divergences.

=== The empirical figure, and why the tail is selected by rank

The historical VaR replays today's book weights over past returns and reads the
loss distribution directly, assuming nothing about its shape. With the replayed
P&L sorted ascending and $k = ceil((1 - alpha) n)$,

$ "VaR"^"hist"_alpha = -x_((k)), quad "CVaR"^"hist"_alpha = -1/k sum_(j=1)^k x_((j)) $ <eq:histvar>

The tail is selected *by rank*, never by value. Averaging everything at or
below the VaR threshold is equal to @eq:histvar only when the quantile is not a
repeated value, and in a backtest it very often is: a strategy that is flat most
of the time earns exactly zero on every bar it holds nothing, so at low exposure
the fifth percentile lands on that atom of zeros, the "tail" becomes every
non-positive bar, and the mean is taken over most of the sample. The comment in
`web/lib/quant/tail-risk.ts` records what that cost when it was live --- CVaR95
understated by #measured[19.8 times][tail-risk.ts] and CVaR99 by
#measured[99 times][tail-risk.ts] on a default RSI run, with the two printed as
the same number, which is the visible tell that selection was by value.

Both stacks refuse below twenty aligned observations. A percentile over a dozen
days is a single data point wearing a statistic's name.

For the worked example the per-bar figures are
$"VaR"_(95) = #measured[-0.00809][seed-run.json]$,
$"CVaR"_(95) = #measured[-0.01305][seed-run.json]$,
$"VaR"_(99) = #measured[-0.01793][seed-run.json]$,
$"CVaR"_(99) = #measured[-0.02121][seed-run.json]$, with an ulcer index of
#measured[0.03853][seed-run.json].

=== Backtesting the forecast: Kupiec

A VaR nobody has back-tested is an opinion. Count exceptions --- days whose
realised loss exceeded the forecast --- and test the count against the model's
own claim. With $n$ scored observations, $x$ exceptions, nominal rate
$alpha' = 1 - alpha$ and $hat(p) = x slash n$, the proportion-of-failures
likelihood ratio is

$ "LR"_"uc" = -2 ln ( ((1 - alpha')^(n-x) alpha'^x) / ((1 - hat(p))^(n-x) hat(p)^x) ) ~ chi^2_1 $ <eq:kupiec>

and for one degree of freedom the survival function is exactly
$P(chi^2_1 > y) = "erfc"(sqrt(y slash 2))$ --- no series expansion, no
dependency, correct to machine precision in the Python and to
$1.5 times 10^(-7)$ in the TypeScript, which lacks `erfc` and uses the
Abramowitz--Stegun 7.1.26 rational form. Both branch explicitly at $x = 0$ and
$x = n$, where @eq:kupiec contains $ln 0$.

The forecast is re-estimated on a rolling sixty-bar window and scored against
the *next* bar's realised P&L, so it is never judged on data it was fitted to,
with the book held at today's weights so that what is measured is the *model*
rather than the trading. A $p$-value below 0.05 rejects in *either* direction:
too many exceptions understates risk, and too few means the desk is holding
capacity it never uses. A model with zero exceptions is not conservative, it is
wrong in the expensive direction.

*Failure mode, and the test that is missing.* @eq:kupiec examines
*unconditional coverage only*. It cannot see clustering: five exceptions spread
evenly across a hundred days and five arriving in one week produce the identical
statistic, and only the second is a model failure a desk would care about.
Christoffersen's independence test, built from the two-state transition counts
$n_(i j)$ of the exception indicator,

$ "LR"_"ind" ~ chi^2_1, quad "LR"_"cc" = "LR"_"uc" + "LR"_"ind" ~ chi^2_2 $ <eq:christoffersen>

is *not implemented*. That absence is more pointed here than it would be
elsewhere, because the measured absolute-return autocorrelation of
#measured[0.4201][seed-run.json] at lag one says clustered exceptions are the
*expected* failure of this data, not a hypothetical one. Power is also thin by
construction: at sixty scored bars and $alpha' = 0.05$ the expected exception
count is three, and @eq:kupiec discriminates poorly between three and six.

== Optimal execution

=== The Almgren--Chriss formulation

Liquidate $X$ units over horizon $T$ in $N$ intervals of length
$tau = T slash N$. Let $x_j$ be the holding at $t_j = j tau$, with $x_0 = X$
and $x_N = 0$, and $n_j = x_(j-1) - x_j$ the trade in interval $j$. Impact is
split into a permanent component $g(v) = gamma v$, which moves the reference
price and never comes back, and a temporary component
$h(v) = epsilon "sgn"(v) + eta v$, which is paid on the trade that causes it.
The price evolves

$ S_j = S_(j-1) + sigma sqrt(tau) xi_j - tau g(n_j slash tau), quad
  tilde(S)_j = S_(j-1) - h(n_j slash tau) $ <eq:acprice>

with $xi_j$ i.i.d. standard normal. Implementation shortfall
$C = X S_0 - sum_j n_j tilde(S)_j$ then has

$ bb(E)[C] = gamma/2 X^2 + epsilon sum_(j=1)^N |n_j| + tilde(eta)/tau sum_(j=1)^N n_j^2, quad
  "Var"[C] = sigma^2 tau sum_(j=1)^(N-1) x_j^2 $ <eq:accost>

where $tilde(eta) = eta - gamma tau slash 2$. The trader minimises
$bb(E)[C] + lambda "Var"[C]$ for risk aversion $lambda > 0$. Differentiating
with respect to an interior $x_j$ --- noting $x_j$ appears in both $n_j$ and
$n_(j+1)$ --- gives

$ (2 tilde(eta))/tau (2 x_j - x_(j-1) - x_(j+1)) + 2 lambda sigma^2 tau x_j = 0
  quad ==> quad (x_(j-1) - 2 x_j + x_(j+1)) / tau^2 = tilde(kappa)^2 x_j $ <eq:acode>

with $tilde(kappa)^2 = lambda sigma^2 slash tilde(eta)$. @eq:acode is a
discrete second-order boundary-value problem; with $x_0 = X$, $x_N = 0$ its
solution is the hyperbolic trajectory

$ x_j = X (sinh(kappa (T - t_j))) / (sinh(kappa T)), quad
  2/tau^2 (cosh(kappa tau) - 1) = tilde(kappa)^2 $ <eq:actraj>

and $kappa = tilde(kappa) + O(tau^2)$ as $tau -> 0$. The two corners are worth
naming because the desk lives in one of them. As $lambda -> 0$, $kappa -> 0$
and @eq:actraj degenerates to $x_j = X(1 - t_j slash T)$, the constant-rate
liquidation --- TWAP. As $lambda -> infinity$ the trajectory collapses to
$x_1 = 0$: sell everything immediately and pay the impact. Sweeping $lambda$
traces the efficient frontier of execution, along which
$d bb(E)[C] slash d "Var"[C] = -lambda$, with $1 slash kappa$ the half-life of
the position.

#raw(block: true, lang: none, "  E[C]  ^
        |  *                      lambda large: trade fast, pay impact
        |    *
        |      *
        |         *
        |             *  *
        |                     *  *  *   lambda small: trade slow, carry risk
        +-------------------------------->  Var[C]")

Each point on that curve is one optimal trajectory @eq:actraj, and the desk
occupies its lower-right end by default: constant participation, @eq:ttl.

=== What the desk implements, and what it does not

*The Almgren--Chriss scheduler is NOT BUILT.* The reason is structural rather
than mathematical: the order path is single-shot. An order is priced, gated and
either sent or refused; there is no child-order clock, no working-order slicer,
and therefore nothing that would execute a trajectory $x(t)$. A solved
trajectory with no executor is precisely the capability-with-no-caller defect
this repository keeps a scar about, so it is absent rather than stubbed.

What does exist is three pieces of the same problem, each measurable, each
cited.

*A concave impact model.* `turnoverCost` in `web/lib/quant/cost-model.ts`
charges

$ c(Q) = ("fee"_"bps" + "slip"_"bps") / 10^4 + k sqrt(min(1, Q slash "ADV")) $ <eq:sqrtimpact>

the square-root law, in place of the linear $h(v) = eta v$ of @eq:acprice.
Doubling order size costs about $1.41 times$, not $2 times$. The consequence is
immediate and is the reason the AC closed form cannot simply be adopted here:
@eq:actraj is a consequence of the cost being *quadratic* in the trade rate. A
concave $h$ gives a different Euler--Lagrange equation and no hyperbolic
solution. The coefficient $k$ defaults to zero, so an unconfigured run
reproduces exactly the figures the parity fixture pins, and the interface
labels the result a model rather than a measurement --- a slippage figure a
researcher chose is an assumption they are making.

*A ladder walk that measures rather than models.* `walkBook` and `smartRoute`
in `web/lib/venues/fill-tolerance.ts` consume a real consolidated book level by
level and return the achievable VWAP and its slippage against the depth-weighted
mid. Under a blended-slippage bound $v_max$ a boundary level is partially
consumed in closed form --- with running notional $N$ and quantity $Q$ at level
price $p$, the admissible take for a buy is
$t = p(v_max Q - N) slash (p - v_max)$ --- and a cap with no resolvable mid
routes nothing, because enforcing a cap without a reference price would be a
lie.

*A constant-participation horizon.* `timeToLiquidate` in
`web/lib/liquidity.ts` reports

$ T_"exit" = |Q| / (P dot.c "ADV"), quad P = #measured[0.10][liquidity.ts] "by default" $ <eq:ttl>

@eq:ttl *is* the $lambda -> 0$ corner of @eq:actraj, expressed in days rather
than as a trajectory: constant participation is constant rate is TWAP. The desk
therefore already computes the risk-neutral schedule's *duration* without ever
computing the schedule.

*And the pre-trade gate.* `MAX_EST_SLIPPAGE_BPS` defaults to
#measured[75][config.py] and `MAX_PRICE_DEVIATION_BPS` to
#measured[500][config.py]; an order whose measured walk exceeds the first is
refused.

=== What the missing scheduler would be worth

The pieces above admit the trade-off symbolically, which is the honest way to
say what is being forgone. Under @eq:sqrtimpact the total *dollar* cost of a
single-shot order is

$ C_1 (Q) = Q dot.c k sqrt(Q slash "ADV") = k Q^(3 slash 2) slash sqrt("ADV") $ <eq:c1>

Splitting into $m$ equal children of size $Q slash m$, each paying impact on its
own size,

$ C_m = m dot.c (Q/m) k sqrt(Q/(m "ADV")) = C_1 slash sqrt(m) $ <eq:cm>

Two consequences follow immediately. First, the single-shot figure the gate
enforces is an *upper bound* on the cost of any schedule, so the gate errs in
the safe direction --- it refuses some orders a scheduler could have worked.
Second, the saving has a price: spreading over $m$ children at fixed spacing
$tau$ carries timing risk over a horizon $m tau$, which under @eq:accost is
proportional to $sigma Q sqrt(m tau)$. Minimising
$A m^(-1 slash 2) + lambda B m^(1 slash 2)$ gives

$ m^* = A / (lambda B), quad C(m^*) = 2 sqrt(lambda A B) $ <eq:mstar>

the same square-root frontier shape as @eq:acode produces, with a different
exponent inside it. @eq:mstar is a derivation, not a measurement: no schedule
has been run, and no number is quoted for $A$, $B$ or $lambda$ because the desk
has never measured its own risk aversion.

== Tracking error, drawdown and position sizing

=== Tracking error and the information ratio

Against an external benchmark with returns $b_t$, the active return is
$a_t = r_t - b_t$ and

$ "TE" = sqrt(a) dot.c sqrt(1/(n-1) sum_t (a_t - macron(a))^2), quad
  "IR" = (a dot.c macron(a)) / "TE" $ <eq:te>

`compareToBenchmark` in `web/lib/benchmark.ts`, which reuses @eq:ols with the
benchmark as a single factor rather than writing a second two-variable
regression that would drift from the shared one within a release. Correlation is
recovered as $"sgn"(hat(beta)) sqrt(R^2)$, identical to computing it directly
for a single-factor fit and one fewer place for the two to disagree by a
rounding step.

Two guards, both with measured reasons. The information ratio is `null` when
$"TE" <= 10^(-9)$: a strategy that replicates its benchmark produces active
returns that are zero to within a couple of ulps, not exactly zero, leaving a
tracking error near $10^(-17)$ and an information ratio in the billions --- float
residue presented as the best risk-adjusted result ever recorded. And the join
is on a bucket key derived from the interval rather than on raw timestamps,
because two vendors rarely stamp the same bar identically and an empty
intersection through a regression is not an error but a `null`. Fewer than
#measured[30][benchmark.ts] aligned bars and no comparison is reported at all.

=== Two different objects both called drawdown

$ "DD"_t = E_t / (max_(s <= t) E_s) - 1 quad "against" quad
  "DD"^"open"_t = max(0, -(E_t - E_"open") / E_"open") $ <eq:dd>

The first is drawdown from the running high-water mark, which is what
`drawdownSeries` in `web/lib/portfolio-analytics.ts` draws and what the ulcer
index $U = sqrt(overline("DD"^2))$ integrates. The second is what the circuit
breaker actually reads (`daily_drawdown_pct`,
`modules/risk_proxy/accounting.py`): loss from *start-of-day equity*, floored
at zero. They are not the same number, and $"DD"^"open" <= |"DD"|$ always ---
a book that rallied 3% and then fell 4% is 1% down on the open and 4% off its
peak. The breaker therefore trips strictly later than a peak-referenced rule
would, and any calibration of it must be done in the units it measures.

The response is a graduated ladder rather than a switch, read from `config.py`:

#table(
  columns: (auto, auto, 1fr),
  [Level], [Default], [Behaviour],
  [`ALERT_DRAWDOWN_PCT`], [#measured[3%][config.py]], [Breach pushed to subscribers; trading unaffected],
  [`REDUCE_ONLY_THRESHOLD`], [#measured[0.80][config.py] of budget, i.e. 4%], [Risk-increasing orders refused, risk-reducing orders still pass],
  [`MAX_DAILY_DRAWDOWN_PCT`], [#measured[5%][config.py]], [Halt],
)

The alert sits well below the halt on purpose: an alert that fires at the same
moment as the kill switch is a notification, not a warning. The middle rung is
the FIA practice of letting a desk close out of trouble but not deeper into it.

=== From drawdown budget to position size

Model the book's log equity over one session as Brownian motion with zero drift
and per-session volatility $sigma_d$. The breaker monitors continuously, so the
quantity it tests is a first-passage probability, and by the reflection
principle

$ P(min_(t <= 1) ln(E_t slash E_"open") <= -D) = 2 Phi(-D slash sigma_d) $ <eq:firstpass>

Inverting for a target trip frequency $p$ gives the largest session volatility
consistent with the budget:

$ sigma_d^max = D / (-Phi^(-1)(p slash 2)) $ <eq:sigmamax>

At $D = 5%$ and one expected trip per 365-session year, @eq:sigmamax gives
$sigma_d^max = #illustrative[1.56%]$ per session. It is marked illustrative
because the model behind it --- zero drift, continuous monitoring, Gaussian
log-returns --- is one the desk's measured $gamma_4 = 14.9$ flatly contradicts;
fat tails make the true trip probability higher than @eq:firstpass at the same
$sigma_d$. The structural claim survives the marking: *the drawdown budget is a
volatility ceiling*, and position sizing is the mechanism that enforces it.

=== Kelly, quartered and capped

For a strategy winning a fraction $W$ of trades at payoff ratio
$R = overline("win") slash overline("loss")$, the growth-optimal fraction is

$ f^* = W - (1 - W) / R $ <eq:kelly>

implemented identically as `kellySizing` (`web/lib/quant/sizing.ts`) and
`kelly_fraction` (`modules/quant_risk/sizing.py`). The desk trades
$#measured[0.25][sizing.ts] dot.c max(0, f^*)$, capped at
$#measured[0.20][sizing.ts]$ of the book, and the cap names itself in the
result so a fraction that silently stopped growing cannot read as a
recommendation.

The quarter is not timidity, and it is derivable. In the continuous Gaussian
approximation with per-unit-time drift $mu$ and volatility $sigma$, log-wealth
grows at $g(f) = f mu - f^2 sigma^2 slash 2$, maximised at
$f^* = mu slash sigma^2$ with $g(f^*) = mu^2 slash (2 sigma^2)$. The function is
a downward parabola through the origin with its second root at $2 f^*$:

$ g(2 f^*) = 0 $ <eq:kellyzero>

Betting *twice* the optimal fraction produces zero long-run growth at maximal
volatility. Since $W$ and $R$ are estimates from a search that has already been
optimised once, over-estimation is the expected error, and @eq:kellyzero says
the penalty for over-betting is unbounded while the penalty for under-betting is
merely slower growth.

The drawdown link makes the choice quantitative. For a book run at fraction
$c f^*$ and rebalanced continuously, log-wealth is Brownian with drift
$m = c f^* mu - (c f^*)^2 sigma^2 slash 2$ and volatility $s = c f^* sigma$, so
the probability of *ever* falling to a fraction $a < 1$ of starting wealth is
$exp(-2 m ln(1 slash a) slash s^2) = a^(2 slash c - 1)$:

$ P("ever reach " a E_0) = a^(2 slash c - 1) $ <eq:kellydd>

At full Kelly ($c = 1$) the probability of ever halving the book is
$1 slash 2$. At $c = 1 slash 4$ it is $(1 slash 2)^7 approx 0.008$. @eq:kellydd
is the argument for `DEFAULT_KELLY_FRACTION = 0.25` stated in the units the
drawdown budget of @eq:dd is written in, and it is a derivation from a stated
model, not a measurement of this desk.

*The worked example, and why the sizing module refuses.* From
`seed-run.json`: $W = #measured[0.75][seed-run.json]$,
$overline("win") = #measured[0.047141][seed-run.json]$,
$overline("loss") = #measured[0.033603][seed-run.json]$, so $R = 1.4029$ and
@eq:kelly gives $f^* = 0.5718$ --- full Kelly would put 57% of the book on this
strategy. Quarter Kelly is 14.3%, inside the 20% cap. And the strategy has
#measured[8 trades][seed-run.json], against a
`MIN_TRADES_FOR_SIZING` of #measured[30][sizing.ts], so the result carries
`thinSample: true`. The formula is indifferent to whether $R$ came from eight
samples or eight hundred; @eq:kellyzero says the consequence of being wrong is
not. This is the same candidate whose DSR is 0.42 and whose out-of-sample
Sharpe is $-1.06$.

Three refusals are written into the implementation and each is a modelling
statement. A strategy with no losing trades has an *undefined* payoff ratio,
not an infinite one --- treating it as infinite drives @eq:kelly to $W$ itself
and sizes a small lucky sample at maximum, so it returns zero. A negative $f^*$
returns zero rather than an inverted position, because an edge that only exists
when you flip the signal is a fitting artefact. And the cap is reported with the
name of the constraint that bound it.

*What is not implemented.* @eq:kelly is a single-strategy result. The
correlated multi-sleeve solution is $bold(f)^* = bold(Sigma)^(-1) bold(mu)$,
which requires a vector of expected returns. The allocation engine deliberately
refuses to forecast one --- `propose_allocation` allocates by risk alone and
its own note says so: "no expected return is forecast, so this answers how
should the risk be spread, never what should we own". The per-strategy cap of
20% is what stands in for the joint solution, and it is a blunt instrument
rather than an approximation of one.

== The bootstrap

=== The stationary bootstrap

Politis and Romano (1994). Draw block lengths
$L ~ "Geom"(p)$, $P(L = ell) = (1-p)^(ell-1) p$, so $bb(E)[L] = 1 slash p = b$,
and concatenate blocks starting at uniformly chosen positions, wrapping the
index modulo $n$:

$ i_(t+1) = cases(
  "Uniform"\{0, ..., n-1\} & "with probability" 1 slash b,
  (i_t + 1) mod n & "otherwise"
) $ <eq:statboot>

The wrap is what earns the name. Künsch's moving-block bootstrap draws
fixed-length blocks without wrapping, and the resulting resample is *not*
stationary --- observations near the ends of the series are systematically
under-drawn. @eq:statboot with the geometric length and the modular wrap
produces a resample that is strictly stationary, which is the property the
downstream percentile estimates rely on.

Both stacks implement @eq:statboot with the identical two-draws-per-step order
--- a uniform to decide whether to start a block, then an index ---
(`modules/quant_risk/montecarlo.py`, `web/lib/montecarlo.ts`), pinned by
`web/tests/fixtures/mc-resampler-parity.json`. The Python separates the $b = 1$
case into its own loop that consumes *one* draw per step rather than two,
specifically so that routing $b = 1$ through the block loop cannot silently
move every existing Monte Carlo figure for the same seed. That is a
reproducibility constraint expressed as control flow.

=== The block-length heuristic, and its departure

$ b = "clamp"(floor(sqrt(n) + 1/2), 5, 100) $ <eq:blocklen>

For the worked example $n = 1200$ and @eq:blocklen gives 35, matching
`meanBlockLength: `#measured[35][seed-run.json] in the recorded run. The
`floor(x + 0.5)` is written out rather than spelled `round` because Python
rounds halves to even and ECMAScript rounds them up --- a difference no integer
square root can actually reach, written explicitly so the two stacks are
provably one rule rather than two that happen to agree.

*The departure.* Politis and White (2004) show the optimal mean block length
for the stationary bootstrap grows as $O(n^(1 slash 3))$ for variance and
distribution estimation. At $n = 1200$ that rate suggests roughly 10.6; @eq:blocklen
gives 35, over-blocking by about $3.3 times$. The tree names it a heuristic
rather than an optimum, and the clamp to $[5, 100]$ is what keeps it bounded.
The cost of over-blocking is fewer effective blocks per resample and therefore
higher variance in the resulting quantile estimates; the benefit is that more
of the dependence structure survives. #ref(<sec:blockdir>) measures which side
of that trade this data lands on, and the answer is not the one the
documentation assumes.

=== What blocks preserve that an i.i.d. draw destroys

The autocorrelation table of #ref(<sec:scaling>) answers this directly and the
answer is sharper than the usual telling. The *linear* autocorrelation of these
returns is negligible --- $|rho_1| = 0.0048$, and no lag out to five exceeds
0.027 in absolute value. There is essentially nothing there for a block draw to
preserve. The autocorrelation of *absolute deviations* is
#measured[0.4201][seed-run.json] at lag one and remains above 0.27 out to lag
five. What an i.i.d. resample destroys in this series is not linear dependence,
which is absent, but *volatility clustering*, which is large.

That distinction matters because the two are conflated constantly. A series can
be serially uncorrelated --- and so pass every test a linear model applies ---
while being strongly dependent in a way that governs exactly the tail behaviour
a Monte Carlo is drawn to estimate.

=== The measured direction, which is not the one the docstring asserts <sec:blockdir>

`web/lib/montecarlo.ts` states, without qualification, that i.i.d. resampling
"destroys the clustering and reports a cone that is too narrow exactly where it
matters, in the tails". That claim is testable against the tree's own resampler.
Running `bootstrap_terminal_distribution` on the 1 200 recorded per-bar returns
scaled to a \$1 000 000 book, 20 000 paths, comparing the i.i.d. draw against
$b = 35$:

#table(
  columns: (auto, auto, auto, auto),
  [Horizon (bars)], [i.i.d. $"VaR"_(95)$], [block-35 $"VaR"_(95)$], [ratio],
  [5], [\$18 611], [\$18 935], [1.017],
  [10], [\$24 991], [\$25 249], [1.010],
  [20], [\$35 088], [\$30 784], [0.877],
  [60], [\$57 358], [\$39 480], [0.688],
)

measured 2026-08-22 with
`bootstrap_terminal_distribution(pnl, h, paths=20000, seed=20260822, ...)` over
`seed-run.json`'s `bestRunReturns`. The $h = 60$ ratio reproduces at 0.688,
0.695 and 0.694 across three independent seeds, so it is not sampling noise.

The direction *reverses at $h approx b$*, and the mechanism is legible. While
the horizon is no longer than the mean block, a simulated path is essentially
one contiguous historical window: it inherits the real clustering, and the block
draw is the wider one, as the docstring says. Once the horizon is several
blocks long, the path is a sum of block-totals that have already been partially
Gaussianised *inside* each block by the central limit theorem, so single
extreme bars can no longer stack --- while the i.i.d. sum of 60 draws from a
distribution with $gamma_4 = 14.9$ keeps its kurtosis-driven tail alive. At
$h = 60$ against $b = 35$ the i.i.d. figure is the more conservative one by 45%.

Neither number is wrong. The unqualified claim is: the direction is a property
of the series and the horizon relative to the block, not of the resampler. A
desk reading the 60-bar terminal distribution and choosing the block draw
because it is "the conservative one" would, on this data, be choosing the
narrower tail.

=== Failure modes of the bootstrap

*It cannot manufacture tail shape the sample never showed.* This is not a
limitation to be worked around; it is what resampling *is*. Hence the floor:
`bootstrap_terminal_distribution` returns `None` below sixty observations, and
either figure is reported *beside* the historical VaR, never instead of it.

*The two stacks default to different resamplers, deliberately.* The Python's
unstated default is the i.i.d. draw; the TypeScript's is the derived block.
Each is the draw that surface has always shown, and changing either would move
a figure a desk has been reading with no code that looks like it changed a
number. A caller who cares names the resampler, and naming it gives the same
resampler on both sides. A contradiction --- i.i.d. with a block above one, or
stationary with a block of exactly one --- raises rather than picking a winner
silently, because a run that quietly used the other resampler is the one thing
no card could report afterwards.

*Seeding is provenance, not decoration.* The seed defaults to the CRC32 of the
input series, so refreshing the same book redraws the same cone without any
stored state, and a different book draws a fresh one.

== Summary of departures from the textbook form

#table(
  columns: (auto, 1fr, 1fr),
  [Model], [Textbook], [Here, and why],
  [Sharpe annualisation],
  [$eta(q)$ from @eq:eta],
  [$sqrt(a)$, uncorrected. $eta(a)$ needs autocorrelations to lag $a - 1$ from $n < a$ observations. All inference is done per bar instead.],

  [Expected max of $N$],
  [$macron(S) + S^*_0$ in some implementations],
  [Mean discarded. Adding it back makes the hurdle negative on a uniformly losing grid.],

  [Factor $t$-statistics],
  [HAC / Newey--West, @eq:hac],
  [Plain OLS. Stated as generous rather than corrected; framing is "not explained by these factors".],

  [Covariance],
  [Shrinkage toward a structured target],
  [Sample covariance, sequential summation for cross-language bit-parity, with a documented sample floor and a refusal below it.],

  [Sample floors],
  [One floor],
  [Twenty observations in TypeScript, two in Python. A real divergence the 220-observation parity fixture cannot see.],

  [Expected shortfall],
  [$phi(z_alpha) slash (1-alpha)$],
  [Two literals differing at $1.3 times 10^(-9)$, both below the exact value; fixture tolerance is $10^(-6)$.],

  [Tail selection],
  [Mean of everything below the quantile],
  [Mean of the worst $ceil((1-alpha)n)$ by *rank*. Value-selection understated CVaR95 by $19.8 times$ on a live run.],

  [VaR validation],
  [Christoffersen conditional coverage, @eq:christoffersen],
  [Kupiec unconditional coverage only. The independence half is absent, and clustering is the measured failure mode of this data.],

  [Execution],
  [Linear $h(v) = eta v$, trajectory @eq:actraj],
  [Square-root law @eq:sqrtimpact, from which the hyperbolic solution does not follow; and no scheduler at all. Single-shot order path, no child-order clock. @eq:ttl computes the risk-neutral schedule's duration without the schedule.],

  [Kelly],
  [$bold(f)^* = bold(Sigma)^(-1) bold(mu)$ across sleeves],
  [Per-strategy @eq:kelly at one quarter, capped at 20%. No expected-return vector is forecast anywhere, deliberately.],

  [Block length],
  [$O(n^(1 slash 3))$],
  [$sqrt(n)$ clamped to $[5, 100]$, over-blocking by roughly $3.3 times$ at $n = 1200$.],

)

== What is not built, and the reason each waits

Stated plainly, in the manner of the product requirements document, because an
absence named is auditable and an absence implied is not.

*Autocorrelation-adjusted annualisation (Lo 2002)* --- the estimator has no data
at $q = a$, and extrapolating from a short horizon would carry a precision the
sample cannot support.

*HAC standard errors, @eq:hac* --- would widen the factor $t$-statistics, so the
current figures are generous in a known and stated direction.

*Ledoit--Wolf shrinkage* --- the shrinkage intensity becomes a number the desk
must defend on every screen quoting a VaR, where a documented floor with a
refusal is auditable.

*Incremental VaR, @eq:ivar* --- exact, one square root per position, absent. The
component figure answers a different question.

*Christoffersen independence, @eq:christoffersen* --- the half of VaR validation
that detects clustered exceptions, which the measured
$rho_1(|r|) = #measured[0.4201][seed-run.json]$ says is this data's expected
failure.

*Effective trial count for the DSR* --- the grid's trials are strongly
dependent, so @eq:expmax overstates the hurdle by an unknown margin. The safe
direction is not a reason to stop saying so.

*The Almgren--Chriss scheduler* --- no child-order clock exists to execute a
trajectory. The single-shot cost is an upper bound by @eq:cm, so the pre-trade
gate errs safe, and @eq:ttl already reports the risk-neutral horizon.

*Joint Kelly across correlated sleeves* --- requires an expected-return vector
the allocation engine deliberately refuses to forecast. The 20% per-strategy cap
stands in for the solution rather than approximating it.
