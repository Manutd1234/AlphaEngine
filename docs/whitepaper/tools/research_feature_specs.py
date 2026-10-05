"""Authored section-level research questions, methods, controls and interpretation."""
S={}
def add(route,question,method,controls,limits):S[route]=(question,method,controls,limits)
add('overview/loop','Is the proposed research-to-order decision supported by the same evidence at each stage?',
'Treat the dashboard as a directed decision graph: data produces a candidate, the candidate produces an order intent, and the portfolio and risk boundary constrain whether it may proceed. The displayed equity, tail loss and binding limit are projections of shared state, not independently estimated observations.',
'Review verdict opens Research. Each pipeline stage opens its corresponding workspace; Next step advances the decision loop. A failed research verdict must remain visible after navigation rather than being replaced by the health of the data provider.',
'An available provider does not validate a strategy. An unreachable gateway leaves position-dependent quantities unknown. The overview supports triage; it is not a performance estimator or investment recommendation.')
add('overview/desks','Which analytical role owns the next unresolved question?',
'The seven role launchers map research, execution, portfolio, risk, data, reliability and engineering to the same underlying state. Role selection changes the question being presented, not the underlying observations or authority to trade.',
'Activate a role card to open the named workspace. Header tabs and keyboard shortcuts provide alternate routes to the same destination; these paths should preserve the current instrument.',
'Role cards are navigation, not permission grants. Guest and authenticated capabilities still depend on the explicit route and operator guard.')
add('overview/audit','Can a paper decision be traced to an observed event?',
'The audit trail reads the gateway ledger. Order identifiers and recorded decisions support temporal reconstruction; the absence of a reachable ledger must not be represented as an observed count of zero trades.',
'Inspect the available audit rows and follow the Blotter handoff for execution details. Expand scope/context disclosures to distinguish local browser context from gateway history.',
'An append-only event record supports accountability, not by itself economic correctness. Offline capture cannot establish that a displayed historical event is complete or that the deployed ledger is currently reachable.')
add('research/summary','Does the selected strategy survive selection-aware statistical scrutiny?',
'The result combines a lagged, cost-adjusted return path with a reproducibility capsule and a search-adjusted verdict. Annualised Sharpe is descriptive; PSR/DSR, minimum track record and out-of-sample performance address different statistical questions. All must refer to the same bars, parameters and cost assumptions.',
'Results/Setup switches between evidence and inputs. Choose symbol, interval, strategy and parameters; Auto recomputes, while Run now explicitly records an experiment. Core parameters and Adjustments expose different assumptions. Pin/record state prevents duplicate history entries.',
'The displayed winner is selected from a search, so its raw Sharpe is biased upward. A FAIL is a substantive output. Neither the run time nor a positive equity curve demonstrates generalisation; source identity and search breadth must accompany any quoted metric.')
add('research/parameters','Is performance stable around the selected parameter pair?',
'Each heatmap cell represents a complete strategy evaluation at a fast/slow pair, subject to model-specific parameter semantics and the finite combination budget. Ranking the grid and inspecting neighbouring cells distinguishes a plateau from an isolated optimum without redefining the search after seeing the answer.',
'Click a cell or use the keyboard to inspect its exact parameter pair and statistics. Change the ranges and step sizes in Setup to define a new hypothesis family. Record the new search rather than comparing cells from mismatched grids.',
'A smooth parameter surface is not an out-of-sample test. Nearby cells share most observations and trades, so cell count is not a count of independent experiments. Fractional threshold axes must not be interpreted as lookback periods.')
add('research/walkforward','Does a rule selected on past data retain performance on later observations?',
'The implementation partitions the series into chronological training/test windows, selects parameters using training observations and reports the subsequent test result. Embargo and minimum-window guards prevent invalid folds. Out-of-sample rank compares the training-selected candidate with the alternatives on the held-out interval.',
'Inspect each fold, selected parameters, sample size and test metrics. Use Setup to alter fold count or embargo, then rerun the entire experiment. Compare fold stability rather than reporting only the aggregate winner.',
'Repeatedly changing folds after reading their outcomes constitutes another search. Purging addresses information overlap; it does not remove regime changes or make adjacent return observations independent.')
add('research/attribution','Which exposures and market states explain the observed return?',
'Factor regressions, regime cuts and tail views decompose the same strategy path. Estimated coefficients associate returns with explanatory series; residual return is not automatically causal alpha. Attribution uses finite aligned samples, so every estimate inherits the input window and cost convention.',
'Select factor/regime/tail views and inspect marks for exact values. Preserve the current symbol and experiment when comparing sections. Recompute after changing execution costs to see whether the apparent contribution survives netting.',
'Collinear factors make coefficients unstable, and ordinary least-squares errors do not automatically handle heteroskedasticity or serial dependence. A regime label assigned with future information would invalidate a predictive interpretation.')
add('research/lineage','Can the result be reproduced from its original observations and transformations?',
'Lineage links raw venue bars, validation, caching, signal generation and the decision path. Dataset hashes identify content; source labels identify provenance. Retrieval from desk memory is a separate evidence query and should distinguish unavailable search from a successful search with no matches.',
'Inspect pipeline nodes, dataset identity and evidence disclosures; use research-memory search when the backing service is configured. Follow related workspace or source references to inspect the observation underlying a result.',
'A hash detects differences, not correctness. A matching hash cannot establish that the vendor timestamp, adjustment policy or corporate-action treatment is economically appropriate.')
add('research/decision','Should a candidate advance to a sized paper-order proposal?',
'Promotion is a conjunction of veto conditions rather than a weighted score that lets strength on one dimension cancel a failed control. Sizing is constrained by the estimated drawdown and the documented fractional/capped Kelly rule. It is a proposal conditional on the selected experiment.',
'Inspect each veto, its threshold and reason. Adjust assumptions by returning to Setup; Promote becomes actionable only when the required gate clears. Follow sizing into Execution with the instrument and candidate context intact.',
'Passing a statistical gate is necessary for this workflow, not evidence of future profitability. Estimation error in win probability and payoff ratio can dominate the optimal-size calculation.')
add('research/runs','What hypotheses did the researcher actually record?',
'The run archive records explicit browser experiments, deduplicates repeats and preserves the inputs and data identity needed to revisit results. Auto-refresh is intentionally different from recording a hypothesis. This distinction avoids interpreting slider movements as independent trials.',
'Inspect, restore, compare or export available runs; clearing removes this browser history rather than altering the underlying market or gateway audit ledger. Selecting a past run must restore its context or state clearly what cannot be reconstructed.',
'A browser log is not a tamper-evident preregistration system and can omit attempts made elsewhere. The true multiple-testing burden may exceed the visible archive.')
add('research/fitted','How does supervised estimation perform under chronological validation?',
'Fitted-model jobs use gateway-side training and report fold-level out-of-sample predictions. Model fitting is distinct from choosing a deterministic technical rule: coefficients are estimated and the information boundary is the training split. The result contract should carry held-out metrics and job state.',
'Choose the supported training specification, submit Fit only when the gateway is available, and inspect job progress, fold evidence and recorded fitted runs. Revisit a completed run rather than mistaking a queued job for a result.',
'The offline screenshots do not demonstrate a live fit. A successful job proves execution, not freedom from leakage; preprocessing, labels and feature windows must obey the same time boundary as training.')
add('research/codex','Which signal hypothesis is appropriate to test, and what market condition defeats it?',
'The catalogue contains 46 source-defined strategies in seven families. Each entry specifies its actual signal rule, two parameter meanings, intended regime and failure regime. The detailed strategy catalogue in this chapter reproduces those definitions as design hypotheses.',
'Select a card or model option to load it into Summary. Search/browse families and compare related rules. Explored-state chips are derived from this browser history and must regress if that history is cleared.',
'A model being available or previously explored does not validate it. Closely related indicators often express the same economic hypothesis and should not be counted as independent evidence.')
add('live/trade','Will a proposed paper order satisfy the pre-trade constraints at the quoted size?',
'The ticket passes an order intent through named risk gates, then accounts for a paper fill only on a supported executable path. Gate results depend on side, notional, book freshness, available depth, rate limits and current book state. The gateway defines 17 gates, of which 15 are reachable on the normal crypto path.',
'Choose instrument, Buy/Sell, Market/Limit, notional and limit price where applicable. Presets expose valid-size, oversized and burst cases. Submit sends a paper intent; it is not a live brokerage order. Read the individual rejection reason rather than inferring failure from colour.',
'Three deployed-UI paper submissions were accepted during the live recapture. A simulated fill cannot prove a venue would have accepted the order or that queue priority and partial fills were modelled.')
add('live/liquidity','What executable depth is present on each side of the consolidated book?',
'For a chosen order side and quantity, cumulative level sizes determine whether enough displayed liquidity exists and which prices would be consumed. Consolidation preserves venue attribution; a crossed or stale book is a data-quality event, not automatically an executable opportunity.',
'Inspect bid/ask ladders, choose a symbol and select a price level to stage a limit order on Trade. Hover/focus depth marks for exact price and size. Refresh requests an observation; it does not manufacture depth.',
'L2 snapshots do not identify hidden liquidity, queue position or the fills available after network delay. A visually narrow spread can coexist with inadequate depth.')
add('live/routing','What is the cost of executing the same intent across venues?',
'Routing compares depth-weighted executable prices and the configured fee/impact assumptions. A volume-weighted fill benchmark differs from the midprice: the comparison must use the same side, quantity and contemporaneous book across alternatives. The cost model is evaluated before risk-gated paper execution.',
'Change the proposal size and available routing choices, inspect venue allocations and the cost decomposition, and follow the resulting intent back to the ticket. The selected quote and quantity should remain coherent across the charts.',
'A lowest-cost snapshot is not a guaranteed future fill. The site does not become an Almgren-Chriss scheduling engine merely because it displays an execution-cost model; the original methods chapter distinguishes implemented impact arithmetic from an unbuilt scheduler.')
add('live/quality','Did observed paper execution cost agree with the model?',
'Fill quality compares realised paper cost with the prediction attached to the order, preserving the same benchmark and sign convention. Differences can reflect depth changes, stale inputs or model misspecification. Aggregation should retain observation count and the time window.',
'Inspect available fill rows, venue or cost views and exact chart readings. Compare the realised-versus-predicted pair for the same order identifier instead of comparing unrelated aggregate means.',
'No fill means no residual to measure. A blank or unavailable panel is not evidence of zero slippage or a perfectly calibrated model.')
add('live/activity','Can orders, decisions and alerts be reconciled?',
'The blotter ties order states and gate decisions to the event tape. Status, timestamps and identifiers support reconciliation with the portfolio. Alerts report observed conditions; they are not a substitute for a state transition recorded by the gateway.',
'Filter or inspect visible rows, open decision details and use available order actions only within the paper gateway. Follow instrument and order links into the relevant analytic view.',
'An event arriving later than its related snapshot can create a temporary display mismatch. Reconciliation requires identifiers and time ordering, not just row counts.')
add('portfolio/overview','Is the book within its exposure and risk budget?',
'Positions, equity, gross/net exposure and limit headroom are computed from one book snapshot. The overview combines the state of the book with the availability of a covariance model, preserving unknown estimates when the aligned history is insufficient.',
'Choose Live or explicit Sandbox, switch Standing/Book and follow alerts into allocation or risk detail. Refresh is meaningful only for a reachable data source.',
'Sandbox values are generated. Mixing them with a live research return must not be presented as a measured portfolio track record.')
add('portfolio/equity','Where did the session change in wealth come from?',
'Equity is evaluated against the start-of-day mark and drawdown boundary. A P&L waterfall decomposes the session rather than independently estimating terminal wealth. Signed changes must reconcile to the same total before percentages are interpreted.',
'Inspect points on the equity curve and components of the P&L attribution. Use the time/series controls exposed by the current view; preserve source and observation timestamps when exporting a reading.',
'A short session curve is not a strategy backtest. Deposits, mark changes and generated sandbox transitions must not be mistaken for trading return.')
add('portfolio/positions','Which holdings create exposure and exit difficulty?',
'Holdings expresses quantities and signed notionals; Shape presents concentration and covariance-sensitive structure; Exit relates the same book to an execution proposal. Portfolio risk weights use signed notional divided by equity, preserving leverage rather than normalising it away.',
'Switch Holdings/Shape/Exit, inspect individual symbols, and follow Research or Execution links with symbol context. A proposed exit is staged and still requires the execution and risk boundaries.',
'A large notional share need not be the largest risk contribution; hedges may contribute negatively to marginal volatility. Exit estimates require current depth and do not establish a fill.')
add('portfolio/allocation','How far is the current composition from a chosen target?',
'Mix describes the observed allocation, Targets describes the chosen objective, and Composition explains the breakdown. Rebalance differences are signed target-minus-current notionals. Their interpretation depends on the capital base, permitted instruments and the currently estimated risk model.',
'Change target controls and inspect implied changes before following a rebalance handoff. Switching views does not execute the allocation.',
'Target weights are decisions, not forecasts. A visually balanced capital allocation can be concentrated in risk when volatilities or correlations differ.')
add('portfolio/performance','Which sleeve and cost component account for the observed performance?',
'Attribution separates sleeve contributions and execution costs, with session history distinguished from static cross-sections. Return, currency P&L and basis-point cost have different denominators and should not be combined without an explicit conversion.',
'Select the available attribution and trend views, inspect a component and compare its contribution with the displayed total. Reconcile the period and book source before comparing screens.',
'Historical contribution does not estimate the marginal return of adding capital. Costs from paper fills remain model-dependent.')
add('risk/limits','Which constraint binds, and how much headroom remains?',
'For a positive limit L and utilisation U, headroom is L-U and utilisation ratio is U/L. The control surface compares multiple constraints but reports their meanings separately: notional, exposure, loss, drawdown and event-rate limits are not interchangeable risk units.',
'Inspect the binding constraint and concentration detail. Expand definitions to check units and scope; use the operator controls only through their guarded handoff.',
'An inactive limit does not imply a safe book if its input is unknown. A threshold is a policy setting, not a statistical confidence interval.')
add('risk/model','What loss distribution is implied by the current exposure and estimated covariance?',
'Portfolio volatility is sqrt(w transpose Sigma w), with weights relative to equity. The implementation uses one-sided normal multipliers for parametric VaR and normal expected shortfall, and separately replays historical observations where available. Model validation is reported beside the estimate.',
'Inspect parametric and historical readings, confidence labels and observation counts. Switch book source explicitly and investigate disagreement in Risk drivers and Risk diagram.',
'Normal VaR omits fat tails and changing dependence. Historical VaR cannot represent unobserved regimes. Neither is a maximum possible loss.')
add('risk/diagram','Did realised losses exceed the forecast at the expected frequency?',
'The forecast-versus-realised series aligns each risk forecast to the outcome it predicts and identifies exceedances. A coverage statistic evaluates the count under a binomial reference model; independence and clustering are additional questions. The screen withholds results below its minimum aligned-history floor.',
'Inspect forecast and realised points, exceedance marks and the validation window. A point-selection readout should use the same date on every linked representation.',
'An acceptable exception count can hide clustered failures. The absence of enough observations is a refusal to estimate, not successful backtesting.')
add('risk/drivers','Which positions account for total volatility and diversification?',
'Euler component risk is w_i (Sigma w)_i / sigma_p, which sums to portfolio volatility under the homogeneous model. The correlation matrix complements this decomposition by showing pairwise dependence. Negative component risk is possible for a hedge.',
'Inspect a contribution bar, position row or correlation cell for exact values and the aligned sample. Compare notional share with risk share to identify concentrations hidden by capital weights.',
'Estimated correlations are noisy and regime-sensitive. Euler contributions are local to the current covariance and portfolio; they do not predict the effect of a large nonlinear trade.')
add('risk/montecarlo','What terminal outcomes follow from resampling the selected return process?',
'The browser worker builds terminal wealth paths using the documented bootstrap and forward horizon. Quantile loss and expected shortfall are computed from the simulated distribution. A fixed seed supports reproducibility; more paths reduce simulation noise but do not fix a misspecified return sample.',
'Change horizon, path count and seed, inspect histogram/tail marks and compare with the research winner that supplied returns. The shared horizon also updates Oracle VaR; no Oracle execution is needed for the local bootstrap.',
'Terminal loss is not pathwise maximum drawdown. Reusing the winner after selection carries selection bias into the simulation. Degenerate or insufficient return histories must remain explicitly labelled.')
add('risk/oraclevar','Does an in-database GBM simulation agree with its own analytic terminal quantile?',
'The procedure models terminal equity as E0 exp((mu-sigma squared/2)T + sigma sqrt(T)Z), with T=days/365. Its 99% loss is compared with the matching lognormal 1st-percentile formula, not a zero-drift normal approximation. Path count controls Monte Carlo error.',
'Set the shared horizon and inspect requested parameters, simulation output, closed-form comparator and freshness/cadence evidence. The live recapture confirms database responses. Small exposure can yield zero floored GBM loss; supplemental Sandbox inputs provide a separate higher-exposure example.',
'GBM assumes constant drift/volatility and lognormal terminal values. Agreement with the formula validates implementation under those assumptions, not suitability for jump risk or empirical tails.')
add('risk/scenarios','How much damage would an explicitly chosen forward shock cause?',
'A scenario reprices the current linear book under symbol or factor shocks and aggregates signed P&L. Hand shocks and named presets are conditional experiments rather than probabilities. The current holdings and shock magnitudes define the result.',
'Choose the named scenario or Hand shocks, move the shock controls and read the propagated damage. No shock should produce the neutral reference, subject to displayed rounding.',
'The result omits any convexity or liquidity effect not present in the implemented repricer. A severe scenario is not automatically a calibrated tail quantile.')
add('risk/controls','What actions can change the desk risk state?',
'Halt, reduce-only and flatten are operational state transitions, not estimators. A halt prevents the allowed new-risk path; flatten proposes liquidation of positions and therefore needs executable quotes, authority and accounting. The UI separates a handoff from completed execution.',
'Open emergency actions, read the confirmation and scope, then issue an action only when the guarded backend is available. Merely opening the header Kill panel does not halt the desk.',
'The capture did not execute destructive risk mutations. The source and offline gate tests establish the control contract; they do not establish current remote availability.')
add('data/overview','What is the reliability of the evidence used by the quantitative workflow?',
'Trust Summary combines freshness, validation, lineage and supply depth. Verdict, Response and Composition are views over the same measurement scope. Per-instance counters must remain distinct from a gateway-merged fleet ledger.',
'Switch the three panes, inspect freshness/contract marks and use the section handoffs for the observation requiring attention. Refresh evidence updates the sample rather than resetting its meaning.',
'A provider configured with credentials is not necessarily a fresh successful observation. Availability of the supply chain does not validate the statistical model consuming it.')
add('data/feeds','Which feeds satisfy freshness and schema requirements?',
'Freshness compares observation age with the capability-specific budget, while contract validation checks shape and permitted values. The two are orthogonal: a fresh payload may be invalid and a valid payload may be stale.',
'Switch freshness and contract panes, inspect each source and use its next-action link. Read reconnect and throughput counters in their stated observation scope.',
'Polling snapshots can miss transient failures. A successful schema check does not detect every economic error, such as a wrong adjustment convention.')
add('data/quality','Which observed payload discrepancies require investigation?',
'Reconciliation compares sources under an explicit tolerance and records findings in the data-quality ledger. Contract failures, mismatches and unresolved checks must remain distinguishable. Escalation is a workflow change tied to a finding, not a statistical correction.',
'Inspect reconciliation results and issue details; filter or expand ledger evidence and use escalation controls only with the required operator access.',
'Different venues may legitimately disagree because timestamps, instruments or conventions differ. A mismatch is evidence to investigate, not proof that one vendor is false.')
add('data/incidents','Which interruptions affected supply, and what responses were quarantined?',
'Incident state combines observed failure windows with explicitly simulated outages. Quarantine retains rejected evidence for diagnosis rather than allowing malformed values into downstream calculations. Recovery state names the condition that re-admits a source.',
'Inspect incident and quarantine rows, available payload explanations and recovery controls. Simulated outage actions are guarded and must remain labelled simulated.',
'An injected outage validates a response path but is not an observed production incident. A cleared incident is not proof that historical downstream results were repaired.')
add('data/lineage','How did vendor bytes become the value on screen?',
'Provider selection, cache state, schema coercion and request timing form a transformation trace. Replay re-evaluates a capability through the validated route; backfill adds a specified historical range subject to contract checks. Each has a distinct scope and persistence effect.',
'Select capability and symbol, inspect REST or WebSocket evidence, expand payloads, and define replay/backfill ranges when permitted. Do not confuse viewing a trace with submitting a new job.',
'Replayed observations can differ from the original because vendor revisions, adjustments or cache epochs changed. Preserve both content identity and observation time.')
add('data/providers','How resilient is the configured supply chain to failure or quota exhaustion?',
'Provider routing maps capabilities to ranked alternatives. Quota headroom reflects the application ledger, while supply depth counts routable alternatives. Neither is a direct read of the vendor billing meter. Budget and Routing answer different questions.',
'Switch capability and Routing/Budget, inspect the failover order and headroom, and read the scope disclosure before interpreting counters. Provider controls affect only the documented local/server state.',
'Multiple providers can share an upstream dependency and therefore not be independent. Resetting an application quota ledger cannot reset a vendor invoice or entitlement.')
add('data/queue','How is a data defect turned into a trackable remediation task?',
'Requests, tickets and bugs carry priority, status, ownership and versioned persistence. Updates use the row version to detect concurrent edits. The source badge distinguishes durable gateway state from edits held locally while transport is unavailable.',
'Open New work, enter the required fields, choose type/priority/area and submit; then filter, sort or change status. Delete follows the implemented confirmation and version/authentication rules.',
'A locally held edit is not durable backend confirmation. Work-item completion records a workflow decision, not independent proof that the affected dataset is now valid.')
add('reliability/overview','Where is the first observed break in the decision-support system?',
'Triage combines dependency state with service-level indicators. Decision latency, compiled-core duration and provider-network latency are separate populations in different units. Quantiles need sufficient samples and an explicit window.',
'Inspect the attention item, refresh evidence and follow incident or latency drilldowns. Expand sample and scope definitions before comparing a percentile with a budget.',
'A p99 of too few observations is not a stable tail estimate. Current health is not an uptime percentage, and unknown downstream health behind a failed transport is not a measured component outage.')
add('reliability/planes','How far does a failure propagate through the dependency graph?',
'The tree and live DAG represent dependencies among browser, web, gateway, providers and storage. Composition counts states under the same observation boundary. Provider, Platform and Latency views separate dependency structure from timing evidence.',
'Select a plane/node and inspect the dependent services or source facts. Preserve unknown states when the transport is down instead of converting all downstream nodes to failed.',
'The dependency graph encodes the implemented topology, not a statistical estimate of correlated failure probabilities.')
add('reliability/services','Which circuits and venue paths are currently usable?',
'Provider circuit breakers move among closed, open and half-open according to failure and recovery rules. Venue health and failover are observed separately. A half-open probe is controlled evidence for recovery, not a restored-service guarantee.',
'Inspect service rows, circuit timelines and venue evidence. Test, simulate and reset controls have different scopes and require their stated guard; simulation should expire rather than masquerade as permanent health.',
'Closing a circuit does not fix the upstream cause. A test request can itself consume quota, so it is distinct from a display-only inspection.')
add('reliability/events','What sequence of observations explains an incident?',
'Logs and traces are ordered evidence about requests, providers and state transitions. Severity filters alter the view, not the underlying event set. Cross-origin timing requires attention to clock and transport boundaries.',
'Filter by severity or request context, select a trace and inspect timeline stages or payload details. Copy identifiers for a reproducible investigation.',
'Log absence can mean a sampling or observability gap. It cannot establish that no request or error occurred.')
add('reliability/controls','What precisely will an operator action affect?',
'Remediation separates server mutations from browser-session controls and reference scope diagrams. The mutation/store map identifies what is cleared, re-read, unchanged or outside reach. Recovery and History expose the breaker lifecycle rather than modifying it.',
'Switch Mutations, Scope, Session, Recovery and History. Read the token/confirmation boundary before purge, restore, reload, quota reset or telemetry clear. Local polling/socket controls affect only this browser session.',
'An application quota reset does not reduce vendor billing. Clearing telemetry removes evidence and changes the measurement window; it does not make the service faster.')
add('developer/overview','What are the runtime and ownership boundaries of the system?',
'Topology links the client, serverless web tier, gateway and data stores, exposing where a request is evaluated and where authoritative state resides. This is essential to interpret a UI that mixes local simulations with remote observations.',
'Inspect runtime nodes and context disclosures, then follow readiness, API or code links. Treat the deployed revision and local source revision as separate evidence identities.',
'A source diagram is not proof that the current deployment matches it. The capture records the revision mismatch explicitly.')
add('developer/readiness','What evidence is required before a release can be considered ready?',
'Launch gates combine configuration, schema, contract and artifact checks. Readiness is a conjunction of prerequisites, while test success concerns a particular build and environment. Unknown checks must remain unknown.',
'Inspect each gate, artifact and explanation; follow the relevant remediation link. A disabled or missing capability requires its own evidence rather than a generic all-green badge.',
'A locally passing test suite cannot demonstrate production credentials, database schema or remote availability.')
add('developer/quality','Which reproducible checks defend the implementation?',
'CI/CD presents offline suites, build checks and delivery artifacts. Counts are generated measurements with dates. The whitepaper adds a new verification record rather than silently treating historical numbers as current.',
'Switch pipeline and verification views; inspect the named test boundary and artifact. The Oracle-connected GitHub workflows are disabled for cost control and must not be shown as newly executed.',
'Passing tests demonstrate only the assertions and inputs actually exercised. Structural source tests, numerical parity tests and browser interaction tests are different kinds of evidence.')
add('developer/apis','Does the running interface match its contracts and numerical reference?',
'Contracts tracks the schema-to-export-to-digest custody chain. Routes enumerates operations and request shapes. Numerics recomputes a deterministic Monte Carlo reference and compares canonical data rather than visual similarity. Canonical JSON hashes differ from hashes of formatted source files.',
'Switch Contracts/Routes/Numerics, select a route, inspect or copy its curl example, and invoke the supported local verifier. Read not-run and unavailable states as such.',
'A matching digest proves content agreement under the canonicaliser, not semantic correctness of every endpoint. A server response is needed to verify the deployed contract.')
add('developer/codebase','Can a displayed implementation claim be traced to a versioned file?',
'The repository manifest indexes paths and change custody. Search and diffs expose provenance of the application rather than executing code. A file list and commit identifier make a result reviewable only if they refer to the same source snapshot.',
'Search paths, select files and inspect diff/custody views. Follow source references from the feature register to the exact component or numerical module.',
'The screenshot deployment and local source differ. The document therefore reports each independently and does not assert that an unpushed local file is deployed.')
add('developer/work','How does an engineering change progress through local review?',
'The engineering queue is browser-persisted state with type, priority, owner, area and workflow status. It is distinct from the gateway-persisted Data queue. A fresh browser intentionally starts empty, which the repaired browser test now respects.',
'New work opens a form; Add to triage creates the item. Search/type/status filters restrict rows; the row select advances status. Delete is a two-step action. Local reload should preserve accepted items when browser storage is available.',
'Closed in this browser is not a GitHub issue closure or deployed change. This queue has no authority to publish code or prove acceptance criteria were met.')
add('markets/universe','Do a family of quoted outcomes span one economically complete payoff?',
'Basket pricing sums executable sides across a mutually exclusive/exhaustive family against its known terminal dollar. Positions relates exposure to that family; Families groups markets using venue metadata rather than ticker-prefix guesses.',
'Select family, basket direction and subview, then inspect exact market prices and missing-side states. Related lattice and proof views use the selected family context.',
'Completeness is a structural premise. Missing outcomes, missing asks/bids, insufficient depth and stale snapshots prevent the quoted sum from being treated as an executable locked-in return.')
add('markets/settlement','What observation does the contract actually settle against?',
'The settlement index, its formation chain and provisional pending readings are distinct objects. A contract based on a windowed mean cannot be valued as if it settled on the latest point. Station disagreement is an uncertainty cue in the provisional reading.',
'Switch Index/Formation/Pending, inspect the time window or selected station/readout, and compare the published value with the provisional construction.',
'The screen is an explanation of the venue rule and observed index, not an independent adjudication of settlement. A provisional estimate is not the final contractual outcome.')
add('markets/books','How are complementary contract ladders related?',
'Binary complementarity gives implied asks from the opposing bid: ask_yes=1-bid_no and ask_no=1-bid_yes. Hence the two implied asks sum to one plus the YES spread. History selects recorded snapshots without inventing observations between them.',
'Switch Ladder/Identity/History. Inspect a level, choose a market and scrub the exact recorded observation where available. Selected marks and numerical readouts should agree.',
'An implied offer is an arithmetic relation, not evidence of queue priority or future execution. Historical gaps must remain gaps.')
add('markets/dispersion','Does maker disagreement differ from each maker\'s own spread?',
'Dispersion compares quoted maker centres and widths; REST poll exposes the authenticated request outcome. Cross-maker disagreement and within-maker bid/ask width measure different uncertainty and liquidity dimensions.',
'Switch Dispersion/REST poll and inspect available maker or request facts. A private-channel refusal should remain a policy state, distinct from an empty successful response or transport failure.',
'Maker quotes may not be simultaneous or comparable in size. A narrow dispersion does not demonstrate price discovery or trading profitability.')
add('markets/lattice','What probability measure is compatible with a structured strike ladder?',
'For ordered threshold contracts, survival differences imply adjacent probability mass. A valid distribution requires monotonic survival and nonnegative mass. Numerical moments need a meaningful numeric support; named outcomes provide categorical probabilities, while unrelated binaries do not define a joint distribution.',
'Switch Survival/Mass/Moment shape/Moment support, select a strike or mass component and inspect exact support and withheld-output reasons.',
'Tail support assumptions materially affect moments. The interface must not manufacture a numeric mean for categorical labels or normalise unrelated binaries into a false partition.')
add('markets/stake','What allocation maximises a stated log-growth objective without hiding worst-case wealth?',
'The frontier replays terminal wealth per outcome: cash equals one minus invested fractions and winning wealth adds fraction/price. Expected log wealth weights the state wealths by assumed probabilities. The worst state and reserved cash are displayed beside growth.',
'Switch Plan/Capital/Method/All outcomes and adjust the available bankroll/scale controls. Inspect declined outcomes and the binding capital or feasibility condition.',
'This is a sizing calculation with no executor. Estimated probabilities and dependence are model inputs; a log-optimal allocation may still suffer a large realised loss.')
add('markets/fees','How much of an apparent edge survives the implemented fee convention?',
'The worked example separates fee components and their rounding; cost shape changes with price and size. Ablation replays the same recorded observations under alternative cost assumptions, while Replay table preserves the individual rows.',
'Change the example inputs, select receipt components and cost-model configurations, and inspect the per-observation replay. Compare configurations on the same tape and observation set.',
'A replay shows what a model would have detected, not realised P&L. Venue fees can change; the source implementation and capture date define this edition, not an assertion of permanent exchange pricing.')
add('markets/shell','Where does a selected market and its derived evidence live in the namespace?',
'The filesystem lens maps exchange families and markets into a bounded hierarchy, separates shard routing from directory listing and preserves the distinction between missing, empty, unavailable and unreachable.',
'Switch Namespace/Routing/Browse, select a directory or file and inspect the corresponding listing or tape. Path selection changes the evidence being read; it does not write to the exchange.',
'A namespace is a representation of the data model. File-like appearance does not imply a complete local archive or unrestricted access to every venue resource.')
add('coherence/certificate','Do the quoted claims admit a common probability assignment?',
'The conceptual feasibility condition is q>=0, sum(q)=1 with quoted bounds on state payoffs. The implemented certificate states its actual price basis, interval/family structure and tested rows. Per-book and structural slack views have different denominators and must not be conflated.',
'Switch Verdict/Proof/Checks/Prices/Sizes, select a constraint or checkpoint and inspect exact slack and the supporting prices/quantities.',
'Feasibility means no contradiction was found under the stated constraints. It does not imply that the probabilities are true or that a missing price was measured as zero.')
add('coherence/portfolio','What constructive portfolio explains an infeasible set of claims?',
'The dual certificate describes a basket whose statewise payoff demonstrates the contradiction under the model. Cover, Basket and Size make payoff coverage, legs, executable depth and fees separately inspectable.',
'Switch the three views; select a state, leg or quantity and reconcile its payoff with the certificate total. Inspect the coherent zero-leg case as a valid result.',
'A mathematical certificate depends on simultaneous executable inputs and the fee model. The UI has no trade executor, and a displayed basket is not an instruction that has been sent.')
add('coherence/combos','Is a quoted conjunction compatible with its marginal probabilities?',
'For two events with marginals p and q, Frechet bounds are max(0,p+q-1)<=P(A and B)<=min(p,q). The interval encodes unidentified dependence; it is not centred on a privileged fair price. Bounds, leg prices and proposed quantities must be assessed together.',
'Switch Ranges/Test quote/Leg prices/Test legs/Checks, change the available local test inputs and inspect which bound determines the conclusion.',
'A quote inside the range is consistent with some dependence, not necessarily correctly priced. Multiplying marginals adds an independence assumption the venue has not quoted.')
add('coherence/index','How far is the current quote vector from the model\'s coherent set?',
'The index records a distance from contemporaneous quotes to a feasible probability representation, by poll and by family. It concerns unsettled prices, unlike the settled-outcome Brier score.',
'Switch By poll/By family and select an observation or family. Read unmeasurable polls as gaps and preserve the observation time and quote basis.',
'Distance depends on the norm, constraints and quote coverage. It is not a realised arbitrage return, probability of profit or forecast accuracy score.')
add('coherence/calibration','Were probabilities informative before their outcomes became known?',
'The Brier score averages squared probability error. The Murphy decomposition distinguishes reliability, resolution and outcome uncertainty. Calibration cells and bands show conditional observed frequencies, requiring sample sizes and the forecast-to-settlement horizon.',
'Switch Overview/Equation/Component scale/Measures/Reliability/Bands; select bins and inspect counts, probabilities and realised frequencies. Keep the engine and horizon caveat visible.',
'Prices observed at or near settlement can score almost perfectly without forecasting skill. Aggregation and coarse bins can mask subgroup miscalibration; uncertainty bands depend on the implemented estimator.')
add('coherence/corpus','Which settled observations make the reported score representative?',
'Composition measures which series contribute to the scoring population; Score trend records the statistic as the corpus accrues. A heavily concentrated series mixture can dominate an aggregate score even if the interface names the whole exchange.',
'Select a series or historical point, inspect counts and shares, and compare within-series results with the aggregate. Preserve unscorable observations as missing evidence.',
'A forward-recorded trend cannot be backdated to imply an archive that was never observed. Corpus selection and settlement availability create survivorship and coverage limitations.')
add('coherence/lessons','What claim does each visual proof establish, and what guards it in code?',
'The curriculum groups quotes, structure, bounds, record, coverage and episode states. Each lesson links a mathematical or data-contract claim to implementation and test provenance. Interactive marks are alternative views of the same exact values.',
'Select a lesson, inspect its diagram with pointer or keyboard, pin a reading and open explanatory/code/test disclosures. Focus enlarges the same figure; zoom and drag inspect it without changing the calculation.',
'An educational illustration is not an empirical finding. A cited test checks a specific invariant, not every data-dependent use of the theorem.')
add('diffusion/arm','How much of an event-related move was incorporated by each horizon?',
'Absorption compares the abnormal return at horizon h with its terminal move. Control compares the same construction with matched non-event windows; Clocks compares wall-clock ordering with a clock built from control-market activity. Overshoot is retained in the observed curve.',
'Switch Absorption/Control/Clocks; select stage, path eligibility or line visibility and inspect exact horizons. Filters change the local lens without fabricating new observations or reranking the underlying study.',
'A small terminal move makes the normalised ratio unstable. A fast curve must be compared with its control before being interpreted as rapid information incorporation.')
add('diffusion/meetings','Which event and stage contributed each measured path?',
'The ledger and calendar expose meeting-level sample membership, signal qualification and missing outcomes. Mechanism makes the stage-window assumptions explicit. Statement and conference rows from one meeting are not independent events.',
'Switch Meeting by meeting/Calendar/Mechanism, choose a meeting or qualification filter and compare stages using their own timestamps and terminal windows.',
'A refused stage can reflect an insufficient move rather than missing raw data. Treating repeated stages or assets as independent replicates understates uncertainty.')
add('diffusion/episodes','How long did a detected pricing inconsistency persist?',
'Episodes have observed start and closing events. The displayed lifetime summary uses the implemented closure rule and preserves unresolved episodes. Lifetime and survival descriptions must state whether open episodes are excluded rather than silently treating them as zero or completed.',
'Switch Survival/Episodes, inspect an episode and move the lifetime probe. Read the population count and open/closed state beside the selected result.',
'A survival curve over closed episodes is subject to closure selection and is not automatically a censoring-corrected population survival estimator. Detection cadence bounds timestamp resolution.')
add('diffusion/model','What does the estimator compute, and when does it refuse?',
'Measurement specifies absorbed fractions, signal/noise qualification, the first level crossing and fitted decay models. The crossing interpolates in log horizon; fit selection is based on residual error in unpriced-fraction space. Overshoots are not clipped out of the observed curve.',
'Inspect each formula card, input definition and failure condition. Expand the reference implementation and compare its units with the selected study view.',
'A fitted half-life is model-dependent and may not exist. Never-reached, before-first-observation and too-few-points are different scientific outcomes.')
add('diffusion/instrument','How are the measurement and information-resolution instrument connected?',
'The instrument separates the price-absorption clock from the explanatory text representation and its Gaussian information spectrum. The implementation retains covariance/eigenvalue scale; whitening would remove the resolution structure the spectrum is meant to describe.',
'Inspect instrument cards and the code/test lineage. Use Sandbox to perturb the mathematical inputs while preserving the distinction between a controlled example and measured event data.',
'An elegant mechanism does not establish explanatory or predictive power. The Findings comparison against a baseline is the empirical test.')
add('diffusion/sandbox','How do estimator outputs change under known controlled inputs?',
'Half-life constructs an absorption curve, Simulator varies signal/noise and shape, and Spectrum varies latent scales/relationships. These deterministic browser calculations are compared with the Python reference by parity fixtures.',
'Switch Half-life/Simulator/Spectrum and adjust bounded sliders. Inspect crossings, refusal states, signed lobes and exact-value readouts. Focus, zoom, pan and close should preserve the same chart instance and selection.',
'A synthetic example diagnoses arithmetic, geometry and sensitivity; it cannot validate that the assumed process generated the market. Finite grids limit crossing resolution.')
add('diffusion/findings','Does the text representation improve held-out prediction beyond a non-text baseline?',
'The study uses a residence-time target, precision weighting and pooled stage effects with policy-move controls. Leave-one-meeting-out evaluation holds both stages out together. Baseline and augmented out-of-sample loss, along with shuffled evidence and the full specification grid, are the basis for a claim.',
'Switch Effect plot/Findings table/Instrument, select a stage and vary displayed absolute-t and shuffled-p thresholds. Expand the selected run and its admissibility criteria; local threshold changes do not rerun the experiment.',
'Post-hoc display thresholds are exploratory. The finite-window, clipped residence-time implementation is not identically the infinite-horizon exponential time constant; horizons, sample selection and preregistered specifications must accompany the reported null or positive result.')
assert len(S)==70,len(S)
