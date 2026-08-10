/**
 * The stress panel's segment control always names the shocks in force.
 *
 * THE DEFECT THIS PINS
 *
 * Moving a hand-shock slider unpresses every named scenario pill — correct,
 * because the numbers below stop being the preset's — but the control was left
 * with NO lit segment. A segmented control with nothing selected does not read
 * as "custom state"; it reads as broken state, and the report that prompted
 * this fix said exactly that: "the UI doesn't show the blue background once I
 * edit". The information existed (a badge and the sub-line changed) but the
 * one control whose job is "which of these is active" went dark.
 *
 * The fix is a fifth segment, "Hand shocks": lit exactly when hand shocks are
 * active, disabled-but-visible otherwise — the same rule Guided-tier controls
 * follow (collapsed, never absent), because an absent control reads as a
 * missing feature.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../components/portfolio/StressTest.tsx", import.meta.url)),
  "utf8",
);

describe("one segment is always lit", () => {
  it("named pills are pressed only when their preset is what is scored", () => {
    assert.match(source, /aria-pressed=\{!manualActive && s\.id === scenarioId\}/);
  });

  it("the custom segment is pressed exactly when hand shocks are active", () => {
    assert.match(source, /aria-pressed=\{manualActive\}/);
  });

  it("the custom segment is disabled, never hidden, when inactive", () => {
    // `manualActive && <button…` would remove it from the DOM — the exact
    // "absent control reads as missing feature" failure this file exists on.
    assert.match(source, /disabled=\{!manualActive\}[\s\S]{0,600}?Hand shocks\s*<\/button>/);
    assert.doesNotMatch(source, /\{manualActive && \(?\s*<button[^>]*stress-scenarios__custom/);
  });

  it("choosing a named scenario clears the hand shocks", () => {
    // Without this, clicking "Melt-up" while sliders are set would light the
    // named pill while the numbers stay the sliders' — two controls claiming
    // authorship of one result.
    assert.match(source, /setScenarioId\(s\.id\);\s*setManual\(\{\}\);/);
  });

  it("explains itself in both states", () => {
    // The disabled state teaches the mechanism; the active state names the way
    // back. A control that lights up for a reason the reader cannot discover
    // is the original bug wearing the fix's clothes.
    assert.match(source, /Move a slider below to set a hand shock/);
    assert.match(source, /clear them to return to/);
  });
});
