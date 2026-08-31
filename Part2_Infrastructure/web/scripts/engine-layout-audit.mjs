#!/usr/bin/env node

/**
 * Browser geometry audit for every addressable AlphaEngine workspace state.
 *
 * The existing copy audit catches document-wide overflow. It cannot catch a
 * child clipped by an ancestor because `html { overflow-x: clip }` can keep the
 * document width apparently valid. This audit records local ownership,
 * explicitly named scrollports, bordered sibling intersections, and sticky
 * controls covering active content.
 *
 * Run against a ready local or production server:
 *   node scripts/engine-layout-audit.mjs --url=http://localhost:3000
 * Narrow a diagnostic run without weakening the default full sweep:
 *   node scripts/engine-layout-audit.mjs \
 *     --route=diffusion/sandbox/spectrum --viewport=390x844
 */

import { pathToFileURL } from "node:url";

import {
  OWNER_SELECTOR,
  SURFACE_SELECTOR,
  TOLERANCE_PX,
  auditGeometrySnapshot,
  browserSnapshot,
  intersection,
  overflowBy,
} from "./engine-layout-geometry.mjs";
import { VISIBLE_COPY_ROUTES } from "./visible-copy-audit.mjs";

export {
  OWNER_SELECTOR,
  SURFACE_SELECTOR,
  auditGeometrySnapshot,
  browserSnapshot,
  intersection,
  overflowBy,
};

export const DEFAULT_LAYOUT_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 390, height: 844 }),
  Object.freeze({ width: 620, height: 900 }),
  Object.freeze({ width: 721, height: 900 }),
  Object.freeze({ width: 821, height: 900 }),
  Object.freeze({ width: 1101, height: 900 }),
  Object.freeze({ width: 1280, height: 900 }),
  Object.freeze({ width: 1401, height: 1000 }),
  Object.freeze({ width: 1720, height: 1100 }),
]);
export const EXPLICIT_LAYOUT_THEMES = Object.freeze(["light", "dark"]);

export const WORKSPACE_READY_SELECTOR = ".workspace-tabs, .workspace-bottom-nav";
export const WORKSPACE_READY_STATE = "attached";
export const LAYOUT_SETTLING = Object.freeze({
  timeoutMs: 35_000,
  sampleIntervalMs: 100,
  identicalSamples: 2,
});

/**
 * An API 503 is an exercised unavailable state, not a browser/runtime
 * exception. Keep it visible in the report, but do not let Chromium's generic
 * resource-console message turn truthful degraded rendering into a geometry
 * failure. Other statuses and non-gateway resources remain blockers.
 */
export function isExpectedApiUnavailable(text, location = {}) {
  if (!/^Failed to load resource:.*status of 503 \(Service Unavailable\)/.test(text)) return false;
  try {
    return new URL(location.url ?? "").pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** Chromium can report the live-book socket's final ping after the audit has
 * already closed its context. It is a teardown reading, not a page exception. */
export function isExpectedExternalStreamShutdown(text) {
  return /^WebSocket connection to 'wss:\/\/stream\.binance\.com(?::\d+)?\/.+' failed: Ping received after close$/.test(text);
}

// Copy and geometry share one live route inventory. The historical copy
// baseline remains a signed 108-state observation, but every current sweep
// includes the addressable Research Setup view exactly once.
export const LAYOUT_AUDIT_ROUTES = Object.freeze([...VISIBLE_COPY_ROUTES]);

const ENGINE_DESKS = new Set(["markets", "coherence", "diffusion"]);
// section-views.ts has one deliberate non-first default. Keep this tiny mirror
// explicit: this script runs directly in Node and cannot import the TS module.
const ENGINE_DEFAULT_VIEW_OVERRIDES = new Map([
  ["coherence/lessons", "coverage"],
]);

function safeSegment(value, name) {
  if (!/^[a-z0-9_-]+$/i.test(value)) {
    throw new Error(`Invalid ${name} '${value}' in layout-audit route`);
  }
  return value;
}

/** The router removes a default engine view's redundant third hash segment. */
export function canonicalAuditHash(route) {
  if (!route.view || !ENGINE_DESKS.has(route.desk)) return route.hash;
  const firstView = ENGINE_DEFAULT_VIEW_OVERRIDES.get(`${route.desk}/${route.section}`)
    ?? LAYOUT_AUDIT_ROUTES.find((candidate) => (
    candidate.desk === route.desk
    && candidate.section === route.section
    && candidate.view != null
    ))?.view;
  return route.view === firstView ? `${route.desk}/${route.section}` : route.hash;
}

/** Stable DOM evidence that the hash reader has rendered the requested state. */
export function auditRouteReadiness(route) {
  const desk = safeSegment(route.desk, "desk");
  const section = safeSegment(route.section, "section");
  const view = route.view == null ? null : safeSegment(route.view, "view");
  const workspace = desk === "live" ? "execution" : desk;
  const sectionSelector = `#${workspace}-subpanel-${section}:not([hidden])`;
  let viewSelector = null;

  if (view && desk === "research") {
    viewSelector = `#research-summary-${view}-tab[data-state="active"]`;
  } else if (view && desk === "markets") {
    viewSelector = `${sectionSelector} [data-market-view="${view}"]`;
  } else if (view && desk === "coherence") {
    // The evidence band is a sibling of the section panels so that its height
    // remains stable while the requested proof view changes beneath it.
    viewSelector = `.coh-evidence[data-tab="coherence"][data-section="${section}"][data-view="${view}"]`;
  } else if (view && desk === "diffusion") {
    const sectionViews = LAYOUT_AUDIT_ROUTES.filter((candidate) => (
      candidate.desk === desk && candidate.section === section && candidate.view != null
    ));
    if (sectionViews.length > 1) {
      viewSelector = `${sectionSelector} .diff-view-control [data-view="${view}"][aria-pressed="true"]`;
    }
  }

  return {
    canonicalHash: canonicalAuditHash(route),
    panelSelector: `#panel-${desk}:not([hidden])`,
    sectionSelector,
    viewSelector,
  };
}

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function parseViewports(value) {
  if (!value) return DEFAULT_LAYOUT_VIEWPORTS;
  return value.split(",").map((entry) => {
    const match = entry.trim().match(/^(\d+)x(\d+)$/);
    if (!match) throw new Error(`Invalid viewport '${entry}'; expected WIDTHxHEIGHT`);
    return { width: Number(match[1]), height: Number(match[2]) };
  });
}

function parseThemes(value) {
  if (value === "both") return EXPLICIT_LAYOUT_THEMES;
  if (["system", ...EXPLICIT_LAYOUT_THEMES].includes(value)) return [value];
  throw new Error(`Invalid theme '${value}'; expected system, light, dark or both`);
}

export async function waitForWorkspaceReady(page, timeoutMs = 15_000) {
  await page.locator(WORKSPACE_READY_SELECTOR).first().waitFor({
    state: WORKSPACE_READY_STATE,
    timeout: timeoutMs,
  });
  /* The rail is server-rendered before useWorkspaceBootstrap has applied and
     confessed the initial hash. On a cold guest redirect it can therefore be
     attached while `data-workspace-boot="pending"` is still hiding the body.
     Mutating the hash in that window starts a lazy console render which the
     bootstrap's later default-location commit can abandon before mount—the
     intermittent React state-update warning this guard was added to prevent. */
  await page.waitForFunction(() => {
    if (document.documentElement.dataset.workspaceBoot) return false;
    const [desk, section] = window.location.hash.slice(1).split("/");
    if (!desk || !section) return false;
    const workspace = desk === "live" ? "execution" : desk;
    const panel = document.getElementById(`panel-${desk}`);
    const subpanel = document.getElementById(`${workspace}-subpanel-${section}`);
    const visible = (element) => Boolean(
      element
      && !element.closest("[hidden]")
      && getComputedStyle(element).display !== "none"
      && element.getClientRects().length > 0
    );
    return visible(panel) && visible(subpanel);
  }, null, { timeout: timeoutMs, polling: 50 });
}

export async function enterWorkspace(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // The button is server-rendered before its client handler is attached.
  // Leave one short hydration window so a click under audit load cannot land
  // on inert HTML and strand the next viewport on /login.
  await page.waitForTimeout(750);
  const guest = page.getByRole("button", { name: /Continue as guest|Open the workspace/i }).first();
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.waitForURL((reading) => !reading.pathname.includes("login"), {
      timeout: 15_000,
      waitUntil: "domcontentloaded",
    });
  }
  // The URL can leave /login before the client router has attached its
  // hashchange listener. Route mutation before this marker silently leaves the
  // previous panel visible and makes a geometry result look authoritative when
  // it sampled the wrong desk.
  await waitForWorkspaceReady(page);
}

const rounded = (value) => Math.round(value * 10) / 10;
const roundedReading = (reading) => Object.fromEntries(
  Object.entries(reading).map(([key, value]) => [key, rounded(value)]),
);

/** Ignore copy and timestamps; retain only geometry that can affect layout. */
export function geometrySnapshotSignature(snapshot) {
  return JSON.stringify({
    documentOverflow: snapshot.documentOverflow,
    overlay: snapshot.overlay,
    elements: snapshot.elements.map((element) => ({
      key: element.key,
      rect: roundedReading(element.rect),
      ownerRect: roundedReading(element.ownerRect),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      clipAncestors: (element.clipAncestors ?? []).map((clip) => ({
        ...clip,
        overflow: roundedReading(clip.overflow),
      })),
    })),
    siblingPairs: snapshot.siblingPairs.map((pair) => ({
      ...pair,
      overlap: roundedReading(pair.overlap),
    })),
    obstructions: snapshot.obstructions.map((obstruction) => ({
      ...obstruction,
      overlap: roundedReading(obstruction.overlap),
    })),
  });
}

/** Wait for the requested route, then require two identical geometry samples. */
export async function waitForAuditRoute(page, route, options = {}) {
  const timeoutMs = options.timeoutMs ?? LAYOUT_SETTLING.timeoutMs;
  const sampleIntervalMs = options.sampleIntervalMs ?? LAYOUT_SETTLING.sampleIntervalMs;
  const identicalSamplesRequired = options.identicalSamples ?? LAYOUT_SETTLING.identicalSamples;
  const snapshot = options.snapshot ?? browserSnapshot;
  const readiness = auditRouteReadiness(route);

  await page.waitForFunction(({ canonicalHash, panelSelector, sectionSelector, viewSelector }) => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && !element.closest("[hidden]")
        && element.getClientRects().length > 0;
    };
    const panel = document.querySelector(panelSelector);
    const section = document.querySelector(sectionSelector);
    const view = viewSelector ? document.querySelector(viewSelector) : section;
    const root = panel;
    const busy = root
      ? [...root.querySelectorAll('[aria-busy="true"], [data-state="loading"]')].some(visible)
      : true;
    const overlay = Boolean(document.querySelector("[data-nextjs-dialog-overlay],#nextjs__container_errors_label"));
    return window.location.hash === `#${canonicalHash}`
      && visible(panel)
      && visible(section)
      && visible(view)
      && !busy
      && !overlay;
  }, readiness, { timeout: timeoutMs, polling: 100 });
  await page.evaluate(() => document.fonts.ready);

  const deadline = Date.now() + timeoutMs;
  let previous = null;
  let identicalSamples = 0;
  let last = null;
  while (Date.now() <= deadline) {
    last = await snapshot(page);
    const signature = geometrySnapshotSignature(last);
    identicalSamples = signature === previous ? identicalSamples + 1 : 1;
    previous = signature;
    if (identicalSamples >= identicalSamplesRequired) return last;
    await page.waitForTimeout(sampleIntervalMs);
  }
  throw new Error(`${route.hash} geometry did not stabilise within ${timeoutMs}ms`);
}

async function runAudit() {
  const { chromium } = await import("playwright");
  const url = option("url", "http://localhost:3000");
  const routeFilter = option("route");
  const routes = routeFilter
    ? LAYOUT_AUDIT_ROUTES.filter((route) => route.hash === routeFilter)
    : LAYOUT_AUDIT_ROUTES;
  if (routes.length === 0) throw new Error(`Unknown route '${routeFilter}'`);
  const viewportOption = option("viewport");
  const viewports = parseViewports(viewportOption);
  const themes = parseThemes(option("theme", "system"));
  const settleTimeoutMs = Number(option("settle-timeout", String(LAYOUT_SETTLING.timeoutMs)));
  if (!Number.isFinite(settleTimeoutMs) || settleTimeoutMs <= 0) {
    throw new Error("--settle-timeout must be a positive number of milliseconds");
  }
  const browser = await chromium.launch({ headless: true });
  const readings = [];
  const consoleErrors = [];
  const unavailableApiReads = [];
  const externalStreamShutdowns = [];

  try {
    for (const viewport of viewports) {
      for (const theme of themes) {
        const context = await browser.newContext({ viewport });
        if (theme !== "system") {
          await context.addInitScript((preference) => {
            try { window.localStorage.setItem("alphaengine-theme", preference); } catch { /* unavailable storage */ }
          }, theme);
        }
        const page = await context.newPage();
        page.on("console", (message) => {
          if (message.type() !== "error") return;
          if (isExpectedApiUnavailable(message.text(), message.location())) {
            unavailableApiReads.push(message.location().url);
            return;
          }
          if (isExpectedExternalStreamShutdown(message.text())) {
            externalStreamShutdowns.push(message.text());
            return;
          }
          consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => consoleErrors.push(error.message));
        await enterWorkspace(page, url);

        for (const route of routes) {
          await page.evaluate((hash) => { window.location.hash = hash; }, route.hash);
          let snapshot;
          try {
            snapshot = await waitForAuditRoute(page, route, { timeoutMs: settleTimeoutMs });
          } catch (error) {
            throw new Error(
              `Layout audit could not settle route '${route.hash}' at `
              + `${viewport.width}x${viewport.height} in ${theme} theme`,
              { cause: error },
            );
          }
          const issues = auditGeometrySnapshot({ viewport, ...snapshot });
          if (snapshot.overlay) issues.push({ kind: "framework-error-overlay" });
          readings.push({ route: route.hash, viewport, theme, issues });
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const failures = readings.filter((reading) => reading.issues.length > 0);
  const report = {
    methodology: {
      routes: routes.length,
      viewports,
      themes,
      tolerancePx: TOLERANCE_PX,
      settling: { ...LAYOUT_SETTLING, timeoutMs: settleTimeoutMs },
      note: "Fresh page per viewport; requested route/view and two identical non-loading geometry samples required before ownership and obstruction checks.",
    },
    states: readings.length,
    passed: readings.length - failures.length,
    failed: failures.length,
    failures,
    consoleErrors: [...new Set(consoleErrors)],
    unavailableApiReads: [...new Set(unavailableApiReads)],
    externalStreamShutdowns: [...new Set(externalStreamShutdowns)],
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0 || consoleErrors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runAudit().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
