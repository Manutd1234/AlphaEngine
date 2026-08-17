/**
 * The decision-latency surfaces say which plane each number is.
 *
 * The header chip now headlines the gateway's in-process decision p99; the
 * network figures are demoted to the title and the Reliability tiles. These
 * source contracts hold the wiring in place: the chip takes its title and
 * label from the model (which names both planes), the guide teaches the two
 * planes apart, the tiles are relabelled, and no per-order ms figure sneaks
 * back in beside the new µs one.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

describe("the header chip is fed by the model, not by hand", () => {
  const chip = read("components/header/LatencyChip.tsx");

  it("passes the model's caveat and aria straight through", () => {
    assert.match(chip, /title=\{chip\.caveat\}/);
    assert.match(chip, /aria-label=\{chip\.ariaLabel\}/);
  });

  it("headlines the decision, with the core figure inline and optional", () => {
    assert.match(chip, /<small>Decision p99<\/small>/);
    assert.match(chip, /headline\.kind === "measured"/);
    assert.match(chip, /latency-chip__core/);
    assert.match(chip, /formatDuration\(v, "ns"\)/);
  });

  it("shows the core figure before the first order, and keeps the dash beside it", () => {
    // The gateway self-measures the compiled battery at startup, so the ns
    // plane exists while the µs plane is honestly empty. The chip renders the
    // core em in that state and STILL prints the dash for the decision — the
    // self-measure must never be promoted to a decision figure.
    assert.match(chip, /headline\.kind === "core-only"/);
    assert.match(chip, /\(\(headline\.kind === "measured" && headline\.coreP99Ns != null\) \|\| headline\.kind === "core-only"\)/);
    // The dash branch is the fall-through: only measured/collecting print words.
    assert.match(chip, /"collecting"\s*\)\s*:\s*\(\s*"—"/);
  });

  it("the header threads both planes into it", () => {
    const header = read("components/WorkspaceHeader.tsx");
    assert.match(header, /<LatencyChip decision=\{decisionLatency\} network=\{latency\}/);
    const page = read("app/dashboard/page.tsx");
    assert.match(page, /decisionLatency=\{systems\.decisionLatency\}/);
  });
});

describe("Reliability teaches the two planes apart", () => {
  it("the guide names the in-process decision and the polled network", () => {
    const guide = read("components/systems/HealthMatrix.tsx");
    assert.match(guide, /Decision p99 \(header chip\)/);
    assert.match(guide, /in-process/);
    assert.match(guide, /Upstream p99 \(this table\)/);
    assert.match(guide, /network, polled/);
  });

  it("the console and the strip name the self-measure where the core figure came from", () => {
    const console_ = read("components/ReliabilityConsole.tsx");
    assert.match(console_, /decision\.kind === "no-orders" && decision\.core/);
    assert.match(console_, /from the startup self-measure; no orders yet/);
    const overview = read("components/systems/ReliabilityOverview.tsx");
    assert.match(overview, /core_self_test_samples/);
    assert.match(overview, /self-measure \$\{d\.core_self_test_samples/);
    // Provenance in the title, in words: synthetic book, never the µs plane.
    assert.match(overview, /synthetic two-venue book; the decision µs figure never includes them/);
    // The types carry the field the gateway publishes.
    const types = read("components/systems/types.ts");
    assert.match(types, /core_self_test_samples\?: number \| null;/);
  });

  it("the console has both a Decision and an Upstream tile", () => {
    const console_ = read("components/ReliabilityConsole.tsx");
    assert.match(console_, /label: "Decision p99"/);
    assert.match(console_, /label: "Upstream p99"/);
  });

  it("the overview note no longer calls the route a different plane from a header p99 that has moved", () => {
    const overview = read("components/systems/ReliabilityOverview.tsx");
    assert.doesNotMatch(overview, /a different plane from the header p99/);
    assert.match(overview, /not the decision p99/);
  });
});
