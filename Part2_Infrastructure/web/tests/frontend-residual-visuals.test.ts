import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { drawdownAreaPath } from "../components/portfolio/EquityCurve";
import { compositionStackRows } from "../components/portfolio/AllocationMixes";
import { dsrSearchView } from "../components/research/DsrSearchDistribution";
import { nextFactorMatrixIndex } from "../components/research/FactorPanel";
import { mcTailGaugeModel } from "../components/risk/McTailGauge";
import { buildDepthHeatmap } from "../components/execution/DepthHeatmap";
import { appendFeedFreshnessHistory, hasLiveTransport } from "../components/data/FeedFreshnessGrid";
import { dependencyEdgeLatency, flattenDependencyDag } from "../components/systems/DependencyDag";
import { appendDepthHistory, type DepthHistoryFrame } from "../lib/livebook";
import type { DependencyNode } from "../lib/dependency-graph";
import type { PortfolioPosition, StrategyAttribution } from "../lib/portfolio";
import type { SystemHealth } from "../components/systems/types";
import type { SweepResponse } from "../lib/types";

const root = join(import.meta.dirname, "..");

test("drawdown area closes high-water mark to equity and refuses malformed points", () => {
  const path = drawdownAreaPath(
    [{ highWaterMark: 100, equity: 100 }, { highWaterMark: 110, equity: 96 }],
    (index) => index * 10,
    (value) => value,
  );
  assert.equal(path, "M0.00,100.00L10.00,110.00L10.00,96.00L0.00,100.00Z");
  assert.equal(drawdownAreaPath(
    [{ highWaterMark: 100, equity: 100 }, { highWaterMark: 110, equity: Number.NaN }],
    (index) => index,
    (value) => value,
  ), "");
});

test("Monte Carlo gauge reads genuine loss quantiles against headroom", () => {
  const model = mcTailGaugeModel({ loss: { p50: 40, p95: 120, p99: 180 } }, 150);
  assert.ok(model);
  assert.equal(model.breaches, false);
  assert.equal(model.remaining, 30);
  assert.equal(mcTailGaugeModel({ loss: { p50: 0, p95: Number.NaN, p99: 1 } }, 5), null);
});

test("DSR view bins candidate Sharpes but keeps one selected-winner hurdle", () => {
  const data = {
    results: [{ sharpe: -0.2 }, { sharpe: 0.3 }, { sharpe: 0.8 }, { sharpe: 1.4 }],
    best: { sharpe: 1.4 },
    expectedMaxSharpe: 0.75,
    deflatedSharpeRatio: 0.62,
  } as unknown as Pick<SweepResponse, "results" | "best" | "expectedMaxSharpe" | "deflatedSharpeRatio">;
  const view = dsrSearchView(data);
  assert.ok(view);
  assert.equal(view.sharpes.length, 4);
  assert.equal(view.clears, 2);
  assert.equal(view.selectedClears, true);
});

test("factor matrix keyboard movement is bounded", () => {
  assert.equal(nextFactorMatrixIndex(0, "ArrowLeft", 3), 0);
  assert.equal(nextFactorMatrixIndex(1, "ArrowRight", 3), 2);
  assert.equal(nextFactorMatrixIndex(1, "Home", 3), 0);
  assert.equal(nextFactorMatrixIndex(1, "End", 3), 2);
  assert.equal(nextFactorMatrixIndex(1, "Enter", 3), null);
});

test("L2 history is bounded and heatmap cells contain only incoming levels", () => {
  const frame = (at: number, bid: number, ask: number): DepthHistoryFrame => ({
    at, mid: (bid + ask) / 2, liveVenues: 2, bids: [[bid, 2]], asks: [[ask, 3]],
  });
  let history: DepthHistoryFrame[] = [];
  for (let at = 0; at < 6; at += 1) history = appendDepthHistory(history, frame(at, 99 + at, 101 + at), 4);
  assert.deepEqual(history.map((entry) => entry.at), [2, 3, 4, 5]);
  assert.deepEqual(appendDepthHistory(history, frame(6, 105, 107), 1).map((entry) => entry.at), [6]);
  const model = buildDepthHeatmap(history, 8);
  assert.ok(model);
  assert.equal(model.frames.length, 4);
  assert.equal(model.cells.length, 32);
  assert.equal(model.cells.reduce((sum, cell) => sum + cell.bidUsd, 0),
    history.reduce((sum, entry) => sum + entry.bids[0][0] * entry.bids[0][1], 0));
});

test("freshness history keeps gaps and pulses only for genuine live transport", () => {
  const health = {
    fetchedAt: "2026-08-28T00:00:00Z",
    platform: {
      market_data: {
        feeds: [{
          venue: "BINANCE", status: "up", connected: true, synthetic: false,
          reconnects: 0, uptime_seconds: 10,
          symbols: [{ symbol: "BTCUSDT", update_rate_hz: 4, age_seconds: 0.2, updates_total: 40, stale: false }],
        }],
      },
    },
  } as unknown as SystemHealth;
  const next = appendFeedFreshnessHistory({}, health, 3);
  assert.deepEqual(next["BINANCE:BTCUSDT"], [0.2]);
  const feed = {
    venue: "BINANCE", status: "up" as const, connected: true, synthetic: false,
    reconnects: 0, uptimeSeconds: 10, updatesTotal: 40, meanRateHz: 4,
    books: [{ symbol: "BTCUSDT", updateRateHz: 4, ageSeconds: 0.2, updatesTotal: 40, stale: false }],
  };
  assert.equal(hasLiveTransport(feed, feed.books[0]), true);
  assert.equal(hasLiveTransport({ ...feed, synthetic: true }, feed.books[0]), false);
});

test("dependency DAG uses only measured gateway-hop p99 and labels every other edge unmeasured", () => {
  const rootNode: DependencyNode = {
    id: "web", label: "web", role: "runtime", health: "ok", detail: "ok", source: "test",
    children: [{ id: "gateway", label: "gateway", role: "api", health: "ok", detail: "ok", source: "test" }],
  };
  assert.deepEqual(flattenDependencyDag(rootNode).map(({ node, parentId, depth }) => [node.id, parentId, depth]),
    [["web", null, 0], ["gateway", "web", 1]]);
  const health = { summary: { gatewayHopLatency: { n: 30, p99: 42 } } } as unknown as SystemHealth;
  assert.deepEqual(dependencyEdgeLatency("web", "gateway", health), {
    measured: true, p99: 42, label: "web to gateway p99 42 ms, n=30",
  });
  assert.equal(dependencyEdgeLatency("gateway", "risk", health).label, "edge latency not measured");
});

test("composition stacks never cross current holdings with lifetime sleeve flow", () => {
  const positions = [{ symbol: "BTCUSDT", notional: 60 }, { symbol: "AAPL", notional: 40 }] as unknown as PortfolioPosition[];
  const attribution = [{ strategy: "momentum", notional: 200 }] as unknown as StrategyAttribution[];
  const rows = compositionStackRows(positions, attribution);
  assert.deepEqual(rows.map(({ label, scope, provenance }) => [label, scope, provenance]), [
    ["Asset class", "current gross exposure", "measured"],
    ["Settlement", "current gross exposure", "inferred"],
    ["Sleeve", "lifetime traded notional", "flow"],
  ]);
  assert.equal(rows[2].entries[0].value, 200);
});

test("phone shell stays viewport-locked with one touch- and keyboard-reachable scroller", () => {
  const base = readFileSync(join(root, "app/globals/00-tokens-and-base.css"), "utf8");
  const shell = readFileSync(join(root, "app/globals/12-workspace-standardisation.css"), "utf8");
  assert.match(base, /body\s*\{[\s\S]*?height: 100svh;[\s\S]*?overflow: hidden;/);
  assert.match(shell, /\.workspace-shell\s*\{[\s\S]*?height: calc\(100svh - var\(--header-h\)\);[\s\S]*?overflow-y: auto;/);
  assert.match(shell, /touch-action: pan-y pinch-zoom;/);
  assert.doesNotMatch(shell, /@media \(max-width: 620px\)[\s\S]*?\.workspace-subtabs\s*\{\s*position: static;/);
});
