/**
 * The dependency marks, and the two ways a logo lies.
 *
 * A mark is a claim of identity, so it can be wrong in ways a number cannot.
 * It can name the WRONG technology — a Redis tile on an in-memory queue — and
 * it can imply a component is wired up when it was never configured, because a
 * crisp vendor mark reads as a connection. Both are the same defect this tab
 * exists to prevent, wearing a picture instead of a sentence.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TECH_MARKS, markFor } from "../lib/tech-marks";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const component = read("../components/common/TechMark.tsx");
const mix = read("../components/systems/DependencyMix.tsx");
const overview = read("../components/systems/ReliabilityOverview.tsx");
const tree = read("../components/systems/DependencyTree.tsx");
const css = read("../app/globals.css");

/**
 * Comments stripped. Both of these files explain in prose exactly which
 * construct they refuse to use, and a source scan that cannot tell an
 * explanation from an instance would read the refusal as the offence.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

describe("a mark never names a technology that is not there", () => {
  it("ignores a backend hint it does not recognise", () => {
    /**
     * `queue.backend` is `memory` on a deployment with no broker. Painting a
     * Celery or Redis tile there would assert infrastructure that does not
     * exist — so an unknown hint falls through to the node's own house mark.
     */
    const mark = markFor("queue", "Research queue", "memory");
    assert.equal(mark.kind, "letters");
    assert.equal(mark.name, "Research queue");
  });

  it("uses a recognised backend hint ahead of the node id", () => {
    assert.equal(markFor("audit", "Audit store", "sqlite").name, "SQLite");
    assert.equal(markFor("queue", "Research queue", "celery").name, "Celery");
  });

  it("strips the provider and venue prefixes so one entry serves both", () => {
    assert.equal(markFor("provider:binance", "Binance").name, "Binance");
    assert.equal(markFor("venue:binance", "Binance").name, "Binance");
  });

  it("falls back to initials for anything unknown rather than guessing a brand", () => {
    const mark = markFor("provider:notreal", "Some New Vendor");
    assert.equal(mark.kind, "letters");
    assert.equal(mark.kind === "letters" && mark.letters, "SN");
  });

  it("carries no path whose geometry was approximated", () => {
    /**
     * Only marks that ARE their geometry may ship as paths. Everything else is
     * a lettermark: a traced approximation is recognisably wrong to anyone who
     * knows the brand, and it is worse than initials, not better.
     */
    for (const [key, mark] of Object.entries(TECH_MARKS)) {
      if (mark.kind !== "path") continue;
      assert.match(mark.viewBox, /^[\d.\s-]+$/, `${key} has a malformed viewBox`);
      assert.doesNotMatch(mark.d, /fill/, `${key} bakes in a fill instead of inheriting`);
    }
  });
});

describe("a mark survives high contrast and says when it is not configured", () => {
  it("inherits the ink instead of authoring a colour", () => {
    // The single permitted forced-colors block sets `color: CanvasText` on
    // `.card svg`, and covers `stroke` but NOT `fill`. `fill="currentColor"` is
    // what makes a filled mark follow that without a new rule or an exemption.
    assert.match(component, /fill="currentColor"/);
    assert.doesNotMatch(component, /fill="#/);
  });

  it("draws an unconfigured component hollow rather than filled", () => {
    assert.match(css, /\.tech-mark\[data-state="absent"\][\s\S]{0,160}border-style: dashed/);
    assert.match(css, /\.tech-mark\[data-state="absent"\][\s\S]{0,160}background: none/);
  });

  it("never carries state in colour alone", () => {
    assert.match(component, /DEPENDENCY_WORD\[state\]/);
    assert.match(component, /sr-only/);
  });

  it("adds no forced-colors block and no adjust exemption", () => {
    assert.equal((css.match(/@media \(forced-colors: active\)/g) ?? []).length, 1);
    assert.equal((css.match(/forced-color-adjust:\s*none/g) ?? []).length, 1);
  });
});

describe("the rings count what they say they count", () => {
  it("uses status roles, not the three-colour series palette", () => {
    // There are only `--series-1..3`. A five-state ring built on them would
    // reuse one, which is how "down" ends up rendering blue.
    assert.match(mix, /var\(--status-good\)/);
    assert.match(mix, /var\(--status-critical\)/);
    assert.doesNotMatch(mix, /slices[\s\S]{0,600}var\(--series-2\)/);
  });

  it("refuses to read as an uptime figure", () => {
    assert.match(mix, /not an uptime figure|says nothing about the hour before/);
  });

  it("keeps grey distinct from red in the caption", () => {
    assert.match(mix, /Grey is not red/);
  });
});

describe("the split hides nothing a reader needs at all times", () => {
  it("keeps the four KPI tiles above the switcher", () => {
    const seg = overview.indexOf('className="seg"');
    const summary = overview.indexOf('className="reliability-dependency-summary"');
    assert.ok(summary > 0 && seg > 0, "expected both the summary row and the switcher");
    assert.ok(summary < seg, "the KPI row moved inside a view and now changes identity");
  });

  it("renders views conditionally so a hidden one stops observing", () => {
    // `hidden` would keep a switched-away RouteLatencyBars' ResizeObserver
    // alive behind the view on screen.
    assert.match(overview, /pane === "map" &&/);
    assert.match(overview, /pane === "providers" &&/);
    assert.match(overview, /pane === "platform" &&/);
  });

  it("offers three panes, not four", () => {
    const panes = [...overview.matchAll(/\{ id: "(map|providers|platform)"/g)];
    assert.equal(panes.length, 3, "a four-button seg forces abbreviated labels");
  });

  it("says something honest when there is no gateway to describe", () => {
    // The deployed workspace's normal state is no gateway snapshot; a view that
    // renders blank reads as a broken panel.
    assert.match(overview, /cannot be\s*\n?\s*observed from here|missing measurement, not a set of failures/);
  });

  it("mounts no second workspace rail", () => {
    assert.doesNotMatch(code(overview), /<WorkspaceSubtabs/);
  });
});

describe("the tree stopped claiming to be an ARIA tree", () => {
  it("drops the role its list items never satisfied", () => {
    assert.doesNotMatch(code(tree), /role="tree"/);
    assert.match(tree, /aria-label="Service dependencies"/);
  });

  it("keeps the reason inline on every row that is not healthy", () => {
    assert.match(tree, /node\.health === "ok" \?/);
    assert.match(tree, /dependency-node__detail sr-only/);
  });

  it("keeps provenance on the row rather than behind a click", () => {
    assert.match(tree, /dependency-node__source/);
    assert.match(tree, /\{node\.source\}/);
  });
});

describe("the provider digest speaks one vocabulary and earns every word", () => {
  // Reliability → Dependencies → Providers. The words are the contract: an
  // operator reads "Degraded" and goes looking for a failing vendor, so only a
  // failed call may earn it. Dispatch books a vendor's "no data for this
  // symbol" and a licence refusal as their own reasons, never as errors, so a
  // trace on the wrong asset class cannot degrade four healthy providers.
  const signal = code(overview.slice(overview.indexOf("function providerSignal"), overview.indexOf("const POSTURE_LABEL")));

  it("uses the enterprise vocabulary and nothing else", () => {
    const labels = [...signal.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(labels)].sort(),
      ["Blocked", "Degraded", "Failing", "Healthy", "Idle", "Not configured", "Probe healthy"].sort(),
    );
    for (const retired of ["Success observed", "Successes + errors", "Routable", "Live probe"]) {
      assert.ok(!overview.includes(`"${retired}"`), `${retired} is retired vocabulary`);
    }
  });

  it("a provider whose every call failed is Failing, never Idle", () => {
    assert.match(signal, /failures === n/);
    assert.match(signal, /label: "Failing"/);
  });

  it("every detail is a sentence with counts, and no middle dot", () => {
    assert.match(signal, /of \$\{n\} calls failed in the last 15 minutes/);
    assert.match(signal, /succeeded in the last 15 minutes/);
    assert.doesNotMatch(signal, / · /, "detail templates are prose, not compounds");
  });

  it("names the capabilities this key was refused", () => {
    assert.match(signal, /not licensed on this key/);
    assert.match(signal, /provider\.licence\?\.length/);
  });
});
