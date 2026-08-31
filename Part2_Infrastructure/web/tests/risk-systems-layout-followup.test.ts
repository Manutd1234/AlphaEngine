import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource } from "./helpers/source-files";

const route = readSource("components/systems/RouteLatencyBars.tsx");
const planes = readSource("components/systems/ReliabilityPlanes.tsx");
const css = readSource("app/globals/14zzl-risk-systems-layout-followup.css")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const manifest = readSource("app/globals.css");

describe("the route-p99 distribution remains a sparse-data line instrument", () => {
  it("uses an empirical step function and one inspectable mark per route", () => {
    assert.match(route, /function RouteP99Distribution/);
    assert.doesNotMatch(route, /<LatencyHistogram/);
    assert.match(route, /className="route-p99-distribution__cdf"/);
    assert.match(route, /className="route-p99-distribution__mark"/);
    assert.match(route, /<title>\{`\$\{route\.route\} p99/);
  });

  it("draws the line, grid and points instead of a filled slab", () => {
    assert.match(css, /\.route-p99-distribution__cdf\s*\{[^}]*fill:\s*none;[^}]*stroke:/s);
    assert.match(css, /\.route-p99-distribution__grid\s*\{[^}]*stroke:\s*var\(--grid\)/s);
    assert.match(css, /\.route-p99-distribution__mark\s*\{[^}]*fill:\s*var\(--surface-1\);[^}]*stroke:/s);
  });
});

describe("the reviewed Risk disclosures share one aligned rule", () => {
  it("joins Exception days to the calendar and strengthens its summary", () => {
    assert.match(css, /\.coh-figure \+ \.var-backtest__exceptions\s*\{[^}]*width:\s*100%;[^}]*margin-block-start:\s*0;[^}]*border-block-start:\s*0;/s);
    assert.match(css, /\.var-backtest__exceptions > summary\s*\{[^}]*font-weight:\s*700;/s);
    assert.match(css, /:is\(\.var-backtest__exceptions, \.disclosure\) > summary\s*\{[^}]*padding-inline:\s*var\(--space-2\)/s);
  });

  it("removes the duplicate divider under Risk contribution and Monte Carlo", () => {
    assert.match(css, /#risk-subpanel-drivers \.portfolio-card-heading \+ \.disclosure/);
    assert.match(css, /#risk-subpanel-montecarlo \.portfolio-card-heading \+ \.disclosure/);
    assert.match(css, /border-block-start:\s*0/);
  });
});

describe("Reliability exposes latency as a bounded sibling of Platform", () => {
  it("mounts the platform and latency halves conditionally", () => {
    assert.match(planes, /type DependencyPane = "map" \| "dag" \| "providers" \| "platform" \| "latency"/);
    assert.match(planes, /id: "latency", label: "Latency"/);
    assert.match(planes, /pane === "platform"[\s\S]*?part="platform"/);
    assert.match(planes, /pane === "latency"[\s\S]*?part="latency"/);
  });

  it("keeps both focused layout partials ahead of the trailing accessibility layer", () => {
    const execution = manifest.indexOf("14zzk-execution-layout-followup.css");
    const risk = manifest.indexOf("14zzl-risk-systems-layout-followup.css");
    const trailing = manifest.indexOf("15-navigator-and-trailing-layer.css");
    assert.ok(execution >= 0 && risk > execution && trailing > risk);
  });
});
