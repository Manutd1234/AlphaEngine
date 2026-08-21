/**
 * THE PORTFOLIO TAB'S PROGRESSIVE-DISCLOSURE SWEEP, PINNED.
 *
 * A deletion sweep ran first and stopped at 1.9%, correctly: what was left was
 * load-bearing prose. The lever after that is a quieter desk rather than a
 * shorter one — a methodology note, a scope caveat, a formula and a worked
 * reading move behind `<details>` so they are not on screen at rest, and stay
 * in the DOM word for word for the reader who opens them.
 *
 * That manoeuvre has one silent failure mode: a "disclosure" that DELETED the
 * sentence instead of folding it reads exactly like a success — the screen got
 * shorter, nothing was watching the visible text, and the fact is gone. So
 * every fact this sweep touched is asserted PRESENT first and folded second.
 * The presence half is the honesty half.
 *
 * The other failure mode is folding what must never fold. `MUST_STAY_VISIBLE`
 * names four kinds: an EMPTY STATE (the pane's whole content on a quiet book,
 * which behind a fold renders as a blank plane), a NULL EXPLANATION (the
 * account of a withheld figure, often all the card has), a SAFETY marker
 * (orders are paper, the book is generated, nothing was invented during an
 * outage — one click away is a marker that did not fire), and an ACTED-ON
 * FIGURE. Each carries its own reason on the entry.
 *
 * `read()` refuses a short file for the reason `tests/helpers/portfolio-
 * sources.ts` gives: a source that resolved to an empty string makes every
 * containment check below pass while scanning nothing at all.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(relative: string): string {
  const source = readFileSync(join(root, relative), "utf8");
  assert.ok(
    source.trim().length > 400,
    `${relative} read as empty or near-empty from ${root}; every check below would pass against nothing`,
  );
  return source;
}

/** The files this sweep owns. */
const OWNED = [
  "components/PortfolioWorkspace.tsx",
  ...readdirSync(join(root, "components/portfolio"))
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => `components/portfolio/${entry}`)
    .sort(),
].filter((relative) => statSync(join(root, relative)).isFile());

/**
 * Comments blanked to spaces, LENGTH PRESERVED.
 *
 * Stripping them outright would shift every index, and this file's whole
 * method is "where in the file does this sentence sit". A comment explaining a
 * fold must not be mistaken for the fold.
 */
const blankComments = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/gm, (match, lead: string) =>
      lead + " ".repeat(match.length - lead.length));

/**
 * A flat view of the source, with a map back to the original offsets.
 *
 * Two normalisations, both needed to ask "is this sentence in the file":
 *   1. Runs of whitespace collapse to one space, because JSX re-indents prose
 *      when it moves inside a `<details>` and the words are what is at stake.
 *   2. A string-concatenation seam — `"…for a " + "covariance…"` — disappears,
 *      because several of the sentences below are written across two literals
 *      and a reader sees one sentence.
 */
function flatten(source: string): { text: string; map: number[] } {
  const seam = /["`]\s*\+\s*["`]/y;
  const space = /\s+/y;
  const chars: string[] = [];
  const map: number[] = [];
  let i = 0;
  while (i < source.length) {
    seam.lastIndex = i;
    if (seam.exec(source)) { i = seam.lastIndex; continue; }
    space.lastIndex = i;
    if (space.exec(source)) {
      if (chars.length > 0 && chars[chars.length - 1] !== " ") { chars.push(" "); map.push(i); }
      i = space.lastIndex;
      continue;
    }
    chars.push(source[i]);
    map.push(i);
    i += 1;
  }
  return { text: chars.join(""), map };
}

/** The needle, normalised the same way the haystack was. */
const flat = (text: string) => flatten(text).text;

/** Half-open `[start, end)` ranges of every `<details>`, nesting included. */
function detailRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while ((i = source.indexOf("<details", i)) !== -1) {
    let depth = 0;
    let j = i;
    while (j < source.length) {
      if (source.startsWith("<details", j)) { depth += 1; j += 8; continue; }
      if (source.startsWith("</details>", j)) { depth -= 1; j += 10; if (depth === 0) break; continue; }
      j += 1;
    }
    assert.equal(depth, 0, `an unclosed <details> at offset ${i}`);
    ranges.push([i, j]);
    i += 1;
  }
  return ranges;
}

type Scan = { ranges: Array<[number, number]>; view: { text: string; map: number[] } };
const scanned = new Map<string, Scan>();

/** One file, read once: where its folds are, and its flattened text. */
function scan(relative: string): Scan {
  let entry = scanned.get(relative);
  if (!entry) {
    const blanked = blankComments(read(relative));
    entry = { ranges: detailRanges(blanked), view: flatten(blanked) };
    scanned.set(relative, entry);
  }
  return entry;
}

/** One flag per occurrence of `needle`: true when a `<details>` hides it. */
function occurrences(relative: string, needle: string): boolean[] {
  const { ranges, view } = scan(relative);
  const target = flat(needle);
  assert.ok(target.length > 20, `needle too short to mean anything: "${target}"`);
  const folded: boolean[] = [];
  for (let at = view.text.indexOf(target); at !== -1; at = view.text.indexOf(target, at + 1)) {
    const start = view.map[at];
    const end = view.map[at + target.length - 1] + 1;
    folded.push(ranges.some(([from, to]) => from <= start && end <= to));
  }
  return folded;
}

// --------------------------------------------------------------------------
// 1. Nothing was deleted, and what moved is behind a fold
// --------------------------------------------------------------------------

/**
 * The prose this sweep moved: byte for byte what the file said before, now
 * inside a `<details>`. The `why` is the argument that it was foldable — a
 * methodology claim, a definition, a provenance note — and, where the claim
 * matters at rest, WHERE IT STILL SHOWS on screen with the fold shut.
 */
const MOVED: Array<{ file: string; needle: string; why: string }> = [
  {
    file: "components/portfolio/PerformanceSection.tsx",
    needle:
      "Lifetime totals, every order since the audit log opened. The Overview waterfall is "
      + "session-scoped: mixing the two subtracts a lifetime fee bill from one day&apos;s P&amp;L.",
    why: "scope caveat; the pane switcher above reads \"Flow, lifetime\" and \"Trend, this session\"",
  },
  {
    file: "components/portfolio/RiskAdjustedTrend.tsx",
    needle:
      "Drawdown uses the same running high-water mark as the gateway&rsquo;s halt rule. "
      + "The Sharpe line is <strong>per observation and not annualised</strong>: a poll series has "
      + "no stable period to scale by. It is blank for the first{\" \"} "
      + "{MIN_SHARPE_OBSERVATIONS} observations and breaks wherever the window is too thin to score.",
    why: "methodology; the plot's own caption reads \"Rolling Sharpe, per observation\"",
  },
  {
    file: "components/portfolio/DriftBars.tsx",
    needle:
      "Drift is{\" \"} <span className=\"num\">(target notional − current notional) ÷ gross before</span> — a share "
      + "of the <strong>whole book</strong>, not of the position, so a bar reading{\" \"} "
      + "{pct(driftBand, 0)} on a name twice that size means moving half of it.",
    why: "axis definition and a worked reading; the legend above still says \"of gross\"",
  },
  {
    file: "components/portfolio/PnlWaterfall.tsx",
    needle: "{legs.find((leg) => leg.key === \"residual\" || leg.key === \"unattributed\")?.note}",
    why: "defines a leg the chart already names, labels and basis-marks; also on the bar's <title>",
  },
  {
    file: "components/portfolio/PnlWaterfall.tsx",
    needle:
      "The market leg uses {waterfall.referenceSymbol} at {pct(waterfall.referenceReturn, 2)} as "
      + "the reference move, through each position&apos;s measured beta.",
    why: "provenance for one leg the table twin above prints with its basis and source",
  },
  {
    file: "components/portfolio/PnlWaterfall.tsx",
    needle:
      "In the sandbox that move is supplied, not measured, so no generated P&L is attributed to a real market move.",
    why: "the card's own kicker and the full-width chrome both declare the sandbox at rest",
  },
  {
    file: "components/portfolio/PnlWaterfall.tsx",
    needle: "Measured on the daily bar covering the gateway's session, withheld when the newest bar does not.",
    why: "provenance for the measured branch of the same sentence",
  },
  {
    file: "components/portfolio/EquityCurve.tsx",
    needle:
      "Backfilled from the gateway's persisted snapshots and extended by this tab's polls. "
      + "The sampling interval is the resolution: a shape, not a tick record.",
    why: "provenance and resolution; the header still prints the observation count",
  },
  {
    file: "components/portfolio/EquityCurve.tsx",
    needle: "Built from this tab's polls since it opened, filling in as persisted snapshots accumulate.",
    why: "the same note's other non-generated branch",
  },
];

describe("the sweep moved prose and deleted none of it", () => {
  for (const { file, needle, why } of MOVED) {
    const label = flat(needle).slice(0, 52);

    it(`keeps "${label}…" in ${file.split("/").pop()}`, () => {
      assert.ok(
        occurrences(file, needle).length > 0,
        `a disclosure sweep DELETED this instead of folding it (${why}):\n    ${flat(needle)}`,
      );
    });

    it(`folds "${label}…" behind a disclosure`, () => {
      const found = occurrences(file, needle);
      assert.ok(found.length > 0, "missing — see the presence check above");
      const loose = found.filter((folded) => !folded).length;
      assert.equal(loose, 0, `${loose} of ${found.length} occurrences are still on screen at rest`);
    });
  }
});

// --------------------------------------------------------------------------
// 2. The honesty floor: what may never be folded
// --------------------------------------------------------------------------

/** `[file, kind, needle, why]` — the reason is the entry, not a comment beside it. */
type Floor = [file: string, kind: string, needle: string, why: string];

const MUST_STAY_VISIBLE: Floor[] = [
  ["components/portfolio/OverviewStanding.tsx", "EMPTY STATE",
    "No position has spent ${fmt(ALERT_BANDS.symbolNear * 100, 0)}% of its symbol cap,",
    "both cards above it are conditional, so on a quiet book this is the Standing pane's whole content"],
  ["components/portfolio/OverviewStanding.tsx", "NULL EXPLANATION",
    "Drift is not measured: these instruments share too little price history for a "
    + "covariance, so there is no target to measure against — which is not the same as being on target.",
    "the account of a withheld figure, and all this card can say about drift in that state"],
  ["components/portfolio/AllocationPanel.tsx", "NULL EXPLANATION",
    "A flat book, or too little shared price history for a covariance. The proposal is withheld rather than guessed.",
    "in this branch the card is a kicker, a heading and this sentence; fold it and the pane is an empty box"],
  ["components/portfolio/AllocationPanel.tsx", "SAFETY",
    "Composed, not sent. Each faces the same pre-trade gates, including the ones that may reject it.",
    "says the trade list above it is paper, and carries two figures printed nowhere else"],
  ["components/portfolio/BookChrome.tsx", "SAFETY",
    "<strong>These positions do not exist.</strong> Equity, P&amp;L, exposure and every risk "
    + "figure below come from a fixed seed. Execution handoffs are disabled.",
    "the sandbox declaration for both tabs; globals.css says this marker must never be subtle"],
  ["components/portfolio/BookChrome.tsx", "SAFETY",
    "A configured gateway is not answering. Nothing is generated in its place — a sandbox "
    + "appearing during an outage is how generated numbers get mistaken for a desk.",
    "safety inverted: the promise that nothing on screen was invented to cover an outage"],
  ["components/portfolio/RiskAdjustedTrend.tsx", "SAFETY",
    "Generated path for the sandbox book.",
    "the generated-data marker, split out of the methodology note that folded around it"],
  ["components/portfolio/EquityCurve.tsx", "SAFETY",
    "Generated path for the sandbox book, deterministic and ending on the stated equity.",
    "the generated branch of the caption whose two observed branches folded"],
  ["components/portfolio/DriftBars.tsx", "ACTED-ON FIGURE",
    "marker: the target hit that symbol&apos;s own notional limit. A capped position can still sit grey inside the band.",
    "a status about named positions, not a method; it sits directly under the fold and stays out of it"],
  ["components/portfolio/DriftBars.tsx", "ACTED-ON FIGURE",
    "<strong>One position, so nothing here can move.</strong> A single-asset book is 100% of itself under every method",
    "says why the whole panel is inert, which a reader must not have to click for"],
  ["components/portfolio/PnlWaterfall.tsx", "ACTED-ON FIGURE",
    "No beta for {waterfall.unmeasuredSymbols.join(\", \")}, so the market leg excludes them and",
    "names the instruments a drawn leg is understated by; a status, not a derivation"],
  ["components/portfolio/PnlWaterfall.tsx", "NULL EXPLANATION",
    "Some fills this session carry no measured slippage, so the slippage leg is a{\" \"} <strong>lower bound</strong> on what execution cost.",
    "qualifies a figure that is drawn; folding it leaves the bar reading as complete"],
];

describe("the honesty floor is not folded", () => {
  for (const [file, kind, needle, why] of MUST_STAY_VISIBLE) {
    const label = flat(needle).slice(0, 46);

    it(`${kind}: "${label}…" is still in ${file.split("/").pop()}`, () => {
      assert.ok(occurrences(file, needle).length > 0, `deleted outright — ${why}`);
    });

    it(`${kind}: "${label}…" is on screen at rest`, () => {
      const found = occurrences(file, needle);
      assert.ok(found.length > 0, "missing — see the presence check above");
      const hidden = found.filter(Boolean).length;
      assert.equal(hidden, 0, `${hidden} of ${found.length} occurrences sit inside a <details>. ${why}`);
    });
  }
});

// --------------------------------------------------------------------------
// 3. Every disclosure is a real bargain
// --------------------------------------------------------------------------

describe("every portfolio disclosure has both halves", () => {
  it("finds the disclosures it is meant to be checking", () => {
    // The guard the rest of this block needs: a scan that matched nothing
    // would assert nothing and report green.
    const total = OWNED.reduce((sum, relative) => sum + scan(relative).ranges.length, 0);
    assert.ok(total >= 12, `expected the portfolio tab's disclosures, found ${total}`);
  });

  it("no <details> is missing a summary or a body", () => {
    const offenders: string[] = [];
    for (const relative of OWNED) {
      const source = blankComments(read(relative));
      for (const [from, to] of detailRanges(source)) {
        const block = source.slice(from, to);
        const open = block.indexOf("<summary");
        const close = block.indexOf("</summary>");
        if (open === -1 || close === -1) { offenders.push(`${relative}: a <details> with no <summary>`); continue; }
        const summary = block.slice(block.indexOf(">", open) + 1, close).replace(/\s+/g, " ").trim();
        if (summary.length < 12) offenders.push(`${relative}: summary too thin to act on — "${summary}"`);
        const body = block.slice(close + "</summary>".length, block.length - "</details>".length)
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (body.length < 20) offenders.push(`${relative}: "${summary}" hides nothing`);
      }
    }
    assert.deepEqual(offenders, [], `disclosures that are not a bargain:\n    ${offenders.join("\n    ")}`);
  });

  /**
   * The same invariant `tests/copy-audit.test.ts` enforces tree-wide, asserted
   * here against the files this sweep touched so a summary written today fails
   * in the suite that is about today's change. A summary that states the answer
   * makes the reader pay for the sentence twice.
   */
  it("no summary repeats a contiguous four-word phrase from what it hides", () => {
    const phrases = (text: string, n = 4) => {
      const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
      return new Set(Array.from(
        { length: Math.max(0, words.length - n + 1) },
        (_, i) => words.slice(i, i + n).join(" "),
      ));
    };
    const offenders: string[] = [];
    for (const relative of OWNED) {
      const source = read(relative);
      for (const match of source.matchAll(/<summary>([^<]{10,})<\/summary>([\s\S]{0,400})/g)) {
        const summary = match[1].replace(/\s+/g, " ").trim();
        if (summary.includes("{")) continue;
        const body = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);
        const shared = [...phrases(summary)].filter((phrase) => phrases(body).has(phrase));
        if (shared.length > 0) offenders.push(`${relative}: "${summary}" repeats "${shared[0]}"`);
      }
    }
    assert.deepEqual(offenders, [], `these summaries answer themselves:\n    ${offenders.join("\n    ")}`);
  });

  it("no summary carries the banned separator", () => {
    // The middle dot is a key leaking into the UI, and `middle-dot.test.ts`
    // names `<summary>` first among the places it may never appear. Repeated
    // here because this sweep writes summaries.
    for (const relative of OWNED) {
      for (const match of read(relative).matchAll(/<summary>([\s\S]*?)<\/summary>/g)) {
        assert.doesNotMatch(match[1], /·/, `${relative}: a summary uses the middle dot`);
      }
    }
  });
});
