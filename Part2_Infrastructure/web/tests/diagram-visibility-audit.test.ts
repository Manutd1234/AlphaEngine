import assert from "node:assert/strict";
import test from "node:test";

import { isDiagramLoadingText } from "../scripts/diagram-visibility-audit.mjs";
import { read } from "./helpers/workspace-sources";

test("diagram paint audit waits through live-read placeholders", () => {
  for (const reading of [
    "Reading the exchange…",
    "Working the example…",
    "Replaying the tape…",
    "Asking the makers…",
    "Sizing the log-optimal stake…",
    "Loading transport",
    "Waiting for the selected family's solver certificate.",
    "Pricing the fee at every price…",
  ]) {
    assert.equal(isDiagramLoadingText(reading), true, reading);
  }
});

test("diagram paint audit does not mistake analytical gap notes for loading", () => {
  for (const reading of [
    "No poll has landed yet, so there is nothing to plot against time.",
    "Two horizons are drawn as gaps because no source resolves them.",
    "Reference rate unavailable — entitlement required.",
  ]) {
    assert.equal(isDiagramLoadingText(reading), false, reading);
  }
});

test("live diagram placeholders expose a busy state until their gateway answer lands", () => {
  for (const file of [
    "../components/coherence/UniversePane.tsx",
    "../components/coherence/BooksPane.tsx",
    "../components/coherence/SurfacePane.tsx",
    "../components/coherence/StakePane.tsx",
    "../components/coherence/FeesPane.tsx",
    "../components/coherence/RfqPane.tsx",
    "../components/coherence/SettlementPane.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /role="status" aria-busy="true"/, file);
  }
});

test("a completed empty universe is terminal instead of an endless reading label", () => {
  for (const file of [
    "../components/coherence/SurfacePane.tsx",
    "../components/coherence/StakePane.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /const universePending = !universe\.data && !universe\.error/);
    assert.match(source, /No family is available from this completed/);
    assert.match(source, /busy=\{universePending\}/);
  }
});

test("diagram audit cannot pass an unexplained figure with no plot", () => {
  const source = read("../scripts/diagram-visibility-audit.mjs");
  assert.match(source, /isFigure && !plot && !explicitlyUnavailable\) issues\.push\("missing-plot"\)/);
  assert.match(source, /issues\.push\("empty-plot"\)/);
});

test("visual success is reported separately from end-to-end gateway availability", () => {
  const source = read("../scripts/diagram-visibility-audit.mjs");
  assert.match(source, /fullyAvailable: paintPassed/);
  assert.match(source, /unavailable\.length === 0/);
  assert.match(source, /uniqueApiFailures\.length === 0/);
  assert.match(source, /unavailableApiReads\.length === 0/);
  assert.match(source, /page\.on\("response"/);
});

test("diagram audit waits on semantic busy state and rejects transparent SVG marks", () => {
  const source = read("../scripts/diagram-visibility-audit.mjs");
  assert.match(source, /querySelectorAll\("\[aria-busy='true'\]"\)/);
  assert.match(source, /style\.fillOpacity/);
  assert.match(source, /style\.strokeOpacity/);
  assert.match(source, /style\.strokeWidth/);
  assert.match(source, /tag === "line" \|\| tag === "polyline"/);
  assert.match(source, /!mark\.closest\("defs, clipPath, mask, symbol, marker, pattern"\)/);
  for (const file of [
    "../components/coherence/ConstraintLadder.tsx",
    "../components/coherence/FeeCurve.tsx",
  ]) {
    assert.match(read(file), /<FigureEmpty[^>]+busy/);
  }
});
