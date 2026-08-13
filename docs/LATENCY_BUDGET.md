# Latency budget

Every number here was measured on the deployed system, with the method stated.
Where something could not be measured, it says so rather than estimating.

**The conclusion first.** The desk's own risk decision runs in ~50 µs. The market
data it decides on is ~34 ms old when it arrives. The compute is **0.07 %** of the
path, and no amount of further optimisation to it changes the system's latency in
any way a trader could observe. The only lever that moves the number by orders of
magnitude is moving the gateway to the region the matching engine is already in.

---

## What "latency" means here — two separate domains

Conflating these is the most common way a latency claim becomes untrue.

| | Trading path | Observability path |
|---|---|---|
| Question | tick → risk decision → order | what a human sees on screen |
| Floor | network to the venue | a 16.7 ms display frame |
| Achievable | 5–500 µs *for the decision* | ~1 s end-to-end |
| Measured below | §2, §3 | §4 |

A browser will never see microseconds, and it does not need to. The two are
budgeted separately throughout, and the UI labels which numbers are pushed and
which are polled rather than implying everything is live.

---

## 1. Measurement method, and what it excludes

Timings come from `time.perf_counter_ns()` in-process, recorded into a
log-linear histogram (`modules/metrics.py`, `observe_decision_latency`) with
~12 % bucket resolution, and reported as p50 / p99 / p99.9 / p99.99 / max on
`/metrics`. Never as a mean: the mean of a latency distribution is the one
statistic that reliably hides the thing being measured.

**What these numbers do not include, and cannot on this hardware.** There is no
NIC hardware timestamping and no PTP time source on a cloud VM, so every figure
below is *in-process*: it excludes the kernel network stack, the driver, and the
wire. A true tick-to-trade measurement needs hardware neither Oracle Cloud nor
AWS exposes at this tier. Published in-process numbers are therefore a floor on
the real latency, never the real latency, and this document does not claim
otherwise.

Sample counts are stated with every figure. A p99.9 drawn from 200 samples is
the maximum wearing a decimal point, which is why the decision histogram keeps
every sample for the life of the process rather than a sliding window.

---

## 2. The trading path

### 2.1 The pre-trade risk decision — measured

`RiskGateway.submit` evaluates gates under a lock and returns a decision.
Seventeen are defined; fifteen of them can appear on the crypto path measured
here, and the remaining two (`paper_execution_model`, `reference_freshness`) run
only for paper-equity orders, which are priced from a vendor quote rather than a
book and are not what this benchmark exercises. 5 000 orders against a synthetic
50-level book, warmed, on the development machine:

| | p50 | p99 | p99.9 | max |
|---|---|---|---|---|
| Before | 54.5 µs | 69.1 µs | 101.4 µs | 121.7 µs |
| **After** | **50.3 µs** | **61.6 µs** | **90.9 µs** | **94.2 µs** |

Two changes produced that, both measured before being adopted:

* **`CheckResult` is a `@dataclass(slots=True)`, not a pydantic `BaseModel`.**
  Fifteen are constructed inside the timed section of every order. In isolation
  that swap is 8.79 µs → 2.58 µs p50 for the fifteen. Pydantic v2 accepts a
  stdlib dataclass as a field type, so `RiskDecision` serialises to identical
  JSON and generates an identical JSON Schema — the committed OpenAPI snapshot
  is unchanged, which is the proof the API contract did not move.
* **The instrument whitelist is a prebuilt `frozenset`.** It was a list
  comprehension re-uppercasing every configured symbol per order.

**The isolated gain was 6.2 µs; the end-to-end gain was 4.1 µs.** The difference
is real and worth stating: `RiskDecision` now validates fifteen dataclasses at
its own boundary, giving some of it back. A microbenchmark is a hypothesis about
a system, and this one was 34 % optimistic.

**What was deliberately not done.** Building the `detail` string only on failure
measured a further 0.87 µs. It was rejected: passing checks would lose their
detail, which the UI renders, and 0.87 µs against a 68 ms network is not worth a
change to what the API reports. Likewise no Rust or C++ rewrite — 50 µs is
already three orders of magnitude inside the 5–500 µs target band, and the
constraint is elsewhere.

### 2.2 The tail is the operating system, not the language

Disabling the cyclic garbage collector (`gc.freeze()` + `gc.disable()`) around
the same workload changed p50 not at all and p99 by ~0.1 µs. The tail beyond
p99.9 is scheduler preemption, and the only things that move it are CPU
pinning, real-time priority and a host that is not shared. The gateway runs on
`VM.Standard3.Flex` (2 OCPU, Xeon 8358) — a virtualised shape, so the hypervisor
schedules against neighbours regardless of what the guest asks for. Python is
not the constraint at this scale; the hypervisor is.

### 2.3 The network to the venue — measured, and it dominates everything

From the OCI VM (`ap-singapore-2`, 2 vCPU Xeon 8358), TCP handshake = one round
trip, five samples, steady state:

Re-measured with `tools/colocation_probe.py`, which reports two figures per
endpoint: the TCP handshake, and a round trip to the venue's server clock — a
dynamic response no CDN edge can serve from cache.

| Endpoint | TCP connect | Origin RTT | What it actually is |
|---|---|---|---|
| `api.binance.com` | 1.6 ms | **72.7 ms** | CloudFront edge; Binance is in Tokyo |
| `api.bybit.com` | 1.5 ms | **6.2 ms** | CloudFront edge; Bybit origin is near |
| **`stream.binance.com`** | **69.1 ms** | — | raw EC2, `ap-northeast-1` — no edge to hide behind |
| `stream.bybit.com` | 1.6 ms | — | CloudFront; WebSocket, so no clock to probe |
| `data-api.binance.vision` | 68.5 ms | 71.0 ms | the public mirror, also Tokyo |

**The connect column is the trap, and the earlier version of this document fell
into it.** It recorded `api.binance.com` at 2.4 ms and called it a CDN edge —
correct as far as it went, and then it left the order-entry path budgeted at
2.4 ms anyway. The origin column is the correction: **order entry to Binance is
72.7 ms, not 2.4 ms.** A handshake that terminates at a PoP two milliseconds
away says nothing about where the order is matched, and the whole reason the
probe now measures a server clock is that nothing else distinguishes the two.

`stream.binance.com` resolves from the VM to `13.112.200.49` / `13.114.181.92` —
AWS **ap-northeast-1, Tokyo**, with no CDN in front, which is why its connect
time and its origin distance are the same number.

**And the finding that was not in the plan: Bybit's origin answers in 6.2 ms
from the existing Singapore VM — 11.7× closer than Binance, for no spend at
all.** Both venues are already wired into this gateway.

```
 72 700 µs   order entry to Binance, origin     ← 1 446× the decision  (was budgeted at 2 400)
 69 100 µs   market data from Binance           ← 1 374× the decision
  6 160 µs   order entry to Bybit, origin       ←   123× the decision
     50 µs   the risk decision
```

**Optimising the gate from 54.5 µs to 50.3 µs improved end-to-end by 0.006 %.**

### 2.4 The only lever that matters

Co-location, in the sense that applies to cloud-hosted crypto venues: an
instance in AWS `ap-northeast-1`, where the matching engine already runs.
Expected 68 ms → 0.1–0.5 ms same-AZ, 0.5–2 ms cross-AZ — a ~150× improvement
against the ~1.08× available from the compute.

**There is now a cheaper option that was not in the original analysis, because
it only became visible once the origin was measured separately from the edge.**
Routing to Bybit rather than Binance takes the round trip from ~70 ms to 6.2 ms
— an 11.4× improvement, available today, on the existing instance, for nothing.
It does not reach the 0.1–0.5 ms a same-region instance would, and it changes
which venue the desk trades, which is a business decision rather than an
infrastructure one. It is recorded here because a spend decision should be taken
against the best free alternative, not against the status quo.

### 2.5 The free half, taken — research bars now load from Bybit

The research path has been switched; the trading path has not, and the
distinction is the point.

**What changed.** `lib/marketdata.loadBars` used to send every crypto symbol to
Binance klines. It now walks a two-venue chain, Bybit first, Binance second,
synthetic last — `lib/bybit-klines.ts`, registered as an ordinary keyless
provider in `lib/providers/bybit.ts` so it appears in the health matrix like
every other upstream. Measured end to end, 600 × 1h bars of `BTCUSDT`:

| | bars | wall clock |
|---|---|---|
| Bybit | 600 | **112 ms** |
| Binance | 600 | 147 ms |

and across all twelve crypto symbols the portal offers, warm, **17–23 ms each,
all twelve served by Bybit**. From the Vercel serverless region the per-call gap
is larger than from a laptop — five consecutive production probes measured
Bybit at 9–11 ms against Binance at 77–90 ms, roughly 8×.

**What did not change.** `venues.ts` still walks the merged cross-venue ladder
by price for execution, and the gateway still streams both feeds. Bybit's spot
book is thinner than Binance's on most pairs, so *nearer is not deeper* — this
is a latency decision about where history is read, not a routing decision about
where an order should go. Conflating the two is the mistake this whole document
exists to prevent.

**Two things worth recording because they were both wrong in the repository.**

The first: `venues.ts` carried a comment stating Bybit answered **HTTP 403** to
every request from the serverless region — a 100 % error rate. That was true
when written and is no longer; five consecutive production calls all returned a
book, faster than Binance every time. The comment has been corrected rather than
deleted, because a fact that flipped silently once can flip back.

The second: the two venues order their klines **oppositely** — Binance
ascending, Bybit descending. A reversed series does not crash, does not warn,
and produces a complete backtest of every strategy run backwards through
history. `parseBybitPage` sorts rather than reverses, and `fetchBybitKlines`
re-checks monotonicity before returning, because a comment asking the next
reader to remember is not a control. Cross-checked against Binance on 600
aligned bars: **median close difference 0.46 bps, p95 1.58 bps, max 3.15 bps** —
which is what two spot venues quoting one instrument should look like, and
nothing like what a reversed or misaligned series would.

**Coverage, and why the fallback is load-bearing rather than decorative.** Of
Binance's 489 USDT pairs, 247 are absent from Bybit. Every symbol the portal
currently offers is on both, so no real request can exercise the failover —
which is why the chain is injectable and the fallback is tested with a stubbed
venue rather than left as an untested promise.

**Tokyo co-location is not yet done, and the number above is an expectation, not a
measurement.** The plan is probe-first: stand up an instance, run the same
`time_connect` probe, and migrate only if it confirms.

The tenancy already runs a paid shape (`VM.Standard3.Flex`), not a free one, so
this is not a question of starting to pay — it is subscribing the tenancy to a
second region and provisioning there. Tokyo is reachable two ways, and the probe
should cover both: OCI's own `ap-tokyo-1`, or an AWS instance in
`ap-northeast-1` itself. The second is likely to win, because `ap-northeast-1`
is where the venue already is and the last hop becomes a VPC hop rather than a
peering one — but that is a hypothesis, and the probe exists to settle it.

Bybit resolves through CloudFront and needs the same probe. If the two venues do
not co-locate in one region, cross-exchange arbitrage is bounded by whichever is
further, and that is a finding to publish rather than hide.

### 2.5 What is out of scope, and why

* **FPGA** — no crypto venue rents an FPGA feed-handler path, and with the
  decision at 50 µs against a millisecond-scale network there is nothing for one
  to save.
* **Microwave** — microwave links exist between physical exchange datacentres
  because the great-circle path beats fibre. Binance and Bybit are *inside AWS*;
  there is no microwave route into a cloud region, and the relevant distance is
  a VPC hop.
* **Kernel bypass** — DPDK and Solarflare need hardware this instance does not
  expose. The nearest available equivalents (ENA busy-polling, `SO_BUSY_POLL`,
  cluster placement groups) are worth doing *after* co-location, not before.

---

## 3. Reading the numbers on a live desk

```bash
curl -s http://<gateway>:8000/metrics | grep decision_latency
```

```
alphaengine_decision_latency_us{quantile="0.5"}     52
alphaengine_decision_latency_us{quantile="0.99"}    80
alphaengine_decision_latency_us{quantile="0.999"}  144
alphaengine_decision_latency_max_us                237
alphaengine_decision_samples_total                5200
```

Microseconds, not milliseconds — in ms every healthy decision reports as `0.05`
and every quantile becomes indistinguishable. `decision_samples_total` exists at
zero before the first order so a dashboard has a series to draw; the quantiles
are simply absent until something has been measured, because quantiles of
nothing are not zeros.

---

## 4. The observability path

Separate budget, and much less demanding.

* **The order book is already optimal.** The browser opens its own WebSocket
  directly to Binance and Bybit (`web/lib/livebook.ts`), receiving 100 ms depth
  snapshots and publishing to React at 5 Hz. One hop, no backend. Routing this
  through the gateway would make it slower, not faster.
* **Portfolio, P&L and risk are the stale ones**, and the cause is server-side:
  the gateway re-marks the book every 5 s (`risk_proxy.py`, `_monitor_loop`),
  and the browser polls at 4 s / 5 s / 15 s. Worst case ≈ 20 s.
* **The fix is ordered.** Tightening the poll before the 5 s recompute would
  deliver the same stale number more often. The recompute is split first, then
  the transport.
* **A browser cannot open an `EventSource` to the gateway directly.** The page
  is HTTPS and the gateway is `http://…:8000`; that is blocked as mixed content
  with no override. Streaming would therefore have to be proxied through a
  Vercel route handler, costing ~25 ms — measured, and irrelevant against a 1 s
  recompute.
* **The transport half is not wired, and the proxy that anticipated it has been
  removed.** It had no consumer, and the hook written against it could not
  express the state that matters: `EventSource` exposes neither the status code
  nor the body, so the proxy's deliberate 503 on a gateway-less deployment was
  invisible to it and the panel would have read "Connecting…" forever — on
  precisely the deployment where that is the normal condition. The recompute
  split above stands on its own; re-proxying is roughly sixty lines once a
  surface genuinely wants a stream.

Measured from a development machine to the gateway: 21–27 ms total, 9–13 ms TCP
connect. Vercel serves the web project from `sin1`, the same city as the VM.

---

## 5. Summary

| Hop | Measured | Notes |
|---|---|---|
| Risk decision (crypto path, up to 15 of 17 gates) | **50.3 µs** p50 | in-process; excludes kernel and wire |
| Decision tail | 90.9 µs p99.9 | scheduler jitter, not GC |
| Market data → gateway | **69.1 ms** RTT | Binance, Tokyo → Singapore; **the constraint** |
| Order entry → venue | **72.7 ms** origin RTT | Binance; 1.6 ms to the CDN edge, which is not where it matches |
| Order entry → Bybit | **6.2 ms** origin RTT | the free alternative, measured on the same host |
| Gateway → browser (dev machine) | 21–27 ms | |
| Book recompute | 5 s | server-side; the observability floor |
| Browser order book | 100 ms | direct from venue, already optimal |

The honest headline: **the decision is fast, the system is not, and the gap is
entirely geography.** A sub-millisecond claim about this deployment would be true
of the gate and false of everything the gate depends on.
