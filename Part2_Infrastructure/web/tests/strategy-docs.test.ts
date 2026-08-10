/**
 * The strategy catalogue's documentation.
 *
 * The picker grew from three entries to forty-six. Forty-six
 * names with no explanation is not more capability — it is a longer list to try
 * at random until one scores well, which is exactly the search process the
 * Deflated Sharpe Ratio exists to punish.
 *
 * So the assertions here are mostly about the failure half. It is the half that
 * goes unwritten, and it is the half that decides whether a reader can rule a
 * strategy out before running it. A `whenItFails` that says "may underperform in
 * certain conditions" is the same sentence forty-six times and carries no
 * information at all; several of these tests exist specifically to reject that.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { STRATEGY_DOCS } from "@/lib/strategy-docs";
import { PARAM_MEANING, STRATEGY_LABELS, type Strategy } from "@/lib/types";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ids = Object.keys(STRATEGY_LABELS) as Strategy[];

describe("every strategy in the picker is documented", () => {
  it("has an entry, with no orphans in either direction", () => {
    assert.deepEqual(Object.keys(STRATEGY_DOCS).sort(), ids.slice().sort());
  });

  it("fills every field", () => {
    for (const id of ids) {
      const doc = STRATEGY_DOCS[id];
      for (const field of ["summary", "formula", "whenItWorks", "whenItFails"] as const) {
        assert.ok(doc[field].length > 40, `${id}.${field} is too short to say anything: "${doc[field]}"`);
      }
    }
  });
});

describe("the failure mode is specific, not a hedge", () => {
  it("no two strategies share a failure description", () => {
    // The tell for boilerplate. If two entries fail the same way in the same
    // words, at least one of them has not been thought about.
    const seen = new Map<string, Strategy>();
    for (const id of ids) {
      const text = STRATEGY_DOCS[id].whenItFails;
      const previous = seen.get(text);
      assert.equal(previous, undefined, `${id} and ${previous} share a failure description`);
      seen.set(text, id);
    }
  });

  it("names a market condition rather than gesturing at one", () => {
    // Every entry must contain at least one concrete regime word. "May
    // underperform in some conditions" passes a length check and fails this.
    const conditions = /range|trend|chop|sideways|volatilit|drawdown|reversal|gap|drift|crash|thin|spike|downtrend|contraction|expand|turning|noise|top\b/i;
    for (const id of ids) {
      assert.match(
        STRATEGY_DOCS[id].whenItFails, conditions,
        `${id}.whenItFails names no market condition`,
      );
    }
  });

  it("does not hedge with weasel words", () => {
    for (const id of ids) {
      assert.doesNotMatch(
        STRATEGY_DOCS[id].whenItFails, /\b(may|might|could) (sometimes|occasionally|underperform)\b/i,
        `${id}.whenItFails hedges instead of naming the condition`,
      );
    }
  });

  it("never promises the strategy works", () => {
    // A catalogue is not a sales page. The score, the gate and walk-forward
    // decide whether anything works; these cards describe intent.
    for (const id of ids) {
      const doc = STRATEGY_DOCS[id];
      for (const text of [doc.summary, doc.whenItWorks]) {
        assert.doesNotMatch(
          text, /\b(guaranteed|will profit|always wins|best strategy|risk-free)\b/i,
          `${id} makes a promise: "${text}"`,
        );
      }
    }
  });
});

describe("cross-references go somewhere", () => {
  it("every `similar` id is a real strategy", () => {
    for (const id of ids) {
      for (const other of STRATEGY_DOCS[id].similar) {
        assert.ok(other in STRATEGY_LABELS, `${id} points at ${other}, which does not exist`);
      }
    }
  });

  it("no strategy lists itself", () => {
    for (const id of ids) {
      assert.ok(!STRATEGY_DOCS[id].similar.includes(id), `${id} suggests comparing against itself`);
    }
  });

  it("every strategy is reachable from at least one other", () => {
    // An entry nothing links to is one a reader only finds by scrolling the
    // dropdown — which is the browsing behaviour the cards exist to replace.
    const referenced = new Set(ids.flatMap((id) => STRATEGY_DOCS[id].similar));
    for (const id of ids) {
      assert.ok(referenced.has(id), `nothing links to ${id}`);
    }
  });
});

describe("the card does not restate what other maps own", () => {
  const card = read("../components/research/StrategyDocCard.tsx");
  const page = read("../app/page.tsx");

  it("renders parameter meanings from PARAM_MEANING", () => {
    // Two descriptions of the same axis, four pixels apart, drifting.
    assert.match(card, /PARAM_MEANING/);
    assert.ok(Object.keys(PARAM_MEANING).length === ids.length);
  });

  it("takes the family and label from the shared maps", () => {
    assert.match(card, /STRATEGY_FAMILY/);
    assert.match(card, /STRATEGY_LABELS/);
  });

  it("is mounted and follows the selected strategy", () => {
    assert.match(page, /import StrategyDocCard/);
    assert.match(page, /<StrategyDocCard[\s\S]{0,120}displayedResult\.request\.strategy/);
  });

  it("switching strategy from the card invalidates the displayed run", () => {
    // A path that set the strategy without `setResearchDirty` would leave the
    // previous sweep on screen under the new strategy's name.
    const handler = /const updateStrategy = useCallback\([\s\S]*?\}, \[\]\);/.exec(page)?.[0] ?? "";
    assert.match(handler, /setResearchDirty\(true\)/, "updateStrategy does not mark the run stale");
    assert.match(handler, /setInspect\(null\)/);
  });

  it("states the convention the descriptions assume", () => {
    // "Buy the crossover" and "buy the crossover, but flatten if the exit also
    // fires on that bar" are different strategies with the same name.
    assert.match(card, /exit wins|exit dominates/i);
  });
});
