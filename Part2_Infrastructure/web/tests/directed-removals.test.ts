/**
 * Lines the desk was asked to remove, asserted to stay removed.
 *
 * Every entry below was named directly by the person reading the app and taken
 * out in rounds D5, D7, F3, F4 and G3. Nothing stopped one coming back: a copy
 * sweep that re-adds a sentence, a revert, a component rewritten from an older
 * version — all silent, because a removed line leaves no test behind it.
 *
 * ── Why this reads the source and not a commit log ─────────────────────────
 *
 * G3.1 is the reason this file exists. It had a commit, the commit message said
 * the corpus panel stopped promising a document kind nothing writes, and the
 * sentence was still rendering. A commit message is evidence that somebody
 * intended a removal; only the source is evidence that it happened.
 *
 * ── Why a comment mentioning the phrase is allowed ────────────────────────
 *
 * Several of these removals left a note behind explaining WHY the line went,
 * and that note is worth keeping — it is how the next person avoids re-adding
 * it. A comment is not on screen, so lines beginning `//`, `*` or `/*` do not
 * count as a re-occurrence. What is checked is whether the phrase can reach a
 * reader.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));

/** Every hand-written source file the desk renders from. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules") sources(full, found);
    } else if (/\.tsx?$/.test(entry) && !entry.includes("generated")) {
      found.push(full);
    }
  }
  return found;
}

const FILES = ["app", "components", "lib"].flatMap((d) => sources(join(web, d)));

/**
 * `[round, phrase]`. The phrase is the shortest fragment that is unique to the
 * removed line — short enough to survive a reword of the rest of the sentence,
 * specific enough not to match something else.
 */
const REMOVED: ReadonlyArray<readonly [string, string]> = [
  ["D7.1", "Why validation"],
  ["D7.2", "Everything on this pane is counted"],
  ["D7.3", "Compare the fingerprint"],
  ["D7.4", "has not earned"],
  ["D7.6", "not an audit trail"],
  ["F3.2", "Stress scenarios sized on the long-run average"],
  ["F4.1", "Both engines apply the convention"],
  ["F4.2", "Reruns the same TCA maths"],
  ["F4.3", "Two times the absolute slippage"],
  ["F4.4", "which is what the prompt above is about"],
  ["F4.5", "No position is above"],
  ["F4.6", "Bars share one scale across venues"],
  ["F4.8", "work without a credential"],
  ["G3.1", "execution summaries"],
  ["ask.8", "Worth a closer look"],
  ["ask.9", "Saved in this browser as a summary"],
  ["ask.10", "A crossover that also requires the slow average"],

  // Round M's copy sweeps — the panels Phase A never reached. Only sentences
  // removed OUTRIGHT are listed; the many that were tightened rather than cut
  // would over-constrain a future rewording, and this file is for lines that
  // should not come back at all.
  ["A2.12", "Each cell is coloured by what its own neighbours"],
  ["A2.12", "A broad plateau suggests"],
  ["A2.13", "overfitting made visible"],
  ["A2.17", "accepted and rejected alike"],
  ["A2.20", "not by this browser"],
  ["A2.21", "not what is largest"],
  ["A2.21", "hue is the sign"],
  ["A2.23", "Triage by impact"],
  ["A2.23", "New items enter Intake"],
  ["A2.25", "This page manages an identity"],

  // Round D5's de-duplication sweeps. Each phrase below was copied from the
  // DELETED line of the commit named beside it, not from the plan item that
  // asked for it — F4.1 sat in this list for eleven rounds pinning "apply the
  // same convention" while the screen read "apply the convention these
  // descriptions assume", so the guard was green and the line was up.
  ["D5.6", "equal positions"],                          // b366999, AllocationDonut
  ["D5.6", "Parametric VaR assumes normal returns"],    // b366999, RiskEngine
  ["D5.6", "Positions inside the drift band are left alone"], // b366999, AllocationPanel
  ["D5.7", "Cost decomposition per venue."],            // 80cc634, SpreadDecomposition
  ["D5.7", "Execution venues across the audit window."], // 80cc634, VenueMixDonut
  ["D5.7", "Mirrored decisions as Postgres commits them"], // 80cc634, DeskTape
  ["D5.9", "Compare against:"],                         // bf1a03a, StrategyDocCard
  // The trigger's `{term}` echo, which printed every explained tile's label a
  // second time beside the glyph. The fragment spans the tag because that is
  // what made it unique — the glyph alone is the version that stayed.
  ["D5.10", "ⓘ</span> {term}"],                         // 3dfa9d1, QuantEducationalTooltip
];

/**
 * The source with every comment removed, so only text that can reach a reader
 * is searched.
 *
 * Line-prefix matching was the first attempt and it missed the JSX form:
 * `{/* … *\/}` starts with a brace, and a block comment's continuation lines
 * start with ordinary prose. Stripping the blocks is the only version that
 * cannot be fooled by where a comment happens to wrap.
 */
function rendered(text: string): string {
  return text
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")   // {/* JSX comment */}
    .replace(/\/\*[\s\S]*?\*\//g, " ")                // /* block */
    .replace(/^\s*\/\/.*$/gm, " ");                    // // line
}

describe("copy the desk asked to have removed stays removed", () => {
  const blobs = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));

  it("comment stripping does not swallow the whole file", () => {
    // If the block regexes over-matched, every phrase would pass for the wrong
    // reason. A rendered file keeps most of its bytes.
    const [file, text] = [...blobs].find(([f]) => f.endsWith("DataWorkBoard.tsx"))!;
    assert.ok(
      rendered(text).length > text.length * 0.5,
      `comment stripping removed more than half of ${file}`,
    );
  });

  it("reads a source set worth checking", () => {
    // A glob that silently matched nothing would make every assertion below
    // pass for the wrong reason.
    assert.ok(FILES.length > 100, `only found ${FILES.length} source files`);
  });

  for (const [round, phrase] of REMOVED) {
    it(`${round}: ${JSON.stringify(phrase)} is not rendered anywhere`, () => {
      const offenders = [...blobs]
        .filter(([, text]) => rendered(text).includes(phrase))
        .map(([file]) => file.slice(web.length));
      assert.deepEqual(
        offenders, [],
        `this line was removed on request and is on screen again:\n  ${offenders.join("\n  ")}`,
      );
    });
  }
});
