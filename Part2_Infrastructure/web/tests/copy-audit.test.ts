/**
 * The copy audit, pinned so it stays done.
 *
 * The desk read wordy, and measuring it found that the volume was not in the
 * long explanations — those earn their space, and several are the null-honesty
 * and empty-state rules being obeyed — but in a handful of shapes that restate
 * something already on the same screen. Four kinds, each of which grows back
 * quietly because each looks like helpfulness when written:
 *
 *   1. A tab's one-sentence description paraphrasing its own section rail.
 *   2. A card note repeating a figure that is a headline in the same grid.
 *   3. A note stating the sign of a number the number already signs.
 *   4. A hint narrating the navigation its own button performs.
 *
 * The first is worth a real invariant rather than a string match, and it is the
 * first test below: no tab description may contain a label from the rail
 * directly beneath it. The rest are pinned against the specific line that was
 * removed, with the reason, so a regression fails with an argument instead of a
 * diff.
 *
 * What this file deliberately does NOT do is cap length. "Detailed" and "wordy"
 * are not the same property, and a test that could not tell them apart would
 * push the desk toward saying less than it knows.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEVELOPER_SECTIONS,
  DATA_SECTIONS,
  EXECUTION_SECTIONS,
  OVERVIEW_SECTIONS,
  PORTFOLIO_SECTIONS,
  RELIABILITY_SECTIONS,
  RESEARCH_SECTIONS,
  RISK_SECTIONS,
} from "../lib/sections";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comments stripped: a comment explaining a removal must not fail its own test. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

// Research draws its head inside its own component now; scanning only
// page.tsx would drop one of the eight tab descriptions from the audit.
const page = code(read("../app/dashboard/page.tsx"))
  + code(read("../components/ResearchWorkspace.tsx"));
const overview = code(read("../components/WorkspaceOverview.tsx"));
const deck = code(read("../components/overview/KpiDeck.tsx"));
const footer = code(read("../components/common/NextStepFooter.tsx"));
const verdict = code(read("../components/Verdict.tsx"));
const liveMarket = code(read("../components/LiveMarket.tsx"));

/** Every `description={<>…</>}` rendered by a workspace header, by source. */
function descriptions(source: string): string[] {
  return [...source.matchAll(/description=\{<>([\s\S]*?)<\/>\}/g)].map((m) =>
    m[1].replace(/\{[^}]*\}/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(),
  );
}

describe("a tab's description does not paraphrase the rail beneath it", () => {
  // The rail is the next element on the page and states these labels itself, in
  // order, as controls the reader can press. A sentence listing them is the same
  // information with none of the affordance, and it was what four of the eight
  // tabs opened with. PageHead asks this field for "the question this tab
  // answers", which is the thing a list of destinations structurally cannot be.
  const rails = [
    ["Overview", OVERVIEW_SECTIONS],
    ["Research", RESEARCH_SECTIONS],
    ["Execution", EXECUTION_SECTIONS],
    ["Portfolio", PORTFOLIO_SECTIONS],
    ["Risk", RISK_SECTIONS],
    ["Data", DATA_SECTIONS],
    ["Reliability", RELIABILITY_SECTIONS],
    ["Developer", DEVELOPER_SECTIONS],
  ] as const;

  const all = [...descriptions(page), ...descriptions(overview)];

  it("finds the descriptions it is meant to be checking", () => {
    // Guards the regex: a rename that stopped it matching would make every
    // assertion below pass by finding nothing at all.
    assert.ok(all.length >= 4, `expected at least 4 tab descriptions, found ${all.length}`);
  });

  for (const [tab, sections] of rails) {
    it(`${tab}: no section label appears in any tab description`, () => {
      for (const section of sections) {
        // Multi-word labels only. "Overview", "Trade" and "Runs" are ordinary
        // English and a sentence is allowed to contain them; "Walk-forward",
        // "Fill quality" and "Monte Carlo" are the rail speaking.
        const label = section.label;
        if (label.split(/[\s/]+/).length < 2) continue;
        for (const description of all) {
          assert.ok(
            !description.toLowerCase().includes(label.toLowerCase()),
            `a tab description contains the ${tab} rail's "${label}": ${description}`,
          );
        }
      }
    });
  }
});

describe("a note does not repeat a figure that is a headline beside it", () => {
  it("Order intent does not carry gross exposure or headroom", () => {
    // Gross exposure is a card in the same grid whose headline IS that figure,
    // and Binding constraint's note is "<limit>: <headroom> left of <limit>".
    const intent = deck.slice(deck.indexOf("const intentNote"), deck.indexOf("const intentNote") + 400);
    assert.doesNotMatch(intent, /gross/i, "Order intent restates the Gross exposure card");
    assert.doesNotMatch(intent, /headroom/i, "Order intent restates the Binding constraint card");
    assert.match(intent, /modeled cost/, "the modelled cost is this card's own fact and must stay");
  });

  it("the Data plane card does not carry the p99 the band above states", () => {
    const note = deck.slice(deck.indexOf("const dataNote"), deck.indexOf("const dataNote") + 500);
    assert.doesNotMatch(note, /p99/, "the band's Data plane p99 tile is the headline for this figure");
    assert.match(note, /cache/, "the cache hit rate is this card's own fact and must stay");
  });

  it("Book concentration does not carry the quarantine count", () => {
    // The Data plane card in the same eight-card grid appends the quarantine
    // to its own note, and the deck's rule is that a figure is printed once.
    // Two cards carrying it made the same number look like two measurements.
    const start = deck.indexOf('label="Book concentration"');
    assert.notEqual(start, -1);
    const card = deck.slice(start, start + 400);
    assert.doesNotMatch(card, /quarantine/i, "the quarantine belongs to the Data plane card");
    assert.match(card, /largest_share/, "the largest holding's share is this card's own fact and must stay");
  });

  it("the band's p99 tile does not carry the ready count the deck heads with", () => {
    // The deck's Data plane card headline IS "{ready}/{total} ready". The band
    // stated it again as the p99 tile's note, where it was never provenance
    // for the p99 figure it sat under.
    const start = overview.indexOf('label: "Data plane p99"');
    assert.notEqual(start, -1);
    const tile = overview.slice(start, start + 500);
    assert.doesNotMatch(tile, /routes ready/, "the deck's Data plane card is the headline for that count");
    assert.match(tile, /measured from this browser's polls/,
      "the provenance is this tile's own and must stay");
  });

  it("Loss beyond VaR does not carry the validation zone", () => {
    // The zone belongs under the figure it validates, which is the band's VaR
    // tile. This is the deck's own stated rule — see the comment on that tile.
    const start = deck.indexOf('label="Loss beyond VaR"');
    assert.notEqual(start, -1);
    const card = deck.slice(start, start + 600);
    assert.doesNotMatch(card, /zone/, "the zone is stated under the VaR figure, not under CVaR");
    assert.match(card, /annualisedVolatility/, "the volatility is this card's own fact and must stay");
  });
});

describe("a note does not state a sign the number already carries", () => {
  it("Day P&L says the percentage, not the direction", () => {
    // The value renders "+$142,500" and the note opens "+1.4%". "up on the
    // session" was the third statement of one sign. Removing it is not a
    // colour-only-meaning problem: both + and − are typographic.
    assert.doesNotMatch(overview, /on the session`?\s*:\s*"book connecting"[\s\S]{0,40}up/);
    assert.doesNotMatch(overview, /dayTone/, "the binding existed only for that word");
    assert.match(overview, /signedPct\(equity\.daily_return\)\} on the session/);
  });
});

describe("a hint does not narrate the button beside it", () => {
  it("the flow ring carries no field nothing renders", () => {
    // roleLabel was set on all eight entries and read by nothing; the role is
    // already inside the kicker it sits next to.
    assert.doesNotMatch(footer, /roleLabel/, "roleLabel renders nowhere");
  });

  it("no hint describes moving between tabs", () => {
    const hints = [...footer.matchAll(/hint: "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hints.length >= 8, `expected the eight ring hints, found ${hints.length}`);
    for (const hint of hints) {
      assert.doesNotMatch(hint, /\bmove from\b/i, `a hint narrates navigation: ${hint}`);
      assert.doesNotMatch(hint, /\breturn to the .*(dashboard|overview)\b/i,
        `a hint restates its own title: ${hint}`);
    }
  });
});

describe("a line does not quote figures the row below it pairs properly", () => {
  it("the verdict card quotes no benchmark figure of its own", () => {
    // The stat row beneath carries "buy & hold −1.11" under the strategy's own
    // Sharpe and "buy & hold −40.7%" under its own return — beside their
    // counterparts, which is where a comparison is actually made.
    //
    // This used to anchor on the standard-setting sentence that sat at the foot
    // of the card and check the 400 characters after it. The sentence has been
    // removed; the guarantee it was riding on has not, and applies to the whole
    // file now rather than one window inside it.
    assert.doesNotMatch(verdict, /benchmark\.totalReturn|benchmark\.sharpe/,
      "the benchmark figures belong in the stat row, paired with the strategy's own");
  });

  it("the execution cost probe does not restate its heading", () => {
    const probe = liveMarket.slice(liveMarket.indexOf("<h2>Execution cost probe</h2>"));
    assert.doesNotMatch(probe.slice(0, 400), /what it would actually cost/,
      'the card is titled "Execution cost probe"');
    assert.match(probe.slice(0, 400), /live ladder/, "that the walk is live is not in the heading");
  });
});
