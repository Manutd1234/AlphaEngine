/**
 * Detail level, and the invariant that keeps it from becoming three products.
 *
 * The tier system's whole risk is that it drifts into a beginner MODE — a
 * simplified surface that grows features as you advance. That failure has a
 * specific shape: a user reads the documentation, follows a link, or sits next
 * to a colleague, and discovers a control they were told did not exist.
 *
 * So the load-bearing assertion here is not that Guided hides things. It is
 * that every tab, every rail section and every capability exists at every tier,
 * and that what changes is only what is expanded by default.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  atLeast,
  COMPLEXITY_LABELS,
  COMPLEXITY_TIERS,
  DEFAULT_COMPLEXITY,
  isComplexity,
  nextComplexity,
  type Complexity,
} from "@/lib/complexity";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("the ordering is a ladder, not a set of flags", () => {
  it("every tier is at least itself", () => {
    for (const tier of COMPLEXITY_TIERS) assert.equal(atLeast(tier, tier), true);
  });

  it("orders guided below standard below full", () => {
    assert.equal(atLeast("full", "standard"), true);
    assert.equal(atLeast("standard", "guided"), true);
    assert.equal(atLeast("guided", "standard"), false);
    assert.equal(atLeast("standard", "full"), false);
  });

  it("cycles through every tier and returns to the start", () => {
    let tier: Complexity = "guided";
    const seen: Complexity[] = [tier];
    for (let i = 0; i < COMPLEXITY_TIERS.length - 1; i++) {
      tier = nextComplexity(tier);
      seen.push(tier);
    }
    assert.deepEqual(seen.slice().sort(), [...COMPLEXITY_TIERS].sort());
    assert.equal(nextComplexity(tier), "guided");
  });

  it("rejects a stored value that is not a tier", () => {
    // localStorage is user-writable and survives deploys. A stale or hand-edited
    // value must fall back, not index a record with undefined.
    assert.equal(isComplexity("expert"), false);
    assert.equal(isComplexity(null), false);
    assert.equal(isComplexity("full"), true);
  });

  it("defaults to standard rather than guided", () => {
    // A visitor to a quant research desk is likelier to be an analyst who wants
    // the numbers than a beginner who wants them collapsed, and a tool that
    // opens with everything shut reads as an empty tool. Guided is a choice.
    assert.equal(DEFAULT_COMPLEXITY, "standard");
  });
});

describe("the wording never claims a capability is missing", () => {
  it("describes density, not availability", () => {
    for (const tier of COMPLEXITY_TIERS) {
      const { description } = COMPLEXITY_LABELS[tier];
      assert.doesNotMatch(
        description, /\b(hidden|unavailable|disabled|removed|not available)\b/i,
        `the ${tier} description implies a feature is missing: "${description}"`,
      );
    }
  });

  it("the control says so out loud to a screen reader", () => {
    const toggle = read("../components/ComplexityToggle.tsx");
    assert.match(toggle, /available at every level/i);
  });
});

describe("tiers change density, never navigation", () => {
  const page = read("../app/page.tsx");
  const routing = read("./workspace-routing.test.ts");

  it("no tab or rail section is conditional on the tier", () => {
    // The invariant. A tier that can remove a destination is a navigation fork.
    assert.doesNotMatch(
      page, /useComplexity|atLeast/,
      "the workspace shell is branching on the detail level — sections must not be tier-dependent",
    );
    assert.match(routing, /RESEARCH_SECTION|tabId/);
  });

  it("every panel that tiers does it by opening a disclosure, not by dropping content", () => {
    // `open={...}` sets an initial state; a conditional `<details>` would not
    // exist at all, and the content inside it would be genuinely unreachable.
    for (const file of [
      "../components/research/QualityScorePanel.tsx",
      "../components/research/StrategyDocCard.tsx",
    ]) {
      const source = read(file);
      assert.match(source, /<details[^>]*open=\{/, `${file} gates content on something other than a disclosure`);
    }
  });

  it("the headline number and the verdict are never collapsed", () => {
    // A score with no reasoning beside it is the failure the panel exists to
    // prevent; the reasoning may be one click away and must never be absent.
    const panel = read("../components/research/QualityScorePanel.tsx");
    const beforeDisclosure = panel.slice(0, panel.indexOf("<details"));
    assert.match(beforeDisclosure, /score\.total/);
    assert.match(beforeDisclosure, /score\.verdict/);
  });

  it("every collapsed disclosure names what is inside it", () => {
    // "Advanced" as a summary reads as a warning. The summary has to say what a
    // reader would get, or Guided becomes a tier that hides things.
    for (const file of [
      "../components/research/QualityScorePanel.tsx",
      "../components/research/StrategyDocCard.tsx",
    ]) {
      const source = read(file);
      const summaries = [...source.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
      assert.ok(summaries.length > 0, `${file} has a disclosure with no summary`);
      for (const summary of summaries) {
        assert.ok(summary.trim().length > 12, `a summary is too vague to act on: "${summary.trim()}"`);
        assert.doesNotMatch(summary, /^\s*(Advanced|More|Details)\s*$/i);
      }
    }
  });
});

describe("the preference is read where it cannot cause a hydration mismatch", () => {
  const hook = read("../lib/use-complexity.ts");

  it("reads localStorage in an effect, not during render", () => {
    // Reading storage while rendering makes the server's HTML and the client's
    // first paint disagree; React resolves that by discarding the server markup,
    // which is a visible flash on every load to move one preference.
    const readIndex = hook.indexOf("readStored()");
    const effectIndex = hook.indexOf("useEffect");
    assert.ok(effectIndex >= 0 && hook.lastIndexOf("readStored()") > effectIndex,
      "the stored tier is read outside an effect");
    assert.ok(readIndex > 0);
  });

  it("survives a blocked storage API", () => {
    // Private browsing and some enterprise policies throw on access. Losing the
    // preference is acceptable; losing the workspace is not.
    assert.match(hook, /catch\s*\{/);
    const setter = /export function setComplexity[\s\S]*?\n\}/.exec(hook)?.[0] ?? "";
    assert.match(setter, /catch/, "setComplexity can throw out of a click handler");
  });
});
