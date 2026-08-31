# Native decision core: latency and operability evidence

**Last verified: 2026-08-29.** Repository wiring and the generated report were
rechecked today. The measurements remain dated 2026-08-28 because the benchmark
population was not silently rerun or restamped.

Measured on 2026-08-28 with Python 3.12.14 on arm64 macOS. The reviewable
summary is [`native-latency.generated.json`](native-latency.generated.json).
It contains nine repetitions of 100,000 direct calls after 5,000 warm-ups and
nine matched 5,000-order gateway runs after 500 warm-ups. macOS offered no CPU
affinity control, so the report records pinning as unavailable. Quantiles below
are medians of the nine per-run observed nearest-rank quantiles, never pooled or
interpolated.

## Claim boundary and qualification result

The sub-100 ns release contract belongs only to the warmed, canonical two-venue
C++ arithmetic kernel measured by `CoreResult.elapsed_ns`: at least 99% of each
run must be strictly below 100 ns. It does not describe Python marshalling,
`RiskGateway.submit`, HTTP, storage, Telegram, a browser render, or end-to-end
latency. The harness keeps those populations separate.

`steady_clock` advances in roughly 41.7 ns steps on this host. Values of 42 ns
and 84 ns are one and two observed clock ticks, not one-nanosecond-resolution
measurements. Timer floors remain in the artifact beside the decision results.

| population | p50 | p99 | qualification |
|---|---:|---:|---|
| Python timer floor | 0 ns | 42 ns | measurement floor |
| C++ timer floor | 0 ns | 42 ns | measurement floor |
| Python/pybind identity round-trip | 42 ns | 84 ns | boundary probe only |
| Raw 28-argument native call | 542 ns | 625 ns | excludes eager materialization |
| Complete native operation, eager tuple | 958 ns | 1,042 ns | N3 passes (≤2/4 µs) |
| Complete native operation, legacy attributes | 1,916 ns | 2,042 ns | matched A/B control |
| Canonical two-venue C++ kernel | 42 ns | 84 ns | N1 passes |
| Varied two-venue C++ kernel | 42 ns | 84 ns | shape sweep, not release population |
| Varied four-venue C++ kernel | 83 ns | 84 ns | shape sweep, not release population |
| Gateway-cadence C++ kernel | 83 ns | 125 ns | N2 misses at p99 |
| Whole gateway, eager tuple (external wall) | 64.833 µs | 81.667 µs | N4 misses (≤10/20 µs) |
| Whole gateway, legacy attributes (external wall) | 66.750 µs | 85.084 µs | matched A/B control |

All nine canonical runs passed: 99.929%–99.974% of their 100,000 samples were
strictly below 100 ns and every p99 was 84 ns. The below-50 ns fraction was
84.715%–89.636%; that supports the observed 42 ns p50 only. It does not support
a sub-50 ns p99 claim.

The complete operation is the honest Python→C++→Python boundary: `decide()`
plus conversion of all nineteen result fields. Replacing nineteen extension
property reads with one eager tuple cut its median p50 from 1,916 to 958 ns and
p99 from 2,042 to 1,042 ns. The candidate was lower at both quantiles in all
nine matched 100,000-call runs. No kernel arithmetic or timer boundary changed.

At the gateway wall, the median-of-runs p50 improved 2.9% and p99 4.0%. The p50
was lower in nine of nine matched runs; p99 was lower in six of nine, so the
tail improvement is directional rather than a universal guarantee. The
gateway's own internal interval was 48.208/65.875 µs at p50/p99; the external
wall figures above include the await/call boundary. Both are far above 100 ns.

## Correctness, fallback and rollback

The eager path is used only for the exact loaded `CoreResult` type. An older
compatible extension without `materialize_tuple` takes the legacy path. Both
paths fully convert the result while the native fallback boundary is active and
validate route topology before Python indexes venue names: route presence must
match the flags, venue indices must be in range, and duplicates are rejected.
Any accessor, tuple conversion, or topology fault records
`native_result_conversion`, clears stale native timing, and re-runs the Python
reference for bit-exact money-path output.

The permanent breakage corpus plants:

- all five unequal parallel-position vector shapes in child processes, plus an
  empty ladder, proving `ValueError` rather than process memory corruption;
- out-of-range, negative, duplicate, and structurally missing route indices;
- a result accessor that throws after `decide()` returns;
- stale ABI/capability metadata and missing executable symbols;
- a structurally valid but wrong startup known-answer result; and
- an incompatible binary while `DECISION_CORE=python`, proving rollback remains
  available.

`DECISION_CORE=native` is fail-closed at load. Auto mode falls back with stable
reason counters. A loaded-native known-answer failure marks readiness false;
container promotion therefore fails instead of advertising a healthy native
engine that is actually executing Python.

The extension build ID now includes ABI, source SHA-256 prefix, compile-flag
SHA-256 prefix, architecture and Python SOABI. Compiler and pybind11 versions
remain separate exported fields. Production retains `-O3`,
`-ffp-contract=off`, and `-fvisibility=hidden`; fast-math and host-specific `-march=native` remain
forbidden.

## Remaining performance boundary

Profiling found no further safe change inside the native boundary with enough
whole-request benefit to justify another kernel. Most gateway time is Python
state/accounting, date formatting, rate-limit work and audit construction. A
public analytics route walk (`TCAEngine._merged_walk`) was the one remaining
CPU-shaped candidate at about 97 ms over 4,202 profiled calls (~23 µs/call),
but integrating it crosses the TCA service boundary and needs its own exact
parity/adoption tests. No unused C++ duplicate was added.

The combined ASAN/UBSAN build is configured on Linux CI with warnings as errors
and recovery disabled. Apple ASAN cannot interpose into this local Homebrew
Python runtime, so that local combination remains unsupported rather than
being called green; UBSAN-only is the local executable fallback. The production
extension is rebuilt after sanitizer work.

## Reproduce

```bash
cd Part2_Infrastructure
venv/bin/python native/decision_core/setup.py build_ext --inplace --force \
  --build-temp build/native
venv/bin/python tools/bench_native_boundary.py \
  --orders 100000 --warmup 5000 \
  --gateway-orders 5000 --gateway-warmup 500 --repeat 9 \
  --json docs/native-latency.generated.json
```

For forensic raw samples, add `--include-raw` and write to a temporary path;
the committed artifact intentionally remains a reviewable summary.
