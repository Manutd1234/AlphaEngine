/** Pre-paint routing and chrome geometry contracts for a hard-refreshed desk. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { chromium, type Page } from "@playwright/test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const layout = read("app/layout.tsx");
const routing = read("lib/use-workspace-routing.ts");
const bootstrap = read("lib/use-workspace-bootstrap.ts");
const header = read("components/WorkspaceHeader.tsx");
const subtabs = read("components/WorkspaceSubtabs.tsx");
const lazyPanels = read("components/workspace/lazy-panels.tsx");
const shellCss = `${read("app/globals/12-workspace-standardisation.css")}\n${read("app/globals/14zzj-layout-review-followup.css")}`;
const browserOrigin = process.env.ALPHAENGINE_BROWSER_ORIGIN;

describe("workspace hard-refresh bootstrap source contract", () => {
  it("gates only the dashboard and always has a no-JavaScript escape", () => {
    assert.match(layout, /window\.location\.pathname === '\/dashboard'/);
    assert.match(layout, /dataset\.workspaceBoot = 'pending'/);
    assert.match(layout, /dataset\.workspaceBoot = 'fallback'/);
    assert.match(layout, /4000/);
  });

  it("applies the location and measures both chrome rows before paint", () => {
    assert.match(routing, /useWorkspaceBootstrap\(\{ view, activeSection, applier, setView, sectionByViewRef, viewRef \}\)/);
    assert.match(bootstrap, /const \[locationReady, setLocationReady\] = useState\(false\)/);
    assert.match(
      bootstrap,
      /const stopFollowing = followLocation\(applier, setView, \(nextView, nextSection\) => \{\s*targetRef\.current = \{ view: nextView, section: nextSection \};/s,
    );
    assert.match(bootstrap, /view !== target\.view \|\| activeSection !== target\.section/);
    assert.match(bootstrap, /document\.getElementById\(`panel-\$\{target\.view\}`\)/);
    assert.match(bootstrap, /target\.view === "live" \? "execution" : target\.view/);
    assert.match(bootstrap, /document\.getElementById\(`\$\{workspaceId\}-subpanel-\$\{target\.section\}`\)/);
    assert.match(bootstrap, /panel\.hidden\s*\|\|\s*window\.getComputedStyle\(panel\)\.display === "none"/s);
    assert.match(bootstrap, /subpanel\.hidden\s*\|\|\s*window\.getComputedStyle\(subpanel\)\.display === "none"/s);
    assert.doesNotMatch(bootstrap, /useEffect\(\(\) => followLocation\(applier, setView\)/);
    assert.match(header, /useLayoutEffect\(\(\) => \{[\s\S]*?--header-h/);
    assert.match(subtabs, /useLayoutEffect\(\(\) => \{[\s\S]*?--rail-h/);
  });

  it("reveals one animation-free target frame without collapsing the shell", () => {
    assert.match(shellCss, /html\[data-workspace-boot="pending"\] body\s*\{[^}]*visibility:\s*hidden;/s);
    assert.match(shellCss, /html\[data-workspace-boot="revealing"\] body\s*\{[^}]*visibility:\s*hidden;/s);
    assert.match(shellCss, /html\[data-workspace-boot\] \.view-panel\s*\{[^}]*animation:\s*none;/s);
    assert.match(bootstrap, /root\.dataset\.workspaceBoot = "revealing"/);
    assert.match(bootstrap, /committedFrames === 0/);
    assert.match(bootstrap, /delete root\.dataset\.workspaceBoot/);
    assert.doesNotMatch(shellCss, /data-workspace-boot[^}]*display:\s*none/s);
  });

  it("retains the bounded dynamic console chunks", () => {
    for (const workspace of ["Data", "Reliability", "Developer", "Markets", "Coherence", "Diffusion"]) {
      assert.match(lazyPanels, new RegExp(`const ${workspace}Console = dynamic\\(`));
    }
    assert.match(lazyPanels, /loading: PanelLoading/);
  });
});

async function openWorkspace(page: Page) {
  await page.goto(new URL("/dashboard", browserOrigin).href, { waitUntil: "domcontentloaded" });
  const headerRow = page.locator(".workspace-header__utility");
  if (!(await headerRow.count())) {
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
  await headerRow.waitFor({ state: "visible", timeout: 15_000 });
}

describe("workspace hard-refresh geometry in Chromium", () => {
  it("never exposes Overview while a Reliability deep link is booting", {
    skip: !browserOrigin,
  }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 900 }, reducedMotion: "no-preference" });
      await page.addInitScript({ content: `
        window.__workspaceBootFrames = [];
        window.__workspaceBootSample = function () {
          var body = document.body;
          var panels = Array.prototype.slice.call(document.querySelectorAll('.view-panel'));
          var visible = panels.find(function (panel) {
            return !panel.hidden && window.getComputedStyle(panel).display !== 'none';
          });
          window.__workspaceBootFrames.push({
            boot: document.documentElement.dataset.workspaceBoot || '',
            bodyVisibility: body ? window.getComputedStyle(body).visibility : '',
            panel: visible ? visible.id : ''
          });
          if (window.__workspaceBootFrames.length < 240) window.requestAnimationFrame(window.__workspaceBootSample);
        };
        window.requestAnimationFrame(window.__workspaceBootSample);
      ` });
      await openWorkspace(page);

      await page.goto(new URL("/dashboard#reliability/controls", browserOrigin).href, {
        waitUntil: "domcontentloaded",
      });
      // `page.goto` can treat a hash-only change from the authenticated desk as
      // same-document navigation. Reload once at the deep URL so the samples
      // below describe the bootstrap under test, not the preceding guest-entry
      // visit to plain Overview.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("#panel-reliability").waitFor({ state: "visible", timeout: 15_000 });
      await page.locator("#reliability-subpanel-controls").waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForFunction(() => !document.documentElement.dataset.workspaceBoot);
      await page.evaluate(() => document.fonts.ready);

      const audit = await page.evaluate(() => {
        const frames = (window as Window & {
          __workspaceBootFrames?: Array<{ boot: string; bodyVisibility: string; panel: string }>;
        }).__workspaceBootFrames ?? [];
        const workspaceHeader = document.querySelector<HTMLElement>(".workspace-header")!;
        const shell = document.querySelector<HTMLElement>(".workspace-shell")!;
        const rail = document.querySelector<HTMLElement>("#panel-reliability .workspace-subtabs")!;
        const headerBox = workspaceHeader.getBoundingClientRect();
        const shellBox = shell.getBoundingClientRect();
        return {
          frames,
          activeTab: document.querySelector<HTMLElement>("#tab-reliability")?.getAttribute("aria-selected"),
          headerHeight: headerBox.height,
          headerToken: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")),
          railHeight: rail.getBoundingClientRect().height,
          railToken: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-h")),
          shellTop: shellBox.top,
          headerBottom: headerBox.bottom,
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          shellOverflow: shell.scrollWidth - shell.clientWidth,
        };
      });

      assert.equal(audit.activeTab, "true");
      assert.ok(audit.frames.some((frame) => frame.boot === "pending" && frame.bodyVisibility === "hidden"),
        "the dashboard never held its first deep-link frame");
      assert.equal(
        audit.frames.some((frame) => frame.bodyVisibility === "visible" && frame.panel === "panel-overview"),
        false,
        `Overview became visible during a Reliability refresh: ${JSON.stringify(audit.frames.slice(0, 24))}`,
      );
      assert.ok(Math.abs(audit.headerHeight - audit.headerToken) <= 1);
      assert.ok(Math.abs(audit.railHeight - audit.railToken) <= 1);
      assert.ok(Math.abs(audit.shellTop - audit.headerBottom) <= 1);
      assert.ok(audit.documentOverflow <= 1);
      assert.ok(audit.shellOverflow <= 1);

      const remediationHeader = await page.locator("#panel-reliability .page-heading").first().boundingBox();
      const remediationShell = await page.locator(".workspace-shell").boundingBox();
      assert.ok(remediationHeader, "Remediation did not render the shared Reliability header");
      assert.ok(remediationShell, "the workspace shell was not measurable on Remediation");
      await page.locator("#reliability-subtab-overview").click();
      await page.locator("#reliability-subpanel-overview").waitFor({ state: "visible" });
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      const overviewHeader = await page.locator("#panel-reliability .page-heading").first().boundingBox();
      const overviewShell = await page.locator(".workspace-shell").boundingBox();
      assert.ok(overviewHeader, "Overview did not retain the shared Reliability header");
      assert.ok(overviewShell, "the workspace shell was not measurable on Reliability Overview");
      assert.ok(remediationHeader.y >= remediationShell.y - 1, "Remediation clipped its shared header above the shell");
      assert.ok(overviewHeader.y >= overviewShell.y - 1, "Overview clipped its shared header above the shell");
      assert.ok(Math.abs(remediationHeader.height - overviewHeader.height) <= 1);

      await page.evaluate(() => { window.location.hash = "developer/work"; });
      await page.locator("#developer-subpanel-work").waitFor({ state: "visible", timeout: 15_000 });
      const statusSelect = page.locator(".developer-work__table tbody tr select").first();
      const deleteButton = page.locator(".developer-work__table tbody tr .developer-work__delete").first();
      await statusSelect.waitFor({ state: "visible" });
      const [statusBox, deleteBox] = await Promise.all([
        statusSelect.boundingBox(),
        deleteButton.boundingBox(),
      ]);
      assert.ok(statusBox && deleteBox, "the first task row did not expose both controls");
      assert.ok(Math.abs(statusBox.y - deleteBox.y) <= 1);
      assert.ok(
        Math.abs(statusBox.height - deleteBox.height) <= 1,
        `task row control heights diverged: status ${statusBox.height}px, delete ${deleteBox.height}px`,
      );
    } finally {
      await browser.close();
    }
  });
});
