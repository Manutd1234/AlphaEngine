#!/usr/bin/env python3
"""Measure the network half of the latency budget, from wherever it is run.

WHY THIS EXISTS AS A COMMITTED TOOL RATHER THAN A SHELL ONE-LINER

The co-location decision is a spend decision, and it should be made on a number
that anyone can reproduce rather than on one person's `curl` from one machine on
one afternoon. Running this from the current gateway and from a candidate host
produces two comparable figures and a verdict against a stated threshold.

WHAT IT MEASURES

TCP connect time — one round trip, no TLS, no HTTP. That is deliberately the
narrowest thing that can be measured from userspace: a TLS handshake is two more
round trips plus asymmetric crypto, and an HTTP request adds server-side work
this has no way to separate from the wire. Connect time is the closest available
proxy for "how far away is this venue".

THE TRAP THIS TOOL EXISTS TO AVOID

TCP connect time measures the distance to whatever TERMINATES the connection,
which is not always the exchange. `stream.binance.com` resolves to raw EC2
addresses in ap-northeast-1, so its handshake really does cross to Tokyo.
`stream.bybit.com` resolves to CloudFront, so its handshake stops at the nearest
edge — and reports 1.6 ms from Singapore while the matching engine behind it may
be anywhere. Reading that as "Bybit is 1.6 ms away" is how a desk concludes it
is co-located with a venue on the other side of an ocean.

So this also measures an ORIGIN round trip: an HTTP request for the venue's
server time, which no edge can answer from cache. The gap between the two
numbers is the CDN's contribution, and for a market-data feed the origin figure
is the one that matters.

WHAT IT CANNOT MEASURE

There is no NIC hardware timestamping and no PTP on a cloud VM, so every number
here is in-process: it excludes kernel scheduling on both ends and includes
whatever the local stack added. Treat it as a floor on the true wire latency,
never as the wire latency. The same caveat is on every figure in
docs/architecture/LATENCY_BUDGET.md and it is the reason this prints a range rather than a
single number.
"""

from __future__ import annotations

import argparse
import json
import socket
import statistics
import sys
import time

#: Market-data and order endpoints, separated because they are not co-located.
#: `api.binance.com` answers from a CDN edge; `stream.binance.com` is the feed
#: and resolves to the region the matching engine actually sits in. Measuring
#: only the first is how a desk concludes it is 2 ms from an exchange it is
#: 68 ms from.
#: `origin_path` is an endpoint no CDN edge can serve from cache — a server
#: clock. Where it is None the host is not CDN-fronted and connect time already
#: measures the origin.
ENDPOINTS = [
    ("binance-stream", "stream.binance.com", 9443, "market data feed", None),
    ("binance-rest", "api.binance.com", 443, "REST / order entry", "/api/v3/time"),
    ("binance-mirror", "data-api.binance.vision", 443, "public data mirror", "/api/v3/time"),
    ("bybit-rest", "api.bybit.com", 443, "REST / order entry", "/v5/market/time"),
    ("bybit-stream", "stream.bybit.com", 443, "market data feed", None),
]

#: Below this a move is not worth a paid instance; above it, it is the single
#: largest lever available. Stated here so the verdict is not a judgement call
#: made after seeing the number.
MIGRATE_THRESHOLD_MS = 5.0


def time_connect(host: str, port: int, timeout: float = 5.0) -> float | None:
    """One TCP handshake, in milliseconds. None when it cannot be established."""
    try:
        addr = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)[0][4]
    except socket.gaierror:
        return None
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    started = time.perf_counter_ns()
    try:
        sock.connect(addr)
    except OSError:
        return None
    finally:
        elapsed = time.perf_counter_ns() - started
        sock.close()
    return elapsed / 1e6


def time_origin(host: str, path: str, samples: int) -> float | None:
    """Round trip to something the origin must compute — a server clock.

    Connections are reused across samples so the figure excludes the handshake
    and isolates the request/response leg, which is the part a CDN edge cannot
    shortcut for a dynamic response.
    """
    import http.client

    try:
        conn = http.client.HTTPSConnection(host, 443, timeout=8)
        conn.request("GET", path)          # warm the connection; not timed
        conn.getresponse().read()
    except Exception:
        return None

    timings = []
    try:
        for _ in range(samples):
            started = time.perf_counter_ns()
            conn.request("GET", path)
            conn.getresponse().read()
            timings.append((time.perf_counter_ns() - started) / 1e6)
    except Exception:
        return None
    finally:
        conn.close()
    return round(statistics.median(timings), 3) if timings else None


def resolve(host: str) -> list[str]:
    try:
        return sorted({info[4][0] for info in socket.getaddrinfo(host, None, socket.AF_INET)})
    except socket.gaierror:
        return []


def probe(samples: int) -> list[dict]:
    results = []
    for name, host, port, role, origin_path in ENDPOINTS:
        # The first connection to a host is not representative — it pays DNS and
        # any ARP/route resolution. Measured and reported separately rather than
        # discarded, because a cold path is what a reconnect actually costs.
        timings = [t for t in (time_connect(host, port) for _ in range(samples)) if t is not None]
        results.append({
            "name": name,
            "host": host,
            "port": port,
            "role": role,
            "addresses": resolve(host),
            "samples": len(timings),
            "cold_ms": round(timings[0], 3) if timings else None,
            "p50_ms": round(statistics.median(timings[1:] or timings), 3) if timings else None,
            "min_ms": round(min(timings), 3) if timings else None,
            "max_ms": round(max(timings), 3) if timings else None,
            "origin_ms": time_origin(host, origin_path, samples) if origin_path else None,
        })
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=7)
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--baseline-ms", type=float, default=None,
        help="the current host's market-data p50, to compare this host against",
    )
    args = parser.parse_args()

    results = probe(args.samples)
    if args.json:
        print(json.dumps({"threshold_ms": MIGRATE_THRESHOLD_MS, "endpoints": results}, indent=2))
        return 0

    print(f"{'endpoint':18} {'connect':>9} {'origin':>9} {'min':>8} {'max':>8}  resolves to")
    for r in results:
        addresses = ", ".join(r["addresses"][:2]) or "—"
        if r["p50_ms"] is None:
            print(f"{r['name']:18} {'unreachable':>9}                                  {addresses}")
            continue
        origin = f"{r['origin_ms']:9.2f}" if r["origin_ms"] is not None else f"{'—':>9}"
        print(f"{r['name']:18} {r['p50_ms']:9.2f} {origin} {r['min_ms']:8.2f} {r['max_ms']:8.2f}"
              f"  {addresses}")
    print()
    print("connect = distance to whatever terminates TCP (a CDN edge, or the origin).")
    print("origin  = round trip to a server clock, which no edge can answer from cache.")
    print("A large gap between the two means the venue is fronted and further than it looks.")

    feed = next((r for r in results if r["name"] == "binance-stream"), None)
    if feed and feed["p50_ms"] is not None:
        print()
        print(f"Market-data feed p50 from this host: {feed['p50_ms']:.2f} ms")
        if args.baseline_ms is not None:
            saved = args.baseline_ms - feed["p50_ms"]
            print(f"Against the {args.baseline_ms:.2f} ms baseline: {saved:+.2f} ms")
            # The verdict is computed against a threshold fixed above, before
            # the measurement, so it cannot be rationalised after the fact.
            verdict = "MIGRATE" if saved > MIGRATE_THRESHOLD_MS else "STAY"
            print(f"Verdict at a {MIGRATE_THRESHOLD_MS} ms threshold: {verdict}")
        else:
            print("Run with --baseline-ms <current host's figure> for a migrate/stay verdict.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
