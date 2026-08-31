import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  mergePinnedReadings,
  type SharedXReading,
} from "../lib/coherence/use-shared-x-readout";
import {
  QuantInspectionPair,
  QuantInspectionReadout,
} from "../components/coherence/QuantInspectionPair";
import { read } from "./helpers/workspace-sources";

const basketNull = read("../components/coherence/BasketNullInstrument.tsx");
const targetedLayout = read("../components/coherence/BasketInstruments.module.css");

describe("Proofs pinned comparisons preserve fact identity", () => {
  it("matches optional estimator and refusal rows by label rather than array position", () => {
    const current: SharedXReading = {
      title: "current poll",
      rows: [
        { label: "Series A", value: "0.0010", raw: 10 },
        { label: "Families", value: "4 families" },
        { label: "Run", value: "run 8" },
      ],
    };
    const pinned: SharedXReading = {
      title: "pinned poll",
      rows: [
        { label: "Series A", value: "0.0004", raw: 4 },
        { label: "Estimator", value: "isotonic" },
        { label: "Families", value: "3 families" },
        { label: "Reason", value: "insufficient prices" },
        { label: "Run", value: "run 3" },
      ],
    };

    const merged = mergePinnedReadings(current, pinned, (now, then) => `delta ${Number(now.raw) - Number(then.raw)}`);

    assert.deepEqual(merged.rows.map((row) => [row.label, row.value]), [
      ["Series A", "0.0010 was 0.0004, delta 6"],
      ["Families", "4 families was 3 families"],
      ["Run", "run 8 was run 3"],
    ]);
    assert.doesNotMatch(merged.rows.map((row) => row.value).join(" "), /isotonic|insufficient prices/);
  });
});

describe("Proofs exact-value inspection has an accessible idle state", () => {
  it("keeps its instruction for assistive technology without activating the visible plate", () => {
    const TypedInspectionReadout = QuantInspectionReadout<{ value: string }>;
    const markup = renderToStaticMarkup(createElement(
      QuantInspectionPair,
      null,
      createElement(TypedInspectionReadout, {
        rows: [{ value: "0.42" }],
        reading: (row: { value: string }) => row.value,
      }),
    ));

    assert.match(markup, /data-active="false"/);
    assert.match(markup, /class="sr-only"/);
    assert.match(markup, /Focus a figure mark or exact-value row to inspect it/);
    assert.doesNotMatch(markup, /data-active="true"/);
  });
});

describe("zero-leg dependency circuit remains contained", () => {
  it("stacks the interactive circuit before narrow geometry can overlap", () => {
    assert.match(basketNull, /Family activity[\s\S]*Certificate legs[\s\S]*Comparable legs[\s\S]*Capacity context/);
    assert.match(basketNull, /className=\{styles\.dependencyRail\}[\s\S]*?role="tablist"/);
    assert.match(basketNull, /role="tab"[\s\S]*?aria-selected=\{selected === index\}[\s\S]*?tabIndex=\{selected === index \? 0 : -1\}/);
    assert.match(basketNull, /aria-controls=\{`\$\{circuitId\}-detail`\}/);
    assert.match(basketNull, /role="tabpanel"[\s\S]*?aria-labelledby=\{`\$\{circuitId\}-stage-\$\{selected\}`\}/);
    assert.match(basketNull, /className=\{styles\.dependencyGauge\}[\s\S]*?"--dependency-progress"/);
    assert.match(basketNull, /className=\{styles\.dependencyInspector\}[\s\S]*?aria-live="polite"/);
    assert.match(targetedLayout, /\.dependencyRail\s*\{[^}]*repeat\(var\(--dependency-stage-count\), minmax\(0, 1fr\)\)/s);
    assert.match(basketNull, /"--dependency-stage-count": stages\.length/,
      "the rail does not derive its column count from the live stage model");
    assert.match(targetedLayout, /\.dependencyRail > li:not\(:last-child\)::after\s*\{[^}]*inset-inline-start:\s*calc\(50% \+ var\(--dependency-node-radius\)\)[^}]*inline-size:\s*calc\(100% \+ var\(--dependency-stage-gap\) - var\(--dependency-node-size\)\)/s,
      "the horizontal connector does not run from one node edge to the next");
    assert.doesNotMatch(targetedLayout, /\.dependencyRail::before/,
      "the detached rail-wide line can cross stage copy again");
    assert.match(
      targetedLayout,
      /@container basket-instrument \(max-width: 52rem\)[\s\S]*?\.dependencyRail\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    );
    assert.match(targetedLayout, /@container basket-instrument \(max-width: 52rem\)[\s\S]*?\.dependencyRail > li:not\(:last-child\)::after\s*\{[^}]*border-inline-start:\s*2px solid var\(--rule\)/s,
      "the stacked process does not reconnect the same nodes vertically");
    assert.match(targetedLayout, /@container basket-instrument \(max-width: 52rem\)[\s\S]*?\.dependencyCanvas\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    assert.match(targetedLayout, /\.dependencyValue\s*\{[^}]*line-height:[^}]*\}/s);
    assert.doesNotMatch(targetedLayout, /\.dependencyValue[^}]*white-space:\s*nowrap/s,
      "stage values are truncated instead of wrapping inside their stage");
    assert.doesNotMatch(targetedLayout, /\.dependencyInspector[^}]*white-space:\s*nowrap/s);
  });
});
