/**
 * Two control-semantics defects on the routing probe.
 *
 * Two of the four execution controls that were lying about what they do. Both
 * are the same failure — appearance and behaviour drifted apart — pointing in
 * opposite directions:
 *
 *  - Five notional presets sat in a bare flex div: no group, no name, no
 *    `aria-pressed`. A screen reader met five unrelated actions and could not
 *    tell which size the probe was running.
 *  - The venue picker — a genuine multi-select, independent per venue — was a
 *    `.seg`, pixel-identical to the exclusive one directly above it.
 *
 * They are kept in one file because the rule only holds as a pair: the last
 * test below pins the exclusive control beside the venue picker as still
 * exclusive, and without it "drop the seg" would be the lesson, which is the
 * same confusion from the other direction.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here,
 * and what is worth pinning is structural.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { code, read } from "./helpers/execution-controls-sources";

/**
 * The routing probe, not `LiveMarket`.
 *
 * Both controls corrected below moved when LiveMarket was split along its
 * panel seams; the file they used to live in is now the tab spine and holds
 * neither. Left pointed at the old path, the two `indexOf` guards below would
 * have reported "the presets are gone" — which is why they are guards and not
 * bare slices. Re-anchored, not relaxed.
 */
const routingProbe = read("components/execution/RoutingProbe.tsx");

describe("the notional shortcuts say which one is selected", () => {
  const stripped = code(routingProbe);
  const group = (() => {
    const at = stripped.indexOf("PROBE_SIZES.map");
    assert.ok(at >= 0, "the presets are gone");
    // Back up to the element that wraps them, forward to the end of the map.
    const open = stripped.lastIndexOf("<div", at);
    return stripped.slice(open, stripped.indexOf("</div>", at));
  })();

  it("has five options, which is why it is not a seg", () => {
    const list = /const PROBE_SIZES = \[([^\]]+)\]/.exec(stripped);
    assert.ok(list, "PROBE_SIZES is gone");
    assert.equal(list[1].split(",").filter((n) => n.trim()).length, 5);
    // `.seg button` is flex:1, so a fifth segment is bought by abbreviating
    // every label. globals.css records the two-or-three budget at the rule.
    assert.doesNotMatch(group, /className="seg"/);
  });

  it("is a named group rather than five loose buttons", () => {
    assert.match(group, /role="group"/);
    assert.match(group, /aria-label="[^"]+"/);
  });

  it("announces the selected size, and carries it as a mark as well", () => {
    /**
     * `aria-pressed` alone would put the state in the accessibility tree and
     * nowhere on the screen: `.icon` has no selected treatment, so a sighted
     * reader would have no way to tell either. The ✓ is the visible half, and
     * it is house typography rather than a colour.
     */
    assert.match(group, /aria-pressed=\{notional === n\}/);
    assert.match(group, /notional === n \?/);
    assert.match(group, /✓/);
  });

  it("declares its buttons as buttons", () => {
    // No form wraps this, but a bare <button> still defaults to type=submit.
    assert.match(group, /type="button"/);
  });
});

describe("the venue picker does not look like a one-of-three", () => {
  const stripped = code(routingProbe);
  const group = (() => {
    const at = stripped.indexOf('aria-label="Venues included in the what-if route"');
    assert.ok(at >= 0, "the venue group lost its name");
    const open = stripped.lastIndexOf("<div", at);
    return stripped.slice(open, stripped.indexOf("snap?.venues ?? []).length === 0", at));
  })();

  it("is not a seg, because aria-pressed is independent per venue", () => {
    assert.doesNotMatch(group, /className="seg"/);
    assert.match(group, /role="group"/);
  });

  it("spells out both readings, so on and off are each stated", () => {
    // A raised-surface fill reads as "the selected one". Two marks read as a
    // row of switches, which is what this is.
    assert.match(group, /on \? "✓" : "✕"/);
    assert.match(group, /aria-pressed=\{on\}/);
  });

  it("says so when there is no venue to include yet", () => {
    // The seg used to render as an empty pill box before the first book, which
    // reads as a control with its options missing.
    assert.match(stripped, /No venue is streaming yet, so there is nothing to include or exclude/);
  });

  it("leaves the exclusive control beside it still exclusive", () => {
    /**
     * The other half of the rule, and the reason this is not simply "drop the
     * seg". The routing urgency preset directly above IS one-of-three, and it
     * must keep the treatment the multi-select has given up — otherwise the two
     * are indistinguishable again, from the other direction.
     */
    assert.match(
      stripped,
      /<div className="seg" role="group" aria-label="What-if routing urgency preset">/,
    );
  });
});
