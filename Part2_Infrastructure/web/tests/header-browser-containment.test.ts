/**
 * Source contract plus an opt-in real-browser geometry audit.
 *
 * The browser half runs against a local desk when ALPHAENGINE_BROWSER_ORIGIN
 * is set. It is intentionally executable rather than a screenshot assertion:
 * the regression this guards left every source-regex test green while
 * `overflow-x: clip` silently removed the rightmost controls.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { chromium } from "@playwright/test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shell = read("app/globals/01-workspace-shell.css");
const ladder = read("app/globals/14p-header-ladder-tenth-tab.css");
const topbar = read("app/globals/14w-engine-topbar.css");
const browserOrigin = process.env.ALPHAENGINE_BROWSER_ORIGIN;

function mediaBody(source: string, heading: string): string {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing ${heading}`);
  let depth = 0;
  let opened = false;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") { depth += 1; opened = true; }
    if (source[index] === "}") depth -= 1;
    if (opened && depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${heading}`);
}

describe("desktop header containment source contract", () => {
  it("keeps overflow observable and spends one consistent compact rhythm", () => {
    const utility = /\.workspace-header__utility \{([\s\S]*?)\n\}/.exec(shell)?.[1] ?? "";
    assert.match(utility, /gap: 6px;/);
    assert.match(utility, /overflow-x: visible;/);
    assert.doesNotMatch(utility, /overflow-x: clip;/);
    assert.match(shell, /\.workspace-tabs button \{[^}]*padding: 7px 6px;/s);
  });

  it("contains the complete borderless tab rail instead of replacing it with a boxed selector", () => {
    const compact = mediaBody(ladder, "@media (min-width: 901px) and (max-width: 1590px)");
    assert.match(compact, /\.workspace-header__utility \{\s*flex-wrap: nowrap;/);
    assert.match(
      compact,
      /\.workspace-tabs \{[^}]*display: flex;[^}]*flex: 1 1 0;[^}]*min-width: 0;[^}]*overflow-x: auto;/s,
    );
    assert.match(compact, /\.workspace-tabs button \{[^}]*flex: 1 0 max-content;/s);
    assert.match(compact, /\.workspace-switcher \{\s*display: none;/);
    assert.doesNotMatch(compact, /\.workspace-switcher \{[^}]*(?:border|background|padding|width):/s,
      "the desktop breakpoint rebuilt the removed boxed selector");
  });

  it("does not add a route-specific title inset inside analytical frames", () => {
    assert.doesNotMatch(
      topbar,
      /\.page-heading__copy[^{}]*\{[^}]*padding-inline-start\s*:/s,
    );
  });
});

describe("desktop header containment in Chromium", () => {
  it("contains every visible control and tab in one row from 1120 through 2048", {
    skip: !browserOrigin,
  }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 2048, height: 900 }, reducedMotion: "reduce" });
      await page.goto(`${browserOrigin}/dashboard`, { waitUntil: "domcontentloaded" });
      if (await page.locator(".workspace-header__utility").count() === 0) {
        const guest = page.getByRole("button", { name: /open the workspace|continue as guest/i }).first();
        await guest.waitFor({ state: "visible" });
        // Let the login island hydrate before dispatching the guest action.
        await page.waitForTimeout(250);
        await guest.click();
        await page.waitForURL(/\/dashboard(?:#|$)/);
      }
      await page.locator(".workspace-header__utility").waitFor({ state: "visible" });
      await page.evaluate(() => document.fonts.ready);

      for (const width of [2048, 1950, 1800, 1600, 1590, 1440, 1280, 1120]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(80);
        const geometry = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(".workspace-header__utility")!;
          const tabs = document.querySelector<HTMLElement>(".workspace-tabs")!;
          const switcher = document.querySelector<HTMLElement>(".workspace-switcher")!;
          const boundary = row.getBoundingClientRect();
          const rowStyle = getComputedStyle(row);
          const settingsAnchor = row.lastElementChild as HTMLElement;
          const settingsBox = settingsAnchor.getBoundingClientRect();
          const tabButtons = [...tabs.querySelectorAll<HTMLElement>("button")];
          const escaped = [...row.children].filter((child) => {
            const element = child as HTMLElement;
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.display !== "none"
              && style.position !== "absolute"
              && box.width > 1
              && (box.left < boundary.left - 1 || box.right > boundary.right + 1);
          }).map((element) => (element as HTMLElement).className);
          return {
            clientWidth: row.clientWidth,
            scrollWidth: row.scrollWidth,
            height: boundary.height,
            tabs: getComputedStyle(tabs).display,
            tabsClientWidth: tabs.clientWidth,
            tabsScrollWidth: tabs.scrollWidth,
            tabsOverflowX: getComputedStyle(tabs).overflowX,
            tabCount: tabButtons.length,
            visibleTabCount: tabButtons.filter((tab) => getComputedStyle(tab).display !== "none").length,
            switcher: getComputedStyle(switcher).display,
            decisionCopy: getComputedStyle(document.querySelector<HTMLElement>(".latency-chip__copy")!).display,
            rightInset: boundary.right - settingsBox.right,
            expectedRightInset: Number.parseFloat(rowStyle.paddingRight),
            escaped,
          };
        });
        assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1,
          `${width}px row overflows by ${geometry.scrollWidth - geometry.clientWidth}px`);
        assert.ok(geometry.height <= 60, `${width}px header grew to ${geometry.height}px`);
        assert.deepEqual(geometry.escaped, [], `${width}px has controls outside the row`);
        assert.equal(geometry.tabs, "flex", `${width}px should retain the full borderless tab rail`);
        assert.equal(geometry.visibleTabCount, geometry.tabCount, `${width}px hides a workspace destination`);
        assert.equal(geometry.switcher, "none", `${width}px should not show the boxed workspace selector`);
        assert.notEqual(geometry.decisionCopy, "none", `${width}px hides the Decision p99 and latency readout`);
        assert.ok(
          Math.abs(geometry.rightInset - geometry.expectedRightInset) <= 1,
          `${width}px leaves ${geometry.rightInset}px after Settings; expected the ${geometry.expectedRightInset}px row inset`,
        );
        if (width <= 1590) {
          assert.equal(geometry.tabsOverflowX, "auto", `${width}px tab rail is not its own scroll container`);
          assert.ok(geometry.tabsScrollWidth >= geometry.tabsClientWidth,
            `${width}px tab rail reports invalid scroll geometry`);
        }
      }
    } finally {
      await browser.close();
    }
  });

  it("aligns every title to its own context edge across representative widths", {
    skip: !browserOrigin,
  }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 2048, height: 900 }, reducedMotion: "reduce" });
      await page.goto(`${browserOrigin}/dashboard`, { waitUntil: "domcontentloaded" });
      if (await page.locator(".workspace-header__utility").count() === 0) {
        const guest = page.getByRole("button", { name: /open the workspace|continue as guest/i }).first();
        await guest.waitFor({ state: "visible" });
        // Let the login island hydrate before dispatching the guest action.
        await page.waitForTimeout(250);
        await guest.click();
        await page.waitForURL(/\/dashboard(?:#|$)/);
      }
      await page.locator(".workspace-header__utility").waitFor({ state: "visible" });
      await page.evaluate(() => document.fonts.ready);

      const routes = [
        "overview",
        "research",
        "live",
        "portfolio",
        "risk",
        "data",
        "reliability",
        "developer",
        "markets",
        "coherence",
        "diffusion",
      ] as const;
      const roleRoutes = new Set(["research", "live", "portfolio", "risk", "data", "reliability", "developer"]);

      for (const width of [2048, 1120, 620, 390]) {
        await page.setViewportSize({ width, height: 900 });
        let roleTop: number | null = null;
        for (const route of routes) {
          // Below the header's compact-navigation breakpoint the full tablist
          // remains in the accessibility tree but is not visually clickable.
          // Dispatching the button's native click keeps this geometry test on
          // the same public navigation handler at every width.
          await page.locator(`.workspace-tabs #tab-${route}`).evaluate((button: HTMLButtonElement) => button.click());
          const title = page.locator(`#panel-${route} .page-heading h1`).first();
          await title.waitFor({ state: "visible" });
          await page.evaluate(() => new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }));

          const geometry = await title.evaluate((element) => {
            const heading = element.closest<HTMLElement>(".page-heading");
            if (!heading) throw new Error("page title is not inside PageHead");

            const context = heading.querySelector<HTMLElement>(".page-heading__insights");
            if (context) {
              return {
                titleLeft: element.getBoundingClientRect().left,
                titleTop: element.getBoundingClientRect().top,
                fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
                contextLeft: context.getBoundingClientRect().left,
                anchor: "context strip",
              };
            }

            // Markets and Proofs intentionally have no PageHead metric strip.
            // Their sibling engine-state surface and title share the framed
            // topbar's content edge, so derive that edge from the frame rather
            // than comparing either route with an unrelated core-tab offset.
            const frame = heading.closest<HTMLElement>(".coh-topbar") ?? heading;
            const frameStyle = getComputedStyle(frame);
            const frameBox = frame.getBoundingClientRect();
            return {
              titleLeft: element.getBoundingClientRect().left,
              titleTop: element.getBoundingClientRect().top,
              fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
              contextLeft: frameBox.left
                + Number.parseFloat(frameStyle.borderLeftWidth || "0")
                + Number.parseFloat(frameStyle.paddingLeft || "0"),
              anchor: "frame content edge",
            };
          });

          assert.ok(
            Math.abs(geometry.titleLeft - geometry.contextLeft) <= 1,
            `${width}px ${route} title starts at ${geometry.titleLeft}px; its ${geometry.anchor} starts at ${geometry.contextLeft}px`,
          );
          if (roleRoutes.has(route)) {
            assert.ok(geometry.fontSize >= 30, `${width}px ${route} role heading shrank to ${geometry.fontSize}px`);
            roleTop ??= geometry.titleTop;
            assert.ok(
              Math.abs(geometry.titleTop - roleTop) <= 1,
              `${width}px ${route} role heading begins at ${geometry.titleTop}px; shared baseline is ${roleTop}px`,
            );
          }
        }
      }
    } finally {
      await browser.close();
    }
  });
});
