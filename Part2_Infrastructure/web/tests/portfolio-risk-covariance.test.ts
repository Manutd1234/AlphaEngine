/**
 * A covariance model is measured, or it is not returned.
 *
 * Everything else on this surface — the risk decomposition, VaR, the allocation
 * proposal — is a function of the covariance matrix, so a matrix that quietly
 * filled a gap is a whole panel of numbers that look measured and are not.
 *
 * The two ways to fill a gap are both refused here. Building from two
 * observations returns null rather than a matrix with no statistical claim
 * behind it; and where two symbols have histories of different lengths the
 * model truncates to the shorter rather than padding the gap with zeros.
 * Padding is the more dangerous of the pair because it reads as zero volatility
 * and zero correlation at once, and both errors point the same way: a book that
 * looks safer than it is.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCovariance } from "../lib/portfolio-risk";
import { close, correlatedSeries } from "./helpers/risk-series";

describe("covariance is measured, and refuses to guess", () => {
  it("recovers a known correlation", () => {
    const [a, b] = correlatedSeries(500, 0.9);
    const m = buildCovariance(["A", "B"], { A: a, B: b })!;
    assert.ok(m, "model should build");
    assert.ok(m.correlation[0][1] > 0.7, `expected high correlation, got ${m.correlation[0][1]}`);
    close(m.correlation[0][0], 1, 1e-12, "self-correlation");
    close(m.correlation[0][1], m.correlation[1][0], 1e-12, "symmetry");
  });

  it("returns null rather than a covariance built on nothing", () => {
    assert.equal(buildCovariance(["A"], { A: [0.01, 0.02] }), null, "2 observations is not a covariance");
    assert.equal(buildCovariance(["A"], {}), null, "no history at all");
  });

  it("truncates to the shortest common history instead of padding with zeros", () => {
    // Padding would read as zero volatility and zero correlation — the two
    // errors that both make a book look safer than it is.
    const long = Array.from({ length: 200 }, (_, i) => (i % 7) * 0.001 - 0.003);
    const short = long.slice(-40);
    const m = buildCovariance(["L", "S"], { L: long, S: short })!;
    assert.equal(m.observations, 40, "should align to the shorter series");
    assert.ok(m.vol[0] > 0 && m.vol[1] > 0, "neither series should read as zero-vol");
  });
});
