"""Build the research protocol and complete per-section quantitative interpretation."""
from pathlib import Path
import json, re, math, hashlib
from research_feature_specs import S

ROOT=Path(__file__).resolve().parents[3]
WP=ROOT/'docs/whitepaper'; EV=WP/'evidence'
captures=json.loads((EV/'view-manifest.json').read_text())+json.loads((EV/'supplementary-views.json').read_text())
plan=json.loads((EV/'publication-plan.json').read_text())
screenshot_count=plan['stats']['printed_screenshots']
extra_count=len(json.loads((EV/'supplementary-views.json').read_text()))
unique_count=len(plan['unique_images'])
q=lambda x:json.dumps(str(x),ensure_ascii=False)
t=lambda x:'#text('+q(x)+')'
p=lambda x:t(x)+'\n\n'
h=lambda n,x:'#heading(level: '+str(n)+')['+t(x)+']\n\n'
field=lambda name,x:'#strong['+t(name)+'] '+t(x)+'\n\n'
parts=[h(1,'Research protocol, quantitative interpretation and verification')]

def section(title,*paragraphs):
 parts.append(h(2,title))
 anchors={'Latest verification: Oracle search repaired; gateway access unresolved':'oracle-repair','Interpreting the retrieved quant evidence':'oracle-search-method','Oracle comparison and Monte Carlo uncertainty':'oracle-var-method'}
 if title in anchors:parts.append('#metadata('+q(anchors[title])+') <capture-'+anchors[title]+'>\n')
 for a in paragraphs:parts.append(p(a))
def equation(s):parts.append('$ '+s+' $\n\n')
def table(headers,rows,widths='(1fr, 2fr, 2fr)'):
 parts.append('#table(columns: '+widths+', table.header('+','.join('['+t(c)+']' for c in headers)+'),\n')
 for row in rows:parts.append(','.join('['+t(c)+']' for c in row)+',\n')
 parts.append(')\n\n')

section('Revision H audit: visual content and selected subtabs',
 'Chapter 9 remains AlphaEngine Features with a linked Oracle page index. Revision H replaces 37 image sets with focused active-panel browser captures and removes visually repeated content, including small-scroll overlaps that exact hashes missed. The fresh audit asserts all 70 selectable URL views and 50 internal presentation panes. Thirteen live Portfolio/Risk routes are blocked by the unreachable gateway; their generated Sandbox variants are checked separately. The underlying original evidence remains attached and retained in the repository. This is an incomplete live-service acceptance audit, not a claim that every feature works.',
 'New production captures include a byte-exact browser Monte Carlo parity result, six-provider cross-source reconciliation, settled Oracle search health, a 90-day Oracle VaR calculation, Research Adjustments, Robustness and Sharpe colouring, and previously omitted Execution panes. Gateway-dependent captures disclose the continuing outage. Some views are represented by earlier dated working captures because current gateway access is unavailable.',
 'The interaction matrix explicitly distinguishes source definitions, observed runtime controls, route-render checks and executed actions. Every inventoried entry has a status and evidence scope. Untested or blocked actions are not counted as successful. Creating a documentation task and recording a benchmark run were blocked by automatic approval review; their unsubmitted or existing states remain labelled. Private RFQ requires an authenticated desk account.',
 'The following Revision F results and earlier test counts are historical observations, retained with their original build identities. They do not imply a new full regression run or current backend availability. The latest UI sweep, capture fixes, publication plan, subtab coverage and interaction matrix are embedded as evidence.')

section('Latest verification: Oracle search repaired; gateway access unresolved',
 'Revision F was captured from production build 3b9918f6 on 5 October 2026. The exact query reported by the user, moving average crossover drawdown, now returns an Oracle research match in the deployed Vercel UI. The successful result is Backtest BTCUSDT 1h ma_cross 10/200, cosine similarity 0.8501158. The browser measured a 736 ms round trip. The result is a stored historical observation, not a newly successful trading strategy.',
 'The original search path was browser to Vercel to the OCI gateway VM to Supabase embeddings, then back to Vercel and Oracle ADB. The gateway did not answer within eight seconds. Independent checks showed that Supabase returned a valid 384-dimensional gte-small vector in 0.94 seconds and Vercel could execute the Oracle Monte Carlo procedure. The repair calls the same Supabase embedding function directly from the Vercel server, removing the unavailable VM hop for Oracle searches. Server credentials never enter the browser. The model name, dimension, finite coordinates and nonzero vector are validated; incompatible embeddings fail instead of producing arbitrary neighbours. Deployments without the server credential retain their existing gateway path.',
 'Supabase UI search still uses the gateway because it owns tenant scoping, retrieval fusion, optional reranking and the research audit trail. It remains blocked by the gateway timeout. No direct database shortcut was substituted for that authorization and accounting path. SSH and HTTPS to the VM time out, and the Oracle console requires the user to sign in. The precise VM or network cause and current container state cannot be established from a timeout. The UI now preserves the classified gateway error rather than calling the response unreadable or reporting zero matches.',
 'All seven GitHub workflows are disabled_manually, with zero running and zero queued jobs at the final workflow check. This includes OpenBB warm-keeping and public-market observation as well as the five previously paused Oracle-connected workflows. Container shutdown is NOT verified. Oracle ADB still answered live queries and has not been stopped through OCI. No database, volume or retained audit history was deleted. Stopping workflows prevents their scheduled calls; it is not proof that cloud resources stopped accruing charges. Console access remains necessary to complete the requested service shutdown.',
 'The Oracle axis-margin repair is deployed. New 1-day, 10-day and 30-day screenshots show real in-database Monte Carlo computations against the explicitly selected generated Sandbox book, with complete currency tick labels. At the captured 30-day observation the Oracle 99% terminal-loss estimate was 2,061,676 dollars and the matching closed form was 2,035,391 dollars, a displayed divergence of 1.3%. These inputs are a ten-million-dollar generated book, not the live paper positions. The chart plots independent repeated simulation estimates; it is not an equity time series.',
 'The repair passed 117 focused tests and TypeScript checking. These checks cover embedding model and vector validation, credential transport, failure handling, Oracle contracts, deadlines and chart behavior. They supplement the earlier broad suites below; they do not establish that every authenticated action or backend feature works. The current edition deliberately records the successful Oracle search and the unresolved Supabase/gateway boundary separately.')
section('Interpreting the retrieved quant evidence',
 'Cosine similarity compares the direction of the query and document embeddings. For nonzero vectors q and d it is q dot d divided by the product of their Euclidean norms. Oracle stores the same 384-dimensional gte-small representation used by the embedding service. The score 0.8501 is a semantic proximity measure, not an 85% chance of profitability, a statistical p-value, or a calibrated forecast. The configured relevance floor determines which neighbours can be displayed. No match means no sufficiently similar indexed evidence was found; an unavailable request means no valid search outcome was obtained.',
 'The matched record reports historical total return 0.006105, maximum drawdown -0.079040, deflated-Sharpe evidence 0.2016, walk-forward out-of-sample Sharpe -0.293 and PBO 0.75. In percentage terms the stored return is about 0.61% and drawdown about -7.90%. The negative out-of-sample Sharpe and high reported overfit probability caution against treating retrieval as strategy approval. The stored engine and combination-count fields are None; they remain missing historical metadata and have not been fabricated for presentation. The source reference and data hash allow a reviewer to identify the evidence being discussed.',
 'The two index choices contain different populations. Supabase is the gateway-maintained corpus with its own retrieval and graph machinery. Oracle contains backfilled historical research snapshots. Differences in hit count can reflect corpus membership, ingestion time, ranking or filtering. A valid comparison records query text, backend, model, timestamp, relevance threshold and document identity. Connected-document traversal belongs to the Supabase graph; an Oracle row identifier does not by itself establish a corresponding graph node.')

section('Abstract and contribution',
 'This chapter documents AlphaEngine as an inspectable quantitative research system, with an empirical software-verification study and a visual instrument catalogue. It connects each registered workspace section to a research question, mathematical or operational method, input intervention and interpretation boundary. It is not a new backtest claiming profitable alpha. Its reproducible contribution is the linkage between the implemented estimator, the visible control that changes it, and the evidence needed to interpret its output.',
 f'The observation set contains 11 tabs, 70 sections, 120 registered URL views and {extra_count} supplementary interface states. The visual appendix contains {screenshot_count} screenshot placements from {unique_count} distinct browser captures. An AST inventory records 964 source control definitions and 49 event-listener registrations across 855 source files. These denominators describe different populations and must not be added together or treated as independent trials. One source definition can generate many runtime buttons; one view can require several screenshots.',
 'The study combines deployed-interface capture with local numerical, contract and browser tests. The deployed build observed during capture was 726bbe7; local source was 5225f3e2 plus the documented test fixture and Oracle chart-margin corrections. Deployment parity is therefore not established. The initial outage screenshots were rechecked and replaced after restoring the gateway at the user request. The deployed Vercel UI reads real providers, Oracle calculations and retained analytical history. Three accepted paper verification orders populate the live paper book. Supplemental portfolio/risk views explicitly select Sandbox and identify generated inputs. No real-money trade or destructive operator action was executed.')

section('Live recapture: corrected data and operational evidence',
 'The initial edition included explicit gateway-outage text in 111 of its 210 captured states. This was an unsuitable basis for a populated feature demonstration. The revised atlas uses the actual Vercel production interface after restoring OCI gateway and reverse-proxy containers. Capture checks reject blank pages and wrong origins; delayed market panes wait for their initial calculation, and family selection must commit before the figure is saved.',
 'Live probes returned 120 real Bybit bars, a 51-combination backtest sweep, Oracle responses and eight configured providers. The authenticated in-container dependency check confirmed the Supabase mirror and research writer running and Neo4j returning 16 documents, 57 edges and two communities. A stale local gateway token failed direct smoke checks; the deployed Vercel proxy and in-container identity passed. These scopes are retained separately in live-verification.json.',
 'The three accepted paper verification orders total 3,000 USD nominal exposure and remain distinguishable from historical orders. They are not real venue trades. Supplemental Sandbox figures use the product’s own generated book and are labelled accordingly. Public prediction-market families are chosen to match the model: a threshold ladder for Survival, an exhaustive GDP bucket family for Mass and Stake, and a separately priced basket family for cover and capacity.',
 'Limits that cannot be repaired by waiting are preserved: private Makers/RFQ requires sign-in and desk membership; missing subminute diffusion observations are not invented; a zero optimal stake means the specified probabilities and prices do not justify a bet; low exposure and positive GBM drift can produce zero floored loss. Healthy operation does not imply a profitable strategy, positive allocation or a nonzero risk statistic.',
 'The earlier recapture observed the gateway and reverse proxy running. The latest verification section supersedes that operating observation: the VM is now unreachable and all seven workflows are disabled. Captures and connection checks are time-specific; authenticated private success and final service shutdown remain unverified.')

section('Visual defect repaired in production',
 'The fixed left margin had clipped leading digits of large currency-axis ticks. The deployed correction reserves space for the longest formatted tick. New production screenshots show complete million-dollar values at the 10-day and 30-day horizons. The figures use real Oracle calculations with explicit Sandbox inputs; no chart pixels or values were edited. Private RFQ success remains unverified pending an authenticated desk session.')

section('Research questions and falsifiable acceptance criteria',
 'RQ1 asks whether every registered section can be identified and documented with its actual rendered appearance. The acceptance unit is the route manifest, not the number of attractive screenshots. RQ2 asks whether numerical and presentation contracts remain consistent under controlled input changes; its units are named tests and exact observable outcomes. RQ3 asks whether a research claim can be traced through source identity, inputs, estimator, assumptions and failure conditions. RQ4 asks whether an unavailable dependency is disclosed rather than silently converted into a valid-looking measurement.',
 'A section passes documentation coverage when its route, screenshot(s), captured controls and quantitative explanation exist. This does not imply functional coverage of every hidden branch. A control passes a functional check only when its event is exercised and an observable postcondition is asserted. Screenshot existence is presentation evidence; source existence is implementation evidence; neither is equivalent to successful live service execution. The study makes no statistical claim that a finite test suite proves every possible interaction correct.')

section('Design, units of analysis and data provenance',
 'The interface census follows the registered desk/section/view state space, then adds disclosures, segmented panes, settings, authentication forms and guarded panels. Captures use a 1600 by 1000 browser viewport and scroll the workspace when necessary. Figures are printed on larger landscape sheets for legibility. Route hashes connect the method notes below to the identically named screenshot and control tables. Captured text, disabled states, option lists and image filenames remain available in the embedded JSON manifests.',
 'Quantitative units must be stated before interpretation: returns are per bar; annualised volatility carries a year convention; portfolio weights are relative to equity; execution costs use currency or basis points; binary-market prices are fractions of a unit payoff; diffusion time is in minutes. A provider timestamp is not a settlement timestamp, a retrieved document is not a filled trade, and an event count is not an independent sample count. Null or unavailable observations must not be relabelled as zero.',
 'Historical measurements in the six preceding chapters retain their original artefact and date. The October 2026 verification table below is the current software evidence for this edition. Earlier latency, data availability, benchmark and deployment statements should not be read as current measurements. The visual atlas records a live recapture; availability is time-specific and is not a continuing service guarantee.')

section('Return construction and selection-aware research',
 'A transparent conceptual return ledger applies yesterday\'s position to today\'s price change and subtracts the cost of changing exposure. Let r_t be the simple asset return, w_(t-1) the exposure known before that return, and c_t the fee/slippage cost per unit turnover. The equation below states the economic timing contract; individual strategy engines may additionally implement stops, sizing, shorting and turnover conventions. The actual implementation and exported parameters govern an exact reproduction.')
equation('r_t^"net" = w_(t-1) r_t - c_t abs(w_t - w_(t-1))')
parts.append(p('For an illustrative 1% asset return, 50% pre-existing exposure, 20% exposure change and 10 basis points of cost per unit turnover, the net return is 0.5% minus 0.02%, or 0.48%. Applying the end-of-bar signal to that same bar would introduce future information. This arithmetic example is not an observed AlphaEngine strategy result.'))
equation('hat("SR") = sqrt(A) (overline(r) - r_f) / s_r')
parts.append(p('Here A is bars per year, the risk-free return r_f is on the same per-bar scale, and s_r is sample return volatility. Annualising under serial dependence requires more care than multiplying by the square root of A. A price-chart interval, a backtest return interval and the Oracle 365-day simulation year are separate conventions. Sharpe, drawdown, turnover and cost must be reported jointly.'))
parts.append(p('The search family includes strategies, parameter combinations, symbols, timeframes, filters and repeated researcher revisions. Bailey and López de Prado [R1] motivate adjusting performance inference for selection and non-normal returns. The system exposes PSR/DSR and track-record evidence for that purpose. The precise reference Sharpe, skewness, kurtosis and effective trial assumptions matter; a high displayed probability cannot repair an unrecorded search. Walk-forward estimates should use chronological train/test separation and report each fold, sample size and selected parameter pair.'))

section('Portfolio risk: covariance, VaR, ES and attribution',
 'For equity E, exposure weights w and aligned per-bar covariance matrix Sigma, the portfolio implementation derives volatility and normal loss summaries. The covariance window, alignment, missing-data policy and shrinkage settings determine the estimate. Positive VaR denotes loss. Parametric normal VaR is a model quantile; it is neither a worst-case loss nor a guarantee that the boundary will hold.')
equation('sigma_p = sqrt(w^T Sigma w), quad "VaR"_(.95) = 1.6448536269514722 E sigma_p')
equation('"ES"_(.95) = 2.0627128054846826 E sigma_p, quad "RC"_i = w_i (Sigma w)_i / sigma_p')
parts.append(p('The normal summaries above use the zero-drift convention in web/lib/portfolio-risk/risk.ts. Under differentiable nonzero volatility, Euler contributions sum to sigma_p. A negative contribution can represent a hedge rather than invalid data. Scaling contributions to currency or percentages requires the same equity and normalisation convention. Historical simulation, bootstrap paths, stress shocks and parametric VaR answer different questions and need not agree.'))
E=100000; vol=.012
parts.append(p(f'Controlled arithmetic: with E = 100,000 currency units and per-bar volatility 1.2%, normal VaR95 is {1.6448536269514722*E*vol:,.2f}, and normal ES95 is {2.0627128054846826*E*vol:,.2f}. These are illustrative inputs, not the captured book. ES describes the conditional tail mean under the assumed normal distribution. It should not be read as the largest possible loss.'))

section('Oracle comparison and Monte Carlo uncertainty',
 'The Oracle panel has a distinct terminal-value geometric Brownian motion reference. Annual drift mu, annual volatility sigma and forward days d must be identical in the database simulation and the analytical comparator. The local reference explicitly uses T = d/365 and floors a negative reported loss at zero. Comparing this model to a zero-drift normal approximation would conflate model discrepancy with Monte Carlo error.')
equation('S_T = E exp((mu - sigma^2 / 2) T + sigma sqrt(T) Z), quad Z ~ cal(N)(0,1)')
equation('"VaR"_(.99)^"GBM" = max(0, E - E exp((mu - sigma^2 / 2) T - 2.326347874 sigma sqrt(T)))')
gbm=max(0,E-E*math.exp((.08-.5*.2**2)*30/365-2.326347874*.2*math.sqrt(30/365)))
parts.append(p(f'At illustrative equity 100,000, annual drift 8%, annual volatility 20% and 30 days, the matched GBM reference gives approximately {gbm:,.2f} currency units. This illustrative value was computed from the equation. The separate UI recapture also exercised the live Oracle service with its displayed inputs. The bootstrap Monte Carlo screen is a separate historical-return model and should not be expected to match GBM when its assumed return distribution differs.'))
parts.append(p('Seed selection controls reproducibility, path count controls simulation precision, and horizon changes the estimand. Roughly N times 0.01 paths populate a 1% tail before interpolation; 1,000 paths therefore provide only about ten tail observations. A stable seed is not evidence of statistical accuracy. Compare independent seeds and increasing path counts before attributing a discrepancy to database precision. Live UI observations confirm database execution, but do not constitute a full distributional convergence study. The small live verification book can produce zero floored loss under the 8% drift assumption; the explicitly selected Sandbox provides a higher-exposure comparison.'))

section('Execution cost and order decisions',
 'An order ticket expresses an intent, not a fill. Side, notional, type, limit price and execution assumptions feed a gate vector whose vetoes remain observable. Separate spread, explicit fee, impact, latency and adverse selection when analysing implementation shortfall. A routing allocation computed from a snapshot can become stale before execution; displayed depth is not an executable guarantee.',
 'In a simplified signed-cost definition, implementation shortfall equals side times the difference between fill VWAP and arrival price, divided by arrival price, plus fees on the same notional. Buy side is +1 and sell side is -1. For a buy at an arrival price of 100, fill VWAP 100.05 and fees of 2 basis points, illustrative shortfall is 7 basis points. Partial fills, cancelled quantities and opportunity costs require a separately defined denominator and horizon. The recapture submitted three paper BUY orders through the deployed UI: BTCUSDT 1,000 USD, ETHUSDT 1,500 USD and SOLUSDT 500 USD. All were accepted, creating three paper positions; the fill-quality panel reads the retained decision ledger. These are simulated verification trades, not live venue fills.',
 'Liquidity ladder selection and ticket editing are presentation operations; Send, Cancel, burst demonstrations and risk-control mutations require the gateway and operator authority. Offline gate tests can verify rejection logic without proving venue connectivity, fill probability or a live kill switch. The atlas records each visible or source-defined action without treating it as a successful trade.')

section('Prediction-market coherence and executable bounds',
 'A coherent set of quotes admits at least one probability assignment over the same mutually exclusive, exhaustive state space. Let q be the state probabilities, A the payoff incidence matrix, and b/a aligned bid/ask vectors. A conceptual feasibility system is shown below; practical certificates additionally encode the implemented relation set, tolerances, settlement rules and available sizes.')
equation('b <= A q <= a, quad q >= 0, quad sum_i q_i = 1')
equation('max(0,p_A+p_B-1) <= p_(A ∩ B) <= min(p_A,p_B)')
parts.append(p('For illustrative marginal probabilities 0.6 and 0.5, the joint event can lie anywhere from 0.1 to 0.5 without an additional dependence assumption. The independence value 0.3 is one admissible choice, not a bound forced by the marginals. A parlay quoted at 0.55 violates this simple upper bound only if the contracts truly represent the asserted events under matching settlement definitions and quotes are executable on the required sides.'))
parts.append(p('A price-only violation is not a net executable arbitrage. A statewise basket requires covered outcomes, correct buy/sell direction, depth, fees, capital, settlement and rounding. The binary-book identity maps a NO bid to a YES ask by one minus that bid; it does not justify adding two same-side quotes as though they were purchase costs. Inspect Prices and Sizes separately before interpreting the certificate.'))

section('Kelly sizing, forecast scores and calibration',
 'For a mutually exclusive exhaustive family, let f_i be the bankroll fraction spent on outcome i, a_i its price and p_i the forecast probability. The implemented local frontier replay computes residual cash and the terminal wealth multiplier if outcome i occurs. It rejects nonfinite or nonpositive wealth. The model is a log-growth illustration whose validity depends on the state-space and probability assumptions.')
equation('c = 1 - sum_i f_i, quad W_i = c + f_i/a_i, quad G = sum_i p_i ln(W_i)')
parts.append(p('Scaling all fractions creates the displayed fractional frontier. The lowest statewise wealth, remaining cash and expected log growth answer different capital questions. Probability uncertainty, fees and correlated or missing outcomes can dominate the apparent optimum. The Stake pane does not execute a portfolio. A visually attractive allocation is not evidence that its probabilities are calibrated.'))
equation('"BS" = (1/n) sum_(i=1)^n (p_i-y_i)^2')
parts.append(p('For binary outcomes y in {0,1}, Brier loss is lower when probability forecasts assign mass more accurately. Forecast timestamp and settlement label must be aligned without future information. Reliability bins compare mean forecast with realised event frequency; their widths and counts must accompany the chart. Proper scoring principles [R2] concern incentives and distributional assessment, not evidence that one observed sample proves a forecasting edge. A mixed corpus of different contracts, horizons or selection rules can change the score even when the underlying forecaster is unchanged.'))

section('Diffusion instruments and empirical identification',
 'The diffusion workspace studies how an announcement response evolves through time, with announcement-stage controls, meeting observations, closed episodes and synthetic estimator probes. The exact rate/price sign convention and terminal normalisation determine what an absorption ordinate means. Overshoot and reversal are economically meaningful; clipping the displayed curve would erase them. A fitted scale and shape describe a model, whereas the nonparametric residence-time target is a different object.',
 'In the implemented skill-study target, the terminal response is measured at 30 minutes, the area above the absorption curve is integrated with a trapezoidal rule over a finite window, and the resulting time is clipped to [0,30]. Missing terminal values and zero terminal response are inadmissible. This is a bounded finite-window target; calling it exactly the infinite-horizon exponential time constant would be inaccurate. The distinction matters for interpreting coefficients and out-of-sample error.')
equation('tau_H = integral_0^H (1-a(t)) dif t')
parts.append(p('For an ideal illustrative absorption curve a(t)=1-exp(-t/tau), the integral is tau times (1-exp(-H/tau)). With tau=20 minutes and H=30 minutes it is approximately 15.54 minutes before implementation clipping. It only approaches 20 as the observation horizon grows. This worked example explains the finite-window estimand; it is not a newly fitted announcement.'))
parts.append(p('The empirical comparison holds both stages of a meeting out together. Baseline controls and augmented text-derived features must use the same training fold, target definition, precision weights and evaluation population. A change in weighted held-out loss is the relevant comparison; a selected in-sample t statistic is insufficient. Meeting-level dependence, small samples, post-hoc thresholds, shuffled evidence and the entire specification grid must remain visible. The current work verifies software and documents existing findings; it does not recompute the historical study or promote its displayed numbers to new research results.'))

section('Verification results and scope of inference')
verification={
 'date':'2026-10-05','local_revision':'5225f3e2','deployed_build':'726bbe7',
 'web':{'tests':6856,'passed':6850,'failed':0,'skipped':6},
 'gateway':{'passed':3500,'failed':0,'count_method':'3500 pytest progress dots; process exit 0'},
 'openbb':{'passed':24,'failed':0,'warnings':1},
 'browser':{'initial_tests':23,'initial_passed':22,'initial_failed':1,'targeted_recheck_tests':5,'targeted_recheck_passed':5,'unresolved_failures':0,'note':'Not a new aggregate 28-test run: targeted recheck overlaps initial suite.'},
 'typecheck':{'exit_code':0},
 'test_correction':'workspace-refresh-bootstrap creates a row through New work / Add to triage before measuring controls; fresh queue is intentionally empty.',
 'live_mutations_verified':'three paper BUY orders only; no real venue or destructive mutation','oracle_execution_verified':True,'all_possible_interactions_verified':False,
 'limits':['Source and deployed revisions differ','No private account submissions, real venue orders, or destructive remediations','Screenshots do not prove successful backend execution','Six opt-in cases skipped in the main web suite; five browser files run separately'],
 'latest_repair':{'deployed_build':'3b9918f6','focused_tests_passed':117,'failed':0,'typecheck_exit':0,'oracle_ui_search':'verified genuine result','supabase_ui_search':'blocked by gateway timeout','all_workflows_disabled':True,'service_shutdown_verified':False},
 'logs':{}
}
route_report=json.loads((EV/'route-verification.json').read_text())
assert route_report['passed']==120 and route_report['failed']==0 and not route_report['pageErrors']
verification['route_navigation']={'passed':120,'failed':0,'uncaught_page_errors':0,'portfolio_and_risk':'generated Sandbox selected through the actual UI'}
for name in ['web-tests-verified.log','gateway-tests.log','openbb-tests.log','browser-tests.log','browser-bootstrap-recheck.log','typecheck-verified.log','repair-tests.log','repair-typecheck.log']:
 data=(EV/'test-logs'/name).read_bytes()
 verification['logs'][name]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
(EV/'verification-report.json').write_text(json.dumps(verification,indent=2)+'\n')
table(['Evidence','Observed result','What this establishes'],[
 ['Web suite','6,850 passed; 0 failed; 6 opt-in cases skipped','Numerical, source-contract and component logic within existing tests.'],
 ['Gateway suite','3,500 pass dots; successful exit','Offline gateway behavior under the test fixtures; no cloud availability claim.'],
 ['OpenBB service','24 passed; 1 dependency deprecation warning','Service contracts in its local test environment.'],
 ['Browser suite','23 cases initially: 22 passed, 1 failed; targeted five-case recheck: all passed','The failure was a test fixture assumption; no unresolved failure in these selected files.'],
 ['TypeScript','Typecheck exit 0','Static typing of local source after generated development types were available.'],
 ['Route navigation','120 of 120 passed; no uncaught page errors','Expected workspace and section visible with non-empty content; Portfolio/Risk use explicitly selected Sandbox.'],
 ['Visual census',f'120 canonical views; {extra_count} supplementary states; {screenshot_count} screenshot placements','Rendered coverage of live Vercel states, explicit Sandbox states and documented access/data limitations.'],
 ['Source census','964 controls; 49 listener registrations; 854 files scanned','Implementation inventory, not a 964-of-964 behavioral success claim.'],
])
parts.append(p('Browser files: focus-browser-interaction, coherence-interaction-layout-stability, workspace-refresh-bootstrap, header-browser-containment, and responsive-header-and-density-followup. Assertions exercise chart focus, keyboard inspection, both-axis zoom, drag pan, close behavior, stable readout geometry, header containment across responsive widths, deep-link bootstrap and task creation/control geometry. The main web-suite skipped cases were opt-in browser paths; the selected five browser files were run separately. The reported totals are not summed because their source-contract cases overlap.'))
parts.append(p('The earlier, separate local-browser census navigated all 120 registered view hashes and asserted that the expected workspace and section were visible with meaningful content. It recorded no uncaught page errors. Portfolio and Risk used the generated book after clicking Explore the sandbox book; Oracle API calls remained blocked. This verifies route reachability and section rendering, not every individual button, nested computation or live response. Exact per-route results are attached as route-verification.json.'))
parts.append(p('The initial browser failure expected a task-row select in a fresh engineering queue, which intentionally contains no sample tasks. The test was corrected to click New work, fill Title and submit Add to triage before measuring row controls. All five cases in that file then passed. This changes the test setup, not product behavior. An initial typecheck raced generated Next.js files during server startup; a subsequent check after startup completed without errors. The local server was configured without the project\'s paid service credentials.'))
parts.append(p('No claim is made that every hidden, authenticated, destructive or remote interaction has been executed successfully. Live Oracle simulation and paper order submission were exercised after the user requested reconnection. Real venue trading, destructive remediation and private account operations were not tested. The five Oracle-connected GitHub schedules remain paused while their dependency connections were checked; no deployment or schema workflow was run merely to produce screenshots.'))

section('Section-by-section quantitative interpretation',
 'Each entry below identifies a falsifiable analytical question and explains what an input change means. The matching route in the visual atlas supplies the actual screenshot(s), button labels, options and captured disabled states. The source register supplies conditional controls that were not rendered. Use all three together: the method note explains why, the screenshot explains where, and the event/attribute record explains the implemented interaction.')
source=(ROOT/'Part2_Infrastructure/web/lib/sections.ts').read_text()
names={}; mapping={'EXECUTION':'live','COHERENCE':'coherence','MARKETS':'markets','DIFFUSION':'diffusion'}
for key,body in re.findall(r'export const (\w+)_SECTIONS = \[(.*?)\] as const',source,re.S):
 for id,label,desc in re.findall(r'\{ id: "([^"]+)", label: "([^"]+)", description: "([^"]+)" \}',body):names[mapping.get(key,key.lower())+'/'+id]=label
assert set(S)==set(names),(set(S)-set(names),set(names)-set(S))
for route,(question,method,controls,limits) in S.items():
 parts.append(h(3,names[route]+' | '+route))
 for label,body in [('Research question.',question),('Method and estimand.',method),('Controls and interpretation.',controls),('Assumptions and failure modes.',limits)]:parts.append(field(label,body))
(EV/'feature-methods.json').write_text(json.dumps({r:dict(zip(['question','method','controls','limitations'],v)) for r,v in S.items()},indent=2)+'\n')

section('Complete strategy-model catalogue',
 'All 46 selectable strategies are documented below from the repository strategy documentation and parameter catalogue. The source descriptions state the intended mechanics and regime rationale; they are hypotheses, not measured profitability claims. The timing/cost/search protocol above applies to every model. Fast and slow are interface parameter slots whose units differ by strategy; a threshold, ATR multiple or number of lags must not be silently treated as a moving-average period.',
 'The rule descriptions below reproduce the implementation-facing documentation. Exact edge cases, warm-up, equality handling, missing values and order timing are governed by the numerical implementation and tests. Related models are conceptual comparisons, not independent replications. No strategy was promoted or funded as part of this documentation work.')
catalog=json.loads((EV/'strategy-catalogue.json').read_text()); c=catalog['catalogue']
for id,doc in catalog['docs'].items():
 parts.append(h(3,c['STRATEGY_LABELS'].get(id,id)+' | '+id))
 parts.append(field('Family and purpose.',str(c['STRATEGY_FAMILY'].get(id,''))+'. '+doc['summary']))
 parts.append(field('Signal rule.',doc['formula']))
 meanings=c['PARAM_MEANING'].get(id,{})
 parts.append(field('Parameter semantics.','; '.join(k+': '+str(v) for k,v in meanings.items())+'.'))
 series=c['CHART_SERIES'].get(id,{})
 parts.append(field('Chart series.','; '.join(k+': '+str(v) for k,v in series.items())+'.'))
 parts.append(field('Intended regime hypothesis.',doc['whenItWorks']))
 parts.append(field('Failure mechanism.',doc['whenItFails']))
 parts.append(field('Related models.',', '.join(c['STRATEGY_LABELS'].get(x,x) for x in doc.get('similar',[]))+'.'))

section('Reproducibility, limitations and interpretation',
 'Reproduction requires the local source revision, runtime versions, data identities, parameter definitions and service state. The embedded view-manifest.json and supplementary-views.json identify captured routes and images; source-controls.json preserves the full control attributes and listener registrations. strategy-catalogue.json and feature-methods.json preserve the model and analytical explanations. verification-report.json records test counts, scope and SHA-256 identities of the local test logs, retained under docs/whitepaper/evidence/test-logs. route-verification.json records each local navigation result. shutdown-status.json records the current unreachable VM, unverified service shutdown and all-workflow pause as well as historical observations; github-workflows.json records paused schedules. screenshot-audit.json and live-verification.json record the live recapture checks and dependency observations.',
 'The corpus is a registered-state census rather than a random sample of users, devices or market conditions. It does not cover every account permission, instrument, viewport, server response or sequence of clicks. Source and deployed revision mismatch limits transfer of local verification to the hosted build. Source-contract tests can catch architectural regressions but can also mirror implementation assumptions; browser assertions and backend fixtures provide complementary, still finite evidence.',
 'The resulting whitepaper is therefore a research and engineering reference with explicitly bounded empirical validation. Screenshots preserve appearance, method notes preserve quantitative meaning, and test records preserve what was actually exercised. Unknown or unavailable states remain part of the evidence. No new investment-performance, forecast-skill, cost-savings or live execution claim follows merely from this software study.')

section('References and primary implementation sources')
for label,text,url in [
 ('R1','Bailey, D. H., and López de Prado, M. (2014). The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting and Non-Normality. Author manuscript, 31 July 2014.','https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf'),
 ('R2','Gneiting, T., and Raftery, A. E. (2007). Strictly Proper Scoring Rules, Prediction, and Estimation. Journal of the American Statistical Association 102(477), 359-378.','https://doi.org/10.1198/016214506000001437'),
 ]:
 parts.append(p(label+'. '+text)+'#link('+q(url)+')[Primary source]\n\n')
for text in [
 'P1. web/lib/sections.ts; web/scripts/visible-copy-audit.mjs: registered workspace state space and view census.',
 'P2. web/lib/strategy-docs/{trend,momentum,reversion,breakout,model,index}.ts and exported strategy parameter catalogue: model rules and parameter semantics.',
 'P3. web/lib/portfolio-risk/{risk,covariance,contribution,var-validation,exceedance,stress}.ts: covariance risk, GBM reference, contribution and validation conventions.',
 'P4. web/lib/coherence/kelly-frontier.ts and diffusion-model.ts: terminal wealth replay and synthetic diffusion geometry.',
 'P5. modules/coherence/diffusion/skill.py: finite-window residence-time target, precision weights and held-out study mechanics.',
 'P6. web/tests/{focus-browser-interaction,coherence-interaction-layout-stability,workspace-refresh-bootstrap,header-browser-containment,responsive-header-and-density-followup}.test.ts: executed browser assertions.',
 'P7. Embedded source-controls.json: exact file/line bindings for the native controls, interactive primitives and event listeners. Prefix all web and modules paths above with Part2_Infrastructure/.',
 ]:parts.append(p(text))

(WP/'sections/08-research-protocol.typ').write_text(''.join(parts).rstrip()+'\n')
print('Research chapter: 70 feature methods, 46 strategy models, verification report and the attached audit evidence.')
