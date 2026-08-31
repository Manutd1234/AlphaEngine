import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { STRATEGY_DOCS } from "../lib/strategy-docs";
import { FAMILY_ORDER, strategiesByFamily } from "../lib/strategy-progress";
import { STRATEGY_FAMILY, STRATEGY_LABELS } from "../lib/types";

const read = (relative: string) => readFileSync(
  fileURLToPath(new URL(relative, import.meta.url)),
  "utf8",
);

const codex = read("../components/research/StrategyCodex.tsx");
const css = read("../app/globals/14zze-strategy-codex-tabs.css");

describe("Research Strategies is a bounded, addressable workbench", () => {
  it("uses the source-owned shadcn Tabs and ScrollArea patterns", () => {
    assert.match(codex, /import \{ Tabs, TabsContent, TabsList, TabsTrigger \} from "@\/components\/ui\/tabs"/);
    assert.match(codex, /<Tabs/);
    assert.match(codex, /<TabsList/);
    assert.match(codex, /aria-label=\{FAMILY_ORDER\.join\(", "\)\}/);
    assert.doesNotMatch(codex, /aria-label=\{activeFamily\}/);
    assert.match(codex, /<TabsTrigger/);
    assert.match(codex, /<TabsContent[\s\S]*?forceMount/);
    assert.match(codex, /aria-controls=\{`strategy-family-\$\{familyId\(family\)\}-panel`\}/);
    assert.match(codex, /aria-labelledby=\{`strategy-family-\$\{familyId\(family\)\}-tab`\}/);
    assert.match(codex, /<ScrollArea/);
  });

  it("derives one keyboard-operable family tab from the canonical registry", () => {
    assert.match(codex, /\[\.\.\.strategiesByFamily\(\)\]/);
    assert.match(codex, /FAMILY_ORDER\.includes/);
    assert.match(codex, /value=\{family\}/);
    assert.match(codex, /onValueChange=\{handleFamilyChange\}/);
    assert.doesNotMatch(codex, /<table/);
  });

  it("keeps every strategy selectable while showing one complete detail at rest", () => {
    assert.match(codex, /strategies\.map\(\(strategy\) =>/);
    assert.match(codex, /setBrowsedStrategy\(strategy\)/);
    assert.match(codex, /STRATEGY_DOCS\[browsedStrategy\]/);
    assert.match(codex, /doc\.summary/);
    assert.match(codex, /doc\.formula/);
    assert.match(codex, /doc\.whenItFails/);
    assert.doesNotMatch(codex, /firstSentence/);
  });

  it("keeps selection and relationship navigation distinct and focusable", () => {
    assert.match(codex, /onClick=\{\(\) => onSelect\(browsedStrategy\)\}/);
    assert.match(codex, /setActiveFamily\(STRATEGY_FAMILY\[strategy\]\)/);
    assert.match(codex, /pendingFocus/);
    assert.match(codex, /\.focus\(\{ preventScroll: true \}\)/);
  });
});

describe("the Strategies presentation reduces at-rest density without deleting the catalogue", () => {
  it("covers all seven families and all forty-six strategies from shared data", () => {
    const groups = [...strategiesByFamily()];
    const strategies = groups.flatMap(([, entries]) => entries);
    assert.deepEqual(groups.map(([family]) => family), FAMILY_ORDER);
    assert.equal(strategies.length, 46);
    assert.equal(new Set(strategies).size, 46);
    assert.deepEqual(strategies.sort(), Object.keys(STRATEGY_LABELS).sort());
    for (const strategy of strategies) {
      assert.equal(STRATEGY_FAMILY[strategy], groups.find(([, ids]) => ids.includes(strategy))?.[0]);
      assert.ok(STRATEGY_DOCS[strategy].formula.length > 0);
      assert.ok(STRATEGY_DOCS[strategy].whenItFails.length > 0);
      assert.ok(STRATEGY_DOCS[strategy].similar.length > 0);
    }
  });

  it("bounds the family rail, selector and detail with responsive overflow rules", () => {
    assert.match(css, /\.strategy-codex__tabs-list[\s\S]*overflow-x:\s*auto/);
    assert.match(css, /\.codex-family__scroll[\s\S]*height:/);
    assert.match(css, /\.codex-strategy-selector[\s\S]*grid-template-columns:/);
    assert.match(css, /@media \(max-width: 720px\)/);
  });
});
