import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasDrawableMakerRange, makerPanelKey, makerPanelLabel } from "../lib/coherence/maker-dispersion";
import type { CoherenceDispersion } from "../lib/coherence/types-lab";

const row = (overrides: Partial<CoherenceDispersion> = {}): CoherenceDispersion => ({
  market_ticker: "TEST-MARKET",
  band_width: null,
  band_fraction: null,
  band_note: "",
  quotes: 2,
  usable: 2,
  median: "0.5000",
  lowest: "0.4900",
  highest: "0.5100",
  spread: "0.0200",
  median_width: "0.0100",
  crossed: 0,
  thin: false,
  detail: "",
  ...overrides,
});

describe("maker-range admission", () => {
  it("draws a range only from at least two usable maker answers", () => {
    assert.equal(hasDrawableMakerRange(row()), true);
    assert.equal(hasDrawableMakerRange(row({ usable: 1, lowest: "0.5000", highest: "0.5000", spread: null })), false);
  });

  it("keeps two RFQs on one ticker separate without displaying their private ids", () => {
    const rows = [row({ rfq_id: "private-r1" }), row({ rfq_id: "private-r2" })];
    assert.deepEqual(rows.map(makerPanelKey), ["private-r1", "private-r2"]);
    assert.deepEqual(rows.map((item, index) => makerPanelLabel(item, index, rows)), [
      "TEST-MARKET, request 1",
      "TEST-MARKET, request 2",
    ]);
    assert.doesNotMatch(makerPanelLabel(rows[0], 0, rows), /private-r1/);
  });

  it("withholds a band when an endpoint or the disagreement reading is absent", () => {
    assert.equal(hasDrawableMakerRange(row({ highest: null })), false);
    assert.equal(hasDrawableMakerRange(row({ spread: null })), false);
  });
});
