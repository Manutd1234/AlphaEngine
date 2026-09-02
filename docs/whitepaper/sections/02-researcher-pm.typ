// Chapter 2 — the quantitative researcher and the portfolio manager.
//
// Content only: no page, font or numbering setup, which lives in template.typ.
//
// Every quantitative claim below is either read out of the tree with the file
// named beside it, or derived symbolically from a formula that is itself quoted
// from the tree — so `illustrative` is deliberately NOT imported: nothing here
// needed a stand-in figure, and importing a helper with no caller is the defect
// this repository keeps a scar about. Nothing here is a benchmark that was not
// run. Where the desk does not have a capability the chapter says so and gives
// the reason it waits, which is the convention PRD.md §6 uses.

// The template helpers are not inherited through `include` — a Typst module
// has its own scope — so the section imports them itself. Layout still lives
// entirely in template.typ; this brings in `measured` and `note`, both used.
#import "../template.typ": measured, note

= The quantitative researcher and the portfolio manager

Two roles share one pipeline and disagree about what a number means. The
researcher produces a candidate: a rule, a pair of parameters, and a claim that
the pair was not chosen by luck. The portfolio manager decides what fraction of a
finite book that claim is worth, and then explains at the close where the day's
money came from. The first half of this chapter is the arithmetic that prices a
search; the second spreads risk and decomposes a session. Both are held to the
same discipline: a figure nobody measured is not written down, and a figure that
could not be measured is reported as absent with its reason rather than rounded
to zero.

The two implementations are pinned against each other throughout. The sweep
engine exists twice, in `Part2_Infrastructure/modules/backtester/` and in
`Part2_Infrastructure/web/lib/`, and the fixture
`web/tests/fixtures/parity.json` holds
#measured[48 recorded cases covering all 46 strategies over 1,200 bars at four
parameter combinations each][web/tests/fixtures/parity.json]. The risk and
allocation arithmetic exists twice as well, pinned by
`web/tests/fixtures/risk-parity.json`, and the pre-trade gate by
#measured[twenty bit-exact scenarios][web/tests/fixtures/gate-parity.json] in
`web/tests/fixtures/gate-parity.json`. Two independent implementations that
agree to the last float are the only cheap evidence that either is what its
documentation says it is.

== Part A: the quantitative researcher

=== The signal surface as implemented

The research surface holds
#measured[46 strategies][web/lib/types/strategies.ts], grouped into seven
families: trend, breakout, mean reversion, momentum, volume, volatility and one
called fitted. Every one of them takes exactly two parameters. That is a
selection criterion rather than a coincidence, and the criterion is written at
the declaration site: a model needing a third axis, Ichimoku being the named
example, is held back until the request carries named parameters, because
folding a third value into one of the two existing ones produces a control that
lies about its units. Fractional axes were the first relaxation of that rule;
named axes are recorded as the next one, and are #strong[not built].

The fitted family contains one member, `linreg_forecast`, and it differs in kind
rather than in method: every other strategy applies a fixed rule the researcher
chose, while this one estimates its coefficients from the data inside the
backtest. Its second parameter is an entry threshold expressed as a multiple of
the fit's own residual standard error, so that zero means "any positive
forecast" and one means "the forecast must beat the noise the fit could not
explain".

A strategy emits a long state $ell_t in {0, 1}$. The traded position is built
from the #emph[transitions] of that state, not from the state itself:

$ p_t = cases(
  1 &"if" ell_t and not ell_(t-1),
  f &"if" not ell_t and ell_(t-1),
  p_(t-1) &"otherwise",
) quad f = cases(0 &"long only", -1 &"long/short") $

Reading the comparison directly instead would open a short at the instant the
warm-up window ends, on a signal that never fired. The distinction costs three
lines and is the difference between a position somebody asked for and one the
indicator's initial conditions produced.

Signals form on bar $t$ and execute on bar $t+1$. With $x_t$ the instrument's
simple return, $c$ the per-unit-turnover cost and $h_t$ the per-bar holding
cost, the strategy's return and equity are

$ r_t = p_(t-1) x_t - abs(p_(t-1) - p_(t-2)) c - h_t, quad E_t = product_(s <= t) (1 + r_s) $

Returns compound on equity, which is constant-fraction sizing at one hundred per
cent. The lag is the whole of the look-ahead protection in the accounting, and
it is applied identically in both engines. Exposure is measured on the lagged
position for the same reason: the bar a signal appears on is not a bar the book
was in the market.

The cost model is a flat leg plus three optional frictions, all defaulting to
zero so that an unconfigured run evaluates the identical expression the parity
fixture pins:

$ c = (f_"bps" + s_"bps") / 10^4 + k sqrt(min(1, Q \/ "ADV")) $

The square-root impact law is the standard concave form, so doubling order size
costs about $sqrt(2)$ rather than two. It is a model and the interface says so,
because a slippage figure a researcher chose is an assumption they are making
rather than a fact the backtest discovered. Average daily volume is computed once
over the whole series and reused for every combination and every walk-forward
slice: recomputing it per slice would make an order's modelled impact depend on
which fold it landed in, so two identical trades would be charged differently for
a reason having nothing to do with the trade.

=== The sweep and its combination budget

A sweep evaluates a grid. For the strategies whose two parameters are both
lookback periods the grid is the triangle

$ G = { (f, s) in F times S : f < s } $

with $F$ and $S$ generated by an inclusive float-safe axis constructed by index
multiplication rather than repeated addition, because at step $0.25$ repeated
addition drifts to $2.7499999999999996$ and shows the reader a different number
from the control they moved.

The triangular filter is right when both axes are periods and nonsense
otherwise. Fifteen strategies declare a free second axis, where the second
parameter is a level rather than a lookback: a band width in standard
deviations, an oscillator threshold, a $%B$ position, an ulcer index. Applying
$f < s$ to a 20-bar mean against a $2.0 sigma$ band fails $20 < 2.0$, discards
every combination, and reports a strategy that silently took no trades. One
strategy, `linreg_forecast`, declares a free #emph[first] axis as well: the
default fast sweep of 5 to 40 bars is a sensible moving-average period and an
unusable training window for a four-parameter regression.

At the shipped defaults the budget is small and worth stating exactly, because
it is the $N$ that later deflates the winner's Sharpe.

#table(
  columns: (auto, 1fr, auto),
  [Quantity], [Definition], [Value],
  [Fast axis], [5 to 40 step 5], [#measured[8 values][web/lib/types/sweep.ts]],
  [Slow axis], [20 to 200 step 20], [#measured[10 values][web/lib/types/sweep.ts]],
  [Grid $abs(G)$], [the $f < s$ triangle of the two axes], [#measured[74 combinations][derived from `paramGrid`]],
  [Folds $k$], [request default, clamped to 2..10], [#measured[4][web/lib/types/sweep.ts]],
  [Bars $N$], [request default at the 4h interval], [#measured[2,000][web/lib/types/sweep.ts]],
  [Bars per year], [`BARS_PER_YEAR["4h"]`], [#measured[2,190][web/lib/types/sweep.ts]],
)

The grid is hard-capped at #measured[400 combinations][web/lib/types/sweep.ts],
and the cap is applied by taking every $ceil(abs(G) \/ 400)$-th combination
rather than by truncating the list. Truncation would keep every slow period
against the smallest fast periods and none against the largest; decimation by
stride keeps the shape of both axes.

Walk-forward multiplies that budget. Each fold selects on the training window by
running the whole grid, scores the winner out-of-sample, and then re-scores the
whole grid out-of-sample as well, so the total number of combination evaluations
in a run is

$ abs(G) + k (2 abs(G) + 1) = 74 + 4 times 149 = 670 $

which is #measured[670 evaluations][derived from `runSweep` and `walkForward`]
at the defaults. The third term is the one that could be dropped and is not; the
subsection on out-of-sample rank explains what it buys.

Where the cost of a combination is unusual, it is recorded. `linreg_forecast`
refits a regression one hundred times per pass and costs
#measured[approximately 15 ms per combination against approximately 0.4 ms for
the parametric strategies][web/lib/strategies/grid.ts], which is why its
threshold axis is stepped at $0.2$ rather than $0.1$: the finer step would make a
77-combination grid take about a second where every other sweep takes about forty
milliseconds.

=== Walk-forward optimisation: the fold structure actually used

Let $N$ be the bar count and $k$ the requested fold count clamped to $[2, 10]$.
The segment length is $ sigma = floor(N \/ (k+1)) $ and fold $i in {0, ..., k-1}$
uses, with an embargo of $e$ bars,

$ "train"_i = [i sigma, (i+1) sigma - e), quad "test"_i = [(i+1) sigma, (i+2) sigma) $

Three guards apply. A segment shorter than 100 bars produces no folds at all,
and the response carries the warning "walk-forward skipped: not enough bars for
the requested folds" rather than an empty list that reads as a clean pass. A
train or test window shorter than 50 bars breaks the loop. The embargo is
clamped to $[0, max(0, sigma - 50)]$.

The windows are rolling and fixed-length, not expanding. The embargo is taken
out of the #emph[training window's tail] rather than by shifting the test window
forward, and the reason is recorded at the site: shifting would walk the last
fold off the end of the data and quietly drop it, so a researcher who switched
the embargo on would silently lose a fold and see the median efficiency move for
a reason they did not ask for.

At the shipped defaults $sigma = 400$ and the layout is:

```
bar 0        400       800      1200      1600      2000
    |---------|---------|---------|---------|---------|
f1  [ train  ][  test  ]
f2            [ train  ][  test  ]
f3                      [ train  ][  test  ]
f4                                [ train  ][  test  ]
                 out-of-sample coverage: 1600 of 2000 bars (80%)
```

Adjacent folds leak without an embargo, and the leak is structural rather than
accidental: a 200-bar moving average evaluated on the first test bar is mostly
made of training bars, so that bar's "out-of-sample" score is partly in-sample.
The embargo defaults to zero, which reproduces the Python reference exactly and
is what the parity fixture pins; switching it on is an explicit choice.

Per-fold walk-forward efficiency is

$ "WFE"_i = cases(
  "OOS"_i \/ "IS"_i &"if" "IS"_i > 0,
  "null" &"otherwise",
) $

The null is the point. Dividing by a negative in-sample Sharpe produces a
#emph[positive] ratio for a fold that lost money in both windows, which reads as
success on a chart. Those folds report null, are excluded from the median, and
are counted separately.

Two further per-fold statistics are computed. Parameter drift is measured in
grid-#emph[index] space, not in raw parameter units, because the grid is a
sparse lattice: with a fast step of 5 the neighbour of 25 is 20, and measuring
distance in parameter units would call 24 a neighbour when 24 was never
evaluated. Parameter persistence is then the share of fold transitions whose
drift is exactly zero, or null when there are no transitions to measure.

The aggregate out-of-sample Sharpe is computed on the #emph[concatenated] OOS
return vectors rather than as a mean of the per-fold Sharpes. A mean of Sharpes
would weight a fold with 50 surviving bars as heavily as one with 400.

The walk-forward verdict bands are:

#table(
  columns: (auto, 1fr, 1fr),
  [Level], [Condition], [What it says],
  [pass], [median WFE $>= 0.5$ and $>= 60%$ of folds profitable OOS],
    [parameters chosen on one window kept working on the next],
  [marginal], [median WFE $> 0$ and $>= 50%$ of folds profitable OOS],
    [the edge decays; expect live results nearer the OOS column],
  [fail], [anything else],
    [the edge does not survive the fold boundary],
)

=== Out-of-sample testing, and what the fold rank buys

Scoring only the winner out-of-sample yields one number per fold, and one number
cannot separate two very different situations: "this parameter choice was right"
and "this fold was easy for everything in the grid". So the whole grid is
re-scored on each test window, sorted, and the in-sample winner's rank among its
peers is recorded together with the number of combinations ranked. That is what
doubles the walk-forward cost, and it is the input the overfitting probability
is computed from.

=== The Probabilistic Sharpe Ratio, derived

Let $x_1, ..., x_n$ be per-observation strategy returns with central moments
$mu_1, mu_2, mu_3, mu_4$, standardised skewness $gamma_3 = mu_3 \/ mu_2^(3\/2)$
and #emph[raw Pearson] kurtosis $gamma_4 = mu_4 \/ mu_2^2$, so that a normal
sample gives $gamma_4 = 3$. The per-observation Sharpe ratio and its estimator
are $S = mu_1 \/ sqrt(mu_2)$ and $hat(S) = m_1 \/ sqrt(m_2)$ for the
corresponding sample moments.

The estimator is a smooth function $g(m_1, m_2) = m_1 \/ sqrt(m_2)$ of the first
two sample moments, whose joint asymptotic covariance for an i.i.d. sample is

$ "Var"(m_1) = mu_2 / n, quad "Var"(m_2) = (mu_4 - mu_2^2) / n, quad "Cov"(m_1, m_2) = mu_3 / n $

The partial derivatives at the true moments are
$partial g \/ partial m_1 = mu_2^(-1\/2)$ and
$partial g \/ partial m_2 = - mu_1 \/ (2 mu_2^(3\/2))$. The delta method then
gives

$ "Var"[hat(S)] approx 1/mu_2 mu_2/n + mu_1^2/(4 mu_2^3) (mu_4 - mu_2^2)/n - 2 mu_1/(2 mu_2^2) mu_3/n = 1/n (1 - gamma_3 S + (gamma_4 - 1)/4 S^2) $

Each term is interpretable. The first is what a Gaussian sample would give on its
own; the second says fat tails inflate the denominator's sampling error as the
square of the Sharpe; the third says #emph[negative] skew makes the estimator
noisier than a normal sample of the same length, so a strategy that wins often
and loses violently has a Sharpe to be believed less, not more.

Replacing $n$ by $n-1$, the small-sample convention Bailey and López de Prado
adopt, and standardising, gives the Probabilistic Sharpe Ratio, which is the
probability that the true Sharpe exceeds a stated benchmark $S^*$:

$ "PSR"(S^*) = Phi ( ((hat(S) - S^*) sqrt(n - 1)) / sqrt(1 - gamma_3 hat(S) + ((gamma_4 - 1)/4) hat(S)^2) ) $

The implementation in `web/lib/stats.ts` is this expression and nothing else. It
returns zero for $n < 3$ rather than raising, because fewer than three
observations is an unusable sample rather than an error. The variance term is
clamped at $10^(-12)$ from below, which matters under extreme negative skew where
the bracket can go non-positive, and the clamp is duplicated exactly in the
minimum-track-record inverse so the two stay exact inverses of each other.
$Phi$ is evaluated through Abramowitz and Stegun 7.1.26, whose error is bounded
at #measured[$1.5 times 10^(-7)$][web/lib/stats.ts], and $Phi^(-1)$ through
Acklam's rational approximation at
#measured[$1.15 times 10^(-9)$][web/lib/stats.ts]. Both bounds are far below any
resolution at which a promotion decision changes.

#note[Units are load-bearing][
Every Sharpe entering these formulas is per-observation, never annualised. The
sweep de-annualises the grid by dividing each combination's reported Sharpe by
$sqrt("bars per year")$, and computes the winner's per-bar Sharpe directly from
its own bar returns. The response re-annualises exactly one figure,
`expectedMaxSharpe`, for display, and the engine carries a comment warning that
the minimum track record length benchmarks against the #emph[per-bar] expected
maximum rather than that displayed one. Mixing the two silently produces a
hurdle wrong by a factor of $sqrt(2190)$ at the 4h interval.
]

=== Minimum track record length

Solving $"PSR"(S^*) = alpha$ for $n$ inverts the expression above exactly:

$ N^* = 1 + (1 - gamma_3 hat(S) + (gamma_4 - 1)/4 hat(S)^2) (z_alpha / (hat(S) - S^*))^2 $

with $z_alpha = Phi^(-1)(alpha)$ and $alpha = 0.95$ as shipped. The function
returns $infinity$ when $hat(S) <= S^*$, which is the honest answer: no finite
record can demonstrate an edge that is not there. The engine converts a finite
$N^*$ to whole bars by ceiling, divides by the bars-per-year constant to report
years, and reports a boolean `sufficient` comparing the run's own bar count
against the requirement. Two benchmarks are reported side by side: $S^* = 0$,
which asks how long a record must be to establish an edge against nothing, and
$S^* = S^*_0$, the per-bar search hurdle derived in the next subsection, which
asks how long it must be to establish an edge against #emph[this search].

The formula is worth a symbolic reading, because the shape of the answer is the
argument for walk-forward in the first place. At $gamma_3 = 0$, $gamma_4 = 3$ and
$S^* = 0$ the requirement collapses to $N^* approx 1 + (1 + hat(S)^2\/2)(z_alpha
\/ hat(S))^2$, so the bar requirement falls as the #emph[square] of the Sharpe.
An annualised Sharpe of 1.0 on 4h bars is $hat(S) = 1 \/ sqrt(2190) approx
0.02137$ per bar, giving $N^* approx 5{,}927$ bars, or
#measured[approximately 2.71 years][derived from the formula above at the stated
inputs] of continuous 4h data before a 95 per cent statement can be made. Halving
the Sharpe quadruples that. This is arithmetic from the stated formula, not a
measurement of any strategy.

=== The Deflated Sharpe Ratio, derived

The best Sharpe in a grid of $N$ is the maximum of $N$ draws, not an estimate of
edge. A sweep over a pure random walk reliably produces an impressive-looking
winner, and the Deflated Sharpe Ratio exists to price that.

Under the null hypothesis every trial's true Sharpe is zero and the trial
estimates are $N(0, V)$ where $V$ is the variance of the Sharpes actually
observed across the grid. Write $M_N$ for the maximum of $N$ i.i.d. standard
normals. Its distribution converges to a Gumbel: with
$a_N = Phi^(-1)(1 - 1\/N)$ and $b_N = 1 \/ (N phi(a_N))$,

$ P(M_N <= a_N + b_N z) --> exp(-exp(-z)), quad EE[M_N] approx a_N + gamma b_N $

where $gamma approx 0.5772156649015329$ is the Euler-Mascheroni constant, the
mean of the standard Gumbel. The scale $b_N$ has a convenient closed form. The
normal tail is locally exponential with that same scale, so
$1 - Phi(a_N + b_N) approx (1 - Phi(a_N)) upright(e)^(-1) = 1 \/ (N upright(e))$,
which says $a_N + b_N approx Phi^(-1)(1 - 1\/(N upright(e)))$ and therefore
$b_N approx Phi^(-1)(1 - 1\/(N upright(e))) - a_N$. Substituting and collecting
terms:

$ S_0^* = sqrt(V) [ (1 - gamma) Phi^(-1)(1 - 1/N) + gamma Phi^(-1)(1 - 1/(N upright(e))) ] $

which is exactly the expression `deflatedSharpe` evaluates. The Deflated Sharpe
Ratio is then the Probabilistic Sharpe Ratio taken against that hurdle rather
than against zero:

$ "DSR" = "PSR"(S_0^*) = Phi ( ((hat(S) - S_0^*) sqrt(n-1)) / sqrt(1 - gamma_3 hat(S) + ((gamma_4 - 1)/4) hat(S)^2) ) $

#note[The hurdle is dispersion only, and that is deliberate][
The sample #emph[mean] of the candidate Sharpes is not added back. It is a
common slip, and the file records why it is refused: on a uniformly losing grid
the mean is negative, so a hurdle built from mean plus dispersion goes negative
and a losing strategy clears it. Under the null every true Sharpe is zero, so the
hurdle comes purely from how widely the search scattered.
]

Two degenerate cases are handled explicitly. With one trial the dispersion is
zero, the hurdle is zero, and the DSR equals the PSR, which is correct: with no
search there is nothing to deflate. With every trial identical the dispersion is
also zero and the same thing happens, which is likewise correct, because a grid
in which every combination produces the same Sharpe has not searched anything.

Two limitations are real and are stated rather than assumed away. First, the
trials are #emph[dependent]: a 5/20 crossover and a 5/40 crossover share most of
their returns, so the effective number of independent trials is below $N$. That
pushes the Gumbel term, which reads $N$ literally, toward too high a hurdle;
meanwhile the dependence also depresses the observed dispersion $V$, which pushes
the hurdle down. The two errors point in opposite directions and nothing measured
here signs the net. Second, the DSR prices the search #emph[within] one sweep and
cannot price the search #emph[across] sweeps. Forty runs over forty hypotheses is
itself a multiple-testing problem, and the winner's DSR does not know the other
thirty-nine happened. The experiment log records the run count as prominently as
it records the results, precisely because a tool that silently accumulates
attempts while displaying per-attempt significance is actively misleading.

=== The probability of backtest overfitting

The reference construction, combinatorially purged cross-validation, partitions
$T$ observations into $S$ groups, forms all $binom(S, S\/2)$ train/test splits,
and for each split $c$ computes the out-of-sample relative rank $omega_c$ of the
configuration that was optimal in-sample. With $lambda_c = log(omega_c \/ (1 -
omega_c))$, the probability of backtest overfitting is $P(lambda <= 0)$: the
chance that the in-sample winner lands in the losing half out-of-sample.

Full CPCV is #strong[not built], and the reason is recorded at the site in
`modules/backtester/engines.py`: it costs factorially more compute for a tighter
estimate of the same quantity. What is built is the cheap sequential reading over
the walk-forward folds that were computed anyway. With $R$ the set of folds
carrying both a rank $rho_k$ and a ranked-combination count $M_k > 1$,

$ hat("PBO") = 1/abs(R) sum_(k in R) bb(1)[rho_k > (M_k + 1)/2] $

rounded to four decimal places. It returns #emph[null], never zero, when no fold
produced a rank, because "no fold could be ranked" and "no fold was overfit" are
opposite claims.

Its coarseness is the fold count. With the default four folds the estimator can
only take the values $0, 0.25, 0.5, 0.75, 1$, and with the maximum ten folds it
takes eleven values. That is a derived property of the definition, and it is the
reason the desk does #emph[not] gate on it: the promotion gate contains no PBO
check. A hurdle on a five-valued statistic estimated from four observations would
be a coin flip wearing the costume of a control. Instead the figure is displayed,
and it enters the quality score's robustness category at 35 per cent of that
category's 20 points, inverted so that a high probability of overfitting costs
points rather than earning them.

=== The data hash that ties a result to the exact bars

A symbol and a date range do not identify a dataset. The same window can be a
live venue pull, a cached copy, or the synthetic fallback, and the synthetic
series is not stable across processes. Both engines therefore fingerprint the
bars a run actually saw.

#table(
  columns: (auto, 1fr, 1fr),
  [], [Python gateway], [TypeScript portal],
  [Function], [`dataset_fingerprint`], [`datasetFingerprint`],
  [Digest], [SHA-256, truncated to 16 hex characters], [FNV-1a 32-bit, 8 hex characters],
  [Covers], [open, high, low, close as float64 bytes, plus index bounds and length],
    [close rounded to $10^(-6)$, plus length and first and last timestamps],
  [Source], [`modules/backtester/engines.py`], [`web/lib/engine/frame.ts`],
)

The Python side hashes every price column, not just the close, and the argument
is written beside it: `donchian` reads highs and lows, so a vendor revising a
session high changes the signal while the close is untouched, and a fingerprint
that missed that would certify two runs as comparable at exactly the moment they
stopped being so. The browser side hashes closes only, at six decimal places,
which is enough to separate real revisions and coarse enough that a float
round-trip through JSON does not change the answer.

The two are #emph[deliberately] not expected to agree. They fingerprint their own
inputs, which arrive over different transports with different float formatting.
What each guarantees is internal consistency: two runs in the same engine over
the same bars agree, and two that do not agree are not comparable however alike
their headers look. Saying so plainly is better than a cross-engine hash that
would have to normalise formatting and would then be trusted for a property it
does not have.

The browser digest is 32 bits and the file says outright that it is not
cryptographic. The consequence is quantifiable rather than hand-waved: a 32-bit
digest reaches a fifty per cent collision probability at about
$sqrt(2 ln 2 dot 2^32) approx 77{,}000$ distinct datasets, and the experiment log
is capped at #measured[60 records][web/lib/experiments.ts], so the probability
that any two records in a full log collide is about
#measured[$4 times 10^(-7)$][derived from the birthday bound at 60 records].
That is the argument for a cheap hash, made in numbers.

Downstream, the hash is what makes a research corpus queryable by data rather
than by title. `tools/graph_recall.py` exposes a query over one `data_hash` that
returns every run over the same bars together with what the graph says followed
each, and its own summary line states the reason it is useful: results that
disagree over one `data_hash` disagree about method, not data. The experiment
record carries the field as optional, because runs recorded before it existed
cannot be back-filled with anything honest, and the research cards print "Data
hash: unrecorded" rather than leaving a blank that reads as agreement.

=== The decision tree from sweep to promotion

```
                        run the sweep over G
                                 |
                  bars >= 200 and |G| >= 1 ?  --- no --> refuse, state which
                                 |  yes
                        pick argmax Sharpe
                                 |
                  DSR = PSR(S*_0) over |G| trials
                                 |
        +------------------------+------------------------+
        | DSR >= 0.95            | 0.80 <= DSR < 0.95     | DSR < 0.80
        |                        |                        |
   OOS Sharpe > 0 ?         OOS Sharpe > 0 ?        "consistent with
        |                        |                   selection bias"
   yes -+- no               yes -+- no                    STOP
        |    |                   |    |
   "edge     "in-sample     "plausible, STOP
    survives  only"          not
    the       STOP           established"
    search"                       |
        |                         |
        +-----------+-------------+
                    |
          promotion gate: six vetoes, all displayed
                    |
        all six pass ? --- no --> not eligible; the failing rows are the work list
                    |  yes
        Kelly sizing from the run's own realised trades
        (quarter Kelly, capped at 20% of the book)
                    |
             hand to a sleeve
```

The verdict bands and the gate are two different objects and are deliberately not
merged. The verdict is a sentence about the evidence; the gate is a vector of
vetoes.

#table(
  columns: (auto, auto, 1fr),
  [Check], [Hurdle], [Why it is there],
  [Deflated Sharpe], [$>= 0.95$],
    [prices the search itself: the probability the edge is real after paying for how many combinations were tried],
  [Walk-forward OOS Sharpe], [$> 0$],
    [measured on data the parameters never saw; in-sample results are a fit, this is a test],
  [Walk-forward efficiency], [$>= 0.5$],
    [how much of the in-sample edge survives; below half the backtest is mostly fitting],
  [Parameter neighbourhood], [plateau or slope],
    [a real edge degrades smoothly; an isolated spike is a coordinate found in noise],
  [Alpha t-statistic], [$abs(t) >= 2$],
    [return not explained by market, trend or volatility exposure, else it is a factor bet in disguise],
  [Trade count], [$>= 30$],
    [below about thirty trades the Sharpe is dominated by a handful of outcomes],
)

Every check is a veto and every check is displayed whether it passes or fails.
A gate panel that only appears on failure teaches people that the absence of a
warning means safety; showing the full vector every time makes the one failing
row the thing a reader looks for.

The parameter-neighbourhood check deserves its own definition, because it is the
one that is not a threshold on a published statistic. Every grid point is
classified by what its neighbours do, with adjacency taken in grid-index space
for the sparse-lattice reason given earlier. With $overline(S)_"nb"$ the mean
Sharpe of a cell's tested neighbours, the retention ratio is
$overline(S)_"nb" \/ S_"cell"$, and the classification is:
#measured[retention $>= 0.6$][web/lib/quant/stability.ts] is a plateau,
#measured[retention $<= 0.2$][web/lib/quant/stability.ts] is a cliff, between
them is a slope, fewer than three tested neighbours is isolated, and a
non-positive Sharpe is dead. A winner classified isolated sits on the grid
boundary, and the verdict says so and asks for a wider range, because an optimum
at the boundary is usually a sign that the true optimum is outside the grid.

Retention is reported as a percentage only inside a band where a percentage
means something. The denominator is a Sharpe that can be a hair above zero, and
the file records the pathology it produced: a winner at $0.006$ with negative
neighbours gave #measured[$-8268%$][web/lib/quant/stability.ts], arithmetically
correct and communicating nothing. Outside $[0, 2]$ the two Sharpes are quoted
directly. Percentages are a convenience, not the measurement.

Beyond the gate, one 0-100 score exists so that many runs can be ranked at a
glance. Its weights are a deliberate departure from the obvious ones:

#table(
  columns: (1fr, auto, 1fr),
  [Category], [Weight], [Composition],
  [Risk-adjusted], [#measured[35][web/lib/quality-score.ts]], [DSR at 0.67, raw Sharpe at 0.33],
  [Robustness, out-of-sample], [#measured[20][web/lib/quality-score.ts]], [efficiency 0.40, inverted PBO 0.35, OOS Sharpe 0.25],
  [Drawdown and tail], [#measured[15][web/lib/quality-score.ts]], [max drawdown 0.60, Calmar 0.40],
  [Versus benchmark], [#measured[15][web/lib/quality-score.ts]], [Sharpe edge 0.70, return edge 0.30],
  [Trade quality], [#measured[8][web/lib/quality-score.ts]], [sample size 0.65, win rate 0.35],
  [Absolute return], [#measured[7][web/lib/quality-score.ts]], [total return over the window],
)

The sibling weights this replaced scored on raw Sharpe and raw return, statistics
this engine already knows to be inflated by selection; scoring on the naive
numbers while owning the corrected ones would publish a figure the repository's
own machinery disagrees with. So robustness gets its own twenty points and the
risk-adjusted category is DSR-led. Absolute return is last and lightest on
purpose: a large return earned by taking a large risk is already counted twice
above, and weighting it heavily is how a scoring system learns to prefer
leverage.

The benchmark category carries a scar worth recording, because it is the exact
failure this chapter is about. It originally compared the #emph[in-sample]
Sharpe against the benchmark, and a run with a grid-inflated Sharpe of
#measured[3.2, a DSR of 0.2 and 80 per cent PBO collected full marks in that
category and reached 55 overall][web/lib/quality-score.ts]. The whole point of
the robustness category is that the in-sample number is not to be trusted, and
then the category beside it trusted it. It now compares the walk-forward
out-of-sample Sharpe wherever walk-forward ran, and labels the result in-sample
where it did not.

=== The guardrails, and the one they do not cover

Four of the mechanisms have already been derived above: grid hygiene, so that no
strategy is swept over a space in which every combination is silently discarded;
the separation of the code allowed to pick a winner from the code that reports
one; the embargo; and neighbourhood classification, under which a cliff fails the
gate even when its Sharpe is the highest in the grid. Two more carry content of
their own.

- #strong[The factor regression.] Three time-series factors built from the same
  instrument's own bars over a #measured[30-bar][web/lib/quant/factors.ts]
  lookback: the asset itself, time-series momentum, and a volatility-regime
  factor whose threshold is an #emph[expanding] mean of prior observations rather
  than a full-sample median. The look-ahead avoided there is the insidious
  direction: a benchmark built with hindsight is stronger than one anybody could
  have traded, so a real edge could be argued away by a factor that could not
  have existed. The factors are executed with the same one-bar lag as the
  strategy, so a beta is an exposure rather than a timing artefact. The
  t-statistics are plain OLS, and the file states that a Newey-West correction
  would widen them, meaning the significance reported is generous rather than
  conservative. Newey-West is #strong[not built].
- #strong[Sizing that refuses.] Kelly sizing is quartered and capped at
  #measured[20 per cent][web/lib/quant/sizing.ts] of the book. A negative $f^*$
  returns zero rather than an inverted position, because an edge that only exists
  when you flip it is a fitting artefact. A strategy with no losing trades has an
  #emph[undefined] payoff ratio, not an infinite one, and also returns zero. The
  file records the measured case that motivated the thin-sample flag: on live
  BTC 4h at the defaults, `ma_cross` produced a
  #measured[17.7 per cent allocation, 1.77M USD of a 10M USD book, from six
  trades][web/lib/quant/sizing.ts]. The formula is indifferent to whether the
  payoff ratio came from six samples or six hundred; the consequence of being
  wrong is not.

The guardrail that does not exist is the cross-sweep one. Nothing prices the
number of hypotheses a researcher tried before this one. The experiment log makes
the count visible and says in its own header why visibility is the most it can
offer; a corrected across-sweep statistic is #strong[not built], and it waits on a
definition of what counts as one attempt that survives a researcher reloading a
tab.

== Part B: the portfolio manager

=== Mean-variance, and the part of it the desk actually solves

The canonical program is, for a long-only fully-invested book,

$ max_w  w^top mu - lambda/2 w^top bold(Sigma) w quad "subject to" quad bold(1)^top w = 1, quad w >= 0 $

whose unconstrained solution is $w prop bold(Sigma)^(-1) mu$. The desk does not
solve it, and the reason is written at the top of `modules/quant_risk/allocation.py`:
the allocator is deliberately naive about expected return, because forecasting
covariance is hard and forecasting returns is harder, and a proposal that
pretends otherwise is an opinion dressed as arithmetic. An expected-return model
is #strong[not built]. What is solved is the $mu$-free corner of the same
program, $lambda -> infinity$, together with three risk-only heuristics, in
increasing order of what they claim to know.

#strong[Equal weight] is $w_i = 1\/n$ over #emph[distinct] symbols. It knows
nothing and says so, which makes it the honest baseline the other three have to
beat. The distinctness matters: both engines key weights by symbol but iterate
the position list when building targets, so a duplicated symbol would collect the
same weight twice and silently inflate gross.

#strong[Inverse volatility] is $w_i prop 1\/sigma_i$, so a quiet instrument
carries more notional than a violent one for the same risk. It ignores
correlation entirely.

#strong[Equal risk] equalises each position's contribution to book volatility.
By Euler's theorem on the homogeneous-of-degree-one function $sigma_p(w) =
sqrt(w^top bold(Sigma) w)$,

$ sigma_p = sum_i w_i (partial sigma_p)/(partial w_i) = sum_i (w_i (bold(Sigma) w)_i)/sigma_p, quad "so" quad "RC"_i = w_i (bold(Sigma) w)_i, quad sum_i "RC"_i = sigma_p^2 $

The target is $"RC"^* = sigma_p^2 \/ n$ and the solver is the multiplicative
fixed point $w_i <- w_i sqrt("RC"^* \/ "RC"_i)$ followed by renormalisation,
seeded at inverse volatility because that is already the exact answer when the
correlations are zero, so the iteration only has to undo the correlation. A
non-positive contribution or a non-positive marginal is held flat rather than
updated, because $sqrt("negative")$ would put a NaN into every weight at the next
renormalisation.

#strong[Minimum variance] is the long-only fully-invested portfolio with the
smallest variance the estimated covariance allows. Its Lagrangian is

$ cal(L)(w, theta, nu) = w^top bold(Sigma) w - 2 theta (bold(1)^top w - 1) - sum_i nu_i w_i $

with stationarity $2(bold(Sigma) w)_i - 2 theta - nu_i = 0$ and complementary
slackness $nu_i w_i = 0$, $nu_i >= 0$. On the support, where $w_i > 0$, this
forces $nu_i = 0$ and therefore

$ (bold(Sigma) w)_i = theta quad "for every" i "with" w_i > 0, quad (bold(Sigma) w)_j >= theta "otherwise" $

Every marginal variance is equal on the support. That is a fixed point of exactly
the same shape as the equal-risk update, which is why the file has one solver
family rather than two, and no simplex projection or step size to tune. The
update is $w_i <- w_i sqrt(sigma_p^2 \/ (bold(Sigma) w)_i)$, seeded at inverse
#emph[variance] because that is the exact answer at zero correlation. A negative
marginal variance is a hedge, has no update in this fixed point, and is held
flat.

Two implementation choices are load-bearing and both are recorded. Both iterative
solvers run a #emph[fixed] #measured[60 iterations][modules/quant_risk/allocation.py]
rather than testing for convergence, because a tolerance check lets two
implementations stop on different iterations and disagree by more than the
cross-language fixture allows, whereas a fixed count cannot. And the minimum
variance solver keeps the #emph[best] iterate rather than whichever the loop ended
on, because a multiplicative fixed point is not proven to decrease the objective
at every step, and a method called minimum variance that returned something more
volatile than inverse volatility would be indefensible.

The parity fixture records what all four produce on one three-symbol book, and
the numbers below are read from it rather than recomputed here.

#table(
  columns: (auto, auto, auto, auto, auto),
  [Method], [AAA], [BBB], [CCC], [Gross after],
  [Current], [120,000], [180,000], [-60,000], [360,000],
  [Equal weight], [0.33333], [0.33333], [0.33333], [360,000],
  [Inverse volatility], [0.25432], [0.21306], [0.53262], [360,000],
  [Equal risk], [0.22806], [0.07710], [0.69484], [360,000],
  [Minimum variance], [0.30859], [0.00000], [0.69141], [360,000],
)

#measured[All twelve target weights and both gross figures][web/tests/fixtures/risk-parity.json].
The ordering is instructive and is a property of the methods rather than of this
book: minimum variance is the most concentrated of the four by construction,
here driving one sleeve to exactly zero, which is why it clips against a symbol
cap most often.

Clipping is where the allocator meets the gateway. Every proposal is clipped by
the same limits the risk gateway enforces, and each clipped weight names the
constraint that bound it, because a proposal that ignored the limits would be
rejected order by order at the gate, which is a worse way to discover it. On the
same fixture, with a symbol cap of 150,000 and a gross cap of 300,000, the
budget becomes $min(360{,}000, 300{,}000) = 300{,}000$; the minimum-variance
weights put $0.69141 times 300{,}000 = 207{,}423$ into CCC, which is clipped to
#measured[150,000, tagged `max_symbol_notional_usd`][web/tests/fixtures/risk-parity.json],
and the proposal's gross after falls to
#measured[242,577][web/tests/fixtures/risk-parity.json]. The weights no longer
sum to one after clipping and the proposal carries a `clipped` flag saying so
rather than renormalising, which would quietly hand the clipped notional to
whichever sleeve happened to be uncapped.

The trades that reach a proposal are filtered by a drift band of
#measured[5 per cent of gross][modules/quant_risk/allocation.py]. The band is what
stops a rebalance from being a fee-generating machine: a position one per cent
from target costs more to correct than the correction is worth. On the fixture's
unclipped minimum-variance proposal the three drifts are $-2.47%$ for AAA,
$-50.0%$ for BBB and $+52.5%$ for CCC, so AAA is left alone and two trades are
produced. The direction of the CCC trade is the detail that makes the band
non-trivial: CCC is a #emph[short], so increasing its target notional means
selling more of it, and the fixture records
#measured[SELL 188,907.60 on CCC and SELL 180,000.00 on BBB][web/tests/fixtures/risk-parity.json].
The proposal alone cannot produce that direction, which is why the current
positions are still an argument to the trade builder.

=== The covariance model and where it is measured from

The estimate is a plain sample covariance over the window every symbol shares:

$ bold(Sigma)_(i j) = 1/(W - 1) sum_(k=1)^W (r_(i k) - overline(r)_i)(r_(j k) - overline(r)_j), quad W = min_i abs(r_i) $

Truncating to the shortest series rather than padding is the point. A symbol with
a shorter history would otherwise have its missing bars treated as zero-return
days, which understates its variance and, because the zeros line up across
symbols, inflates every correlation toward one: the two errors that both make a
book look safer than it is. Correlation is the usual normalisation with an
explicit zero-denominator guard, and annualisation by
$sqrt("BARS_PER_YEAR"["interval"])$ is applied to the volatilities, not to the
matrix. The observation count $W$ travels with the estimate, because a small $W$
is a weak covariance and the consumer has to be able to see that.

Live, the matrix is built from the returns of the symbols actually held, on
demand, by the risk commands that report contributions and exposure. Nothing
caches it: a PM asking why a number says what it says gets a query for an answer.

One divergence between the two implementations is worth recording rather than
smoothing over. The Python builder requires only two observations per symbol and
a shared window of two; the TypeScript builder requires
#measured[20 observations per symbol and a shared window of 20][web/lib/portfolio-risk/covariance.ts],
returning null below that. The TypeScript floor is the stricter and the more
defensible one. The parity fixture runs on
#measured[120 observations per symbol][web/tests/fixtures/risk-parity.json], so
the divergence does not bite there, which is exactly why it is stated here
instead of being discovered later.

Both implementations sum sequentially, never through `math.fsum` or a vectorised
dot product. Floating-point addition is not associative, and pairwise summation
rounds differently from JavaScript's left-to-right accumulation; the parity
fixture exists to catch that class of drift, so the summation order is part of
the contract rather than an implementation detail.

=== Risk contributions, and why share of notional is not share of risk

With $w_i$ the signed notional of position $i$ divided by equity, the marginal
variance vector is $(bold(Sigma) w)_i$, the book variance is $w^top bold(Sigma)
w$, and each position's contribution and share are

$ "RC"_i = w_i (bold(Sigma) w)_i, quad "share"_i = "RC"_i / (w^top bold(Sigma) w), quad sum_i "share"_i = 1 $

The weights are signed and scaled by equity rather than normalised to one, so a
short enters the quadratic form with a negative weight and its covariance with
the longs subtracts. That is the reason the decomposition exists: a 13 per cent
sleeve in a volatile name can carry more risk than a 42 per cent one in a quiet
name, and a hedging short contributes a #emph[negative] amount, a number a
notional-weighted view cannot produce at all. These weights sum to net exposure
over equity, not to one, so they are a leverage-aware weighting, distinct from
the normalised weights the allocation solvers work in.

A non-positive computed variance returns #emph[null] rather than a zero
volatility, because a book whose estimated variance is degenerate has not been
measured as riskless.

The diversification ratio reported beside the contributions is

$ "DR" = (sum_i abs(w_i) sigma_i) / sigma_p $

the weighted sum of standalone volatilities over the realised book volatility,
both per-bar so the ratio is scale-free. It is one when the book is a single bet
and rises as the positions stop moving together.

=== Intraday P and L attribution: the waterfall

A day's profit-and-loss number answers "how much" and nothing else. The question
a PM asks at the close is how much of it was the market moving and how much was
the desk, because the answer decides whether a good day is worth repeating. The
session is decomposed into four legs that sum, by construction, to the number
they decompose:

$ "dayPnL" = "market" + "residual" + "slippage" + "fees" $

where the residual is a plug, $"dayPnL" - "market" - "slippage" - "fees"$. The
accounting is not double counting, and the argument is written at the module
head: the position state subtracts each fee from realised P and L as the fill is
applied, and paper fills print at the smart-route VWAP rather than at mid, so
fees and slippage are #emph[already inside] day P and L. Pulling them out as
their own bars and letting the residual absorb the remainder counts each exactly
once.

The market leg is measured exposure against a measured reference move:

$ "market" = sum_(i in M) n_i beta_i r_"ref", quad M = { i : beta_i "is measurable" } $

with $n_i$ the signed notional and $beta_i = "Cov"(r_i, r_"ref") \/ "Var"(r_"ref")$
estimated on at least #measured[20 shared observations][web/lib/portfolio-risk/stress.ts].
The beta function returns null rather than defaulting to 1.0, and that null has
to survive all the way into the leg: defaulting an unknown beta to one is the
quiet way an attribution starts inventing exposure, because every unmeasurable
instrument would then move exactly with the reference and the resulting number
would look like a measurement. The leg is computed on #emph[closing] exposure,
because closing exposure is what the payload carries, so a book that traded
during the session did not hold this exposure all day and the leg carries that
error. That error is one of the several things living in the residual.

```
   start equity  ────────────────────────────────────────→  end equity
                  │
                  ├─ market (beta)   Σ nᵢ βᵢ r_ref     measured  or withheld
                  ├─ residual        the plug          derived   or "unattributed"
                  ├─ slippage        −Σ notional×bps   audited, bounded, or withheld
                  └─ fees            −Σ fee            audited   or withheld
                  │
                  └─ complete = every leg present AND |Σ legs − dayPnL| ≤ 0.01
```

Every leg can refuse to exist, and a refusal is never a zero. The five refusals
are the substance of the module:

#table(
  columns: (1fr, 1fr),
  [Condition], [Consequence],
  [No reference return could be measured],
    [the market leg is withheld #emph[and so is the residual]; the remainder is relabelled "unattributed", because a residual with no market leg subtracted from it is day P and L wearing a more flattering name],
  [Some betas unmeasurable],
    [those positions leave the leg, which is then understated; their names are reported and their P and L falls into the residual],
  [No held position has a measurable beta],
    [the leg is withheld outright, and the excluded-names list is emptied, because a leg that does not exist cannot be understated by the names missing from it],
  [$0 <$ fills without slippage $<$ fills],
    [the slippage leg is a #emph[lower bound]: a measurement with a known direction of error],
  [Fills without slippage $>=$ fills],
    [the leg is withheld. The cost query sums notional times slippage coalesced to zero, so an all-null session reports a cost of exactly 0.0, which is a sum over nothing rather than a measurement of nothing],
)

The last of those is the sharpest, and it is reachable from one mark outage
during a maker-filled session. Drawing it as an audited leg of zero would say
execution was free on a session where nobody could measure what execution cost.

Every cost figure is scoped to the session. The gateway zeroes per-position
realised P and L at UTC midnight, so today's P and L contains only today's costs,
and the lifetime aggregates in the payload are not merely useless here but
dangerous: subtracting a lifetime fee total from one day's P and L reports a loss
the desk did not take, and an unweighted mean of basis points cannot become
dollars at all. The session block is accepted only when it describes this book
and this day, with three rejections for the three lies it could otherwise tell: a
basis disagreeing with whether the book is generated; a session date other than
the book's; and a block with no basis at all, which is a gateway without an audit
log rather than one reporting zero cost. A block naming #emph[no] date is
accepted, since its costs may well be this session's, but the note then says the
date could not be checked rather than asserting a day the block never claimed.

Completeness is a statement about arithmetic closure and deliberately not a
quality claim: the legs reconcile to within
#measured[one cent][web/lib/pnl-attribution/types.ts], the residual being a plug,
so anything larger is a bug rather than a rounding artefact. A waterfall can be
complete while its market leg is understated by an unmeasurable beta, which is
why the unmeasured-symbol list and the lower-bound flag are separate fields a
caller has to read as well. A further field carries $"dayPnL" - ("realised" +
"unrealised")$, which is legitimately non-zero in a correct multi-day book:
mark-to-market carried in on positions opened before the session.

The residual is never called alpha. It contains genuine idiosyncratic moves, but
also intraday trading P and L, beta-estimation error, the P and L of every
position whose beta could not be measured, and the error from computing the
market leg on closing rather than opening exposure. Naming that alpha would be
exactly the fabrication the rest of the system refuses.

=== Concentration and the effective-position count

With $s_i = abs(n_i) \/ "gross"$ the share of gross of position $i$, the
Herfindahl-Hirschman index and the effective number of positions are

$ H = sum_(i=1)^n s_i^2, quad N_"eff" = 1/H $

The bounds follow immediately. By Cauchy-Schwarz, $sum_i s_i^2 >= (sum_i s_i)^2
\/ n = 1\/n$ with equality if and only if every share is equal, and $H <= 1$ with
equality when one position is the book. So $N_"eff" in [1, n]$: it is $n$ for a
perfectly spread book and one for a single-name book, and it is #emph[scale-free],
which is what makes it comparable day to day as the book grows.

On the three-position book in the parity fixture, shares of $0.5$, $0.3333$ and
$0.1667$ give $H = 0.3889$ and
#measured[$N_"eff" = 2.57$][derived from `build_portfolio` over the positions in
web/tests/fixtures/risk-parity.json]: three positions that behave, from a
concentration standpoint, like about two and a half. Largest share and top-two
share are reported alongside, because one large position and many equal ones are
both concentrated in different ways and a single metric hides one of them.

What the code #emph[enforces] here is nothing. Concentration is measured and
reported; the enforced cap is the per-symbol notional limit, which is a dollar
figure and not a share. The pushed alert on concentration defaults to
#measured[0.0, meaning off][config.py], and the reason is recorded at the
setting: a one-instrument desk is 100 per cent concentrated and correct, so the
right threshold is a house decision rather than something a config default can
guess. Zero disables a rule outright rather than setting an unreachable
threshold, because "off" and "never fires in practice" are different states and
only one of them is honest.

One honest exception to the absence convention lives here. `effective_positions`
returns $0.0$ when $H = 0$, which happens only on an empty book, and a zero
rather than a dash is a coercion of exactly the kind this system refuses
elsewhere. It survives because `positions: 0` is carried immediately beside it,
so the zero is readable in context rather than standing alone. It is named here
rather than left for a reader to find.

=== Risk-budget allocation and the binding constraint

Every limit is expressed as the same triple, $("used", "limit", "remaining")$
with $"utilisation" = "used"\/"limit"$, and the book's headline status is derived
from the constraint that actually binds:

$ ("name"^*, u^*) = "argmax"_c u_c "over" {"gross exposure", "daily drawdown"} union {"symbol":i} $

#table(
  columns: (1fr, auto, 1fr),
  [Limit], [Default], [What it is],
  [`MAX_ORDER_NOTIONAL_USD`], [#measured[50,000][config.py]], [hard ceiling on a single order, a fat-finger guard],
  [`MAX_SYMBOL_NOTIONAL_USD`], [#measured[150,000][config.py]], [per-symbol net notional ceiling],
  [`MAX_GROSS_EXPOSURE_USD`], [#measured[500,000][config.py]], [aggregate gross notional across open positions],
  [`MAX_DAILY_DRAWDOWN_PCT`], [#measured[0.05][config.py]], [circuit breaker as a fraction of start-of-day equity],
  [`REDUCE_ONLY_THRESHOLD`], [#measured[0.80][config.py]], [fraction of the drawdown budget at which risk-increasing orders are refused and risk-reducing ones still pass],
  [`VAR_BUDGET_PCT`], [#measured[0.02][config.py]], [advisory ceiling on one-day 95 per cent VaR, reported and never enforced],
  [`STARTING_EQUITY_USD`], [#measured[1,000,000][config.py]], [notional starting equity for the paper book],
)

The reduce-only threshold is the only graduated response in the set, and it is
the FIA practice of letting a desk close out of trouble but not deeper into it:
between 0.80 and 1.0 of the drawdown budget the gate is directional rather than
binary. The VaR budget is reported and never enforced, with the reason stated at
the setting: VaR needs history, and denying orders on a missing covariance would
halt a healthy book on its first day.

Utilisation is banded at #measured[0.7 and 0.9][web/lib/portfolio.ts] into
headroom, warning and breach, in one table quoted by the status line, every
headroom gauge and the limits table, because three copies of a threshold are
three chances to disagree about whether 0.9 is a breach. A non-finite utilisation
is caught explicitly rather than falling through both comparisons into the safe
band, which is the direction an unchecked NaN fails in.

The status line carries a scar that a screenshot would not have caught. The
utilisation was once re-derived locally as the maximum of gross and drawdown
while the constraint's #emph[name] came from the gateway. On a book whose largest
position sat at #measured[90 per cent while gross sat at 72 per cent][web/lib/portfolio.ts],
the chip read "elevated, symbol exposure at 72 per cent": the right name beside
the wrong number, one severity band too low, on the one indicator a PM glances at
instead of reading the page. The gateway already computes which constraint binds
and how hard; trusting that and taking the maximum against the headrooms visible
locally means the label and the number cannot disagree.

The drawdown limit is the one whose headroom is deliberately reported in
different units from its limit. The limit is a percentage of start-of-day equity;
the headroom that matters is the equity cushion in dollars, which is the number a
PM can compare against a position size. The row carries both a `unit` and a
`headroomUnit` rather than being pre-formatted, because a single formatter would
have to guess.

=== Leverage: what is measured, and what is enforced

Leverage is computed as gross exposure over current equity and reported to three
decimal places on the portfolio view and the exposure command. Nothing is keyed
on it. The enforced gates are dollar-denominated, per order, per symbol and in
aggregate, plus the drawdown breaker and the rate limiter. A leverage limit is
#strong[not built], and stating that is more useful than implying one exists.

A notional cap and a leverage cap diverge as equity moves, so the relationship is
worth deriving. At the shipped defaults the implied leverage ceiling at
start-of-day equity is

$ "MAX_GROSS_EXPOSURE_USD" / "STARTING_EQUITY_USD" = 500{,}000 / 1{,}000{,}000 = 0.5 times $

so the gross cap binds far below $1 times$ and a leverage gate would never be the
binding constraint at these defaults. As equity falls the implied ceiling
#emph[rises], since the cap is a fixed dollar figure: at the 5 per cent drawdown
halt the same cap implies $500{,}000 \/ 950{,}000 approx 0.526 times$. The effect
is small at the shipped numbers and structural at any others, which is the reason
to write the relationship down rather than the number.

The pushed alert on gross exposure over equity also defaults to
#measured[0.0, meaning off][config.py], with the reason recorded: a desk running
deliberate leverage would be paged constantly, and the right number is a house
decision.

== Part C: the quant-engine workbench as a research instrument

Markets, Proofs and Diffusion are not three galleries of explanatory charts.
They are one addressable inspection system that lets a researcher select an
entity, perturb an assumption and read the exact consequence without asking a
pixel for a number. The current registry exposes #measured[71 engine views - 26
Markets, 29 Proofs and 16 Diffusion][`web/lib/section-views.ts`, counted
2026-09-02] beneath #measured[22 rail sections across the three engine tabs][
`web/lib/sections.ts`, counted 2026-09-02]. Each destination has a canonical
`#tab/section/view` address, so an investment note can cite the state that
produced a claim rather than a screenshot of an unrepeatable hover.

#table(
  columns: (auto, 1.15fr, 1.2fr),
  [Plane], [Question it makes executable], [Interaction contract],
  [Markets], [How fees, stake, books, lattice mass and moments, settlement and the instrument universe change a tradable claim.], [Stable keyed selection; a single keyboard tab stop in listboxes; Arrow, Home and End traversal; exact atomic readouts; explicit absent sides rather than synthetic zeroes.],
  [Proofs], [Whether quoted prices, baskets and parlays satisfy the relevant coherence bounds, and which observation drives a verdict.], [Linked selections keep the formula, selected datum and verdict on the same identity; quant-inspection pairs expose the exact value and its interpretation; a changed result is announced as one fact.],
  [Diffusion], [How an event propagates into price, how long a dislocation survives, and when absorption is supported by the sample.], [Event-study controls drive the fitted study and episode tape; sparse states remain visible and typed; all sixteen views remain individually addressable.],
)

The keyboard model is deliberate. A list of market levels is one listbox owner,
not two visual columns with two incompatible indices. Exactly one option is in
the tab order; movement changes both focus and the stable selected key; the
result appears in an `output` with polite, atomic live semantics. This prevents
the common failure in dense quant screens where a mouse can reveal a value that
cannot be reached, retained or announced from the keyboard. The regression
contracts live in `web/tests/markets-quant-workbench.test.ts`,
`web/tests/workspace-routing-sections.test.ts`,
`web/tests/diffusion-upgrade.test.ts` and the focused interaction tests beside
the individual instruments.

== What this chapter's subject matter does not have

Collected so that no reader has to infer it from silence:

- #strong[No expected-return model], therefore no mean-variance frontier and no
  tangency portfolio. The allocator answers how the risk should be spread, never
  what the book should own.
- #strong[No combinatorially purged cross-validation.] The overfitting
  probability is the sequential reading over walk-forward folds, with the
  five-valued coarseness derived above, and it is not a gate.
- #strong[No Newey-West standard errors.] The alpha t-statistic is plain OLS, so
  the reported significance is generous and the interface frames a significant
  alpha as "not explained by these three factors" rather than as real alpha.
- #strong[No cross-sectional factors.] One instrument's OHLCV cannot produce SMB,
  HML or a momentum decile, and constructing something that merely resembles them
  from a single series would be the dishonesty the rest of the system exists to
  prevent.
- #strong[No across-sweep multiplicity correction], as discussed above.
- #strong[No sleeve exposure decomposition.] Sleeve mix is a #emph[flow] measure,
  traded notional per strategy over the audit log's lifetime, because the
  positions payload carries no strategy tag to build current exposure from. The
  panel says the word "flow"; calling it sleeve concentration without that word
  would describe a chart the data cannot draw.
- #strong[No live emission of session summaries.] The producer is built, tested
  and called by the backfill tool, but nothing emits one in process, so on a
  running desk the summaries appear when the backfill is run and not before.
- #strong[No real order routing.] Orders are paper, capped by the gateway's own
  gates, and the honesty ledger in the repository README carries the full list of
  what is mocked against what is implemented.

Each of these is an absence with a reason, which is a different object from a
gap. A desk that knows which of its numbers are measurements can be argued with,
and that is the only property that matters on the day the arithmetic disagrees
with the person reading it.
