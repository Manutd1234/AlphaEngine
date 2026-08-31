import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) => readFileSync(
  fileURLToPath(new URL(relative, import.meta.url)),
  "utf8",
);

const strips = read("../components/coherence/DispersionStrips.tsx");
const table = read("../components/coherence/DispersionTable.tsx");
const pane = read("../components/coherence/RfqPane.tsx");
const css = read("../components/coherence/DispersionStrips.module.css");

describe("maker dispersion is a selectable quantitative instrument", () => {
  it("selects one market through Plot's existing pointer and keyboard contract", () => {
    assert.match(strips, /import \{ useState \} from "react"/);
    assert.match(strips, /const \[selectedTicker, setSelectedTicker\] = useState/);
    assert.match(strips, /<Plot[^>]*onSelect=\{\(index\) => setSelectedTicker\(strips\[index\]\?\.ticker \?\? null\)\}/s);
    assert.match(strips, /className="coh-dispersion__hit"/);
    assert.match(strips, /<title>\{selectionLabel\(strip\)\}<\/title>/);
    assert.match(strips, /className=\{`coh-dispersion__row\$\{selected\.ticker === strip\.ticker \? " is-selected" : ""\}`\}/);
  });

  it("shows only gateway-owned exact fields for the selected market", () => {
    assert.match(strips, /import \{ Card \} from "@\/components\/ui\/card"/);
    assert.match(strips, /className=\{`markets-dispersion-inspector \$\{styles\.inspector\}`\}/);
    assert.match(strips, /data-selected-ticker=\{selected\.ticker\}/);
    assert.match(strips, /aria-live="polite"/);
    for (const field of [
      "quotes", "usable", "median", "spread", "median_width", "crossed", "band_fraction",
    ]) assert.match(strips, new RegExp(`selected\\.row\\.${field}`), `${field} is absent from the exact inspector`);
    assert.doesNotMatch(strips, /Math\.(?:random|round)|Date\.now|setInterval/,
      "the inspector derives a number the RFQ payload did not provide");
  });

  it("keeps the complete twelve-column evidence table behind its existing disclosure", () => {
    assert.match(pane, /<DispersionStrips rows=\{data\.dispersions\} \/>[\s\S]*?<DispersionTable rows=\{data\.dispersions\} \/>/);
    assert.match(table, /<details className="disclosure">/);
    assert.equal((table.match(/<th scope="col"/g) ?? []).length, 12);
    for (const field of ["quotes", "usable", "median", "lowest", "highest", "spread", "median_width", "crossed", "band_width", "band_fraction", "detail"]) {
      assert.match(table, new RegExp(`row\\.${field}`), `the full table dropped ${field}`);
    }
  });
});

describe("the selected-market inspector is dense without widening the page", () => {
  it("uses a scoped auto-fitting metric grid with wrap-safe cells", () => {
    assert.match(css, /\.instrument\s*\{[^}]*container-type:\s*inline-size[^}]*min-inline-size:\s*0/s);
    assert.match(css, /\.inspector\s*\{[^}]*min-inline-size:\s*0/s);
    assert.match(css, /\.inspector dl\s*\{[^}]*repeat\(auto-fit,\s*minmax\(min\(100%,\s*8rem\),\s*1fr\)\)/s);
    assert.match(css, /\.inspector dd\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    assert.match(css, /\.inspector dd\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  });

  it("makes selection visible by weight and shape, not colour alone", () => {
    assert.match(css, /\.instrument :global\(\.coh-dispersion__row\.is-selected\) :global\(\.coh-combo__band\)\s*\{[^}]*stroke-width:\s*2/s);
    assert.match(css, /\.instrument :global\(\.coh-dispersion__row\.is-selected\) :global\(\.coh-combo__label\)\s*\{[^}]*font-weight:/s);
  });
});
