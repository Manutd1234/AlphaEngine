/**
 * The desk does not move when its data does.
 *
 * A recording of the Portfolio and Risk tabs showed two twitches with one
 * cause each. On the section rail, the Refresh button read `view.refreshing`
 * — a flag every quiet refresh sets, including the stream's refetch about
 * once a second on a live desk — so its label grew to "Refreshing…" and the
 * Live/Sandbox control beside it slid left and back on a cadence nobody had
 * clicked. Above the rail, the live path rendered no notice strip and the
 * sandbox path rendered a 43px one, so each press of the toggle inserted or
 * removed a block and moved everything beneath it. Below the rail, the
 * toggle swaps the book, the covariance re-fetches, and cards that depend on
 * it dropped to a one-line placeholder and sprang back.
 *
 * On Execution, the Liquidity ladder and the Routing probe re-rendered on the
 * book's 300ms cadence whether or not their section was on screen, because
 * visited sections persist behind `hidden`.
 *
 * Asserted against source, the way `risk-stability.test.ts` pins the Monte
 * Carlo reserves: each of these is a condition in the code, and a render test
 * would have to reproduce the section routing and a flapping stream to see
 * any of it. The comparator that gates hidden panels is pure, so that one is
 * exercised directly.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shallowEqualProps, skipWhileHidden } from "../components/execution/hidden-panel";
import { globalsCss } from "./globals-css";
import { read } from "./helpers/cockpit-sources";

describe("the book workspaces keep a locked floor under their sections", () => {
  it("portfolio, risk and execution panels carry one min-height between them", () => {
    assert.match(
      globalsCss,
      /\.workspace-subtab-panel\[data-workspace-id="portfolio"\],\s*\.workspace-subtab-panel\[data-workspace-id="risk"\],\s*\.workspace-subtab-panel\[data-workspace-id="execution"\]\s*\{\s*min-height: calc\(330px \+ 5 \* var\(--fs-body\)\);/,
      "the floor under the three data-rebuilt workspaces went",
    );
  });

  it("the floor scales with the reader's text size instead of naming one", () => {
    /*
     * It was a flat `420px`, and measured against the running desk that
     * number was wrong at both ends of the ladder: 13.6px of visible dead
     * reserve under the shortest settled panel on the comfortable step, and
     * BELOW that panel's settled height on large, where it stopped reserving
     * anything. A floor that goes inert exactly where the type is biggest is
     * a floor that is quietly missing the next time the ladder moves, so the
     * literal is pinned out rather than merely replaced.
     */
    const floor = /min-height: calc\(330px \+ 5 \* var\(--fs-body\)\);/;
    assert.match(globalsCss, floor);
    assert.doesNotMatch(
      globalsCss,
      /data-workspace-id="execution"\]\s*\{\s*min-height: \d+px;/,
      "the panel floor went back to a literal px, which does not follow the text size",
    );
  });

  it("the selector keys on an attribute the panel already publishes", () => {
    // No new class, so the dead-CSS budget is untouched — and a panel that
    // stopped stamping its id would drop out of the floor silently, which is
    // why the attribute is pinned beside the rule.
    assert.match(read("components/WorkspaceSubtabs.tsx"), /data-workspace-id=\{workspaceId\}/);
  });

  it("a hidden panel still collapses to nothing", () => {
    assert.match(globalsCss, /\.workspace-subtab-panel\[hidden\]\s*\{\s*display: none !important;/);
  });
});

/** Comment bodies out, so prose that names the old defect is not read as it. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("the Live/Sandbox rail control holds its width", () => {
  const chrome = read("components/portfolio/BookChrome.tsx");
  const control = code(chrome.slice(chrome.indexOf("export function BookSourceControl")));

  it("the source actually loaded", () => {
    assert.ok(control.length > 500, "BookSourceControl did not load");
  });

  it("the refresh button is sized by its widest label, not its current one", () => {
    assert.match(control, /display: "inline-grid"/);
    assert.match(control, /visibility: "hidden" \}\}>Reconnecting…<\/span>/,
      "the invisible measuring label went, so the button resizes as its word changes");
    assert.match(control, /<span style=\{\{ gridArea: "1 \/ 1" \}\}>\{label\}<\/span>/);
  });

  it("a background refresh does not flip the label — only a press does", () => {
    assert.match(control, /const \[pending, setPending\] = useState\(false\)/);
    assert.doesNotMatch(control, /\brefreshing\b/,
      "the control reads the desk-wide refreshing flag again, which every stream refetch sets");
    assert.match(control, /disabled=\{pending \|\| sandbox\}/);
    assert.match(control, /aria-busy=\{pending\}/);
  });

  it("the pending state is declared above the book bail-out", () => {
    assert.ok(
      control.indexOf("useState(false)") < control.indexOf("if (!book) return null;"),
      "a hook after the early return is the rendered-more-hooks crash",
    );
  });

  it("the rail's meta slot is rendered in every source state", () => {
    assert.doesNotMatch(control, /\{!sandbox && !isStale && \(\s*<span className="rail-meta/);
    assert.match(control, /<span className="rail-meta num"/);
    assert.match(control, /"generated book"/, "the sandbox reading of the slot went");
  });
});

describe("the notice strip above the rail keeps its height across the toggle", () => {
  const chrome = read("components/portfolio/BookChrome.tsx");

  it("live, stale and sandbox each render a portfolio-statusbar", () => {
    const strips = chrome.match(/className="portfolio-statusbar/g) ?? [];
    assert.equal(strips.length, 3, "one of the three readings lost its strip, so the toggle moves the rail");
  });

  it("the live strip names the gateway and the refresh time in words", () => {
    assert.match(chrome, /<i aria-hidden \/> Live book/);
    assert.match(chrome, /\{gatewayLabel\}; last refresh \{lastRefreshLabel\}/);
  });

  it("the sandbox marker is still the full-width warn strip", () => {
    assert.match(chrome, /portfolio-statusbar is-sandbox/);
    assert.match(chrome, /These positions do not exist\./);
  });
});

describe("the Oracle VaR card reserves its result height before the model exists", () => {
  const card = read("components/portfolio/OracleVarPanel.tsx");

  it("the waiting line sits inside the 192px reserve", () => {
    const box = card.indexOf("minHeight: 192");
    const waiting = card.indexOf("Waiting for the covariance model");
    assert.ok(box > 0, "the reserve went");
    assert.ok(waiting > box, "the pre-model sentence renders outside the reserved box, so a toggle collapses the card");
  });
});

describe("the liquidity section paints on the book's cadence and nothing else", () => {
  it("the publish tick is the desk's 300ms throttle window", () => {
    assert.match(read("lib/use-throttled-value.ts"), /export const THROTTLE_INTERVAL_MS = 300;/);
    const livebook = read("lib/livebook.ts");
    assert.match(livebook, /const PUBLISH_HZ = 1_000 \/ THROTTLE_INTERVAL_MS;/);
    assert.match(livebook, /\}, 1000 \/ publishHz\);/);
  });

  it("the ladder and the chart are memoised", () => {
    const ladder = read("components/execution/LiquidityBook.tsx");
    assert.match(ladder, /export default memo\(LiquidityBook, skipWhileHidden\);/);
    assert.match(ladder, /const askRows = useMemo\(/);
    assert.match(ladder, /const bidRows = useMemo\(/);
    assert.match(read("components/DepthChart.tsx"), /export default memo\(DepthChart\);/);
  });

  it("LiveMarket tells both panels whether they are on screen", () => {
    const market = read("components/LiveMarket.tsx");
    assert.match(market, /active=\{section === "liquidity"\}/);
    assert.match(market, /active=\{section === "routing"\}/);
    assert.match(read("components/execution/RoutingProbe.tsx"), /export default memo\(RoutingProbe, skipWhileHidden\);/);
  });

  it("the depth chart's empty state carries the legend the drawn state does", () => {
    const chart = read("components/DepthChart.tsx");
    assert.equal((chart.match(/\{LEGEND\}/g) ?? []).length, 2,
      "the legend must render in both states or the first book shifts the ladder beside it");
  });
});

describe("a hidden panel keeps its last render; a shown one compares shallowly", () => {
  const snapA = { n: 1 };
  const snapB = { n: 2 };

  it("both hidden: skip, whatever changed", () => {
    assert.equal(skipWhileHidden({ active: false, snap: snapA }, { active: false, snap: snapB }), true);
  });

  it("becoming visible is always a render", () => {
    assert.equal(skipWhileHidden({ active: false, snap: snapA }, { active: true, snap: snapA }), false);
  });

  it("visible with a new snapshot is a render", () => {
    assert.equal(skipWhileHidden({ active: true, snap: snapA }, { active: true, snap: snapB }), false);
  });

  it("visible with identical props is not", () => {
    assert.equal(skipWhileHidden({ active: true, snap: snapA }, { active: true, snap: snapA }), true);
  });

  it("the shallow comparison is Object.is per key", () => {
    assert.equal(shallowEqualProps({ x: NaN }, { x: NaN }), true);
    assert.equal(shallowEqualProps({ x: 0 }, { x: -0 }), false);
    assert.equal(shallowEqualProps({ x: 1 }, { x: 1, y: 2 } as { x: number }), false);
  });
});
