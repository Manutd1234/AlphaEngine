import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const density = read("app/globals/14r-coherence-density.css");
const stakeView = read("components/coherence/surface/StakeView.tsx");
const distributionView = read("components/coherence/surface/DistributionView.tsx");
const feesPane = read("components/coherence/FeesPane.tsx");
const indexFamilies = read("components/coherence/IndexFamilies.tsx");
const calibrationBands = read("components/coherence/CalibrationBands.tsx");
const calibrationCorpus = read("components/coherence/CalibrationCorpus.tsx");
const rfqPane = read("components/coherence/RfqPane.tsx");
const dispersionTable = read("components/coherence/DispersionTable.tsx");
const booksInstruments = read("components/coherence/BooksInstruments.tsx");
const universePane = read("components/coherence/UniversePane.tsx");

describe("opened engine evidence remains contained at mobile width", () => {
  it("lets a disclosure grid item shrink below its table's intrinsic width", () => {
    const containment = density.match(/\.coherence-plane\s+:is\([\s\S]*?\)\s*\{\s*min-width:\s*0;/)?.[0] ?? "";

    assert.match(
      containment,
      /details\.disclosure/,
      "the disclosure owner must shrink before its local table scrollport can take over",
    );
  });

  it("names every route-owned table scroll region exposed by the 390px evidence sweep", () => {
    assert.match(stakeView, /className="table-wrap"\s+role="region"\s+aria-label=\{caption\}\s+tabIndex=\{0\}/);
    assert.match(distributionView, /className="table-wrap"\s+role="region"\s+aria-label=\{caption\}\s+tabIndex=\{0\}/);
    assert.match(feesPane, /className="table-wrap"\s+role="region"\s+aria-label="Fee fill ledger"\s+tabIndex=\{0\}/);
    assert.match(indexFamilies, /className="table-wrap"\s+role="region"\s+aria-label="Watched family index readings"\s+tabIndex=\{0\}/);
    assert.match(calibrationBands, /className="table-wrap"\s+role="region"\s+aria-label="Calibration price bands"\s+tabIndex=\{0\}/);
    assert.match(calibrationCorpus, /className="table-wrap"\s+role="region"\s+aria-label="Calibration corpus series"\s+tabIndex=\{0\}/);
    assert.match(rfqPane, /className="table-wrap"\s+role="region"\s+aria-label="Private-channel outcome definitions"\s+tabIndex=\{0\}/);
    assert.match(dispersionTable, /className="table-wrap"\s+role="region"\s+aria-label="Maker dispersion evidence"\s+tabIndex=\{0\}/);
    assert.match(booksInstruments, /aria-label=\{`Exact level ledger, \$\{ordered\.length\} rows`\}\s+className="table-wrap table-wrap--clamped"/);
    assert.match(universePane, /className="table-wrap table-wrap--clamped"\s+role="region"\s+aria-label=\{`\$\{event\.title \|\| event\.event_ticker\} outcome quotes`\}\s+tabIndex=\{0\}/);
  });
});
