/**
 * Follow-up contracts for the workspace header and the Overview's phone grid.
 *
 * Source assertions always run. The geometry audit is deliberately opt-in:
 * set ALPHAENGINE_BROWSER_ORIGIN to a running desk (for example,
 * http://127.0.0.1:3000) to exercise the same contracts in Chromium.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { chromium } from "@playwright/test";

import { globalsCss } from "./globals-css";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const headerSource = read("components/WorkspaceHeader.tsx");
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
const browserOrigin = process.env.ALPHAENGINE_BROWSER_ORIGIN;
const WIDTHS = [2048, 1600, 1590, 1120, 900, 768, 620, 540, 390] as const;

function mediaBodies(source: string, condition: string): string[] {
  const bodies: string[] = [];
  const opener = /@media\s*([^\{]+)\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source))) {
    let depth = 1;
    let cursor = opener.lastIndex;
    while (depth > 0 && cursor < source.length) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    assert.equal(depth, 0, `unclosed @media ${match[1].trim()}`);
    if (match[1].trim() === condition) bodies.push(source.slice(opener.lastIndex, cursor - 1));
    opener.lastIndex = cursor;
  }
  return bodies;
}

describe("responsive header and density source contracts", () => {
  it("does not manufacture empty space with a header spacer", () => {
    assert.doesNotMatch(headerSource, /className=["'`]header-spacer\b/);
    assert.doesNotMatch(css, /\.header-spacer\b/);
  });

  it("lays the Overview metrics and decision stages out as complete split-screen grids", () => {
    const split = mediaBodies(css, "(max-width: 900px)");
    assert.ok(split.length > 0, "missing the 900px split-screen breakpoint");
    assert.ok(
      split.some((body) =>
        /\.overview-hero \.page-heading__insights\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s.test(body)),
      "the Overview's four insights must form two equal columns on split screens",
    );
    assert.ok(
      split.some((body) =>
        /\.overview-loop ol\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s.test(body)),
      "the decision stages must not squeeze four labels into one narrow row",
    );
  });

  it("lets the owning frame provide the shared page heading's horizontal inset", () => {
    assert.match(
      css,
      /\.page-heading__copy\s*\{[^}]*padding:\s*8px 0;/s,
      "PageHead should retain vertical rhythm without adding a second horizontal inset",
    );
    assert.doesNotMatch(
      css,
      /\.page-heading__copy[^\{]*\{[^}]*padding-inline(?:-start|-end)?:\s*(?!0(?:px)?(?:\s|;))/s,
      "a scoped PageHead override reintroduced horizontal drift",
    );
  });
});

async function openWorkspace(page: import("@playwright/test").Page) {
  const dashboard = new URL("/dashboard", browserOrigin).href;
  await page.goto(dashboard, { waitUntil: "domcontentloaded" });
  const header = page.locator(".workspace-header__utility");
  if (await header.count() === 0) {
    const guest = page.getByRole("button", {
      name: /continue as guest|open the workspace|guest workspace/i,
    }).first();
    await guest.waitFor({ state: "visible", timeout: 15_000 });
    // The login shell can paint before its client island hydrates. Waiting for
    // one short task avoids dispatching a click into inert server HTML.
    await page.waitForTimeout(250);
    await guest.click();
    await page.waitForURL(/\/dashboard(?:\?|$)/, { timeout: 15_000 });
  }
  await header.waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".overview-hero .page-heading h1").waitFor({ state: "visible", timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
}

describe("responsive header and density in Chromium", () => {
  it("contains the header and fills the Overview metric grid at every responsive tier", {
    skip: !browserOrigin,
  }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: WIDTHS[0], height: 900 } });
      await openWorkspace(page);

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));

        const geometry = await page.evaluate(() => {
          const documentElement = document.documentElement;
          const header = document.querySelector<HTMLElement>(".workspace-header")!;
          const row = document.querySelector<HTMLElement>(".workspace-header__utility")!;
          const headerBox = header.getBoundingClientRect();

          const visibleChildren = [...row.children].flatMap((child) => {
            const element = child as HTMLElement;
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            if (
              style.display === "none"
              || style.visibility === "hidden"
              || Number(style.opacity) === 0
              || style.position === "absolute"
              || style.position === "fixed"
              || element.classList.contains("sr-only")
              || box.width <= 1
              || box.height <= 1
            ) return [];
            return [{
              name: element.className || element.tagName.toLowerCase(),
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            }];
          });

          const escaped = visibleChildren.filter((box) =>
            box.left < headerBox.left - 1
            || box.right > headerBox.right + 1
            || box.top < headerBox.top - 1
            || box.bottom > headerBox.bottom + 1);
          const overlaps: string[] = [];
          for (let first = 0; first < visibleChildren.length; first += 1) {
            for (let second = first + 1; second < visibleChildren.length; second += 1) {
              const a = visibleChildren[first];
              const b = visibleChildren[second];
              const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (overlapX > 1 && overlapY > 1) overlaps.push(`${a.name} ↔ ${b.name}`);
            }
          }

          const title = document.querySelector<HTMLElement>(".overview-hero .page-heading h1");
          const insight = document.querySelector<HTMLElement>(".overview-hero .page-heading__insights .page-insight");
          const frame = document.querySelector<HTMLElement>(".overview-hero");
          const titleLeft = title?.getBoundingClientRect().left ?? null;
          const insightLeft = insight?.getBoundingClientRect().left ?? null;
          let frameContentLeft: number | null = null;
          if (frame) {
            const frameStyle = getComputedStyle(frame);
            frameContentLeft = frame.getBoundingClientRect().left
              + parseFloat(frameStyle.borderLeftWidth || "0")
              + parseFloat(frameStyle.paddingLeft || "0");
          }

          const metricBoxes = [...document.querySelectorAll<HTMLElement>(
            ".overview-hero .page-heading__insights .page-insight",
          )].map((element) => {
            const box = element.getBoundingClientRect();
            return { left: box.left, top: box.top, width: box.width };
          });

          return {
            documentClientWidth: documentElement.clientWidth,
            documentScrollWidth: documentElement.scrollWidth,
            headerClientWidth: header.clientWidth,
            headerScrollWidth: header.scrollWidth,
            rowClientWidth: row.clientWidth,
            rowScrollWidth: row.scrollWidth,
            headerHeight: headerBox.height,
            escaped,
            overlaps,
            titleLeft,
            insightLeft,
            frameContentLeft,
            metricBoxes,
          };
        });

        assert.ok(
          geometry.documentScrollWidth <= geometry.documentClientWidth + 1,
          `${width}px document overflows by ${geometry.documentScrollWidth - geometry.documentClientWidth}px`,
        );
        assert.ok(
          geometry.headerScrollWidth <= geometry.headerClientWidth + 1,
          `${width}px header overflows by ${geometry.headerScrollWidth - geometry.headerClientWidth}px`,
        );
        assert.ok(
          geometry.rowScrollWidth <= geometry.rowClientWidth + 1,
          `${width}px header row overflows by ${geometry.rowScrollWidth - geometry.rowClientWidth}px`,
        );
        assert.deepEqual(geometry.escaped, [], `${width}px has visible controls outside the header`);
        assert.deepEqual(geometry.overlaps, [], `${width}px has overlapping header siblings`);

        const maximumHeaderHeight = width >= 1120 ? 72 : width > 620 ? 160 : 120;
        assert.ok(
          geometry.headerHeight > 0 && geometry.headerHeight <= maximumHeaderHeight,
          `${width}px header is ${geometry.headerHeight}px tall; expected at most ${maximumHeaderHeight}px`,
        );

        assert.notEqual(geometry.titleLeft, null, `${width}px Overview title is absent`);
        if (geometry.insightLeft != null) {
          assert.ok(
            Math.abs(geometry.titleLeft! - geometry.insightLeft) <= 1.5,
            `${width}px title x=${geometry.titleLeft}, first insight x=${geometry.insightLeft}`,
          );
        } else if (geometry.frameContentLeft != null) {
          assert.ok(
            Math.abs(geometry.titleLeft! - geometry.frameContentLeft) <= 1.5,
            `${width}px title x=${geometry.titleLeft}, frame content x=${geometry.frameContentLeft}`,
          );
        }

        if (width <= 900) {
          const cells = geometry.metricBoxes;
          assert.equal(cells.length, 4, `${width}px should render all four Overview insights`);
          const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
          assert.ok(near(cells[0].top, cells[1].top), `${width}px first metric row has a hole`);
          assert.ok(near(cells[2].top, cells[3].top), `${width}px second metric row has a hole`);
          assert.ok(cells[2].top > cells[0].top + 1, `${width}px metrics did not form two rows`);
          assert.ok(near(cells[0].left, cells[2].left), `${width}px left metric column drifted`);
          assert.ok(near(cells[1].left, cells[3].left), `${width}px right metric column drifted`);
          assert.ok(near(cells[0].width, cells[3].width), `${width}px phone metric columns are unequal`);
        }
      }
    } finally {
      await browser.close();
    }
  });
});
