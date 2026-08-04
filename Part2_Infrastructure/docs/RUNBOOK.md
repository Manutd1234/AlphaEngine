# AlphaEngine operations runbook

What to do when something breaks, written for the person on the other end of the
alert rather than for the person who wrote the code.

Every procedure here can be rehearsed against a local instance — the systems
console can simulate a provider outage, the risk controls can be exercised on a
paper book, and the synthetic-book fallback makes a total feed loss reproducible
offline. A runbook nobody has practised is a document, not a procedure.

**Where to look first, in order:**

| Question | Where |
|---|---|
| Is the process alive and what is it doing? | `GET /health` |
| What are the numbers doing over time? | `GET /metrics` (Prometheus text) |
| What did the system decide on its own? | Execution tab → Alerts, or `GET /api/audit/events` |
| What happened to a specific order? | Execution tab → Blotter, or `GET /api/audit/orders` |
| Is a data provider the problem? | Systems tab → Health matrix, failover graph, quarantine |

---

## Drawdown breaker tripped

**Alerts:** `AlphaEngineKillSwitchEngaged`, `AlphaEngineReduceOnly`
**Telegram:** the gateway pushes both without being asked.

The desk halts itself when the session drawdown reaches `MAX_DAILY_DRAWDOWN_PCT`
(default 5%). Before that, at `REDUCE_ONLY_THRESHOLD` (default 80% of the
budget), it goes reduce-only: closing orders pass, opening orders do not.

**Do not resume first.** The breaker did its job; the question is whether the
thing that caused the loss is still happening.

1. **Confirm what tripped it.** `/incidents` in Telegram, or the Alerts panel on
   the Execution tab. The audit row for `kill_switch_engaged` names the actor —
   `circuit-breaker` means automatic, anything else means a human.
2. **Check whether the loss is real or a bad mark.** A stale or crossed book
   marks positions wrong and can trip the breaker on a move that never happened.
   Cross-check `alphaengine_book_age_seconds` and the venue status pills. If the
   feed was stale, **fix the feed before resuming** — resuming into a bad mark
   trips the breaker again within seconds.
3. **Look at the positions, not just the P&L.** Portfolio tab, or `/positions`.
   Is the loss concentrated in one name? Is the book bigger than intended?
4. **Decide: reduce or resume.** While halted, `/flatten` still works and is the
   right answer when the exposure is what caused the problem.
5. **Resume with a reason.** `POST /api/risk/resume` with a `reason`, or
   `/resume` in Telegram (which requires a single-use confirmation code from the
   control allow-list). The reason lands in the audit log next to what tripped
   the halt, so the two read as one incident.

**Afterwards:** the drawdown budget does *not* reset on resume — it resets at the
UTC session roll. A desk resumed at 90% of budget is one bad trade from halting
again, and that is intentional.

---

## Venue feed down

**Alerts:** `AlphaEngineFeedDisconnected`, `AlphaEngineBookStale`,
`AlphaEngineSyntheticBookActive`, `AlphaEngineFeedFlapping`
**Telegram:** the feed watchdog pushes on the transition, once per state change.

1. **Distinguish disconnected from stale.** A disconnected socket is obvious. A
   *stale* book — socket up, no updates — is the dangerous one: every dashboard
   reads green while the prices stop moving. `alphaengine_book_age_seconds` is
   the number that tells them apart.
2. **Check whether it is one venue or all of them.** `/health` lists every feed
   with its own connection state and reconnect count. One venue down is a
   degraded router; all of them down brings up the synthetic book.
3. **If the synthetic book is active**, no price on any screen is a market
   price. Every payload is tagged `synthetic: true` and the UI labels it, so
   nothing is being passed off as real — but do not trade on it, and expect TCA
   numbers to be arithmetic about a simulation.
4. **Flapping (repeated reconnects)** usually means sequence gaps forcing
   resubscribes rather than a dead socket. Each gap is a window where the book
   was briefly wrong; if it persists, halt rather than trade through it.
5. **Recovery is automatic.** The watchdog restores the real feed and retires the
   synthetic book on its own, and pushes a recovery alert. No action needed.

**No action that helps:** restarting the gateway. The reconnect backoff already
runs; a restart loses the position book's in-memory state and rehydrates it from
the audit log, which is strictly more risk for no gain.

---

## Rejection spike

**Alert:** `AlphaEngineRejectionSpike`

Most orders are being refused. This is the pre-trade gates working; the question
is which gate and why.

1. **Name the gate.** Execution tab → Blotter → the "Most frequent block" line,
   or expand any rejected row for its full fourteen-check vector. Every rejection
   carries the number that tripped it.
2. **Read it as a sizing problem first.** `max_order_notional`,
   `symbol_concentration` and `gross_exposure` all mean the same thing: the size
   is wrong for the limit, not the limit wrong for the size. Changing a limit is
   a code change and a deploy, on purpose.
3. **`rate_limit` means a retry loop.** A strategy re-firing after a rejected ack
   is the classic cause, and the token bucket is what stops it becoming an
   exchange ban.
4. **`est_slippage` or `price_available` means the book, not the order.** Go to
   the feed procedure above.

---

## Gate latency

**Alert:** `AlphaEngineGateLatencyHigh`

The fourteen gates normally decide in well under a millisecond. Hundreds of
milliseconds means the decision is waiting on something it should not.

1. **Check the audit backend.** `/health` → `audit.backend`. A DuckDB store on a
   slow or full disk is the usual cause; the SQLite fallback is slower still.
2. **Check the job queue.** A backtest sweep saturating the worker pool competes
   for the event loop. `alphaengine_jobs{status="running"}` and the worker count
   are both exported.
3. **Compare `/metrics` route latencies.** If every route is slow the process is
   starved; if only `/api/orders` is slow, look at the audit write path.

---

## Job backlog

**Alerts:** `AlphaEngineJobQueueBacklog`, `AlphaEngineJobFailures`

Research jobs are queuing or failing. **This does not affect trading** — the
queue is deliberately isolated from the order path, and a saturated worker pool
cannot delay a risk decision.

1. **Check a failing job's error** at `GET /api/jobs/{id}` before assuming the
   engine is broken. The common cause is market data being unavailable for the
   requested window, which the job reports rather than silently substituting.
2. **Backlog with no failures** is capacity: raise `JOB_WORKERS`, or point
   `CELERY_BROKER_URL` at Redis to move execution out of process entirely.

---

## Provider degraded or quota exhausted

**Where:** Systems tab → Health matrix, failover graph, quota meters.

The research data plane is separate from the trading data plane: a failing
provider affects backtests and fundamentals, never the order book or the risk
gates.

1. **Read the failover graph.** It shows the ranked chain per capability and
   which node a request would actually land on, with the reason each skipped
   provider was skipped — including whether an operator knocked it out
   deliberately.
2. **Quota exhaustion is a budget, not a fault.** The ledger reserves headroom
   for interactive requests, so background work is refused first. That is the
   design working.
3. **Operator actions** (probe a provider, reset a breaker, purge a cache) are
   in the console and are all self-expiring or self-refilling. Nothing there can
   leave the deployment worse off after the tab closes.

## Data quality: quarantined payloads

**Where:** Systems tab → Quarantine.

Transport health and data health are different questions. A provider can answer
in 40ms, from a closed breaker, with a bar series that has a duplicated
timestamp and quietly halves the volatility a backtest measures.

* **`fatal`** — internally impossible (a high below its low, out-of-order bars).
  The payload was rejected and never cached; the chain failed over.
* **`warn`** — true but suspect (a quote stamped four days ago). Served and
  labelled, because a trader who can see the age can decide.
* **`drift`** — our *mapping* looks stale, not the market: a secondary field
  went null while everything around it stayed intact. Usually a renamed vendor
  field, and the fix is in the adapter, not the vendor.

---

## Gateway unreachable

**Alert:** `AlphaEngineGatewayDown`

1. **Check the process and the port.** The gateway is a single process; nothing
   in the web workspace or the Telegram companion can substitute for it.
2. **Expect it to come back trading.** Kill-switch state is deliberately *not*
   restored on restart: the audit log holds events, not a durable state
   snapshot, and inferring "halted" from an event history could pick the wrong
   side of a release race. If the desk should stay halted, halt it again
   immediately after restart.
3. **Positions are rebuilt from the audit log**, strictly and reset-aware. If
   rehydration cannot be done unambiguously the gateway refuses to start rather
   than starting with an understated book — an empty position list is the most
   dangerous possible wrong answer.

---

## Rehearsing this

| Incident | How to reproduce locally |
|---|---|
| Feed down | Start with `VENUES=SIM`, or disconnect the network — the watchdog brings up the synthetic book and alerts |
| Drawdown halt | Submit orders on the paper book until the budget is spent, or lower `MAX_DAILY_DRAWDOWN_PCT` |
| Reduce-only | Set `REDUCE_ONLY_THRESHOLD=0.1` and take a small loss |
| Rejection spike | The order ticket's "fat finger" and "rate-limit burst" presets |
| Provider outage | Systems tab → simulate an outage (self-expiring, bounded) |
| End-to-end check | `python tools/synthetic_probe.py` — walks book → cost → risk gate → audit |
