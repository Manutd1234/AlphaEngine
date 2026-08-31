/** Fixed-footprint interaction readouts for every shared analytical figure. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { chromium, type Locator, type Page } from "@playwright/test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const figureFrame = read("components/coherence/FigureDialogFrame.tsx");
const lessonFrame = read("components/coherence/lesson-figures/frame.tsx");
const frechet = read("components/coherence/FrechetInstrument.tsx");
const groupPins = read("components/coherence/GroupPins.tsx");
const contrast = read("app/globals/14zzbb-proofs-contrast.css");
const browserOrigin = process.env.ALPHAENGINE_BROWSER_ORIGIN;

function ruleAt(source: string, selector: string): string {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `missing ${selector}`);
  const end = source.indexOf("}", start);
  assert.notEqual(end, -1, `unclosed ${selector}`);
  return source.slice(start, end + 1);
}

describe("interaction readout geometry source contract", () => {
  it("keeps the shared Figure readout mounted before, during and after inspection", () => {
    assert.match(
      figureFrame,
      /<div\s+className="coh-figure__interaction"\s+data-active=\{interactionReadout \? "true" : "false"\}\s+data-reserved=\{reserveInteractionRow \? "true" : "false"\}\s+aria-hidden="true"/,
    );
    assert.doesNotMatch(figureFrame, /\{interactionReadout \? \(\s*<(?:output|div)/,
      "the shared readout is conditionally mounted and will move every plot on first inspection");
    assert.match(figureFrame, /className="coh-figure__interaction"[\s\S]*?aria-hidden="true"/,
      "the stable visual duplicate must not announce alongside Figure's canonical live region");
  });

  it("lets the lesson comparison table opt out without changing other figures' stable rail", () => {
    assert.match(figureFrame, /reserveInteractionRow = true/);
    assert.match(groupPins, /reserveInteractionRow=\{false\}/);
    const optOut = ruleAt(contrast, '.coh-figure__interaction[data-reserved="false"]');
    assert.match(optOut, /--interaction-row-size:\s*0px/);
    assert.match(optOut, /block-size:\s*0/);
    assert.match(optOut, /border-block-width:\s*0/);
  });

  it("puts Proofs evidence directly below its caption and the stable readout after the plot", () => {
    const plot = ruleAt(
      contrast,
      ":where(.coherence-plane.proofs-plane) .coh-figure__plot",
    );
    const readout = ruleAt(
      contrast,
      ":where(.coherence-plane.proofs-plane) .coh-figure__interaction",
    );

    assert.match(plot, /order:\s*1/);
    assert.match(readout, /--interaction-row-size:\s*calc\(1\.45em \+ 2 \* var\(--space-1\) \+ 2px\)/);
    assert.match(readout, /order:\s*2/);
    assert.match(readout, /padding-block:\s*var\(--space-1\)/);
    assert.match(readout, /overflow-y:\s*hidden/);
    assert.match(
      contrast,
      /:where\(\.coherence-plane\.proofs-plane\) :is\([\s\S]*?\.coh-figure__reading,[\s\S]*?\)\s*\{\s*order:\s*3;/,
      "figure explanation content must remain below the reordered interaction rail",
    );
  });

  it("keeps the fixed-canvas lesson readout mounted with one canonical announcement", () => {
    assert.match(
      lessonFrame,
      /<div\s+className="coh-lessonfig__readout"\s+data-active=\{announce \? "true" : "false"\}\s+aria-hidden="true"/,
    );
    assert.doesNotMatch(lessonFrame, /\{announce \? \(\s*<(?:output|div)/,
      "lesson diagrams still insert a new row on keyboard or pointer inspection");
    assert.match(lessonFrame, /className="coh-plot__live" role="status" aria-live="polite">\{announce\}/,
      "the canonical live region outside the SVG was removed while stabilising the visible row");
  });

  it("keeps the focused dialog readout mounted in a fixed scrollable footprint", () => {
    assert.match(figureFrame, /className="coh-figure__readout coh-figure-dialog__readout"/);
    assert.doesNotMatch(figureFrame, /\{displayedReadout \? \(\s*<span className="coh-figure__readout"/);
    const dialogReadout = ruleAt(read("app/globals/14z-engine-evidence.css"),
      ".coh-figure-dialog__tools .coh-figure__readout");
    assert.match(dialogReadout, /block-size:\s*calc\(2\.9em \+ var\(--space-2\)\)/);
    assert.match(dialogReadout, /overflow:\s*hidden auto/);
    assert.match(dialogReadout, /scrollbar-gutter:\s*stable/);
  });

  it("reserves exactly two readable lines and scrolls longer facts inside that footprint", () => {
    const active = ruleAt(contrast, ".coh-figure__interaction,");
    assert.match(active, /--interaction-row-size:\s*calc\(2\.9em \+ var\(--space-4\) \+ 2px\)/);
    assert.match(active, /block-size:\s*var\(--interaction-row-size\)/);
    assert.match(active, /min-block-size:\s*var\(--interaction-row-size\)/);
    assert.match(active, /overflow-x:\s*hidden/);
    assert.match(active, /overflow-y:\s*auto/);
    assert.match(active, /scrollbar-gutter:\s*stable/);
    assert.match(active, /overflow-wrap:\s*anywhere/);

    const inactive = ruleAt(contrast, '.coh-figure__interaction[data-active="false"],');
    assert.match(inactive, /opacity:\s*0/);
    assert.doesNotMatch(inactive, /display:\s*none|visibility:\s*hidden/,
      "the quiet state stopped reserving space or made a populated live row inaccessible");
  });

  it("keeps the Fréchet missing-band explanation's wrapped footprint reserved", () => {
    assert.doesNotMatch(frechet, /\{!validBand \? \(\s*<p className=\{styles\.rangeMissing\}/);
    assert.match(frechet, /className=\{styles\.rangeMissing\}[\s\S]*?data-active=\{validBand \? "false" : "true"\}/);
    assert.match(frechet, /style=\{\{ visibility: validBand \? "hidden" : "visible" \}\}/,
      "valid and missing bands no longer occupy the same inspector height");
  });
});

interface RectReading {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FigureGeometry {
  figure: RectReading;
  plot: RectReading;
  readout: RectReading;
}

async function geometry(figure: Locator): Promise<FigureGeometry> {
  return figure.evaluate((node) => {
    const plot = node.querySelector<HTMLElement>(".coh-figure__plot");
    const readout = node.querySelector<HTMLElement>(".coh-figure__interaction");
    if (!plot || !readout) throw new Error("shared figure geometry is incomplete");
    /* Keep this callback free of nested functions. The test runs through tsx,
       whose function-name helper is not present inside Playwright's isolated
       page realm. */
    const figureBox = node.getBoundingClientRect();
    const plotBox = plot.getBoundingClientRect();
    const readoutBox = readout.getBoundingClientRect();
    return {
      /* The workspace itself is a scroll container, so browser focus may move
         the whole figure in the viewport. Internal coordinates catch the
         defect under test (a readout pushing its plot) without treating that
         legitimate scroll as reflow. */
      figure: { x: 0, y: 0, width: figureBox.width, height: figureBox.height },
      plot: { x: plotBox.x - figureBox.x, y: plotBox.y - figureBox.y, width: plotBox.width, height: plotBox.height },
      readout: { x: readoutBox.x - figureBox.x, y: readoutBox.y - figureBox.y, width: readoutBox.width, height: readoutBox.height },
    };
  });
}

function assertStable(before: FigureGeometry, after: FigureGeometry, phase: string) {
  for (const region of ["figure", "plot", "readout"] as const) {
    for (const field of ["x", "y", "width", "height"] as const) {
      const delta = Math.abs(before[region][field] - after[region][field]);
      assert.ok(delta <= 1, `${phase} moved ${region}.${field} by ${delta.toFixed(2)}px`);
    }
  }
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function openWorkspace(page: Page) {
  await page.goto(new URL("/dashboard", browserOrigin).href, { waitUntil: "domcontentloaded" });
  const header = page.locator(".workspace-header__utility");
  if (!(await header.count())) {
    const guest = page.getByRole("button", {
      name: /continue as guest|open the workspace|guest workspace/i,
    }).first();
    await guest.waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(250);
    await guest.click();
    await page.waitForURL((url) => !url.pathname.includes("login"), {
      timeout: 15_000,
      waitUntil: "domcontentloaded",
    });
  }
  await header.waitFor({ state: "visible", timeout: 15_000 });
}

describe("shared interaction readout geometry in Chromium", () => {
  it("does not move a plot on focus, long content or Escape", { skip: !browserOrigin }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      await page.bringToFront();
      await openWorkspace(page);
      /* Guest access is held by the mounted workspace, so stay on that document.
         Let its default overview route settle, then publish the hash change the
         same way a tab press does and wait on the routed panel. */
      await page.waitForTimeout(1_200);
      await page.evaluate(() => {
        window.location.hash = "diffusion/sandbox/spectrum";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      await page.locator("#panel-diffusion").waitFor({ state: "visible", timeout: 15_000 });

      const figure = page.locator("#panel-diffusion .coh-figure")
        .filter({ has: page.locator("svg[tabindex='0']") })
        .first();
      const svg = figure.locator("svg[tabindex='0']").first();
      const output = figure.locator(":scope > .coh-figure__interaction");
      await svg.waitFor({ state: "visible", timeout: 15_000 });
      await settle(page);

      assert.equal(await output.getAttribute("data-active"), "false");
      const before = await geometry(figure);

      await svg.focus();
      await page.waitForTimeout(50);
      await settle(page);
      assert.equal(await output.getAttribute("data-active"), "true");
      assert.ok((await output.textContent())?.replace("↳", "").trim(), "focused mark published no visible words");
      const active = await geometry(figure);
      assertStable(before, active, "focus");

      const content = output.locator("span").last();
      await content.evaluate((node) => {
        node.textContent = "A deliberately long exact interaction reading. ".repeat(80);
      });
      await settle(page);
      const long = await geometry(figure);
      assertStable(active, long, "long readout");
      const overflow = await output.evaluate((node) => {
        const style = getComputedStyle(node);
        const content = node.lastElementChild as HTMLElement | null;
        if (!content) throw new Error("interaction readout content is missing");
        const contentStyle = getComputedStyle(content);
        return {
          overflowY: style.overflowY,
          horizontalOverflow: node.scrollWidth - node.clientWidth,
          contentOverflow: content.scrollWidth - content.clientWidth,
          contentOverflowX: contentStyle.overflowX,
          textOverflow: contentStyle.textOverflow,
          whiteSpace: contentStyle.whiteSpace,
        };
      });
      assert.equal(overflow.overflowY, "hidden");
      assert.ok(overflow.horizontalOverflow <= 1, "long exact information escaped horizontally");
      assert.ok(overflow.contentOverflow > 1, "the long-readout fixture did not exercise truncation");
      assert.equal(overflow.contentOverflowX, "hidden");
      assert.equal(overflow.textOverflow, "ellipsis");
      assert.equal(overflow.whiteSpace, "nowrap");

      await page.keyboard.press("Escape");
      await page.waitForTimeout(50);
      await settle(page);
      assert.equal(await output.getAttribute("data-active"), "false");
      assertStable(before, await geometry(figure), "Escape");
    } finally {
      await browser.close();
    }
  });
});
