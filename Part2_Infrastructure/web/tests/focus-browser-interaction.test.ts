/** Opt-in browser proof for the Focus inspector's state, zoom and drag contract. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chromium, type Page } from "@playwright/test";

const browserOrigin = process.env.ALPHAENGINE_BROWSER_ORIGIN;

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

describe("Focus inspection in Chromium", () => {
  it("preserves one chart, shows its words, scales both axes and drags without dismissal", {
    skip: !browserOrigin,
  }, async () => {
    const browser = await chromium.launch({ headless: true });
    const errors: string[] = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 860 },
        reducedMotion: "reduce",
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await openWorkspace(page);
      await page.evaluate(() => { window.location.hash = "diffusion/sandbox/spectrum"; });
      await page.waitForTimeout(400);

      const figure = page.locator("#panel-diffusion .coh-figure", {
        has: page.getByRole("button", { name: /Focus figure/i }),
      }).first();
      const svg = figure.locator("svg").first();
      await svg.waitFor({ state: "visible", timeout: 15_000 });

      // Mix mode order so one part of g(alpha) is positive and another is
      // negative. The old positive-peak-only scale sent the negative lobe
      // below the SVG and the clipped figure hid it.
      const controls = page.locator('#panel-diffusion .coh-model__controls input[type="range"]');
      assert.equal(await controls.count(), 6);
      const signedSpectrum = [3, -2, -2, -3, 2, -1];
      for (let index = 0; index < signedSpectrum.length; index += 1) {
        await controls.nth(index).evaluate((node, value) => {
          const input = node as HTMLInputElement;
          const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setValue?.call(input, String(value));
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, signedSpectrum[index]);
      }
      await page.waitForTimeout(100);

      const inlineSpectrum = await svg.evaluate((node) => {
        const area = node.querySelector<SVGGraphicsElement>(".coh-model__area")!;
        const curve = node.querySelector<SVGGraphicsElement>(".coh-index__line")!;
        const axis = node.querySelector<SVGLineElement>(".coh-ladder__axis")!;
        const note = node.querySelector<SVGTextElement>(".coh-svg-note")!;
        const bounds = curve.getBBox();
        const viewport = (node as SVGSVGElement).viewBox.baseVal;
        const baseline = Number(axis.getAttribute("y1"));
        return {
          fill: getComputedStyle(area).fill,
          noteFill: getComputedStyle(note).fill,
          noteFontSize: getComputedStyle(note).fontSize,
          curveTop: bounds.y,
          curveBottom: bounds.y + bounds.height,
          viewportTop: viewport.y,
          viewportBottom: viewport.y + viewport.height,
          baseline,
        };
      });
      assert.ok(inlineSpectrum.curveTop >= inlineSpectrum.viewportTop,
        "the positive spectrum lobe escaped above the SVG");
      assert.ok(inlineSpectrum.curveBottom <= inlineSpectrum.viewportBottom,
        "the negative spectrum lobe escaped below the SVG");
      assert.ok(inlineSpectrum.curveTop < inlineSpectrum.baseline
        && inlineSpectrum.curveBottom > inlineSpectrum.baseline,
      "the signed browser fixture did not draw on both sides of zero");
      await svg.evaluate((node) => { node.dataset.mountSentinel = "preserved"; });
      await svg.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(50);

      await figure.getByRole("button", { name: /Focus figure/i }).click();
      const dialog = page.locator(".coh-figure-dialog");
      await dialog.waitFor({ state: "visible" });
      const body = dialog.locator(".coh-figure-dialog__body");
      const plot = body.locator(".coh-figure__plot").first();
      const initial = await plot.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          preserved: node.querySelector("svg")?.dataset.mountSentinel === "preserved",
        };
      });
      assert.equal(initial.preserved, true, "Focus remounted the chart subtree");
      const focusedFill = await plot.locator(".coh-model__area").evaluate(
        (node) => getComputedStyle(node).fill,
      );
      assert.equal(focusedFill, inlineSpectrum.fill,
        "Focus lost the Spectrum area colour and fell back to SVG black");
      const focusedNote = await plot.locator(".coh-svg-note").evaluate((node) => ({
        fill: getComputedStyle(node).fill,
        fontSize: getComputedStyle(node).fontSize,
      }));
      assert.deepEqual(focusedNote, {
        fill: inlineSpectrum.noteFill,
        fontSize: inlineSpectrum.noteFontSize,
      }, "Focus lost the Spectrum resolution note's theme colour or diagram rung");
      const readout = await dialog.locator(".coh-figure-dialog__tools .coh-figure__readout").textContent();
      assert.ok(readout?.trim(), "Focus hid the active figure words");

      await page.getByRole("button", { name: "Zoom in figure" }).click();
      await page.getByRole("button", { name: "Zoom in figure" }).click();
      await page.waitForTimeout(200);
      const zoomed = await plot.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const viewport = node.closest<HTMLElement>(".coh-figure-dialog__body")!;
        return {
          width: box.width,
          height: box.height,
          pannable: viewport.dataset.pannable,
        };
      });
      assert.ok(zoomed.width >= initial.width * 1.45, "zoom did not scale the x axis");
      assert.ok(zoomed.height >= initial.height * 1.45, "zoom did not scale the y axis");
      assert.equal(zoomed.pannable, "true");
      await dialog.locator(".coh-figure-dialog__pan-hint").waitFor({ state: "visible" });

      const box = await body.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.6, { steps: 8 });
      await page.mouse.up();
      assert.ok(await body.evaluate((node) => node.scrollLeft) > 0, "drag did not pan the viewport");
      assert.equal(await dialog.isVisible(), true, "drag was misclassified as backdrop dismissal");

      await page.getByRole("button", { name: "Close focused figure" }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await figure.locator("svg[data-mount-sentinel='preserved']").count(), 1,
        "closing Focus did not return the same chart subtree");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
});
