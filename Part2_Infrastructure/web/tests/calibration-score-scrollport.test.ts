/** Calibration score containment without dropping any evidence columns. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const score = readFileSync(
  fileURLToPath(new URL("../components/coherence/CalibrationScore.tsx", import.meta.url)),
  "utf8",
);

const scoreView = score.slice(score.indexOf("export function ScoreMeasuresView("));

describe("the calibration score table owns its narrow-width overflow", () => {
  it("uses one named, keyboard-reachable local scrollport", () => {
    assert.match(
      scoreView,
      /<div\s+className="table-wrap"\s+data-calibration-score-scroll\s+tabIndex=\{0\}\s+role="region"\s+aria-label="Calibration score table; scroll horizontally"\s*>/,
    );
  });

  it("keeps the complete table inside that region", () => {
    const wrap = scoreView.indexOf("data-calibration-score-scroll");
    const table = scoreView.indexOf('<table className="coh-table">', wrap);
    const close = scoreView.indexOf("</div>", table);
    assert.ok(wrap >= 0 && table > wrap && close > table);
    assert.match(scoreView.slice(table, close), /<th scope="col">Measure<\/th>/);
    assert.match(scoreView.slice(table, close), /<th scope="col" className="num">Value<\/th>/);
    assert.match(scoreView.slice(table, close), /<th scope="col">What it reads<\/th>/);
    assert.match(scoreView.slice(table, close), /facts\.map\(\(fact\) =>/);
  });

  it("contains only this score surface and keeps a stable scrollbar gutter", () => {
    assert.match(
      globalsCss,
      /\[data-calibration-score-scroll\]\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-inline:\s*contain;[^}]*scrollbar-gutter:\s*stable;/s,
    );
  });
});
