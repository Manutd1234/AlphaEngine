# AlphaEngine operations runbook

What to do when something breaks, written for the person on the other end of the
alert rather than for the person who wrote the code.

Every procedure here can be rehearsed against a local instance — the
Reliability console can simulate a provider outage, the risk controls can be
exercised on a paper book, and the synthetic-book fallback makes a total feed
loss reproducible offline. A runbook nobody has practised is a document, not a
procedure.

**Where to look first, in order:**

| Question | Where |
|---|---|
| Is the process alive and what is it doing? | `GET /health` |
| What are the numbers doing over time? | `GET /metrics` (Prometheus text) |
| What did the system decide on its own? | Execution tab → Blotter → Tape & alerts, or `GET /api/audit/events` |
| What happened to a specific order? | Execution tab → Blotter, or `GET /api/audit/orders` |
| Is a data provider the problem? | Reliability tab → Services & Circuits (health matrix); Data tab → Providers & Capacity (failover graph) and Incidents (quarantine) |

---

## Drawdown breaker tripped

**Alerts:** `AlphaEngineKillSwitchEngaged`, `AlphaEngineReduceOnly`
**Telegram:** the gateway pushes both without being asked.

The desk halts itself when the session drawdown reaches `MAX_DAILY_DRAWDOWN_PCT`
(default 5%). Before that, at `REDUCE_ONLY_THRESHOLD` (default 80% of the
budget), it goes reduce-only: closing orders pass, opening orders do not.

**Do not resume first.** The breaker did its job; the question is whether the
thing that caused the loss is still happening.

1. **Confirm what tripped it.** `/incidents` in Telegram, or the alert feed on
   Execution tab → Blotter → Tape & alerts. The audit row for
   `kill_switch_engaged` names the actor — `circuit-breaker` means automatic,
   anything else means a human.
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

1. **Name the gate.** Execution tab → Fill quality → Cost → the "Most frequent
   block" line, or expand any rejected row on Blotter for its full check
   vector. The vector lists the gates that *ran*, not a fixed-length row:
   fifteen of the seventeen can appear on a crypto order, and
   `paper_execution_model` and `reference_freshness` only on a paper-equity
   one. Every rejection carries the gate that tripped it.
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

The seventeen gates normally decide in tens of microseconds (the µs histogram
on `/metrics` is the evidence; the compiled core's nanosecond histogram sits
beside it and includes the 300-sample startup self-measure, counted separately
as `alphaengine_decision_core_self_test_samples`). Hundreds of milliseconds
means the decision is waiting on something it should not.

1. **Check the audit backend.** `/health` → `audit.backend`. A DuckDB store on a
   slow or full disk is the usual cause; the SQLite fallback is slower still.
2. **Check the job queue.** A backtest sweep saturating the worker pool competes
   for the event loop. `alphaengine_jobs{status="running"}` and the worker count
   are both exported.
3. **Compare `/metrics` route latencies.** If every route is slow the process is
   starved; if only `/api/orders` is slow, look at the audit write path.

---

## Job backlog

Two more job kinds share this queue since 2026-08-17: `data.replay` and
`data.backfill` (Data tab → Lineage & Payloads → Replay and backfill, or
`POST /api/data/replay` / `/api/data/backfill`). A succeeded job reads
"persisting…" until the gateway's completion hook has written the finding to
the quality ledger and, for a clean backfill, the bars to the cache; if it
never clears, read the gateway log for `persist failed`. `GET /api/data/jobs`
lists what the queue remembers; `GET /api/data/schedules` shows the configured
cadence and when each entry last fired (kept in `data_ops.sqlite`, so a
restart does not re-fire a daily job). A replay needs `WEB_WORKSPACE_URL`;
without it the route answers 503 and the panel says so.

### Backtests

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

**Where:** Reliability tab → Services & Circuits for the health matrix; Data
tab → Providers & Capacity, whose Routing pane draws the failover graph and
whose Budget pane holds the quota meters.

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

**Where:** Data tab → Incidents → Quarantine.

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

The aggregate counts on the Data tab come from the gateway's ledger, not the
instance you happen to be talking to: every web instance pushes its findings
through the ops sync and the gateway keeps them in `data_ops.sqlite` on the
data volume for `DATA_QUALITY_RETENTION_DAYS` (7). `GET /api/data-quality/view`
is the same view the tab renders; `GET /api/data-quality/findings?provider=…&severity=fatal`
pages older rows.

---

## Data-quality escalation fired

**Where:** the Telegram alert chat (or the gateway log when the bot is off), a
`data_quality_escalation` row in `/api/audit/events`, and Data tab → Quality →
Quality ledger and escalations, which shows the rule, the provider, the channel
it went to and when it cleared.

Two rules, evaluated when findings arrive:

* **fatal burst** — `DATA_QUALITY_ESCALATE_FATAL_COUNT` (3) payloads with a
  fatal finding from one provider inside `DATA_QUALITY_ESCALATE_WINDOW_MINUTES` (15).
* **fail rate** — more than `DATA_QUALITY_ESCALATE_FAIL_RATE` (25 %) of a
  provider's payloads failed their contract, once at least
  `DATA_QUALITY_ESCALATE_MIN_SAMPLES` (8) were evaluated in the window.

One escalation per (rule, provider) per `DATA_QUALITY_ESCALATE_COOLDOWN_MINUTES`
(60). An escalation resolves itself when the condition no longer holds in the
window, and the card shows "Cleared" with the time. Acknowledging one is
optional and resolves nothing — it records who took it and the row reads
"Taken": the **Take** button on that card, `POST
/api/data-quality/escalations/{id}/ack`, or `/ack <ID>` in Telegram. Only
Telegram carries a real user id; an acknowledgement from the web records the
credential (`web:token`), not a person. What to do:

1. Read the recent findings on the same card — the check ids name the defect
   (`bars.unique_timestamps`, `quote.price_positive`, `news.ids_unique`).
2. Trace the symbol on Lineage & Payloads with **Trace (bypass cache)** and
   read the raw payload; a `drift` finding is our adapter, a `fatal` one is
   the vendor.
3. If the vendor is the problem, the chain has already failed over; consider
   an operator outage on it (Reliability → Remediation) until it recovers.
4. If the rule is too sensitive for a vendor's normal behaviour, raise the
   threshold in the environment rather than muting the channel.

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
| Provider outage | Reliability tab → Services & Circuits, or the failover graph on Data tab → Providers & Capacity → simulate an outage (self-expiring, bounded) |
| End-to-end check | `python tools/synthetic_probe.py` — walks book → cost → risk gate → audit |

---

## Continuous deployment to the OCI VM

`.github/workflows/deploy.yml` runs on every push to `main` that touches the
gateway: suite → build → GHCR → SSH swap → health check → public reachability
probe. The container runs `--restart unless-stopped`, so it survives a VM
reboot and the desk is live without anyone opening a terminal.

Only the **gateway** deploys this way. The web workspace and the OpenBB service
are Vercel projects that deploy themselves from git.

### Repository secrets

| Secret | Used by | Notes |
|---|---|---|
| `SSH_HOST` | deploy | The VM's **public** IP. Also probed by the reachability job. |
| `SSH_USER` | deploy | `opc` on Oracle Linux, `ubuntu` on Ubuntu images. |
| `SSH_PRIVATE_KEY` | deploy | Whole PEM including the BEGIN/END lines. |
| `WEB_API_TOKEN` | deploy | **Required.** Must equal `ALPHAENGINE_GATEWAY_TOKEN` in Vercel. |
| `DB_CONNECTION_STRING` | `ci.yml` live-smoke | Oracle ADB. Not used by the gateway — see below. |
| `DB_PASSWORD` | `ci.yml` live-smoke | Same. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | deploy (optional) | Turns the Postgres mirror on. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS` | deploy (optional) | Notification companion. |
| `TELEGRAM_CONTROL_USER_IDS` | deploy (optional) | The separate control allow-list. Without it `/halt`, `/resume` and `/flatten` refuse. |
| `TELEGRAM_ALERT_CHAT_IDS` | deploy (optional) | Where risk and data-quality escalations are pushed. |
| `TELEGRAM_LINK_SECRET` | deploy (optional) | Signs the single-use link tokens. |

**`DB_*` are not passed to the gateway container.** The gateway is Python and
has no Oracle client; `ORACLE_*` is read by the Next.js routes on Vercel, which
is where those values belong. The workflow uses them only for the manual
live-smoke job, which verifies the database directly.

### Two things the pipeline cannot do for you

**1. Point Vercel at the VM.** In the web project's environment variables:

```
ALPHAENGINE_GATEWAY_URL   = http://<SSH_HOST>:8000
ALPHAENGINE_GATEWAY_TOKEN = <the same value as WEB_API_TOKEN>
```

Use the **public** address. `gatewayState()` in `web/lib/gateway.ts` classifies
`127.0.0.1`, `10.x`, `192.168.x` and `172.16–31.x` as `loopback` in production
and refuses them — a serverless function fetching a private address fetches
nothing, and that failure once read as a gateway outage for a day.

**2. Open the path.** Both layers, or it looks identical to a closed one:

- OCI VCN security list: ingress TCP 22 and 8000 — and 8443 as well if the TLS
  sidecar is to be reachable from outside (`docs/engineering/TLS_FLIP.md`).
- The instance firewall: Oracle Linux images ship restrictive `iptables`.
  `sudo firewall-cmd --permanent --add-port=8000/tcp && sudo firewall-cmd --reload`

The `reachable` job probes `http://<SSH_HOST>:8000/health` from a GitHub runner
and fails with this list if it cannot connect, so a half-open path is caught at
deploy time rather than when someone opens the site.

### On the bearer token travelling in clear

Unless the Vercel project has been flipped — step 3 of `docs/engineering/TLS_FLIP.md`, a
setting this repository cannot read — Vercel reaches the gateway over plain
HTTP and `WEB_API_TOKEN` crosses the internet unencrypted. It is acceptable
for a paper-trading case study — the token authorises reads and simulated
orders, nothing else — but it is not a production posture.

The container half is already built: every deploy runs a Caddy sidecar that
terminates TLS on `:8443` and proxies to `127.0.0.1:8000`, additively, so
`:8000` keeps serving throughout. It uses Caddy's *internal* CA rather than an
automatically obtained public certificate — nothing will issue one for a bare
IP — so the root is pinned by the one client that matters, and that root is
committed at `Part2_Infrastructure/web/certs/gateway-ca.pem`. What remains is
ingress on 8443 and pointing `ALPHAENGINE_GATEWAY_URL` at `https://<IP>:8443`;
`docs/engineering/TLS_FLIP.md` is the checklist.

### When a deploy fails

The workflow rolls back to the previous image automatically and prints the new
container's logs. The desk stays on the last good build.

```bash
docker logs --tail 100 alphaengine_gateway     # why the new image refused to start
docker inspect --format '{{.Config.Image}}' alphaengine_gateway   # what is running now
docker volume inspect alphaengine_alphaengine_audit   # the decision log, which survives every swap
                                               # (compose prefixes the project name — the
                                               # unprefixed name is a different, empty volume)
```

Re-run without a code change from Actions → *Deploy gateway to OCI* → *Run
workflow*.
