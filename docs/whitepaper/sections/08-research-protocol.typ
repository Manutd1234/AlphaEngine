#heading(level: 1)[#text("Research protocol, quantitative interpretation and verification")]

#heading(level: 2)[#text("Revision G audit: deduplicated figures and interaction status")]

#text("Revision G renames Chapter 9 to AlphaEngine Features, groups each supplementary pane with its parent section, and adds a linked Oracle page index plus registered-view and internal-subtab coverage tables. Exact image duplicates and repeated disclosure captures are not reprinted. The underlying original evidence remains attached and retained in the repository.")

#text("New production captures include a byte-exact browser Monte Carlo parity result, six-provider cross-source reconciliation, settled Oracle search health, a 90-day Oracle VaR calculation, Research Adjustments, Robustness and Sharpe colouring, and previously omitted Execution panes. Gateway-dependent captures disclose the continuing outage. Some views are represented by earlier dated working captures because current gateway access is unavailable.")

#text("The interaction matrix explicitly distinguishes source definitions, observed runtime controls, route-render checks and executed actions. Every inventoried entry has a status and evidence scope. Untested or blocked actions are not counted as successful. Creating a documentation task and recording a benchmark run were blocked by automatic approval review; their unsubmitted or existing states remain labelled. Private RFQ requires an authenticated desk account.")

#text("The following Revision F results and earlier test counts are historical observations, retained with their original build identities. They do not imply a new full regression run or current backend availability. The latest UI sweep, capture fixes, publication plan, subtab coverage and interaction matrix are embedded as evidence.")

#heading(level: 2)[#text("Latest verification: Oracle search repaired; gateway access unresolved")]

#metadata("oracle-repair") <capture-oracle-repair>
#text("Revision F was captured from production build 3b9918f6 on 5 October 2026. The exact query reported by the user, moving average crossover drawdown, now returns an Oracle research match in the deployed Vercel UI. The successful result is Backtest BTCUSDT 1h ma_cross 10/200, cosine similarity 0.8501158. The browser measured a 736 ms round trip. The result is a stored historical observation, not a newly successful trading strategy.")

#text("The original search path was browser to Vercel to the OCI gateway VM to Supabase embeddings, then back to Vercel and Oracle ADB. The gateway did not answer within eight seconds. Independent checks showed that Supabase returned a valid 384-dimensional gte-small vector in 0.94 seconds and Vercel could execute the Oracle Monte Carlo procedure. The repair calls the same Supabase embedding function directly from the Vercel server, removing the unavailable VM hop for Oracle searches. Server credentials never enter the browser. The model name, dimension, finite coordinates and nonzero vector are validated; incompatible embeddings fail instead of producing arbitrary neighbours. Deployments without the server credential retain their existing gateway path.")

#text("Supabase UI search still uses the gateway because it owns tenant scoping, retrieval fusion, optional reranking and the research audit trail. It remains blocked by the gateway timeout. No direct database shortcut was substituted for that authorization and accounting path. SSH and HTTPS to the VM time out, and the Oracle console requires the user to sign in. The precise VM or network cause and current container state cannot be established from a timeout. The UI now preserves the classified gateway error rather than calling the response unreadable or reporting zero matches.")

#text("All seven GitHub workflows are disabled_manually, with zero running and zero queued jobs at the final workflow check. This includes OpenBB warm-keeping and public-market observation as well as the five previously paused Oracle-connected workflows. Container shutdown is NOT verified. Oracle ADB still answered live queries and has not been stopped through OCI. No database, volume or retained audit history was deleted. Stopping workflows prevents their scheduled calls; it is not proof that cloud resources stopped accruing charges. Console access remains necessary to complete the requested service shutdown.")

#text("The Oracle axis-margin repair is deployed. New 1-day, 10-day and 30-day screenshots show real in-database Monte Carlo computations against the explicitly selected generated Sandbox book, with complete currency tick labels. At the captured 30-day observation the Oracle 99% terminal-loss estimate was 2,061,676 dollars and the matching closed form was 2,035,391 dollars, a displayed divergence of 1.3%. These inputs are a ten-million-dollar generated book, not the live paper positions. The chart plots independent repeated simulation estimates; it is not an equity time series.")

#text("The repair passed 117 focused tests and TypeScript checking. These checks cover embedding model and vector validation, credential transport, failure handling, Oracle contracts, deadlines and chart behavior. They supplement the earlier broad suites below; they do not establish that every authenticated action or backend feature works. The current edition deliberately records the successful Oracle search and the unresolved Supabase/gateway boundary separately.")

#heading(level: 2)[#text("Interpreting the retrieved quant evidence")]

#metadata("oracle-search-method") <capture-oracle-search-method>
#text("Cosine similarity compares the direction of the query and document embeddings. For nonzero vectors q and d it is q dot d divided by the product of their Euclidean norms. Oracle stores the same 384-dimensional gte-small representation used by the embedding service. The score 0.8501 is a semantic proximity measure, not an 85% chance of profitability, a statistical p-value, or a calibrated forecast. The configured relevance floor determines which neighbours can be displayed. No match means no sufficiently similar indexed evidence was found; an unavailable request means no valid search outcome was obtained.")

#text("The matched record reports historical total return 0.006105, maximum drawdown -0.079040, deflated-Sharpe evidence 0.2016, walk-forward out-of-sample Sharpe -0.293 and PBO 0.75. In percentage terms the stored return is about 0.61% and drawdown about -7.90%. The negative out-of-sample Sharpe and high reported overfit probability caution against treating retrieval as strategy approval. The stored engine and combination-count fields are None; they remain missing historical metadata and have not been fabricated for presentation. The source reference and data hash allow a reviewer to identify the evidence being discussed.")

#text("The two index choices contain different populations. Supabase is the gateway-maintained corpus with its own retrieval and graph machinery. Oracle contains backfilled historical research snapshots. Differences in hit count can reflect corpus membership, ingestion time, ranking or filtering. A valid comparison records query text, backend, model, timestamp, relevance threshold and document identity. Connected-document traversal belongs to the Supabase graph; an Oracle row identifier does not by itself establish a corresponding graph node.")

#heading(level: 2)[#text("Abstract and contribution")]

#text("This chapter documents AlphaEngine as an inspectable quantitative research system, with an empirical software-verification study and a visual instrument catalogue. It connects each registered workspace section to a research question, mathematical or operational method, input intervention and interpretation boundary. It is not a new backtest claiming profitable alpha. Its reproducible contribution is the linkage between the implemented estimator, the visible control that changes it, and the evidence needed to interpret its output.")

#text("The observation set contains 11 tabs, 70 sections, 120 registered URL views and 92 supplementary interface states. The visual appendix contains 372 screenshot placements from 372 distinct browser captures. An AST inventory records 964 source control definitions and 49 event-listener registrations across 855 source files. These denominators describe different populations and must not be added together or treated as independent trials. One source definition can generate many runtime buttons; one view can require several screenshots.")

#text("The study combines deployed-interface capture with local numerical, contract and browser tests. The deployed build observed during capture was 726bbe7; local source was 5225f3e2 plus the documented test fixture and Oracle chart-margin corrections. Deployment parity is therefore not established. The initial outage screenshots were rechecked and replaced after restoring the gateway at the user request. The deployed Vercel UI reads real providers, Oracle calculations and retained analytical history. Three accepted paper verification orders populate the live paper book. Supplemental portfolio/risk views explicitly select Sandbox and identify generated inputs. No real-money trade or destructive operator action was executed.")

#heading(level: 2)[#text("Live recapture: corrected data and operational evidence")]

#text("The initial edition included explicit gateway-outage text in 111 of its 210 captured states. This was an unsuitable basis for a populated feature demonstration. The revised atlas uses the actual Vercel production interface after restoring OCI gateway and reverse-proxy containers. Capture checks reject blank pages and wrong origins; delayed market panes wait for their initial calculation, and family selection must commit before the figure is saved.")

#text("Live probes returned 120 real Bybit bars, a 51-combination backtest sweep, Oracle responses and eight configured providers. The authenticated in-container dependency check confirmed the Supabase mirror and research writer running and Neo4j returning 16 documents, 57 edges and two communities. A stale local gateway token failed direct smoke checks; the deployed Vercel proxy and in-container identity passed. These scopes are retained separately in live-verification.json.")

#text("The three accepted paper verification orders total 3,000 USD nominal exposure and remain distinguishable from historical orders. They are not real venue trades. Supplemental Sandbox figures use the product’s own generated book and are labelled accordingly. Public prediction-market families are chosen to match the model: a threshold ladder for Survival, an exhaustive GDP bucket family for Mass and Stake, and a separately priced basket family for cover and capacity.")

#text("Limits that cannot be repaired by waiting are preserved: private Makers/RFQ requires sign-in and desk membership; missing subminute diffusion observations are not invented; a zero optimal stake means the specified probabilities and prices do not justify a bet; low exposure and positive GBM drift can produce zero floored loss. Healthy operation does not imply a profitable strategy, positive allocation or a nonzero risk statistic.")

#text("The earlier recapture observed the gateway and reverse proxy running. The latest verification section supersedes that operating observation: the VM is now unreachable and all seven workflows are disabled. Captures and connection checks are time-specific; authenticated private success and final service shutdown remain unverified.")

#heading(level: 2)[#text("Visual defect repaired in production")]

#text("The fixed left margin had clipped leading digits of large currency-axis ticks. The deployed correction reserves space for the longest formatted tick. New production screenshots show complete million-dollar values at the 10-day and 30-day horizons. The figures use real Oracle calculations with explicit Sandbox inputs; no chart pixels or values were edited. Private RFQ success remains unverified pending an authenticated desk session.")

#heading(level: 2)[#text("Research questions and falsifiable acceptance criteria")]

#text("RQ1 asks whether every registered section can be identified and documented with its actual rendered appearance. The acceptance unit is the route manifest, not the number of attractive screenshots. RQ2 asks whether numerical and presentation contracts remain consistent under controlled input changes; its units are named tests and exact observable outcomes. RQ3 asks whether a research claim can be traced through source identity, inputs, estimator, assumptions and failure conditions. RQ4 asks whether an unavailable dependency is disclosed rather than silently converted into a valid-looking measurement.")

#text("A section passes documentation coverage when its route, screenshot(s), captured controls and quantitative explanation exist. This does not imply functional coverage of every hidden branch. A control passes a functional check only when its event is exercised and an observable postcondition is asserted. Screenshot existence is presentation evidence; source existence is implementation evidence; neither is equivalent to successful live service execution. The study makes no statistical claim that a finite test suite proves every possible interaction correct.")

#heading(level: 2)[#text("Design, units of analysis and data provenance")]

#text("The interface census follows the registered desk/section/view state space, then adds disclosures, segmented panes, settings, authentication forms and guarded panels. Captures use a 1600 by 1000 browser viewport and scroll the workspace when necessary. Figures are printed on larger landscape sheets for legibility. Route hashes connect the method notes below to the identically named screenshot and control tables. Captured text, disabled states, option lists and image filenames remain available in the embedded JSON manifests.")

#text("Quantitative units must be stated before interpretation: returns are per bar; annualised volatility carries a year convention; portfolio weights are relative to equity; execution costs use currency or basis points; binary-market prices are fractions of a unit payoff; diffusion time is in minutes. A provider timestamp is not a settlement timestamp, a retrieved document is not a filled trade, and an event count is not an independent sample count. Null or unavailable observations must not be relabelled as zero.")

#text("Historical measurements in the six preceding chapters retain their original artefact and date. The October 2026 verification table below is the current software evidence for this edition. Earlier latency, data availability, benchmark and deployment statements should not be read as current measurements. The visual atlas records a live recapture; availability is time-specific and is not a continuing service guarantee.")

#heading(level: 2)[#text("Return construction and selection-aware research")]

#text("A transparent conceptual return ledger applies yesterday's position to today's price change and subtracts the cost of changing exposure. Let r_t be the simple asset return, w_(t-1) the exposure known before that return, and c_t the fee/slippage cost per unit turnover. The equation below states the economic timing contract; individual strategy engines may additionally implement stops, sizing, shorting and turnover conventions. The actual implementation and exported parameters govern an exact reproduction.")

$ r_t^"net" = w_(t-1) r_t - c_t abs(w_t - w_(t-1)) $

#text("For an illustrative 1% asset return, 50% pre-existing exposure, 20% exposure change and 10 basis points of cost per unit turnover, the net return is 0.5% minus 0.02%, or 0.48%. Applying the end-of-bar signal to that same bar would introduce future information. This arithmetic example is not an observed AlphaEngine strategy result.")

$ hat("SR") = sqrt(A) (overline(r) - r_f) / s_r $

#text("Here A is bars per year, the risk-free return r_f is on the same per-bar scale, and s_r is sample return volatility. Annualising under serial dependence requires more care than multiplying by the square root of A. A price-chart interval, a backtest return interval and the Oracle 365-day simulation year are separate conventions. Sharpe, drawdown, turnover and cost must be reported jointly.")

#text("The search family includes strategies, parameter combinations, symbols, timeframes, filters and repeated researcher revisions. Bailey and López de Prado [R1] motivate adjusting performance inference for selection and non-normal returns. The system exposes PSR/DSR and track-record evidence for that purpose. The precise reference Sharpe, skewness, kurtosis and effective trial assumptions matter; a high displayed probability cannot repair an unrecorded search. Walk-forward estimates should use chronological train/test separation and report each fold, sample size and selected parameter pair.")

#heading(level: 2)[#text("Portfolio risk: covariance, VaR, ES and attribution")]

#text("For equity E, exposure weights w and aligned per-bar covariance matrix Sigma, the portfolio implementation derives volatility and normal loss summaries. The covariance window, alignment, missing-data policy and shrinkage settings determine the estimate. Positive VaR denotes loss. Parametric normal VaR is a model quantile; it is neither a worst-case loss nor a guarantee that the boundary will hold.")

$ sigma_p = sqrt(w^T Sigma w), quad "VaR"_(.95) = 1.6448536269514722 E sigma_p $

$ "ES"_(.95) = 2.0627128054846826 E sigma_p, quad "RC"_i = w_i (Sigma w)_i / sigma_p $

#text("The normal summaries above use the zero-drift convention in web/lib/portfolio-risk/risk.ts. Under differentiable nonzero volatility, Euler contributions sum to sigma_p. A negative contribution can represent a hedge rather than invalid data. Scaling contributions to currency or percentages requires the same equity and normalisation convention. Historical simulation, bootstrap paths, stress shocks and parametric VaR answer different questions and need not agree.")

#text("Controlled arithmetic: with E = 100,000 currency units and per-bar volatility 1.2%, normal VaR95 is 1,973.82, and normal ES95 is 2,475.26. These are illustrative inputs, not the captured book. ES describes the conditional tail mean under the assumed normal distribution. It should not be read as the largest possible loss.")

#heading(level: 2)[#text("Oracle comparison and Monte Carlo uncertainty")]

#metadata("oracle-var-method") <capture-oracle-var-method>
#text("The Oracle panel has a distinct terminal-value geometric Brownian motion reference. Annual drift mu, annual volatility sigma and forward days d must be identical in the database simulation and the analytical comparator. The local reference explicitly uses T = d/365 and floors a negative reported loss at zero. Comparing this model to a zero-drift normal approximation would conflate model discrepancy with Monte Carlo error.")

$ S_T = E exp((mu - sigma^2 / 2) T + sigma sqrt(T) Z), quad Z ~ cal(N)(0,1) $

$ "VaR"_(.99)^"GBM" = max(0, E - E exp((mu - sigma^2 / 2) T - 2.326347874 sigma sqrt(T))) $

#text("At illustrative equity 100,000, annual drift 8%, annual volatility 20% and 30 days, the matched GBM reference gives approximately 12,054.87 currency units. This illustrative value was computed from the equation. The separate UI recapture also exercised the live Oracle service with its displayed inputs. The bootstrap Monte Carlo screen is a separate historical-return model and should not be expected to match GBM when its assumed return distribution differs.")

#text("Seed selection controls reproducibility, path count controls simulation precision, and horizon changes the estimand. Roughly N times 0.01 paths populate a 1% tail before interpolation; 1,000 paths therefore provide only about ten tail observations. A stable seed is not evidence of statistical accuracy. Compare independent seeds and increasing path counts before attributing a discrepancy to database precision. Live UI observations confirm database execution, but do not constitute a full distributional convergence study. The small live verification book can produce zero floored loss under the 8% drift assumption; the explicitly selected Sandbox provides a higher-exposure comparison.")

#heading(level: 2)[#text("Execution cost and order decisions")]

#text("An order ticket expresses an intent, not a fill. Side, notional, type, limit price and execution assumptions feed a gate vector whose vetoes remain observable. Separate spread, explicit fee, impact, latency and adverse selection when analysing implementation shortfall. A routing allocation computed from a snapshot can become stale before execution; displayed depth is not an executable guarantee.")

#text("In a simplified signed-cost definition, implementation shortfall equals side times the difference between fill VWAP and arrival price, divided by arrival price, plus fees on the same notional. Buy side is +1 and sell side is -1. For a buy at an arrival price of 100, fill VWAP 100.05 and fees of 2 basis points, illustrative shortfall is 7 basis points. Partial fills, cancelled quantities and opportunity costs require a separately defined denominator and horizon. The recapture submitted three paper BUY orders through the deployed UI: BTCUSDT 1,000 USD, ETHUSDT 1,500 USD and SOLUSDT 500 USD. All were accepted, creating three paper positions; the fill-quality panel reads the retained decision ledger. These are simulated verification trades, not live venue fills.")

#text("Liquidity ladder selection and ticket editing are presentation operations; Send, Cancel, burst demonstrations and risk-control mutations require the gateway and operator authority. Offline gate tests can verify rejection logic without proving venue connectivity, fill probability or a live kill switch. The atlas records each visible or source-defined action without treating it as a successful trade.")

#heading(level: 2)[#text("Prediction-market coherence and executable bounds")]

#text("A coherent set of quotes admits at least one probability assignment over the same mutually exclusive, exhaustive state space. Let q be the state probabilities, A the payoff incidence matrix, and b/a aligned bid/ask vectors. A conceptual feasibility system is shown below; practical certificates additionally encode the implemented relation set, tolerances, settlement rules and available sizes.")

$ b <= A q <= a, quad q >= 0, quad sum_i q_i = 1 $

$ max(0,p_A+p_B-1) <= p_(A ∩ B) <= min(p_A,p_B) $

#text("For illustrative marginal probabilities 0.6 and 0.5, the joint event can lie anywhere from 0.1 to 0.5 without an additional dependence assumption. The independence value 0.3 is one admissible choice, not a bound forced by the marginals. A parlay quoted at 0.55 violates this simple upper bound only if the contracts truly represent the asserted events under matching settlement definitions and quotes are executable on the required sides.")

#text("A price-only violation is not a net executable arbitrage. A statewise basket requires covered outcomes, correct buy/sell direction, depth, fees, capital, settlement and rounding. The binary-book identity maps a NO bid to a YES ask by one minus that bid; it does not justify adding two same-side quotes as though they were purchase costs. Inspect Prices and Sizes separately before interpreting the certificate.")

#heading(level: 2)[#text("Kelly sizing, forecast scores and calibration")]

#text("For a mutually exclusive exhaustive family, let f_i be the bankroll fraction spent on outcome i, a_i its price and p_i the forecast probability. The implemented local frontier replay computes residual cash and the terminal wealth multiplier if outcome i occurs. It rejects nonfinite or nonpositive wealth. The model is a log-growth illustration whose validity depends on the state-space and probability assumptions.")

$ c = 1 - sum_i f_i, quad W_i = c + f_i/a_i, quad G = sum_i p_i ln(W_i) $

#text("Scaling all fractions creates the displayed fractional frontier. The lowest statewise wealth, remaining cash and expected log growth answer different capital questions. Probability uncertainty, fees and correlated or missing outcomes can dominate the apparent optimum. The Stake pane does not execute a portfolio. A visually attractive allocation is not evidence that its probabilities are calibrated.")

$ "BS" = (1/n) sum_(i=1)^n (p_i-y_i)^2 $

#text("For binary outcomes y in {0,1}, Brier loss is lower when probability forecasts assign mass more accurately. Forecast timestamp and settlement label must be aligned without future information. Reliability bins compare mean forecast with realised event frequency; their widths and counts must accompany the chart. Proper scoring principles [R2] concern incentives and distributional assessment, not evidence that one observed sample proves a forecasting edge. A mixed corpus of different contracts, horizons or selection rules can change the score even when the underlying forecaster is unchanged.")

#heading(level: 2)[#text("Diffusion instruments and empirical identification")]

#text("The diffusion workspace studies how an announcement response evolves through time, with announcement-stage controls, meeting observations, closed episodes and synthetic estimator probes. The exact rate/price sign convention and terminal normalisation determine what an absorption ordinate means. Overshoot and reversal are economically meaningful; clipping the displayed curve would erase them. A fitted scale and shape describe a model, whereas the nonparametric residence-time target is a different object.")

#text("In the implemented skill-study target, the terminal response is measured at 30 minutes, the area above the absorption curve is integrated with a trapezoidal rule over a finite window, and the resulting time is clipped to [0,30]. Missing terminal values and zero terminal response are inadmissible. This is a bounded finite-window target; calling it exactly the infinite-horizon exponential time constant would be inaccurate. The distinction matters for interpreting coefficients and out-of-sample error.")

$ tau_H = integral_0^H (1-a(t)) dif t $

#text("For an ideal illustrative absorption curve a(t)=1-exp(-t/tau), the integral is tau times (1-exp(-H/tau)). With tau=20 minutes and H=30 minutes it is approximately 15.54 minutes before implementation clipping. It only approaches 20 as the observation horizon grows. This worked example explains the finite-window estimand; it is not a newly fitted announcement.")

#text("The empirical comparison holds both stages of a meeting out together. Baseline controls and augmented text-derived features must use the same training fold, target definition, precision weights and evaluation population. A change in weighted held-out loss is the relevant comparison; a selected in-sample t statistic is insufficient. Meeting-level dependence, small samples, post-hoc thresholds, shuffled evidence and the entire specification grid must remain visible. The current work verifies software and documents existing findings; it does not recompute the historical study or promote its displayed numbers to new research results.")

#heading(level: 2)[#text("Verification results and scope of inference")]

#table(columns: (1fr, 2fr, 2fr), table.header([#text("Evidence")],[#text("Observed result")],[#text("What this establishes")]),
[#text("Web suite")],[#text("6,850 passed; 0 failed; 6 opt-in cases skipped")],[#text("Numerical, source-contract and component logic within existing tests.")],
[#text("Gateway suite")],[#text("3,500 pass dots; successful exit")],[#text("Offline gateway behavior under the test fixtures; no cloud availability claim.")],
[#text("OpenBB service")],[#text("24 passed; 1 dependency deprecation warning")],[#text("Service contracts in its local test environment.")],
[#text("Browser suite")],[#text("23 cases initially: 22 passed, 1 failed; targeted five-case recheck: all passed")],[#text("The failure was a test fixture assumption; no unresolved failure in these selected files.")],
[#text("TypeScript")],[#text("Typecheck exit 0")],[#text("Static typing of local source after generated development types were available.")],
[#text("Route navigation")],[#text("120 of 120 passed; no uncaught page errors")],[#text("Expected workspace and section visible with non-empty content; Portfolio/Risk use explicitly selected Sandbox.")],
[#text("Visual census")],[#text("120 canonical views; 92 supplementary states; 372 screenshot placements")],[#text("Rendered coverage of live Vercel states, explicit Sandbox states and documented access/data limitations.")],
[#text("Source census")],[#text("964 controls; 49 listener registrations; 854 files scanned")],[#text("Implementation inventory, not a 964-of-964 behavioral success claim.")],
)

#text("Browser files: focus-browser-interaction, coherence-interaction-layout-stability, workspace-refresh-bootstrap, header-browser-containment, and responsive-header-and-density-followup. Assertions exercise chart focus, keyboard inspection, both-axis zoom, drag pan, close behavior, stable readout geometry, header containment across responsive widths, deep-link bootstrap and task creation/control geometry. The main web-suite skipped cases were opt-in browser paths; the selected five browser files were run separately. The reported totals are not summed because their source-contract cases overlap.")

#text("The earlier, separate local-browser census navigated all 120 registered view hashes and asserted that the expected workspace and section were visible with meaningful content. It recorded no uncaught page errors. Portfolio and Risk used the generated book after clicking Explore the sandbox book; Oracle API calls remained blocked. This verifies route reachability and section rendering, not every individual button, nested computation or live response. Exact per-route results are attached as route-verification.json.")

#text("The initial browser failure expected a task-row select in a fresh engineering queue, which intentionally contains no sample tasks. The test was corrected to click New work, fill Title and submit Add to triage before measuring row controls. All five cases in that file then passed. This changes the test setup, not product behavior. An initial typecheck raced generated Next.js files during server startup; a subsequent check after startup completed without errors. The local server was configured without the project's paid service credentials.")

#text("No claim is made that every hidden, authenticated, destructive or remote interaction has been executed successfully. Live Oracle simulation and paper order submission were exercised after the user requested reconnection. Real venue trading, destructive remediation and private account operations were not tested. The five Oracle-connected GitHub schedules remain paused while their dependency connections were checked; no deployment or schema workflow was run merely to produce screenshots.")

#heading(level: 2)[#text("Section-by-section quantitative interpretation")]

#text("Each entry below identifies a falsifiable analytical question and explains what an input change means. The matching route in the visual atlas supplies the actual screenshot(s), button labels, options and captured disabled states. The source register supplies conditional controls that were not rendered. Use all three together: the method note explains why, the screenshot explains where, and the event/attribute record explains the implemented interaction.")

#heading(level: 3)[#text("Decision loop | overview/loop")]

#strong[#text("Research question.")] #text("Is the proposed research-to-order decision supported by the same evidence at each stage?")

#strong[#text("Method and estimand.")] #text("Treat the dashboard as a directed decision graph: data produces a candidate, the candidate produces an order intent, and the portfolio and risk boundary constrain whether it may proceed. The displayed equity, tail loss and binding limit are projections of shared state, not independently estimated observations.")

#strong[#text("Controls and interpretation.")] #text("Review verdict opens Research. Each pipeline stage opens its corresponding workspace; Next step advances the decision loop. A failed research verdict must remain visible after navigation rather than being replaced by the health of the data provider.")

#strong[#text("Assumptions and failure modes.")] #text("An available provider does not validate a strategy. An unreachable gateway leaves position-dependent quantities unknown. The overview supports triage; it is not a performance estimator or investment recommendation.")

#heading(level: 3)[#text("Desk roles | overview/desks")]

#strong[#text("Research question.")] #text("Which analytical role owns the next unresolved question?")

#strong[#text("Method and estimand.")] #text("The seven role launchers map research, execution, portfolio, risk, data, reliability and engineering to the same underlying state. Role selection changes the question being presented, not the underlying observations or authority to trade.")

#strong[#text("Controls and interpretation.")] #text("Activate a role card to open the named workspace. Header tabs and keyboard shortcuts provide alternate routes to the same destination; these paths should preserve the current instrument.")

#strong[#text("Assumptions and failure modes.")] #text("Role cards are navigation, not permission grants. Guest and authenticated capabilities still depend on the explicit route and operator guard.")

#heading(level: 3)[#text("Audit trail | overview/audit")]

#strong[#text("Research question.")] #text("Can a paper decision be traced to an observed event?")

#strong[#text("Method and estimand.")] #text("The audit trail reads the gateway ledger. Order identifiers and recorded decisions support temporal reconstruction; the absence of a reachable ledger must not be represented as an observed count of zero trades.")

#strong[#text("Controls and interpretation.")] #text("Inspect the available audit rows and follow the Blotter handoff for execution details. Expand scope/context disclosures to distinguish local browser context from gateway history.")

#strong[#text("Assumptions and failure modes.")] #text("An append-only event record supports accountability, not by itself economic correctness. Offline capture cannot establish that a displayed historical event is complete or that the deployed ledger is currently reachable.")

#heading(level: 3)[#text("Summary | research/summary")]

#strong[#text("Research question.")] #text("Does the selected strategy survive selection-aware statistical scrutiny?")

#strong[#text("Method and estimand.")] #text("The result combines a lagged, cost-adjusted return path with a reproducibility capsule and a search-adjusted verdict. Annualised Sharpe is descriptive; PSR/DSR, minimum track record and out-of-sample performance address different statistical questions. All must refer to the same bars, parameters and cost assumptions.")

#strong[#text("Controls and interpretation.")] #text("Results/Setup switches between evidence and inputs. Choose symbol, interval, strategy and parameters; Auto recomputes, while Run now explicitly records an experiment. Core parameters and Adjustments expose different assumptions. Pin/record state prevents duplicate history entries.")

#strong[#text("Assumptions and failure modes.")] #text("The displayed winner is selected from a search, so its raw Sharpe is biased upward. A FAIL is a substantive output. Neither the run time nor a positive equity curve demonstrates generalisation; source identity and search breadth must accompany any quoted metric.")

#heading(level: 3)[#text("Parameters | research/parameters")]

#strong[#text("Research question.")] #text("Is performance stable around the selected parameter pair?")

#strong[#text("Method and estimand.")] #text("Each heatmap cell represents a complete strategy evaluation at a fast/slow pair, subject to model-specific parameter semantics and the finite combination budget. Ranking the grid and inspecting neighbouring cells distinguishes a plateau from an isolated optimum without redefining the search after seeing the answer.")

#strong[#text("Controls and interpretation.")] #text("Click a cell or use the keyboard to inspect its exact parameter pair and statistics. Change the ranges and step sizes in Setup to define a new hypothesis family. Record the new search rather than comparing cells from mismatched grids.")

#strong[#text("Assumptions and failure modes.")] #text("A smooth parameter surface is not an out-of-sample test. Nearby cells share most observations and trades, so cell count is not a count of independent experiments. Fractional threshold axes must not be interpreted as lookback periods.")

#heading(level: 3)[#text("Walk-forward | research/walkforward")]

#strong[#text("Research question.")] #text("Does a rule selected on past data retain performance on later observations?")

#strong[#text("Method and estimand.")] #text("The implementation partitions the series into chronological training/test windows, selects parameters using training observations and reports the subsequent test result. Embargo and minimum-window guards prevent invalid folds. Out-of-sample rank compares the training-selected candidate with the alternatives on the held-out interval.")

#strong[#text("Controls and interpretation.")] #text("Inspect each fold, selected parameters, sample size and test metrics. Use Setup to alter fold count or embargo, then rerun the entire experiment. Compare fold stability rather than reporting only the aggregate winner.")

#strong[#text("Assumptions and failure modes.")] #text("Repeatedly changing folds after reading their outcomes constitutes another search. Purging addresses information overlap; it does not remove regime changes or make adjacent return observations independent.")

#heading(level: 3)[#text("Attribution | research/attribution")]

#strong[#text("Research question.")] #text("Which exposures and market states explain the observed return?")

#strong[#text("Method and estimand.")] #text("Factor regressions, regime cuts and tail views decompose the same strategy path. Estimated coefficients associate returns with explanatory series; residual return is not automatically causal alpha. Attribution uses finite aligned samples, so every estimate inherits the input window and cost convention.")

#strong[#text("Controls and interpretation.")] #text("Select factor/regime/tail views and inspect marks for exact values. Preserve the current symbol and experiment when comparing sections. Recompute after changing execution costs to see whether the apparent contribution survives netting.")

#strong[#text("Assumptions and failure modes.")] #text("Collinear factors make coefficients unstable, and ordinary least-squares errors do not automatically handle heteroskedasticity or serial dependence. A regime label assigned with future information would invalidate a predictive interpretation.")

#heading(level: 3)[#text("Lineage | research/lineage")]

#strong[#text("Research question.")] #text("Can the result be reproduced from its original observations and transformations?")

#strong[#text("Method and estimand.")] #text("Lineage links raw venue bars, validation, caching, signal generation and the decision path. Dataset hashes identify content; source labels identify provenance. Retrieval from desk memory is a separate evidence query and should distinguish unavailable search from a successful search with no matches.")

#strong[#text("Controls and interpretation.")] #text("Inspect pipeline nodes, dataset identity and evidence disclosures; use research-memory search when the backing service is configured. Follow related workspace or source references to inspect the observation underlying a result.")

#strong[#text("Assumptions and failure modes.")] #text("A hash detects differences, not correctness. A matching hash cannot establish that the vendor timestamp, adjustment policy or corporate-action treatment is economically appropriate.")

#heading(level: 3)[#text("Decision | research/decision")]

#strong[#text("Research question.")] #text("Should a candidate advance to a sized paper-order proposal?")

#strong[#text("Method and estimand.")] #text("Promotion is a conjunction of veto conditions rather than a weighted score that lets strength on one dimension cancel a failed control. Sizing is constrained by the estimated drawdown and the documented fractional/capped Kelly rule. It is a proposal conditional on the selected experiment.")

#strong[#text("Controls and interpretation.")] #text("Inspect each veto, its threshold and reason. Adjust assumptions by returning to Setup; Promote becomes actionable only when the required gate clears. Follow sizing into Execution with the instrument and candidate context intact.")

#strong[#text("Assumptions and failure modes.")] #text("Passing a statistical gate is necessary for this workflow, not evidence of future profitability. Estimation error in win probability and payoff ratio can dominate the optimal-size calculation.")

#heading(level: 3)[#text("Runs | research/runs")]

#strong[#text("Research question.")] #text("What hypotheses did the researcher actually record?")

#strong[#text("Method and estimand.")] #text("The run archive records explicit browser experiments, deduplicates repeats and preserves the inputs and data identity needed to revisit results. Auto-refresh is intentionally different from recording a hypothesis. This distinction avoids interpreting slider movements as independent trials.")

#strong[#text("Controls and interpretation.")] #text("Inspect, restore, compare or export available runs; clearing removes this browser history rather than altering the underlying market or gateway audit ledger. Selecting a past run must restore its context or state clearly what cannot be reconstructed.")

#strong[#text("Assumptions and failure modes.")] #text("A browser log is not a tamper-evident preregistration system and can omit attempts made elsewhere. The true multiple-testing burden may exceed the visible archive.")

#heading(level: 3)[#text("Fitted models | research/fitted")]

#strong[#text("Research question.")] #text("How does supervised estimation perform under chronological validation?")

#strong[#text("Method and estimand.")] #text("Fitted-model jobs use gateway-side training and report fold-level out-of-sample predictions. Model fitting is distinct from choosing a deterministic technical rule: coefficients are estimated and the information boundary is the training split. The result contract should carry held-out metrics and job state.")

#strong[#text("Controls and interpretation.")] #text("Choose the supported training specification, submit Fit only when the gateway is available, and inspect job progress, fold evidence and recorded fitted runs. Revisit a completed run rather than mistaking a queued job for a result.")

#strong[#text("Assumptions and failure modes.")] #text("The offline screenshots do not demonstrate a live fit. A successful job proves execution, not freedom from leakage; preprocessing, labels and feature windows must obey the same time boundary as training.")

#heading(level: 3)[#text("Strategies | research/codex")]

#strong[#text("Research question.")] #text("Which signal hypothesis is appropriate to test, and what market condition defeats it?")

#strong[#text("Method and estimand.")] #text("The catalogue contains 46 source-defined strategies in seven families. Each entry specifies its actual signal rule, two parameter meanings, intended regime and failure regime. The detailed strategy catalogue in this chapter reproduces those definitions as design hypotheses.")

#strong[#text("Controls and interpretation.")] #text("Select a card or model option to load it into Summary. Search/browse families and compare related rules. Explored-state chips are derived from this browser history and must regress if that history is cleared.")

#strong[#text("Assumptions and failure modes.")] #text("A model being available or previously explored does not validate it. Closely related indicators often express the same economic hypothesis and should not be counted as independent evidence.")

#heading(level: 3)[#text("Trade | live/trade")]

#strong[#text("Research question.")] #text("Will a proposed paper order satisfy the pre-trade constraints at the quoted size?")

#strong[#text("Method and estimand.")] #text("The ticket passes an order intent through named risk gates, then accounts for a paper fill only on a supported executable path. Gate results depend on side, notional, book freshness, available depth, rate limits and current book state. The gateway defines 17 gates, of which 15 are reachable on the normal crypto path.")

#strong[#text("Controls and interpretation.")] #text("Choose instrument, Buy/Sell, Market/Limit, notional and limit price where applicable. Presets expose valid-size, oversized and burst cases. Submit sends a paper intent; it is not a live brokerage order. Read the individual rejection reason rather than inferring failure from colour.")

#strong[#text("Assumptions and failure modes.")] #text("Three deployed-UI paper submissions were accepted during the live recapture. A simulated fill cannot prove a venue would have accepted the order or that queue priority and partial fills were modelled.")

#heading(level: 3)[#text("Liquidity | live/liquidity")]

#strong[#text("Research question.")] #text("What executable depth is present on each side of the consolidated book?")

#strong[#text("Method and estimand.")] #text("For a chosen order side and quantity, cumulative level sizes determine whether enough displayed liquidity exists and which prices would be consumed. Consolidation preserves venue attribution; a crossed or stale book is a data-quality event, not automatically an executable opportunity.")

#strong[#text("Controls and interpretation.")] #text("Inspect bid/ask ladders, choose a symbol and select a price level to stage a limit order on Trade. Hover/focus depth marks for exact price and size. Refresh requests an observation; it does not manufacture depth.")

#strong[#text("Assumptions and failure modes.")] #text("L2 snapshots do not identify hidden liquidity, queue position or the fills available after network delay. A visually narrow spread can coexist with inadequate depth.")

#heading(level: 3)[#text("Routing & TCA | live/routing")]

#strong[#text("Research question.")] #text("What is the cost of executing the same intent across venues?")

#strong[#text("Method and estimand.")] #text("Routing compares depth-weighted executable prices and the configured fee/impact assumptions. A volume-weighted fill benchmark differs from the midprice: the comparison must use the same side, quantity and contemporaneous book across alternatives. The cost model is evaluated before risk-gated paper execution.")

#strong[#text("Controls and interpretation.")] #text("Change the proposal size and available routing choices, inspect venue allocations and the cost decomposition, and follow the resulting intent back to the ticket. The selected quote and quantity should remain coherent across the charts.")

#strong[#text("Assumptions and failure modes.")] #text("A lowest-cost snapshot is not a guaranteed future fill. The site does not become an Almgren-Chriss scheduling engine merely because it displays an execution-cost model; the original methods chapter distinguishes implemented impact arithmetic from an unbuilt scheduler.")

#heading(level: 3)[#text("Fill quality | live/quality")]

#strong[#text("Research question.")] #text("Did observed paper execution cost agree with the model?")

#strong[#text("Method and estimand.")] #text("Fill quality compares realised paper cost with the prediction attached to the order, preserving the same benchmark and sign convention. Differences can reflect depth changes, stale inputs or model misspecification. Aggregation should retain observation count and the time window.")

#strong[#text("Controls and interpretation.")] #text("Inspect available fill rows, venue or cost views and exact chart readings. Compare the realised-versus-predicted pair for the same order identifier instead of comparing unrelated aggregate means.")

#strong[#text("Assumptions and failure modes.")] #text("No fill means no residual to measure. A blank or unavailable panel is not evidence of zero slippage or a perfectly calibrated model.")

#heading(level: 3)[#text("Blotter | live/activity")]

#strong[#text("Research question.")] #text("Can orders, decisions and alerts be reconciled?")

#strong[#text("Method and estimand.")] #text("The blotter ties order states and gate decisions to the event tape. Status, timestamps and identifiers support reconciliation with the portfolio. Alerts report observed conditions; they are not a substitute for a state transition recorded by the gateway.")

#strong[#text("Controls and interpretation.")] #text("Filter or inspect visible rows, open decision details and use available order actions only within the paper gateway. Follow instrument and order links into the relevant analytic view.")

#strong[#text("Assumptions and failure modes.")] #text("An event arriving later than its related snapshot can create a temporary display mismatch. Reconciliation requires identifiers and time ordering, not just row counts.")

#heading(level: 3)[#text("Overview | portfolio/overview")]

#strong[#text("Research question.")] #text("Is the book within its exposure and risk budget?")

#strong[#text("Method and estimand.")] #text("Positions, equity, gross/net exposure and limit headroom are computed from one book snapshot. The overview combines the state of the book with the availability of a covariance model, preserving unknown estimates when the aligned history is insufficient.")

#strong[#text("Controls and interpretation.")] #text("Choose Live or explicit Sandbox, switch Standing/Book and follow alerts into allocation or risk detail. Refresh is meaningful only for a reachable data source.")

#strong[#text("Assumptions and failure modes.")] #text("Sandbox values are generated. Mixing them with a live research return must not be presented as a measured portfolio track record.")

#heading(level: 3)[#text("Equity & P&L | portfolio/equity")]

#strong[#text("Research question.")] #text("Where did the session change in wealth come from?")

#strong[#text("Method and estimand.")] #text("Equity is evaluated against the start-of-day mark and drawdown boundary. A P&L waterfall decomposes the session rather than independently estimating terminal wealth. Signed changes must reconcile to the same total before percentages are interpreted.")

#strong[#text("Controls and interpretation.")] #text("Inspect points on the equity curve and components of the P&L attribution. Use the time/series controls exposed by the current view; preserve source and observation timestamps when exporting a reading.")

#strong[#text("Assumptions and failure modes.")] #text("A short session curve is not a strategy backtest. Deposits, mark changes and generated sandbox transitions must not be mistaken for trading return.")

#heading(level: 3)[#text("Positions | portfolio/positions")]

#strong[#text("Research question.")] #text("Which holdings create exposure and exit difficulty?")

#strong[#text("Method and estimand.")] #text("Holdings expresses quantities and signed notionals; Shape presents concentration and covariance-sensitive structure; Exit relates the same book to an execution proposal. Portfolio risk weights use signed notional divided by equity, preserving leverage rather than normalising it away.")

#strong[#text("Controls and interpretation.")] #text("Switch Holdings/Shape/Exit, inspect individual symbols, and follow Research or Execution links with symbol context. A proposed exit is staged and still requires the execution and risk boundaries.")

#strong[#text("Assumptions and failure modes.")] #text("A large notional share need not be the largest risk contribution; hedges may contribute negatively to marginal volatility. Exit estimates require current depth and do not establish a fill.")

#heading(level: 3)[#text("Allocation | portfolio/allocation")]

#strong[#text("Research question.")] #text("How far is the current composition from a chosen target?")

#strong[#text("Method and estimand.")] #text("Mix describes the observed allocation, Targets describes the chosen objective, and Composition explains the breakdown. Rebalance differences are signed target-minus-current notionals. Their interpretation depends on the capital base, permitted instruments and the currently estimated risk model.")

#strong[#text("Controls and interpretation.")] #text("Change target controls and inspect implied changes before following a rebalance handoff. Switching views does not execute the allocation.")

#strong[#text("Assumptions and failure modes.")] #text("Target weights are decisions, not forecasts. A visually balanced capital allocation can be concentrated in risk when volatilities or correlations differ.")

#heading(level: 3)[#text("Performance | portfolio/performance")]

#strong[#text("Research question.")] #text("Which sleeve and cost component account for the observed performance?")

#strong[#text("Method and estimand.")] #text("Attribution separates sleeve contributions and execution costs, with session history distinguished from static cross-sections. Return, currency P&L and basis-point cost have different denominators and should not be combined without an explicit conversion.")

#strong[#text("Controls and interpretation.")] #text("Select the available attribution and trend views, inspect a component and compare its contribution with the displayed total. Reconcile the period and book source before comparing screens.")

#strong[#text("Assumptions and failure modes.")] #text("Historical contribution does not estimate the marginal return of adding capital. Costs from paper fills remain model-dependent.")

#heading(level: 3)[#text("Limits | risk/limits")]

#strong[#text("Research question.")] #text("Which constraint binds, and how much headroom remains?")

#strong[#text("Method and estimand.")] #text("For a positive limit L and utilisation U, headroom is L-U and utilisation ratio is U/L. The control surface compares multiple constraints but reports their meanings separately: notional, exposure, loss, drawdown and event-rate limits are not interchangeable risk units.")

#strong[#text("Controls and interpretation.")] #text("Inspect the binding constraint and concentration detail. Expand definitions to check units and scope; use the operator controls only through their guarded handoff.")

#strong[#text("Assumptions and failure modes.")] #text("An inactive limit does not imply a safe book if its input is unknown. A threshold is a policy setting, not a statistical confidence interval.")

#heading(level: 3)[#text("Risk engine | risk/model")]

#strong[#text("Research question.")] #text("What loss distribution is implied by the current exposure and estimated covariance?")

#strong[#text("Method and estimand.")] #text("Portfolio volatility is sqrt(w transpose Sigma w), with weights relative to equity. The implementation uses one-sided normal multipliers for parametric VaR and normal expected shortfall, and separately replays historical observations where available. Model validation is reported beside the estimate.")

#strong[#text("Controls and interpretation.")] #text("Inspect parametric and historical readings, confidence labels and observation counts. Switch book source explicitly and investigate disagreement in Risk drivers and Risk diagram.")

#strong[#text("Assumptions and failure modes.")] #text("Normal VaR omits fat tails and changing dependence. Historical VaR cannot represent unobserved regimes. Neither is a maximum possible loss.")

#heading(level: 3)[#text("Risk diagram | risk/diagram")]

#strong[#text("Research question.")] #text("Did realised losses exceed the forecast at the expected frequency?")

#strong[#text("Method and estimand.")] #text("The forecast-versus-realised series aligns each risk forecast to the outcome it predicts and identifies exceedances. A coverage statistic evaluates the count under a binomial reference model; independence and clustering are additional questions. The screen withholds results below its minimum aligned-history floor.")

#strong[#text("Controls and interpretation.")] #text("Inspect forecast and realised points, exceedance marks and the validation window. A point-selection readout should use the same date on every linked representation.")

#strong[#text("Assumptions and failure modes.")] #text("An acceptable exception count can hide clustered failures. The absence of enough observations is a refusal to estimate, not successful backtesting.")

#heading(level: 3)[#text("Risk drivers | risk/drivers")]

#strong[#text("Research question.")] #text("Which positions account for total volatility and diversification?")

#strong[#text("Method and estimand.")] #text("Euler component risk is w_i (Sigma w)_i / sigma_p, which sums to portfolio volatility under the homogeneous model. The correlation matrix complements this decomposition by showing pairwise dependence. Negative component risk is possible for a hedge.")

#strong[#text("Controls and interpretation.")] #text("Inspect a contribution bar, position row or correlation cell for exact values and the aligned sample. Compare notional share with risk share to identify concentrations hidden by capital weights.")

#strong[#text("Assumptions and failure modes.")] #text("Estimated correlations are noisy and regime-sensitive. Euler contributions are local to the current covariance and portfolio; they do not predict the effect of a large nonlinear trade.")

#heading(level: 3)[#text("Monte Carlo | risk/montecarlo")]

#strong[#text("Research question.")] #text("What terminal outcomes follow from resampling the selected return process?")

#strong[#text("Method and estimand.")] #text("The browser worker builds terminal wealth paths using the documented bootstrap and forward horizon. Quantile loss and expected shortfall are computed from the simulated distribution. A fixed seed supports reproducibility; more paths reduce simulation noise but do not fix a misspecified return sample.")

#strong[#text("Controls and interpretation.")] #text("Change horizon, path count and seed, inspect histogram/tail marks and compare with the research winner that supplied returns. The shared horizon also updates Oracle VaR; no Oracle execution is needed for the local bootstrap.")

#strong[#text("Assumptions and failure modes.")] #text("Terminal loss is not pathwise maximum drawdown. Reusing the winner after selection carries selection bias into the simulation. Degenerate or insufficient return histories must remain explicitly labelled.")

#heading(level: 3)[#text("Oracle VaR | risk/oraclevar")]

#strong[#text("Research question.")] #text("Does an in-database GBM simulation agree with its own analytic terminal quantile?")

#strong[#text("Method and estimand.")] #text("The procedure models terminal equity as E0 exp((mu-sigma squared/2)T + sigma sqrt(T)Z), with T=days/365. Its 99% loss is compared with the matching lognormal 1st-percentile formula, not a zero-drift normal approximation. Path count controls Monte Carlo error.")

#strong[#text("Controls and interpretation.")] #text("Set the shared horizon and inspect requested parameters, simulation output, closed-form comparator and freshness/cadence evidence. The live recapture confirms database responses. Small exposure can yield zero floored GBM loss; supplemental Sandbox inputs provide a separate higher-exposure example.")

#strong[#text("Assumptions and failure modes.")] #text("GBM assumes constant drift/volatility and lognormal terminal values. Agreement with the formula validates implementation under those assumptions, not suitability for jump risk or empirical tails.")

#heading(level: 3)[#text("Stress tests | risk/scenarios")]

#strong[#text("Research question.")] #text("How much damage would an explicitly chosen forward shock cause?")

#strong[#text("Method and estimand.")] #text("A scenario reprices the current linear book under symbol or factor shocks and aggregates signed P&L. Hand shocks and named presets are conditional experiments rather than probabilities. The current holdings and shock magnitudes define the result.")

#strong[#text("Controls and interpretation.")] #text("Choose the named scenario or Hand shocks, move the shock controls and read the propagated damage. No shock should produce the neutral reference, subject to displayed rounding.")

#strong[#text("Assumptions and failure modes.")] #text("The result omits any convexity or liquidity effect not present in the implemented repricer. A severe scenario is not automatically a calibrated tail quantile.")

#heading(level: 3)[#text("Controls | risk/controls")]

#strong[#text("Research question.")] #text("What actions can change the desk risk state?")

#strong[#text("Method and estimand.")] #text("Halt, reduce-only and flatten are operational state transitions, not estimators. A halt prevents the allowed new-risk path; flatten proposes liquidation of positions and therefore needs executable quotes, authority and accounting. The UI separates a handoff from completed execution.")

#strong[#text("Controls and interpretation.")] #text("Open emergency actions, read the confirmation and scope, then issue an action only when the guarded backend is available. Merely opening the header Kill panel does not halt the desk.")

#strong[#text("Assumptions and failure modes.")] #text("The capture did not execute destructive risk mutations. The source and offline gate tests establish the control contract; they do not establish current remote availability.")

#heading(level: 3)[#text("Trust Summary | data/overview")]

#strong[#text("Research question.")] #text("What is the reliability of the evidence used by the quantitative workflow?")

#strong[#text("Method and estimand.")] #text("Trust Summary combines freshness, validation, lineage and supply depth. Verdict, Response and Composition are views over the same measurement scope. Per-instance counters must remain distinct from a gateway-merged fleet ledger.")

#strong[#text("Controls and interpretation.")] #text("Switch the three panes, inspect freshness/contract marks and use the section handoffs for the observation requiring attention. Refresh evidence updates the sample rather than resetting its meaning.")

#strong[#text("Assumptions and failure modes.")] #text("A provider configured with credentials is not necessarily a fresh successful observation. Availability of the supply chain does not validate the statistical model consuming it.")

#heading(level: 3)[#text("Feeds & Contracts | data/feeds")]

#strong[#text("Research question.")] #text("Which feeds satisfy freshness and schema requirements?")

#strong[#text("Method and estimand.")] #text("Freshness compares observation age with the capability-specific budget, while contract validation checks shape and permitted values. The two are orthogonal: a fresh payload may be invalid and a valid payload may be stale.")

#strong[#text("Controls and interpretation.")] #text("Switch freshness and contract panes, inspect each source and use its next-action link. Read reconnect and throughput counters in their stated observation scope.")

#strong[#text("Assumptions and failure modes.")] #text("Polling snapshots can miss transient failures. A successful schema check does not detect every economic error, such as a wrong adjustment convention.")

#heading(level: 3)[#text("Quality | data/quality")]

#strong[#text("Research question.")] #text("Which observed payload discrepancies require investigation?")

#strong[#text("Method and estimand.")] #text("Reconciliation compares sources under an explicit tolerance and records findings in the data-quality ledger. Contract failures, mismatches and unresolved checks must remain distinguishable. Escalation is a workflow change tied to a finding, not a statistical correction.")

#strong[#text("Controls and interpretation.")] #text("Inspect reconciliation results and issue details; filter or expand ledger evidence and use escalation controls only with the required operator access.")

#strong[#text("Assumptions and failure modes.")] #text("Different venues may legitimately disagree because timestamps, instruments or conventions differ. A mismatch is evidence to investigate, not proof that one vendor is false.")

#heading(level: 3)[#text("Incidents | data/incidents")]

#strong[#text("Research question.")] #text("Which interruptions affected supply, and what responses were quarantined?")

#strong[#text("Method and estimand.")] #text("Incident state combines observed failure windows with explicitly simulated outages. Quarantine retains rejected evidence for diagnosis rather than allowing malformed values into downstream calculations. Recovery state names the condition that re-admits a source.")

#strong[#text("Controls and interpretation.")] #text("Inspect incident and quarantine rows, available payload explanations and recovery controls. Simulated outage actions are guarded and must remain labelled simulated.")

#strong[#text("Assumptions and failure modes.")] #text("An injected outage validates a response path but is not an observed production incident. A cleared incident is not proof that historical downstream results were repaired.")

#heading(level: 3)[#text("Lineage & Payloads | data/lineage")]

#strong[#text("Research question.")] #text("How did vendor bytes become the value on screen?")

#strong[#text("Method and estimand.")] #text("Provider selection, cache state, schema coercion and request timing form a transformation trace. Replay re-evaluates a capability through the validated route; backfill adds a specified historical range subject to contract checks. Each has a distinct scope and persistence effect.")

#strong[#text("Controls and interpretation.")] #text("Select capability and symbol, inspect REST or WebSocket evidence, expand payloads, and define replay/backfill ranges when permitted. Do not confuse viewing a trace with submitting a new job.")

#strong[#text("Assumptions and failure modes.")] #text("Replayed observations can differ from the original because vendor revisions, adjustments or cache epochs changed. Preserve both content identity and observation time.")

#heading(level: 3)[#text("Providers & Capacity | data/providers")]

#strong[#text("Research question.")] #text("How resilient is the configured supply chain to failure or quota exhaustion?")

#strong[#text("Method and estimand.")] #text("Provider routing maps capabilities to ranked alternatives. Quota headroom reflects the application ledger, while supply depth counts routable alternatives. Neither is a direct read of the vendor billing meter. Budget and Routing answer different questions.")

#strong[#text("Controls and interpretation.")] #text("Switch capability and Routing/Budget, inspect the failover order and headroom, and read the scope disclosure before interpreting counters. Provider controls affect only the documented local/server state.")

#strong[#text("Assumptions and failure modes.")] #text("Multiple providers can share an upstream dependency and therefore not be independent. Resetting an application quota ledger cannot reset a vendor invoice or entitlement.")

#heading(level: 3)[#text("Work Queue | data/queue")]

#strong[#text("Research question.")] #text("How is a data defect turned into a trackable remediation task?")

#strong[#text("Method and estimand.")] #text("Requests, tickets and bugs carry priority, status, ownership and versioned persistence. Updates use the row version to detect concurrent edits. The source badge distinguishes durable gateway state from edits held locally while transport is unavailable.")

#strong[#text("Controls and interpretation.")] #text("Open New work, enter the required fields, choose type/priority/area and submit; then filter, sort or change status. Delete follows the implemented confirmation and version/authentication rules.")

#strong[#text("Assumptions and failure modes.")] #text("A locally held edit is not durable backend confirmation. Work-item completion records a workflow decision, not independent proof that the affected dataset is now valid.")

#heading(level: 3)[#text("Attention & SLIs | reliability/overview")]

#strong[#text("Research question.")] #text("Where is the first observed break in the decision-support system?")

#strong[#text("Method and estimand.")] #text("Triage combines dependency state with service-level indicators. Decision latency, compiled-core duration and provider-network latency are separate populations in different units. Quantiles need sufficient samples and an explicit window.")

#strong[#text("Controls and interpretation.")] #text("Inspect the attention item, refresh evidence and follow incident or latency drilldowns. Expand sample and scope definitions before comparing a percentile with a budget.")

#strong[#text("Assumptions and failure modes.")] #text("A p99 of too few observations is not a stable tail estimate. Current health is not an uptime percentage, and unknown downstream health behind a failed transport is not a measured component outage.")

#heading(level: 3)[#text("Dependencies | reliability/planes")]

#strong[#text("Research question.")] #text("How far does a failure propagate through the dependency graph?")

#strong[#text("Method and estimand.")] #text("The tree and live DAG represent dependencies among browser, web, gateway, providers and storage. Composition counts states under the same observation boundary. Provider, Platform and Latency views separate dependency structure from timing evidence.")

#strong[#text("Controls and interpretation.")] #text("Select a plane/node and inspect the dependent services or source facts. Preserve unknown states when the transport is down instead of converting all downstream nodes to failed.")

#strong[#text("Assumptions and failure modes.")] #text("The dependency graph encodes the implemented topology, not a statistical estimate of correlated failure probabilities.")

#heading(level: 3)[#text("Services & Circuits | reliability/services")]

#strong[#text("Research question.")] #text("Which circuits and venue paths are currently usable?")

#strong[#text("Method and estimand.")] #text("Provider circuit breakers move among closed, open and half-open according to failure and recovery rules. Venue health and failover are observed separately. A half-open probe is controlled evidence for recovery, not a restored-service guarantee.")

#strong[#text("Controls and interpretation.")] #text("Inspect service rows, circuit timelines and venue evidence. Test, simulate and reset controls have different scopes and require their stated guard; simulation should expire rather than masquerade as permanent health.")

#strong[#text("Assumptions and failure modes.")] #text("Closing a circuit does not fix the upstream cause. A test request can itself consume quota, so it is distinct from a display-only inspection.")

#heading(level: 3)[#text("Logs & Traces | reliability/events")]

#strong[#text("Research question.")] #text("What sequence of observations explains an incident?")

#strong[#text("Method and estimand.")] #text("Logs and traces are ordered evidence about requests, providers and state transitions. Severity filters alter the view, not the underlying event set. Cross-origin timing requires attention to clock and transport boundaries.")

#strong[#text("Controls and interpretation.")] #text("Filter by severity or request context, select a trace and inspect timeline stages or payload details. Copy identifiers for a reproducible investigation.")

#strong[#text("Assumptions and failure modes.")] #text("Log absence can mean a sampling or observability gap. It cannot establish that no request or error occurred.")

#heading(level: 3)[#text("Remediation | reliability/controls")]

#strong[#text("Research question.")] #text("What precisely will an operator action affect?")

#strong[#text("Method and estimand.")] #text("Remediation separates server mutations from browser-session controls and reference scope diagrams. The mutation/store map identifies what is cleared, re-read, unchanged or outside reach. Recovery and History expose the breaker lifecycle rather than modifying it.")

#strong[#text("Controls and interpretation.")] #text("Switch Mutations, Scope, Session, Recovery and History. Read the token/confirmation boundary before purge, restore, reload, quota reset or telemetry clear. Local polling/socket controls affect only this browser session.")

#strong[#text("Assumptions and failure modes.")] #text("An application quota reset does not reduce vendor billing. Clearing telemetry removes evidence and changes the measurement window; it does not make the service faster.")

#heading(level: 3)[#text("Topology | developer/overview")]

#strong[#text("Research question.")] #text("What are the runtime and ownership boundaries of the system?")

#strong[#text("Method and estimand.")] #text("Topology links the client, serverless web tier, gateway and data stores, exposing where a request is evaluated and where authoritative state resides. This is essential to interpret a UI that mixes local simulations with remote observations.")

#strong[#text("Controls and interpretation.")] #text("Inspect runtime nodes and context disclosures, then follow readiness, API or code links. Treat the deployed revision and local source revision as separate evidence identities.")

#strong[#text("Assumptions and failure modes.")] #text("A source diagram is not proof that the current deployment matches it. The capture records the revision mismatch explicitly.")

#heading(level: 3)[#text("Readiness | developer/readiness")]

#strong[#text("Research question.")] #text("What evidence is required before a release can be considered ready?")

#strong[#text("Method and estimand.")] #text("Launch gates combine configuration, schema, contract and artifact checks. Readiness is a conjunction of prerequisites, while test success concerns a particular build and environment. Unknown checks must remain unknown.")

#strong[#text("Controls and interpretation.")] #text("Inspect each gate, artifact and explanation; follow the relevant remediation link. A disabled or missing capability requires its own evidence rather than a generic all-green badge.")

#strong[#text("Assumptions and failure modes.")] #text("A locally passing test suite cannot demonstrate production credentials, database schema or remote availability.")

#heading(level: 3)[#text("CI / CD | developer/quality")]

#strong[#text("Research question.")] #text("Which reproducible checks defend the implementation?")

#strong[#text("Method and estimand.")] #text("CI/CD presents offline suites, build checks and delivery artifacts. Counts are generated measurements with dates. The whitepaper adds a new verification record rather than silently treating historical numbers as current.")

#strong[#text("Controls and interpretation.")] #text("Switch pipeline and verification views; inspect the named test boundary and artifact. The Oracle-connected GitHub workflows are disabled for cost control and must not be shown as newly executed.")

#strong[#text("Assumptions and failure modes.")] #text("Passing tests demonstrate only the assertions and inputs actually exercised. Structural source tests, numerical parity tests and browser interaction tests are different kinds of evidence.")

#heading(level: 3)[#text("API & Schema | developer/apis")]

#strong[#text("Research question.")] #text("Does the running interface match its contracts and numerical reference?")

#strong[#text("Method and estimand.")] #text("Contracts tracks the schema-to-export-to-digest custody chain. Routes enumerates operations and request shapes. Numerics recomputes a deterministic Monte Carlo reference and compares canonical data rather than visual similarity. Canonical JSON hashes differ from hashes of formatted source files.")

#strong[#text("Controls and interpretation.")] #text("Switch Contracts/Routes/Numerics, select a route, inspect or copy its curl example, and invoke the supported local verifier. Read not-run and unavailable states as such.")

#strong[#text("Assumptions and failure modes.")] #text("A matching digest proves content agreement under the canonicaliser, not semantic correctness of every endpoint. A server response is needed to verify the deployed contract.")

#heading(level: 3)[#text("Code & Diffs | developer/codebase")]

#strong[#text("Research question.")] #text("Can a displayed implementation claim be traced to a versioned file?")

#strong[#text("Method and estimand.")] #text("The repository manifest indexes paths and change custody. Search and diffs expose provenance of the application rather than executing code. A file list and commit identifier make a result reviewable only if they refer to the same source snapshot.")

#strong[#text("Controls and interpretation.")] #text("Search paths, select files and inspect diff/custody views. Follow source references from the feature register to the exact component or numerical module.")

#strong[#text("Assumptions and failure modes.")] #text("The screenshot deployment and local source differ. The document therefore reports each independently and does not assert that an unpushed local file is deployed.")

#heading(level: 3)[#text("Task Queue | developer/work")]

#strong[#text("Research question.")] #text("How does an engineering change progress through local review?")

#strong[#text("Method and estimand.")] #text("The engineering queue is browser-persisted state with type, priority, owner, area and workflow status. It is distinct from the gateway-persisted Data queue. A fresh browser intentionally starts empty, which the repaired browser test now respects.")

#strong[#text("Controls and interpretation.")] #text("New work opens a form; Add to triage creates the item. Search/type/status filters restrict rows; the row select advances status. Delete is a two-step action. Local reload should preserve accepted items when browser storage is available.")

#strong[#text("Assumptions and failure modes.")] #text("Closed in this browser is not a GitHub issue closure or deployed change. This queue has no authority to publish code or prove acceptance criteria were met.")

#heading(level: 3)[#text("Universe | markets/universe")]

#strong[#text("Research question.")] #text("Do a family of quoted outcomes span one economically complete payoff?")

#strong[#text("Method and estimand.")] #text("Basket pricing sums executable sides across a mutually exclusive/exhaustive family against its known terminal dollar. Positions relates exposure to that family; Families groups markets using venue metadata rather than ticker-prefix guesses.")

#strong[#text("Controls and interpretation.")] #text("Select family, basket direction and subview, then inspect exact market prices and missing-side states. Related lattice and proof views use the selected family context.")

#strong[#text("Assumptions and failure modes.")] #text("Completeness is a structural premise. Missing outcomes, missing asks/bids, insufficient depth and stale snapshots prevent the quoted sum from being treated as an executable locked-in return.")

#heading(level: 3)[#text("Settlement | markets/settlement")]

#strong[#text("Research question.")] #text("What observation does the contract actually settle against?")

#strong[#text("Method and estimand.")] #text("The settlement index, its formation chain and provisional pending readings are distinct objects. A contract based on a windowed mean cannot be valued as if it settled on the latest point. Station disagreement is an uncertainty cue in the provisional reading.")

#strong[#text("Controls and interpretation.")] #text("Switch Index/Formation/Pending, inspect the time window or selected station/readout, and compare the published value with the provisional construction.")

#strong[#text("Assumptions and failure modes.")] #text("The screen is an explanation of the venue rule and observed index, not an independent adjudication of settlement. A provisional estimate is not the final contractual outcome.")

#heading(level: 3)[#text("Books | markets/books")]

#strong[#text("Research question.")] #text("How are complementary contract ladders related?")

#strong[#text("Method and estimand.")] #text("Binary complementarity gives implied asks from the opposing bid: ask_yes=1-bid_no and ask_no=1-bid_yes. Hence the two implied asks sum to one plus the YES spread. History selects recorded snapshots without inventing observations between them.")

#strong[#text("Controls and interpretation.")] #text("Switch Ladder/Identity/History. Inspect a level, choose a market and scrub the exact recorded observation where available. Selected marks and numerical readouts should agree.")

#strong[#text("Assumptions and failure modes.")] #text("An implied offer is an arithmetic relation, not evidence of queue priority or future execution. Historical gaps must remain gaps.")

#heading(level: 3)[#text("Makers | markets/dispersion")]

#strong[#text("Research question.")] #text("Does maker disagreement differ from each maker's own spread?")

#strong[#text("Method and estimand.")] #text("Dispersion compares quoted maker centres and widths; REST poll exposes the authenticated request outcome. Cross-maker disagreement and within-maker bid/ask width measure different uncertainty and liquidity dimensions.")

#strong[#text("Controls and interpretation.")] #text("Switch Dispersion/REST poll and inspect available maker or request facts. A private-channel refusal should remain a policy state, distinct from an empty successful response or transport failure.")

#strong[#text("Assumptions and failure modes.")] #text("Maker quotes may not be simultaneous or comparable in size. A narrow dispersion does not demonstrate price discovery or trading profitability.")

#heading(level: 3)[#text("Lattice | markets/lattice")]

#strong[#text("Research question.")] #text("What probability measure is compatible with a structured strike ladder?")

#strong[#text("Method and estimand.")] #text("For ordered threshold contracts, survival differences imply adjacent probability mass. A valid distribution requires monotonic survival and nonnegative mass. Numerical moments need a meaningful numeric support; named outcomes provide categorical probabilities, while unrelated binaries do not define a joint distribution.")

#strong[#text("Controls and interpretation.")] #text("Switch Survival/Mass/Moment shape/Moment support, select a strike or mass component and inspect exact support and withheld-output reasons.")

#strong[#text("Assumptions and failure modes.")] #text("Tail support assumptions materially affect moments. The interface must not manufacture a numeric mean for categorical labels or normalise unrelated binaries into a false partition.")

#heading(level: 3)[#text("Stake | markets/stake")]

#strong[#text("Research question.")] #text("What allocation maximises a stated log-growth objective without hiding worst-case wealth?")

#strong[#text("Method and estimand.")] #text("The frontier replays terminal wealth per outcome: cash equals one minus invested fractions and winning wealth adds fraction/price. Expected log wealth weights the state wealths by assumed probabilities. The worst state and reserved cash are displayed beside growth.")

#strong[#text("Controls and interpretation.")] #text("Switch Plan/Capital/Method/All outcomes and adjust the available bankroll/scale controls. Inspect declined outcomes and the binding capital or feasibility condition.")

#strong[#text("Assumptions and failure modes.")] #text("This is a sizing calculation with no executor. Estimated probabilities and dependence are model inputs; a log-optimal allocation may still suffer a large realised loss.")

#heading(level: 3)[#text("Fees | markets/fees")]

#strong[#text("Research question.")] #text("How much of an apparent edge survives the implemented fee convention?")

#strong[#text("Method and estimand.")] #text("The worked example separates fee components and their rounding; cost shape changes with price and size. Ablation replays the same recorded observations under alternative cost assumptions, while Replay table preserves the individual rows.")

#strong[#text("Controls and interpretation.")] #text("Change the example inputs, select receipt components and cost-model configurations, and inspect the per-observation replay. Compare configurations on the same tape and observation set.")

#strong[#text("Assumptions and failure modes.")] #text("A replay shows what a model would have detected, not realised P&L. Venue fees can change; the source implementation and capture date define this edition, not an assertion of permanent exchange pricing.")

#heading(level: 3)[#text("Shell | markets/shell")]

#strong[#text("Research question.")] #text("Where does a selected market and its derived evidence live in the namespace?")

#strong[#text("Method and estimand.")] #text("The filesystem lens maps exchange families and markets into a bounded hierarchy, separates shard routing from directory listing and preserves the distinction between missing, empty, unavailable and unreachable.")

#strong[#text("Controls and interpretation.")] #text("Switch Namespace/Routing/Browse, select a directory or file and inspect the corresponding listing or tape. Path selection changes the evidence being read; it does not write to the exchange.")

#strong[#text("Assumptions and failure modes.")] #text("A namespace is a representation of the data model. File-like appearance does not imply a complete local archive or unrestricted access to every venue resource.")

#heading(level: 3)[#text("Coherence test | coherence/certificate")]

#strong[#text("Research question.")] #text("Do the quoted claims admit a common probability assignment?")

#strong[#text("Method and estimand.")] #text("The conceptual feasibility condition is q>=0, sum(q)=1 with quoted bounds on state payoffs. The implemented certificate states its actual price basis, interval/family structure and tested rows. Per-book and structural slack views have different denominators and must not be conflated.")

#strong[#text("Controls and interpretation.")] #text("Switch Verdict/Proof/Checks/Prices/Sizes, select a constraint or checkpoint and inspect exact slack and the supporting prices/quantities.")

#strong[#text("Assumptions and failure modes.")] #text("Feasibility means no contradiction was found under the stated constraints. It does not imply that the probabilities are true or that a missing price was measured as zero.")

#heading(level: 3)[#text("Basket | coherence/portfolio")]

#strong[#text("Research question.")] #text("What constructive portfolio explains an infeasible set of claims?")

#strong[#text("Method and estimand.")] #text("The dual certificate describes a basket whose statewise payoff demonstrates the contradiction under the model. Cover, Basket and Size make payoff coverage, legs, executable depth and fees separately inspectable.")

#strong[#text("Controls and interpretation.")] #text("Switch the three views; select a state, leg or quantity and reconcile its payoff with the certificate total. Inspect the coherent zero-leg case as a valid result.")

#strong[#text("Assumptions and failure modes.")] #text("A mathematical certificate depends on simultaneous executable inputs and the fee model. The UI has no trade executor, and a displayed basket is not an instruction that has been sent.")

#heading(level: 3)[#text("Parlays | coherence/combos")]

#strong[#text("Research question.")] #text("Is a quoted conjunction compatible with its marginal probabilities?")

#strong[#text("Method and estimand.")] #text("For two events with marginals p and q, Frechet bounds are max(0,p+q-1)<=P(A and B)<=min(p,q). The interval encodes unidentified dependence; it is not centred on a privileged fair price. Bounds, leg prices and proposed quantities must be assessed together.")

#strong[#text("Controls and interpretation.")] #text("Switch Ranges/Test quote/Leg prices/Test legs/Checks, change the available local test inputs and inspect which bound determines the conclusion.")

#strong[#text("Assumptions and failure modes.")] #text("A quote inside the range is consistent with some dependence, not necessarily correctly priced. Multiplying marginals adds an independence assumption the venue has not quoted.")

#heading(level: 3)[#text("Coherence index | coherence/index")]

#strong[#text("Research question.")] #text("How far is the current quote vector from the model's coherent set?")

#strong[#text("Method and estimand.")] #text("The index records a distance from contemporaneous quotes to a feasible probability representation, by poll and by family. It concerns unsettled prices, unlike the settled-outcome Brier score.")

#strong[#text("Controls and interpretation.")] #text("Switch By poll/By family and select an observation or family. Read unmeasurable polls as gaps and preserve the observation time and quote basis.")

#strong[#text("Assumptions and failure modes.")] #text("Distance depends on the norm, constraints and quote coverage. It is not a realised arbitrage return, probability of profit or forecast accuracy score.")

#heading(level: 3)[#text("Scorecard | coherence/calibration")]

#strong[#text("Research question.")] #text("Were probabilities informative before their outcomes became known?")

#strong[#text("Method and estimand.")] #text("The Brier score averages squared probability error. The Murphy decomposition distinguishes reliability, resolution and outcome uncertainty. Calibration cells and bands show conditional observed frequencies, requiring sample sizes and the forecast-to-settlement horizon.")

#strong[#text("Controls and interpretation.")] #text("Switch Overview/Equation/Component scale/Measures/Reliability/Bands; select bins and inspect counts, probabilities and realised frequencies. Keep the engine and horizon caveat visible.")

#strong[#text("Assumptions and failure modes.")] #text("Prices observed at or near settlement can score almost perfectly without forecasting skill. Aggregation and coarse bins can mask subgroup miscalibration; uncertainty bands depend on the implemented estimator.")

#heading(level: 3)[#text("Corpus | coherence/corpus")]

#strong[#text("Research question.")] #text("Which settled observations make the reported score representative?")

#strong[#text("Method and estimand.")] #text("Composition measures which series contribute to the scoring population; Score trend records the statistic as the corpus accrues. A heavily concentrated series mixture can dominate an aggregate score even if the interface names the whole exchange.")

#strong[#text("Controls and interpretation.")] #text("Select a series or historical point, inspect counts and shares, and compare within-series results with the aggregate. Preserve unscorable observations as missing evidence.")

#strong[#text("Assumptions and failure modes.")] #text("A forward-recorded trend cannot be backdated to imply an archive that was never observed. Corpus selection and settlement availability create survivorship and coverage limitations.")

#heading(level: 3)[#text("Lessons | coherence/lessons")]

#strong[#text("Research question.")] #text("What claim does each visual proof establish, and what guards it in code?")

#strong[#text("Method and estimand.")] #text("The curriculum groups quotes, structure, bounds, record, coverage and episode states. Each lesson links a mathematical or data-contract claim to implementation and test provenance. Interactive marks are alternative views of the same exact values.")

#strong[#text("Controls and interpretation.")] #text("Select a lesson, inspect its diagram with pointer or keyboard, pin a reading and open explanatory/code/test disclosures. Focus enlarges the same figure; zoom and drag inspect it without changing the calculation.")

#strong[#text("Assumptions and failure modes.")] #text("An educational illustration is not an empirical finding. A cited test checks a specific invariant, not every data-dependent use of the theorem.")

#heading(level: 3)[#text("Announcement arm | diffusion/arm")]

#strong[#text("Research question.")] #text("How much of an event-related move was incorporated by each horizon?")

#strong[#text("Method and estimand.")] #text("Absorption compares the abnormal return at horizon h with its terminal move. Control compares the same construction with matched non-event windows; Clocks compares wall-clock ordering with a clock built from control-market activity. Overshoot is retained in the observed curve.")

#strong[#text("Controls and interpretation.")] #text("Switch Absorption/Control/Clocks; select stage, path eligibility or line visibility and inspect exact horizons. Filters change the local lens without fabricating new observations or reranking the underlying study.")

#strong[#text("Assumptions and failure modes.")] #text("A small terminal move makes the normalised ratio unstable. A fast curve must be compared with its control before being interpreted as rapid information incorporation.")

#heading(level: 3)[#text("Meetings | diffusion/meetings")]

#strong[#text("Research question.")] #text("Which event and stage contributed each measured path?")

#strong[#text("Method and estimand.")] #text("The ledger and calendar expose meeting-level sample membership, signal qualification and missing outcomes. Mechanism makes the stage-window assumptions explicit. Statement and conference rows from one meeting are not independent events.")

#strong[#text("Controls and interpretation.")] #text("Switch Meeting by meeting/Calendar/Mechanism, choose a meeting or qualification filter and compare stages using their own timestamps and terminal windows.")

#strong[#text("Assumptions and failure modes.")] #text("A refused stage can reflect an insufficient move rather than missing raw data. Treating repeated stages or assets as independent replicates understates uncertainty.")

#heading(level: 3)[#text("Kalshi episodes | diffusion/episodes")]

#strong[#text("Research question.")] #text("How long did a detected pricing inconsistency persist?")

#strong[#text("Method and estimand.")] #text("Episodes have observed start and closing events. The displayed lifetime summary uses the implemented closure rule and preserves unresolved episodes. Lifetime and survival descriptions must state whether open episodes are excluded rather than silently treating them as zero or completed.")

#strong[#text("Controls and interpretation.")] #text("Switch Survival/Episodes, inspect an episode and move the lifetime probe. Read the population count and open/closed state beside the selected result.")

#strong[#text("Assumptions and failure modes.")] #text("A survival curve over closed episodes is subject to closure selection and is not automatically a censoring-corrected population survival estimator. Detection cadence bounds timestamp resolution.")

#heading(level: 3)[#text("Measurement | diffusion/model")]

#strong[#text("Research question.")] #text("What does the estimator compute, and when does it refuse?")

#strong[#text("Method and estimand.")] #text("Measurement specifies absorbed fractions, signal/noise qualification, the first level crossing and fitted decay models. The crossing interpolates in log horizon; fit selection is based on residual error in unpriced-fraction space. Overshoots are not clipped out of the observed curve.")

#strong[#text("Controls and interpretation.")] #text("Inspect each formula card, input definition and failure condition. Expand the reference implementation and compare its units with the selected study view.")

#strong[#text("Assumptions and failure modes.")] #text("A fitted half-life is model-dependent and may not exist. Never-reached, before-first-observation and too-few-points are different scientific outcomes.")

#heading(level: 3)[#text("Instrument | diffusion/instrument")]

#strong[#text("Research question.")] #text("How are the measurement and information-resolution instrument connected?")

#strong[#text("Method and estimand.")] #text("The instrument separates the price-absorption clock from the explanatory text representation and its Gaussian information spectrum. The implementation retains covariance/eigenvalue scale; whitening would remove the resolution structure the spectrum is meant to describe.")

#strong[#text("Controls and interpretation.")] #text("Inspect instrument cards and the code/test lineage. Use Sandbox to perturb the mathematical inputs while preserving the distinction between a controlled example and measured event data.")

#strong[#text("Assumptions and failure modes.")] #text("An elegant mechanism does not establish explanatory or predictive power. The Findings comparison against a baseline is the empirical test.")

#heading(level: 3)[#text("Sandbox | diffusion/sandbox")]

#strong[#text("Research question.")] #text("How do estimator outputs change under known controlled inputs?")

#strong[#text("Method and estimand.")] #text("Half-life constructs an absorption curve, Simulator varies signal/noise and shape, and Spectrum varies latent scales/relationships. These deterministic browser calculations are compared with the Python reference by parity fixtures.")

#strong[#text("Controls and interpretation.")] #text("Switch Half-life/Simulator/Spectrum and adjust bounded sliders. Inspect crossings, refusal states, signed lobes and exact-value readouts. Focus, zoom, pan and close should preserve the same chart instance and selection.")

#strong[#text("Assumptions and failure modes.")] #text("A synthetic example diagnoses arithmetic, geometry and sensitivity; it cannot validate that the assumed process generated the market. Finite grids limit crossing resolution.")

#heading(level: 3)[#text("Findings | diffusion/findings")]

#strong[#text("Research question.")] #text("Does the text representation improve held-out prediction beyond a non-text baseline?")

#strong[#text("Method and estimand.")] #text("The study uses a residence-time target, precision weighting and pooled stage effects with policy-move controls. Leave-one-meeting-out evaluation holds both stages out together. Baseline and augmented out-of-sample loss, along with shuffled evidence and the full specification grid, are the basis for a claim.")

#strong[#text("Controls and interpretation.")] #text("Switch Effect plot/Findings table/Instrument, select a stage and vary displayed absolute-t and shuffled-p thresholds. Expand the selected run and its admissibility criteria; local threshold changes do not rerun the experiment.")

#strong[#text("Assumptions and failure modes.")] #text("Post-hoc display thresholds are exploratory. The finite-window, clipped residence-time implementation is not identically the infinite-horizon exponential time constant; horizons, sample selection and preregistered specifications must accompany the reported null or positive result.")

#heading(level: 2)[#text("Complete strategy-model catalogue")]

#text("All 46 selectable strategies are documented below from the repository strategy documentation and parameter catalogue. The source descriptions state the intended mechanics and regime rationale; they are hypotheses, not measured profitability claims. The timing/cost/search protocol above applies to every model. Fast and slow are interface parameter slots whose units differ by strategy; a threshold, ATR multiple or number of lags must not be silently treated as a moving-average period.")

#text("The rule descriptions below reproduce the implementation-facing documentation. Exact edge cases, warm-up, equality handling, missing values and order timing are governed by the numerical implementation and tests. Related models are conceptual comparisons, not independent replications. No strategy was promoted or funded as part of this documentation work.")

#heading(level: 3)[#text("Moving-average crossover | ma_cross")]

#strong[#text("Family and purpose.")] #text("Trend. The oldest trend rule there is: hold while a short average sits above a long one.")

#strong[#text("Signal rule.")] #text("Long while SMA(fast) > SMA(slow). Both averages must have filled their lookback — before that the rule has no opinion, which is not the same as an exit.")

#strong[#text("Parameter semantics.")] #text("fast: Fast SMA period; slow: Slow SMA period.")

#strong[#text("Chart series.")] #text("fast: Fast SMA; slow: Slow SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Sustained directional moves lasting many multiples of the slow period. It gives up the first part of every move and keeps the middle.")

#strong[#text("Failure mechanism.")] #text("Ranges. Price oscillating around the slow average crosses it repeatedly, and each crossing is a round trip paying fee plus slippage. This is the classic way a strategy with a positive raw edge is destroyed by costs.")

#strong[#text("Related models.")] #text("EMA crossover, Triple moving average, EMA slope.")

#heading(level: 3)[#text("EMA crossover | ema_cross")]

#strong[#text("Family and purpose.")] #text("Trend. The same crossover with exponential averages, which react faster to a turn and are noisier for it.")

#strong[#text("Signal rule.")] #text("Long while EMA(fast) > EMA(slow). Unlike the SMA version there is no warm-up gap — an EMA has a value from the first bar, weighted toward recent prices.")

#strong[#text("Parameter semantics.")] #text("fast: Fast EMA span; slow: Slow EMA span.")

#strong[#text("Chart series.")] #text("fast: Fast EMA; slow: Slow EMA.")

#strong[#text("Intended regime hypothesis.")] #text("Trends that begin sharply. The exponential weighting reaches a new level in roughly a third of the bars a simple average needs.")

#strong[#text("Failure mechanism.")] #text("Choppy markets, worse than the SMA version: reacting faster to a turn also means reacting faster to noise, so it trades more and pays more.")

#strong[#text("Related models.")] #text("Moving-average crossover, MACD signal crossover, Percentage price oscillator.")

#heading(level: 3)[#text("MACD signal crossover | macd_cross")]

#strong[#text("Family and purpose.")] #text("Trend. The difference between two EMAs, traded against its own smoothed version.")

#strong[#text("Signal rule.")] #text("MACD = EMA(fast) − EMA(slow); long while MACD > EMA(MACD, 9). The signal span is fixed at the conventional 9 — a third swept axis for a number nobody tunes would multiply every grid by nine.")

#strong[#text("Parameter semantics.")] #text("fast: Fast EMA span; slow: Slow EMA span.")

#strong[#text("Chart series.")] #text("fast: None; slow: Slow EMA.")

#strong[#text("Intended regime hypothesis.")] #text("Trends with visible acceleration. Because the comparison is against MACD's own average, it can turn long while price is still below its slow EMA.")

#strong[#text("Failure mechanism.")] #text("Low-volatility drift. MACD hugs zero, and its crossings with a 9-span smoothing of itself become almost arbitrary.")

#strong[#text("Related models.")] #text("Percentage price oscillator, TRIX signal crossover, EMA crossover.")

#heading(level: 3)[#text("Triple moving average | triple_ma")]

#strong[#text("Family and purpose.")] #text("Trend. Two averages crossing, gated on the slow one already turning.")

#strong[#text("Signal rule.")] #text("Long while SMA(fast) > SMA(slow) AND SMA(slow) is above its own value one bar earlier. The second condition removes crossovers that happen while the trend is still falling.")

#strong[#text("Parameter semantics.")] #text("fast: Fast SMA period; slow: Slow SMA period.")

#strong[#text("Chart series.")] #text("fast: Fast SMA; slow: Slow SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Established trends. It trades noticeably less than the plain crossover and each trade is better qualified.")

#strong[#text("Failure mechanism.")] #text("Trend beginnings. Waiting for the slow average to turn is waiting for confirmation, and confirmation is late by construction.")

#strong[#text("Related models.")] #text("Moving-average crossover, EMA slope, Supertrend.")

#heading(level: 3)[#text("Percentage price oscillator | ppo_cross")]

#strong[#text("Family and purpose.")] #text("Trend. MACD expressed as a percentage, so the signal means the same thing across price levels.")

#strong[#text("Signal rule.")] #text("PPO = 100 × (EMA(fast) − EMA(slow)) / EMA(slow); long while PPO > EMA(PPO, 9). Dividing by the slow EMA is the whole difference: a raw MACD of 2.0 means something else at $20 than at $200.")

#strong[#text("Parameter semantics.")] #text("fast: Fast EMA span; slow: Slow EMA span.")

#strong[#text("Chart series.")] #text("fast: None; slow: Slow EMA.")

#strong[#text("Intended regime hypothesis.")] #text("Comparing or backtesting across instruments and across long windows where price level changed by an order of magnitude.")

#strong[#text("Failure mechanism.")] #text("The same conditions as MACD — low-volatility drift, where the oscillator hovers near zero and crossings are arbitrary.")

#strong[#text("Related models.")] #text("MACD signal crossover, TRIX signal crossover, EMA crossover.")

#heading(level: 3)[#text("TRIX signal crossover | trix_cross")]

#strong[#text("Family and purpose.")] #text("Trend. Triple-smoothed rate of change, built to strip out the cycles a trader does not want to trade.")

#strong[#text("Signal rule.")] #text("TRIX = per-bar rate of change of EMA(EMA(EMA(close, fast))); long while TRIX > SMA(TRIX, slow). Three passes of exponential smoothing suppress cycles shorter than the span almost entirely.")

#strong[#text("Parameter semantics.")] #text("fast: TRIX EMA span; slow: Signal SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: TRIX signal.")

#strong[#text("Intended regime hypothesis.")] #text("Noisy instruments with a real underlying trend. Very few whipsaws survive the third smoothing pass.")

#strong[#text("Failure mechanism.")] #text("Any move shorter than roughly three times the span. The same smoothing that removes noise removes the signal, and the lag is the cost.")

#strong[#text("Related models.")] #text("MACD signal crossover, Percentage price oscillator, Momentum (skip-recent).")

#heading(level: 3)[#text("EMA slope | ema_slope")]

#strong[#text("Family and purpose.")] #text("Trend. Trade the direction of an average rather than its level.")

#strong[#text("Signal rule.")] #text("Long when EMA(fast) is above its own value `slow` bars ago. No crossing is involved: a single average, compared with its own past.")

#strong[#text("Parameter semantics.")] #text("fast: EMA span; slow: Slope lookback (bars).")

#strong[#text("Chart series.")] #text("fast: None; slow: EMA.")

#strong[#text("Intended regime hypothesis.")] #text("Smooth trends. It has one fewer parameter interaction than a crossover and is correspondingly harder to overfit.")

#strong[#text("Failure mechanism.")] #text("Near turning points, where the slope oscillates around zero and every bar flips the position.")

#strong[#text("Related models.")] #text("Moving-average crossover, Triple moving average, Momentum (skip-recent).")

#heading(level: 3)[#text("Supertrend | supertrend")]

#strong[#text("Family and purpose.")] #text("Trend. A trailing band that flips side when price crosses it, and stays put otherwise.")

#strong[#text("Signal rule.")] #text("The band sits `slow` × ATR(fast) from the midpoint and ratchets in the direction of the trend only — it never loosens. Position flips when close crosses it, so the model is always long or always flat with no ambiguous state.")

#strong[#text("Parameter semantics.")] #text("fast: ATR period; slow: Band distance (ATRs).")

#strong[#text("Chart series.")] #text("fast: Upper band; slow: Lower band.")

#strong[#text("Intended regime hypothesis.")] #text("Persistent trends. The ratchet means the exit level follows the move up and never gives ground back.")

#strong[#text("Failure mechanism.")] #text("Sideways markets, where the ratchet works against it: the band is dragged in behind price and then crossed by ordinary noise.")

#strong[#text("Related models.")] #text("Vortex indicator crossover, ATR trailing stop (chandelier), Keltner channel breakout, Triple moving average.")

#heading(level: 3)[#text("ATR trailing stop (chandelier) | atr_trailing_stop")]

#strong[#text("Family and purpose.")] #text("Trend. The chandelier exit — a stop hung from the highest high, measured in ATRs.")

#strong[#text("Signal rule.")] #text("Long while close stays above (highest high over `fast` bars) − slow × ATR(fast). Entry is the trend filter; the stop is what defines the strategy.")

#strong[#text("Parameter semantics.")] #text("fast: ATR & trend period; slow: Stop distance (ATRs).")

#strong[#text("Chart series.")] #text("fast: Trailing stop; slow: Trend SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Riding a trend to its end. The distance adapts to volatility, so a violent trend is given room a fixed percentage stop would not.")

#strong[#text("Failure mechanism.")] #text("Volatility spikes at a top. ATR rises as the move ends, which widens the stop exactly when it should tighten, and the exit comes well below the high.")

#strong[#text("Related models.")] #text("Supertrend, Price channel breakout, Donchian breakout.")

#heading(level: 3)[#text("Double EMA crossover | dema_cross")]

#strong[#text("Family and purpose.")] #text("Trend. Two exponential averages with most of their own lag subtracted back out.")

#strong[#text("Signal rule.")] #text("DEMA = 2·EMA(n) − EMA(EMA(n)). Long while the fast DEMA is above the slow one. Subtracting the double-smoothed series removes roughly half the lag an EMA carries.")

#strong[#text("Parameter semantics.")] #text("fast: Fast DEMA span; slow: Slow DEMA span.")

#strong[#text("Chart series.")] #text("fast: Fast DEMA; slow: Slow DEMA.")

#strong[#text("Intended regime hypothesis.")] #text("Trends that reverse before a plain EMA crossover has finished turning. It is the same trade as `ema_cross` with the reaction time moved forward.")

#strong[#text("Failure mechanism.")] #text("Choppy markets, harder than either simpler average. Removing lag removes the smoothing that was suppressing the whipsaws, and every false turn now arrives earlier and in full.")

#strong[#text("Related models.")] #text("EMA crossover, Triple EMA crossover, Zero-lag EMA crossover.")

#heading(level: 3)[#text("Triple EMA crossover | tema_cross")]

#strong[#text("Family and purpose.")] #text("Trend. The same lag correction applied a third time, faster still and correspondingly twitchier.")

#strong[#text("Signal rule.")] #text("TEMA = 3·EMA − 3·EMA(EMA) + EMA(EMA(EMA)). Long while the fast TEMA is above the slow one.")

#strong[#text("Parameter semantics.")] #text("fast: Fast TEMA span; slow: Slow TEMA span.")

#strong[#text("Chart series.")] #text("fast: Fast TEMA; slow: Slow TEMA.")

#strong[#text("Intended regime hypothesis.")] #text("Fast-moving instruments where a DEMA is still late. Among the least-lagging averages that remain smooth enough to cross cleanly.")

#strong[#text("Failure mechanism.")] #text("Volatile ranges. Each extra correction amplifies short-term noise, so TEMA overshoots at every turn and crosses back within a few bars.")

#strong[#text("Related models.")] #text("Double EMA crossover, EMA crossover, Hull moving average slope.")

#heading(level: 3)[#text("Zero-lag EMA crossover | zlema_cross")]

#strong[#text("Family and purpose.")] #text("Trend. An EMA fed a de-lagged input rather than a de-lagged output.")

#strong[#text("Signal rule.")] #text("Feeds `2·close − close[(n−1)/2]` into a normal EMA. That input is an extrapolation of the recent move, which is what cancels the lag — and what makes it overshoot.")

#strong[#text("Parameter semantics.")] #text("fast: Fast ZLEMA span; slow: Slow ZLEMA span.")

#strong[#text("Chart series.")] #text("fast: Fast ZLEMA; slow: Slow ZLEMA.")

#strong[#text("Intended regime hypothesis.")] #text("Steady trends. The extrapolation is right whenever the recent direction continues, which is most of the time inside a trend.")

#strong[#text("Failure mechanism.")] #text("Sharp reversals, where the extrapolation points exactly the wrong way. It is confidently early in the wrong direction at precisely the turn.")

#strong[#text("Related models.")] #text("EMA crossover, Double EMA crossover, Triple EMA crossover.")

#heading(level: 3)[#text("Hull moving average slope | hull_trend")]

#strong[#text("Family and purpose.")] #text("Trend. Hull's average, which is unusually smooth and unusually fast at the same time.")

#strong[#text("Signal rule.")] #text("HMA = WMA(2·WMA(n/2) − WMA(n), √n). Long while the HMA is above its own value `slow` bars ago — a slope rule, not a crossover.")

#strong[#text("Parameter semantics.")] #text("fast: Hull MA period; slow: Slope lookback (bars).")

#strong[#text("Chart series.")] #text("fast: None; slow: Hull MA.")

#strong[#text("Intended regime hypothesis.")] #text("Medium-term trends. The construction genuinely does buy smoothness and responsiveness together rather than trading one for the other.")

#strong[#text("Failure mechanism.")] #text("Sideways markets. A very smooth line still has a slope, and a flat market's slope oscillates around zero, so the rule flips repeatedly on moves too small to pay for themselves.")

#strong[#text("Related models.")] #text("EMA slope, Triple EMA crossover, Triple moving average.")

#heading(level: 3)[#text("Vortex indicator crossover | vortex_cross")]

#strong[#text("Family and purpose.")] #text("Trend. Two directed movements built from different data, so their crossing is not a smoothing artefact.")

#strong[#text("Signal rule.")] #text("VI+ = Σ|high − previous low| / Σ true range; VI− = Σ|low − previous high| / Σ true range, over `fast` bars. Long while VI+ leads VI−, flat below SMA(slow).")

#strong[#text("Parameter semantics.")] #text("fast: Vortex period; slow: Exit SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: Exit SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Trend initiation. Unlike a crossover of two averages of the same series — where the crossing is partly an artefact of the smoothing — these two lines measure genuinely different quantities.")

#strong[#text("Failure mechanism.")] #text("Range-bound markets, where the two lines hug each other and cross on noise. True range in the denominator also means a single volatile bar can flip both at once.")

#strong[#text("Related models.")] #text("Supertrend, ATR breakout, Triple moving average.")

#heading(level: 3)[#text("Donchian breakout | donchian")]

#strong[#text("Family and purpose.")] #text("Breakout. Buy a new high, sell a new low. The rule the original Turtles traded.")

#strong[#text("Signal rule.")] #text("Long when close exceeds the highest high of the previous `fast` bars; flat when it falls below the lowest low of the previous `slow` bars. Both channels are shifted one bar so the current bar cannot set the level it is being compared against.")

#strong[#text("Parameter semantics.")] #text("fast: Breakout lookback; slow: Trailing-exit lookback.")

#strong[#text("Chart series.")] #text("fast: Breakout high; slow: Trailing low.")

#strong[#text("Intended regime hypothesis.")] #text("Markets that break out and keep going — crypto and commodities more than large-cap equities. It is a small number of large winners and a long tail of small losses.")

#strong[#text("Failure mechanism.")] #text("Range-bound markets, where every new high is the top of the range. Win rate collapses below 40% and the winners that pay for it never arrive.")

#strong[#text("Related models.")] #text("Aroon crossover, Price channel breakout, Trend-filtered breakout, Volume-confirmed breakout.")

#heading(level: 3)[#text("Donchian mid-band | donchian_mid")]

#strong[#text("Family and purpose.")] #text("Breakout. Donchian's channel used as a pullback entry rather than a breakout one.")

#strong[#text("Signal rule.")] #text("Long when close is above the channel midpoint of the last `fast` bars; flat when it closes below SMA(slow). Entering at the midpoint rather than the high buys the retracement instead of the extension.")

#strong[#text("Parameter semantics.")] #text("fast: Channel lookback; slow: Exit SMA period.")

#strong[#text("Chart series.")] #text("fast: Channel high; slow: Exit SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Trends that advance in steps. It gets in earlier and cheaper than the breakout version, at the cost of more false starts.")

#strong[#text("Failure mechanism.")] #text("A market that is halfway through a top. The midpoint of a widening range is a level price crosses on the way down as readily as on the way up.")

#strong[#text("Related models.")] #text("Donchian breakout, Price channel breakout, Moving-average crossover.")

#heading(level: 3)[#text("Trend-filtered breakout | breakout_sma")]

#strong[#text("Family and purpose.")] #text("Breakout. A breakout that is only taken while the longer trend agrees.")

#strong[#text("Signal rule.")] #text("Long when close exceeds the prior `fast`-bar high AND sits above SMA(slow); flat when it loses the SMA. The filter is a veto on entries, not a second entry condition.")

#strong[#text("Parameter semantics.")] #text("fast: Breakout lookback; slow: Trend-filter SMA period.")

#strong[#text("Chart series.")] #text("fast: Breakout high; slow: Trend SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Markets with clear regimes. The filter removes the breakout trades that occur inside a downtrend, which are the ones that fail immediately.")

#strong[#text("Failure mechanism.")] #text("Sharp V-shaped reversals. By the time the slow average turns up the move is largely over, and the filter has cost the entire first leg.")

#strong[#text("Related models.")] #text("Donchian breakout, Volume-confirmed breakout, Rate of change with trend filter.")

#heading(level: 3)[#text("Price channel breakout | price_channel")]

#strong[#text("Family and purpose.")] #text("Breakout. Donchian with independent entry and exit lookbacks, so the exit can be tighter than the entry.")

#strong[#text("Signal rule.")] #text("Long when close exceeds the prior `fast`-bar high; flat when it falls below the prior `slow`-bar low, both shifted one bar. Setting the exit channel shorter than the entry one is the classic asymmetric configuration.")

#strong[#text("Parameter semantics.")] #text("fast: Breakout lookback; slow: Exit-channel lookback.")

#strong[#text("Chart series.")] #text("fast: Channel high; slow: Channel low.")

#strong[#text("Intended regime hypothesis.")] #text("Trending markets where giving back less of each move matters more than catching every move.")

#strong[#text("Failure mechanism.")] #text("Volatile trends. A tight exit channel is hit by ordinary retracement, and the model exits into the middle of the move it was right about.")

#strong[#text("Related models.")] #text("Donchian breakout, Donchian mid-band, ATR trailing stop (chandelier).")

#heading(level: 3)[#text("Bollinger band breakout | bollinger_breakout")]

#strong[#text("Family and purpose.")] #text("Breakout. Buy a move beyond the upper band — volatility expansion treated as a signal, not a warning.")

#strong[#text("Signal rule.")] #text("Long when close > SMA(fast) + slow × σ(fast), where σ is the population standard deviation over the same window; flat when close falls back below the SMA. The band width is a genuine fractional axis: 1.5σ is 1.5σ, and encoding it as the integer 15 would make a slider that lies about its units.")

#strong[#text("Parameter semantics.")] #text("fast: Band SMA period; slow: Band width (σ).")

#strong[#text("Chart series.")] #text("fast: Upper band; slow: Band mid.")

#strong[#text("Intended regime hypothesis.")] #text("Volatility breakouts after a squeeze. Because the band is measured in standard deviations, the threshold adapts to the instrument's own regime.")

#strong[#text("Failure mechanism.")] #text("The opposite reading is also popular and also profitable in ranges — a touch of the upper band is a classic reversion SELL. In a mean-reverting instrument this rule is on the wrong side of every trade.")

#strong[#text("Related models.")] #text("Keltner channel breakout, Z-score mean reversion, ATR breakout.")

#heading(level: 3)[#text("ATR breakout | atr_breakout")]

#strong[#text("Family and purpose.")] #text("Breakout. A breakout sized in the instrument's own volatility.")

#strong[#text("Signal rule.")] #text("Long when close exceeds the prior close plus `slow` × ATR(fast); flat when it falls the same distance below. ATR is Wilder-smoothed — an `ewm(alpha=1/n)`, which is what every published ATR means and what both engines implement.")

#strong[#text("Parameter semantics.")] #text("fast: ATR period; slow: Breakout size (ATRs).")

#strong[#text("Chart series.")] #text("fast: None; slow: Prior close.")

#strong[#text("Intended regime hypothesis.")] #text("Across instruments and across regimes. A threshold in ATRs means the same thing on a quiet day and a violent one, which a percentage threshold does not.")

#strong[#text("Failure mechanism.")] #text("Volatility contractions. As ATR falls the threshold tightens, so the rule trades most in exactly the conditions where moves are smallest relative to costs.")

#strong[#text("Related models.")] #text("Keltner channel breakout, Supertrend, Bollinger band breakout.")

#heading(level: 3)[#text("Keltner channel breakout | keltner_breakout")]

#strong[#text("Family and purpose.")] #text("Breakout. Bollinger's idea with ATR instead of standard deviation.")

#strong[#text("Signal rule.")] #text("Long when close > EMA(fast) + slow × ATR(fast); flat below the EMA. ATR uses true range, which includes the gap through the previous close — a standard deviation of closes cannot see that.")

#strong[#text("Parameter semantics.")] #text("fast: EMA & ATR period; slow: Channel width (ATRs).")

#strong[#text("Chart series.")] #text("fast: Upper channel; slow: Channel mid.")

#strong[#text("Intended regime hypothesis.")] #text("Gappy instruments. Equities gap overnight and crypto gaps on liquidations; a channel built from closes understates both.")

#strong[#text("Failure mechanism.")] #text("The same failure as any breakout: a range, where every band touch is the edge rather than the start of something.")

#strong[#text("Related models.")] #text("Bollinger band breakout, ATR breakout, Supertrend.")

#heading(level: 3)[#text("Standard-deviation channel | stddev_channel")]

#strong[#text("Family and purpose.")] #text("Breakout. A breakout measured in standard deviations of price rather than of returns.")

#strong[#text("Signal rule.")] #text("Long when the close exceeds SMA(fast) + `slow`σ; flat back below the midline. The exit at the mean rather than the lower band is deliberate — it gives back less of a move that fails.")

#strong[#text("Parameter semantics.")] #text("fast: Channel period; slow: Channel width (σ).")

#strong[#text("Chart series.")] #text("fast: None; slow: Channel midline.")

#strong[#text("Intended regime hypothesis.")] #text("Volatility expansions from a quiet base. The threshold scales with the instrument's own recent dispersion, so it means the same thing across regimes.")

#strong[#text("Failure mechanism.")] #text("Trending markets with a rising mean. The midline chases price upward, so the exit tightens exactly as the trend matures and cuts the position early.")

#strong[#text("Related models.")] #text("Bollinger band breakout, Keltner channel breakout, Bollinger %B reversion.")

#heading(level: 3)[#text("RSI mean reversion | rsi_reversion")]

#strong[#text("Family and purpose.")] #text("Mean reversion. Buy oversold, exit on recovery or when the trend gives way.")

#strong[#text("Signal rule.")] #text("Long when RSI(fast) < 30. Flat when RSI > 50 OR close < SMA(slow). The trend filter is an EXIT, not an entry gate — requiring oversold and above-trend simultaneously makes the two conditions nearly exclusive, and the model takes almost no trades.")

#strong[#text("Parameter semantics.")] #text("fast: RSI period; slow: Trend-filter SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: Trend SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Instruments that oscillate around a stable level. Win rate is high; individual wins are small.")

#strong[#text("Failure mechanism.")] #text("Sustained downtrends, catastrophically. RSI can sit under 30 for weeks while price halves, and \"oversold\" describes the indicator rather than the value.")

#strong[#text("Related models.")] #text("RSI trend continuation, Williams %R reversion, Stochastic oscillator, Z-score mean reversion.")

#heading(level: 3)[#text("Williams %R reversion | williams_r")]

#strong[#text("Family and purpose.")] #text("Mean reversion. Where the close sits inside the recent range, traded as a reversion signal.")

#strong[#text("Signal rule.")] #text("%R = −100 × (highest high − close) / (highest high − lowest low) over `fast` bars. Long below −80; flat above −20 or when close < SMA(slow).")

#strong[#text("Parameter semantics.")] #text("fast: %R lookback; slow: Exit SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: Exit SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Range-bound markets with a stable width. %R is bounded by construction, so it cannot drift the way an unbounded oscillator can.")

#strong[#text("Failure mechanism.")] #text("An expanding range. The denominator grows with each new extreme, so %R recovers toward the middle without price recovering at all.")

#strong[#text("Related models.")] #text("Stochastic oscillator, RSI mean reversion, Money-flow index reversion.")

#heading(level: 3)[#text("Stochastic oscillator | stochastic")]

#strong[#text("Family and purpose.")] #text("Mean reversion. The close's position in the recent range, smoothed against itself.")

#strong[#text("Signal rule.")] #text("%K = 100 × (close − lowest low) / (highest high − lowest low) over `fast` bars; %D = SMA(%K, slow). Long when %K < 20; flat when %K > 80 or %K < %D. Oversold arms the entry and %D confirms the exit — requiring `%K < 20 AND %K > %D` at once is the crossing instant, which almost never coincides, and the strategy took zero trades until they were separated.")

#strong[#text("Parameter semantics.")] #text("fast: %K lookback; slow: %D smoothing.")

#strong[#text("Chart series.")] #text("fast: None; slow: Exit SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Sideways markets with regular swings between support and resistance.")

#strong[#text("Failure mechanism.")] #text("Strong trends. %K pins above 80 for the whole advance, so the model spends the trend flat and re-enters at the top.")

#strong[#text("Related models.")] #text("Stochastic RSI, Williams %R reversion, RSI mean reversion, Money-flow index reversion.")

#heading(level: 3)[#text("Z-score mean reversion | zscore_reversion")]

#strong[#text("Family and purpose.")] #text("Mean reversion. Buy when price is statistically far below its own recent mean.")

#strong[#text("Signal rule.")] #text("z = (close − SMA(fast)) / σ(fast). Long when z < −slow; flat when z rises back above 0. The threshold is in standard deviations and is swept as a fraction.")

#strong[#text("Parameter semantics.")] #text("fast: Z-score lookback; slow: Entry threshold (σ).")

#strong[#text("Chart series.")] #text("fast: None; slow: Rolling mean.")

#strong[#text("Intended regime hypothesis.")] #text("Genuinely stationary series. This is the single-instrument shape of the pairs-trading rule, without the pair.")

#strong[#text("Failure mechanism.")] #text("Anything trending. A price making new lows has a mean that follows it down, so z returns to zero without price returning anywhere — the rule reports a successful reversion after a permanent loss.")

#strong[#text("Related models.")] #text("Linear regression forecast, RSI mean reversion, Bollinger band breakout, Williams %R reversion.")

#heading(level: 3)[#text("CCI mean reversion | cci_reversion")]

#strong[#text("Family and purpose.")] #text("Mean reversion. The Commodity Channel Index, read as an overextension signal.")

#strong[#text("Signal rule.")] #text("CCI = (typical price − SMA) / (0.015 × mean absolute deviation). Long below −`slow`, flat above 0 or under a 50-bar SMA. The 0.015 is Lambert's empirical constant, chosen so most readings fall inside ±100.")

#strong[#text("Parameter semantics.")] #text("fast: CCI period; slow: Entry threshold (|CCI|).")

#strong[#text("Chart series.")] #text("fast: None; slow: Exit SMA (50).")

#strong[#text("Intended regime hypothesis.")] #text("Range-bound markets with recurring extremes. Mean absolute deviation is less distorted by one outlier bar than a standard deviation, so the bands stay usable through a shock.")

#strong[#text("Failure mechanism.")] #text("Sustained trends, the same way every reversion rule fails: CCI can hold below −100 for the whole descent, and the trend filter is the only thing preventing a series of losing entries.")

#strong[#text("Related models.")] #text("RSI mean reversion, Z-score mean reversion, Detrended price oscillator.")

#heading(level: 3)[#text("Stochastic RSI | stoch_rsi_x")]

#strong[#text("Family and purpose.")] #text("Mean reversion. RSI's position inside its own recent range — an oscillator of an oscillator.")

#strong[#text("Signal rule.")] #text("%K = (RSI − min RSI) / (max RSI − min RSI) over the ranking window. Long below 0.2, flat above 0.8. `fast` is the RSI period; `slow` is the window RSI is ranked inside.")

#strong[#text("Parameter semantics.")] #text("fast: RSI period; slow: Ranking window.")

#strong[#text("Chart series.")] #text("fast: None; slow: RSI range.")

#strong[#text("Intended regime hypothesis.")] #text("Instruments whose RSI never reaches classical extremes. Re-ranking it locally makes a signal out of a range that would otherwise sit permanently between 40 and 60.")

#strong[#text("Failure mechanism.")] #text("Trends, and worse than plain RSI. Re-scaling to a local range guarantees extremes appear, so it produces confident oversold readings all the way down.")

#strong[#text("Related models.")] #text("RSI mean reversion, Stochastic oscillator, Williams %R reversion.")

#heading(level: 3)[#text("Detrended price oscillator | dpo_reversion")]

#strong[#text("Family and purpose.")] #text("Mean reversion. Price with its own trend removed, traded against the residual.")

#strong[#text("Signal rule.")] #text("DPO = (close − SMA shifted back by n/2+1), scaled by the rolling standard deviation. Long below −`slow`σ, flat above 0. The shift is what removes the trend instead of lagging it.")

#strong[#text("Parameter semantics.")] #text("fast: Detrend period; slow: Entry threshold (σ).")

#strong[#text("Chart series.")] #text("fast: None; slow: Detrend SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Cyclical instruments. Detrending is what makes a cycle visible when a persistent drift would otherwise dominate the signal.")

#strong[#text("Failure mechanism.")] #text("Regime changes. The detrending window assumes the cycle length is roughly stable, and a market that switches from a 20-bar rhythm to a 60-bar one leaves DPO measuring the wrong thing entirely.")

#strong[#text("Related models.")] #text("Z-score mean reversion, CCI mean reversion, Bollinger %B reversion.")

#heading(level: 3)[#text("Bollinger %B reversion | bollinger_pctb")]

#strong[#text("Family and purpose.")] #text("Mean reversion. Where the close sits between the Bollinger bands, as a number from 0 to 1.")

#strong[#text("Signal rule.")] #text("%B = (close − lower band) / (upper − lower), with 2σ bands over `fast` bars. Long below `slow`, flat above 0.5. Same bands as the breakout strategy, opposite side of the trade.")

#strong[#text("Parameter semantics.")] #text("fast: Band SMA period; slow: Entry level (%B).")

#strong[#text("Chart series.")] #text("fast: None; slow: Band midline.")

#strong[#text("Intended regime hypothesis.")] #text("Mean-reverting instruments. Because it is bounded, the entry level means the same thing across instruments and across volatility regimes, which a raw price distance does not.")

#strong[#text("Failure mechanism.")] #text("Strong trends, where %B pins near 0 for the whole decline. Running this against `bollinger_breakout` on the same symbol is the cheapest way to learn which side that instrument rewards.")

#strong[#text("Related models.")] #text("Bollinger band breakout, Z-score mean reversion, Standard-deviation channel.")

#heading(level: 3)[#text("Momentum (skip-recent) | momentum")]

#strong[#text("Family and purpose.")] #text("Momentum. Buy what has already risen, ignoring the most recent bars — the academic 12-1 construction.")

#strong[#text("Signal rule.")] #text("Long when the return from `slow` bars ago to `fast` bars ago is positive. The recent window is skipped deliberately: short-horizon reversal is the documented contaminant of momentum, and including it measures the opposite effect.")

#strong[#text("Parameter semantics.")] #text("fast: Bars skipped (recent); slow: Momentum lookback.")

#strong[#text("Chart series.")] #text("fast: None; slow: Lookback SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Cross-sectional and time-series momentum is one of the most replicated anomalies in finance, over horizons of months.")

#strong[#text("Failure mechanism.")] #text("Momentum crashes — sharp reversals after a sustained run, historically the worst drawdowns in the factor's history. The skip window does not protect against them.")

#strong[#text("Related models.")] #text("Rate of change with trend filter, EMA slope, TRIX signal crossover.")

#heading(level: 3)[#text("Rate of change with trend filter | roc_trend")]

#strong[#text("Family and purpose.")] #text("Momentum. Rate of change, gated by a longer trend filter.")

#strong[#text("Signal rule.")] #text("Long when close / close[fast bars ago] − 1 > 0 AND close > SMA(slow). Both conditions must hold, so this one genuinely is a gate rather than a stop.")

#strong[#text("Parameter semantics.")] #text("fast: Rate-of-change lookback; slow: Trend-filter SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: Trend SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Trending markets where short-term momentum and long-term direction agree — the filter removes the counter-trend bounces.")

#strong[#text("Failure mechanism.")] #text("Range-bound markets, where the two conditions agree at the top of the range and disagree everywhere useful.")

#strong[#text("Related models.")] #text("Momentum (skip-recent), Trend-filtered breakout, EMA slope.")

#heading(level: 3)[#text("RSI trend continuation | rsi_trend")]

#strong[#text("Family and purpose.")] #text("Momentum. RSI read as a trend indicator rather than a reversion one — the opposite reading of the same number.")

#strong[#text("Signal rule.")] #text("Long when RSI(fast) > 50 AND close > SMA(slow). RSI above 50 means average gains exceed average losses over the lookback, which is a statement about direction rather than exhaustion.")

#strong[#text("Parameter semantics.")] #text("fast: RSI period; slow: Trend-filter SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: Trend SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Trending markets — and it is worth running against `rsi_reversion` on the same instrument, because whichever wins tells you which regime the instrument is in.")

#strong[#text("Failure mechanism.")] #text("Ranges, where RSI crosses 50 constantly and the SMA filter is the only thing preventing continuous trading.")

#strong[#text("Related models.")] #text("RSI mean reversion, Rate of change with trend filter, EMA slope.")

#heading(level: 3)[#text("On-balance volume trend | obv_trend")]

#strong[#text("Family and purpose.")] #text("Volume. On-balance volume: a running total that adds the day's volume on an up close and subtracts it on a down one.")

#strong[#text("Signal rule.")] #text("Long while OBV is above SMA(OBV, fast). The `slow` axis is unused and kept only so the grid keeps its shape.")

#strong[#text("Parameter semantics.")] #text("fast: OBV smoothing period; slow: Unused (kept for grid shape).")

#strong[#text("Chart series.")] #text("fast: None; slow: OBV average.")

#strong[#text("Intended regime hypothesis.")] #text("Where volume leads price. Accumulation shows in OBV before it shows in the close, which is the entire premise.")

#strong[#text("Failure mechanism.")] #text("Ranges, where up and down closes alternate: OBV oscillates around its own average and crosses it on noise. And separately — the failure that has nothing to do with the market — any instrument whose reported volume is unreliable. Crypto is the standard example, with wash trading and venue-specific reporting, and OBV is only ever as good as the volume feed under it.")

#strong[#text("Related models.")] #text("Rolling VWAP trend, Volume-confirmed breakout, Money-flow index reversion, Moving-average crossover.")

#heading(level: 3)[#text("Volume-confirmed breakout | volume_breakout")]

#strong[#text("Family and purpose.")] #text("Volume. A price breakout that must be confirmed by unusual volume.")

#strong[#text("Signal rule.")] #text("Long when close exceeds the prior `fast`-bar high AND volume exceeds its own `slow`-bar average; flat when close falls back below the breakout channel.")

#strong[#text("Parameter semantics.")] #text("fast: Breakout lookback; slow: Volume average period.")

#strong[#text("Chart series.")] #text("fast: Breakout high; slow: Trend SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Separating real breakouts from drift. A move on ordinary volume is one participant; a move on twice the average is a change of opinion.")

#strong[#text("Failure mechanism.")] #text("Thin sessions and holidays, where volume itself is the anomaly. It also inherits every problem with the volume feed that `obv_trend` has.")

#strong[#text("Related models.")] #text("Ease of movement, Donchian breakout, On-balance volume trend, Trend-filtered breakout.")

#heading(level: 3)[#text("Money-flow index reversion | mfi_reversion")]

#strong[#text("Family and purpose.")] #text("Volume. RSI weighted by money flow — price and volume in one oscillator.")

#strong[#text("Signal rule.")] #text("MFI over `fast` bars from typical price × volume, split into positive and negative flow. Long below 20; flat above 50 or when close < SMA(slow) — the same exit-dominates-entry structure as `rsi_reversion`.")

#strong[#text("Parameter semantics.")] #text("fast: MFI period; slow: Exit SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: Exit SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Reversion where volume confirms exhaustion: a low MFI is a sell-off that is running out of participants, not just out of price.")

#strong[#text("Failure mechanism.")] #text("The same way RSI reversion fails, plus a volume feed that can be wrong. A downtrend on rising volume pins MFI low for as long as the selling lasts.")

#strong[#text("Related models.")] #text("RSI mean reversion, Williams %R reversion, On-balance volume trend.")

#heading(level: 3)[#text("Rolling VWAP trend | vwap_trend")]

#strong[#text("Family and purpose.")] #text("Volume. Trade above the volume-weighted average price, exit below a trend line.")

#strong[#text("Signal rule.")] #text("Rolling VWAP over `fast` bars from typical price × volume; long while the close is above it, flat below SMA(slow). Rolling rather than session-anchored: a 24/7 instrument has no session, and a UTC boundary is not one.")

#strong[#text("Parameter semantics.")] #text("fast: VWAP lookback; slow: Exit SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: Exit SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Instruments where participants genuinely reference VWAP — large-cap equities most of all, since execution desks are measured against it.")

#strong[#text("Failure mechanism.")] #text("Thin or erratic volume. VWAP is a volume-weighted level, so a few outsized prints drag it somewhere no one traded.")

#strong[#text("Related models.")] #text("On-balance volume trend, Moving-average crossover, Chaikin money flow.")

#heading(level: 3)[#text("Awesome oscillator crossover | awesome_cross")]

#strong[#text("Family and purpose.")] #text("Momentum. Bill Williams' oscillator: two averages of the median price rather than the close.")

#strong[#text("Signal rule.")] #text("AO = SMA(median price, fast) − SMA(median price, slow), traded as a sign change. Median price is (H+L)/2 — substituting the close makes a different indicator with the same name.")

#strong[#text("Parameter semantics.")] #text("fast: Fast median-price SMA; slow: Slow median-price SMA.")

#strong[#text("Chart series.")] #text("fast: None; slow: Slow median SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Instruments with meaningful intrabar range. Using the bar's midpoint rather than its close makes it less sensitive to where the last print happened to land.")

#strong[#text("Failure mechanism.")] #text("Low-range bars, where the median and the close converge and this becomes an ordinary SMA crossover with extra steps.")

#strong[#text("Related models.")] #text("Moving-average crossover, MACD signal crossover, Chande momentum trend.")

#heading(level: 3)[#text("Chande momentum trend | cmo_trend")]

#strong[#text("Family and purpose.")] #text("Momentum. Chande's momentum oscillator, read as direction rather than exhaustion.")

#strong[#text("Signal rule.")] #text("CMO = 100 × (up moves − down moves) / (up + down) over `fast` bars. Long above +`slow`, flat below −`slow`. Unlike RSI it is unsmoothed, so it reaches its extremes far more often.")

#strong[#text("Parameter semantics.")] #text("fast: CMO period; slow: Entry threshold (|CMO|).")

#strong[#text("Chart series.")] #text("fast: None; slow: Trend reference.")

#strong[#text("Intended regime hypothesis.")] #text("Markets with persistent directional pressure. Being unsmoothed means it registers a regime change sooner than RSI does.")

#strong[#text("Failure mechanism.")] #text("Anything choppy. Without smoothing it crosses its thresholds constantly, which is why the entry and exit levels here are symmetric and far apart rather than RSI's 30/70.")

#strong[#text("Related models.")] #text("RSI trend continuation, Momentum (skip-recent), Awesome oscillator crossover.")

#heading(level: 3)[#text("Chaikin volatility expansion | chaikin_volatility")]

#strong[#text("Family and purpose.")] #text("Volatility. Rising volatility traded as a continuation signal, not a warning.")

#strong[#text("Signal rule.")] #text("Rate of change of an EMA of the high-low spread over `slow` bars; long when it is rising and price is above a 50-bar SMA. The trend filter is what makes expansion bullish rather than merely eventful.")

#strong[#text("Parameter semantics.")] #text("fast: Spread EMA period; slow: Rate-of-change lookback.")

#strong[#text("Chart series.")] #text("fast: None; slow: Trend SMA (50).")

#strong[#text("Intended regime hypothesis.")] #text("Breakouts from compression, where an expanding range and an upward trend genuinely coincide.")

#strong[#text("Failure mechanism.")] #text("Volatility spikes at a top. A crash expands the range violently, and without the trend filter this would read a collapse as a signal to buy.")

#strong[#text("Related models.")] #text("ATR breakout, Keltner channel breakout, Ulcer index regime filter.")

#heading(level: 3)[#text("Ulcer index regime filter | ulcer_filter")]

#strong[#text("Family and purpose.")] #text("Volatility. Hold the trend only while recent losses have been shallow and short.")

#strong[#text("Signal rule.")] #text("The Ulcer Index is the root-mean-square drawdown from the rolling peak. Long while it is below `slow` and price is above a 50-bar SMA; flat above twice that or below the SMA.")

#strong[#text("Parameter semantics.")] #text("fast: Ulcer window; slow: Maximum ulcer index.")

#strong[#text("Chart series.")] #text("fast: None; slow: Trend SMA (50).")

#strong[#text("Intended regime hypothesis.")] #text("Avoiding the worst of a decline. Unlike maximum drawdown, the Ulcer Index penalises duration as well as depth, so a long grinding loss registers where a single sharp dip does not.")

#strong[#text("Failure mechanism.")] #text("V-shaped recoveries. The index stays elevated for as long as the drawdown persists, so it keeps the position flat through the first and best part of the rebound.")

#strong[#text("Related models.")] #text("ATR trailing stop (chandelier), Chaikin volatility expansion, Supertrend.")

#heading(level: 3)[#text("Chaikin money flow | cmf_trend")]

#strong[#text("Family and purpose.")] #text("Volume. Volume weighted by where inside the bar the close landed.")

#strong[#text("Signal rule.")] #text("Money-flow multiplier = ((close − low) − (high − close)) / (high − low), times volume, summed over `fast` bars and divided by total volume. Long above `slow`, flat below 0.")

#strong[#text("Parameter semantics.")] #text("fast: CMF period; slow: Entry threshold (CMF).")

#strong[#text("Chart series.")] #text("fast: None; slow: Trend reference.")

#strong[#text("Intended regime hypothesis.")] #text("Detecting accumulation. A close at the high on heavy volume counts fully; a close at the midpoint counts zero however large the volume, which is what separates conviction from mere activity.")

#strong[#text("Failure mechanism.")] #text("Gapping instruments. The multiplier only sees inside the bar, so an overnight gap — the most informative move an equity makes — contributes nothing at all.")

#strong[#text("Related models.")] #text("On-balance volume trend, Money-flow index reversion, Force index.")

#heading(level: 3)[#text("Force index | force_index")]

#strong[#text("Family and purpose.")] #text("Volume. Price change multiplied by volume: direction and conviction in one number.")

#strong[#text("Signal rule.")] #text("Force = (close − previous close) × volume, smoothed by an EMA over `fast` bars. Long while it is positive and price is above SMA(slow).")

#strong[#text("Parameter semantics.")] #text("fast: Force EMA period; slow: Trend-filter SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: Trend SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Confirming that a move has participation behind it. A large move on small volume and a small move on large volume are different events, and this is the simplest statistic that separates them.")

#strong[#text("Failure mechanism.")] #text("Low-volume drift, where the smoothed force hovers either side of zero and the sign flips on bars that barely moved. And structurally: force is unbounded and scales with both price and volume, so it cannot be compared across instruments or across a period where either changed by an order of magnitude — which is why this reads its sign rather than a level.")

#strong[#text("Related models.")] #text("On-balance volume trend, Chaikin money flow, Volume-confirmed breakout.")

#heading(level: 3)[#text("Ease of movement | eom_trend")]

#strong[#text("Family and purpose.")] #text("Volume. How far price travelled per unit of volume — the market nobody is defending.")

#strong[#text("Signal rule.")] #text("Ease of Movement = midpoint change / (volume / range), smoothed over `fast` bars, scaled by 1e6 so the number is readable. Long while positive and above SMA(slow).")

#strong[#text("Parameter semantics.")] #text("fast: EOM smoothing period; slow: Trend-filter SMA period.")

#strong[#text("Chart series.")] #text("fast: None; slow: Trend SMA.")

#strong[#text("Intended regime hypothesis.")] #text("Spotting moves through thin resistance. A large advance on little volume is exactly the condition this was built to name.")

#strong[#text("Failure mechanism.")] #text("Thin, illiquid markets — every bar there is a large move on little volume, so the indicator sits permanently elevated and never says anything. It measures a ratio, and a ratio with a vanishing denominator is noise amplified rather than a signal. The same happens in a low-volatility range for the opposite reason: the numerator goes to zero and the sign flips on rounding.")

#strong[#text("Related models.")] #text("Force index, Chaikin money flow, On-balance volume trend.")

#heading(level: 3)[#text("Aroon crossover | aroon_cross")]

#strong[#text("Family and purpose.")] #text("Momentum. The only indicator here that measures TIME rather than price.")

#strong[#text("Signal rule.")] #text("Aroon Up = (period − bars since the window's high) / period × 100, and the mirror for Down. Long when Up exceeds `slow` and leads Down. Ties resolve to the most recent bar, which is the definition and the opposite of what an argmax returns.")

#strong[#text("Parameter semantics.")] #text("fast: Aroon period; slow: Entry threshold (Aroon).")

#strong[#text("Chart series.")] #text("fast: None; slow: Aroon reference.")

#strong[#text("Intended regime hypothesis.")] #text("Identifying a range that is about to end. Because it counts bars rather than distance, it can turn while price is still flat — which no price-based indicator can do.")

#strong[#text("Failure mechanism.")] #text("Choppy markets that keep setting marginal new extremes. Each one resets the count, so both lines stay high and the crossover fires repeatedly on nothing.")

#strong[#text("Related models.")] #text("Donchian breakout, Price channel breakout, EMA slope.")

#heading(level: 3)[#text("Linear regression forecast | linreg_forecast")]

#strong[#text("Family and purpose.")] #text("Fitted. The only model here that estimates its own rule: an ordinary least-squares forecast of the next bar's return, refitted as it goes.")

#strong[#text("Signal rule.")] #text("Regress next-bar return on three features known at the bar — the 1-bar return, the 5-bar return, and the close's deviation from its 20-bar mean — over a trailing window of `fast` bars. Long when the forecast exceeds `slow` × the fit's own residual standard error; flat when the forecast turns negative. Refit every 20 bars: a coefficient set that changes every bar is fitting the last observation.")

#strong[#text("Parameter semantics.")] #text("fast: Training window (bars); slow: Entry threshold (residual σ).")

#strong[#text("Chart series.")] #text("fast: None; slow: Feature mean (20).")

#strong[#text("Intended regime hypothesis.")] #text("Series with genuine short-horizon autocorrelation, and it will find either sign of it — the coefficients decide whether the last move is continued or faded, rather than the user deciding in advance.")

#strong[#text("Failure mechanism.")] #text("Regime changes, which is the failure specific to being fitted. Coefficients estimated across a trending window keep predicting a trend into the range that follows, and the model is confidently wrong for a full window before the next refit corrects it. Compare its in-sample and out-of-sample Sharpe rather than reading the coefficients — a fit that only worked in-sample is the thing this strategy is most likely to be.")

#strong[#text("Related models.")] #text("Z-score mean reversion, Momentum (skip-recent), Rate of change with trend filter.")

#heading(level: 2)[#text("Reproducibility, limitations and interpretation")]

#text("Reproduction requires the local source revision, runtime versions, data identities, parameter definitions and service state. The embedded view-manifest.json and supplementary-views.json identify captured routes and images; source-controls.json preserves the full control attributes and listener registrations. strategy-catalogue.json and feature-methods.json preserve the model and analytical explanations. verification-report.json records test counts, scope and SHA-256 identities of the local test logs, retained under docs/whitepaper/evidence/test-logs. route-verification.json records each local navigation result. shutdown-status.json records the current unreachable VM, unverified service shutdown and all-workflow pause as well as historical observations; github-workflows.json records paused schedules. screenshot-audit.json and live-verification.json record the live recapture checks and dependency observations.")

#text("The corpus is a registered-state census rather than a random sample of users, devices or market conditions. It does not cover every account permission, instrument, viewport, server response or sequence of clicks. Source and deployed revision mismatch limits transfer of local verification to the hosted build. Source-contract tests can catch architectural regressions but can also mirror implementation assumptions; browser assertions and backend fixtures provide complementary, still finite evidence.")

#text("The resulting whitepaper is therefore a research and engineering reference with explicitly bounded empirical validation. Screenshots preserve appearance, method notes preserve quantitative meaning, and test records preserve what was actually exercised. Unknown or unavailable states remain part of the evidence. No new investment-performance, forecast-skill, cost-savings or live execution claim follows merely from this software study.")

#heading(level: 2)[#text("References and primary implementation sources")]

#text("R1. Bailey, D. H., and López de Prado, M. (2014). The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting and Non-Normality. Author manuscript, 31 July 2014.")

#link("https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf")[Primary source]

#text("R2. Gneiting, T., and Raftery, A. E. (2007). Strictly Proper Scoring Rules, Prediction, and Estimation. Journal of the American Statistical Association 102(477), 359-378.")

#link("https://doi.org/10.1198/016214506000001437")[Primary source]

#text("P1. web/lib/sections.ts; web/scripts/visible-copy-audit.mjs: registered workspace state space and view census.")

#text("P2. web/lib/strategy-docs/{trend,momentum,reversion,breakout,model,index}.ts and exported strategy parameter catalogue: model rules and parameter semantics.")

#text("P3. web/lib/portfolio-risk/{risk,covariance,contribution,var-validation,exceedance,stress}.ts: covariance risk, GBM reference, contribution and validation conventions.")

#text("P4. web/lib/coherence/kelly-frontier.ts and diffusion-model.ts: terminal wealth replay and synthetic diffusion geometry.")

#text("P5. modules/coherence/diffusion/skill.py: finite-window residence-time target, precision weights and held-out study mechanics.")

#text("P6. web/tests/{focus-browser-interaction,coherence-interaction-layout-stability,workspace-refresh-bootstrap,header-browser-containment,responsive-header-and-density-followup}.test.ts: executed browser assertions.")

#text("P7. Embedded source-controls.json: exact file/line bindings for the native controls, interactive primitives and event listeners. Prefix all web and modules paths above with Part2_Infrastructure/.")
