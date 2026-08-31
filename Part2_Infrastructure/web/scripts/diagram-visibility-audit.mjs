#!/usr/bin/env node

/**
 * Runtime paint audit for every addressable AlphaEngine workspace state.
 *
 * The layout audit proves ownership and containment. This companion proves
 * that active figures have a measurable plot region and that large SVG/canvas
 * diagrams contain at least one painted mark. Honest unavailable states are
 * reported separately so they cannot masquerade as a successful drawing.
 */

import { pathToFileURL } from "node:url";

import {
  LAYOUT_AUDIT_ROUTES,
  auditRouteReadiness,
  enterWorkspace,
  isExpectedApiUnavailable,
  waitForAuditRoute,
} from "./engine-layout-audit.mjs";

const LARGE_DIAGRAM_SELECTOR = [
  ".coh-figure",
  "figure",
  "[data-quant-surface]",
  "[role='img']",
  "canvas",
  "svg",
].join(",");

const UNAVAILABLE_SELECTOR = [
  ".coh-figure__empty",
  ".console-empty",
  "[data-state='unavailable']",
  "[data-transport-state='unavailable']",
].join(",");

const LOADING_COPY = /^(?:Reading|Working|Replaying|Asking|Sizing|Loading|Connecting|Warming|Refreshing|Waiting|Pricing)\b/i;

export function isDiagramLoadingText(value) {
  return LOADING_COPY.test(value.trim());
}

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function parseViewport(value) {
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error(`Invalid viewport '${value}'; expected WIDTHxHEIGHT`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseTheme(value) {
  if (value === "system" || value === "light" || value === "dark") return value;
  throw new Error(`Invalid theme '${value}'; expected system, light or dark`);
}

function diagramSnapshot(page, sectionSelector) {
  return page.evaluate(({ diagramSelector, unavailableSelector, rootSelector }) => {
    const root = document.querySelector(rootSelector);
    if (!root) return { diagrams: [], unavailable: [], loading: [], missingRoot: true };

    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      };
    };
    const labelOf = (element) => (
      element.getAttribute("aria-label")
      ?? element.querySelector(":scope > figcaption")?.textContent
      ?? element.getAttribute("data-quant-surface")
      ?? element.id
      ?? element.className?.baseVal
      ?? element.className
      ?? element.tagName.toLowerCase()
    ).trim().replace(/\s+/g, " ").slice(0, 180);
    const rendered = (element) => {
      for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (Number(style.opacity) <= 0.01) return false;
        if (node.hidden) return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const paintedMark = (element, boundary) => {
      for (let node = element; node && node !== boundary; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0.01) return false;
      }
      const style = getComputedStyle(element);
      const transparentColour = (value) => value === "none" || value === "transparent"
        || /rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(value)
        || /rgb\([^)]*\/\s*0(?:\.0+)?%?\s*\)$/i.test(value);
      const visibleFill = !transparentColour(style.fill) && Number(style.fillOpacity) > 0.01;
      const visibleStroke = !transparentColour(style.stroke)
        && Number(style.strokeOpacity) > 0.01
        && Number.parseFloat(style.strokeWidth) > 0;
      const tag = element.tagName.toLowerCase();
      if (tag === "line" || tag === "polyline") return visibleStroke;
      if (tag === "image") return Boolean(element.getAttribute("href") || element.getAttribute("xlink:href"));
      return visibleFill || visibleStroke;
    };

    const all = [...root.querySelectorAll(diagramSelector)];
    const candidates = all.filter((element) => {
      if (element.closest("[hidden]")) return false;
      const parentCandidate = element.parentElement?.closest(diagramSelector);
      if (parentCandidate && root.contains(parentCandidate)) {
        if (parentCandidate.matches(".coh-figure, figure, [data-quant-surface], [role='img']")) return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width >= 72 && rect.height >= 22;
    });

    const diagrams = candidates.map((element, index) => {
      const isFigure = element.matches(".coh-figure, figure");
      const explicitlyUnavailable = element.matches(unavailableSelector)
        || Boolean(element.querySelector(unavailableSelector));
      const htmlPlots = isFigure
        ? [...element.querySelectorAll(
            ".coh-figure__plot, [data-plot], canvas, [role='img'], [role='listbox'], [role='list'], table, section[aria-label]",
          )].filter((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return rect.width >= 72 && rect.height >= 22;
          }).sort((left, right) => {
            const a = left.getBoundingClientRect();
            const b = right.getBoundingClientRect();
            return b.width * b.height - a.width * a.height;
          })
        : [];
      const plot = isFigure
        ? htmlPlots[0]
          ?? [...element.querySelectorAll("svg")].find((svg) => {
            const rect = svg.getBoundingClientRect();
            return rect.width >= 72 && rect.height >= 22;
          })
          ?? null
        : element;
      const svgs = plot
        ? [...(plot.matches("svg") ? [plot] : plot.querySelectorAll("svg"))]
        : [];
      const canvases = plot
        ? [...(plot.matches("canvas") ? [plot] : plot.querySelectorAll("canvas"))]
        : [];
      const marks = svgs
        .flatMap((svg) => [...svg.querySelectorAll("path,line,rect,circle,ellipse,polyline,polygon,text,use,image")])
        .filter((mark) => !mark.closest("defs, clipPath, mask, symbol, marker, pattern"));
      const paintedMarks = marks.filter((mark) => paintedMark(mark, plot)).length;
      const plotRect = plot ? rectOf(plot) : null;
      const issues = [];

      if (!rendered(element)) issues.push("not-rendered");
      if (isFigure && !plot && !explicitlyUnavailable) issues.push("missing-plot");
      if (plot && !rendered(plot)) issues.push("plot-not-rendered");
      if (plot && !explicitlyUnavailable && plot.childElementCount === 0 && !plot.textContent?.trim()) {
        issues.push("empty-plot");
      }
      if (plotRect && (plotRect.width < 2 || plotRect.height < 2)) issues.push("zero-size-plot");
      for (const canvas of canvases) {
        if (canvas.width < 2 || canvas.height < 2) issues.push("zero-size-canvas-bitmap");
      }
      if (svgs.length > 0 && marks.length === 0) issues.push("empty-svg");
      if (marks.length > 0 && paintedMarks === 0) issues.push("unpainted-svg");

      return {
        key: `${element.tagName.toLowerCase()}-${index + 1}`,
        label: labelOf(element),
        rect: rectOf(element),
        plotRect,
        svgs: svgs.length,
        canvases: canvases.length,
        marks: marks.length,
        paintedMarks,
        explicitlyUnavailable,
        issues: [...new Set(issues)],
      };
    });

    const unavailable = [...root.querySelectorAll(unavailableSelector)]
      .filter(rendered)
      .map((element) => element.textContent?.trim().replace(/\s+/g, " ").slice(0, 240) ?? "unavailable");
    const busy = [...root.querySelectorAll("[aria-busy='true']")]
      .filter(rendered)
      .map((element) => element.textContent?.trim().replace(/\s+/g, " ").slice(0, 240) ?? "busy");
    return {
      diagrams,
      unavailable: [...new Set(unavailable)],
      loading: [...new Set([
        ...unavailable.filter((reading) => /^(?:Reading|Working|Replaying|Asking|Sizing|Loading|Connecting|Warming|Refreshing|Waiting|Pricing)\b/i.test(reading)),
        ...busy,
      ])],
      missingRoot: false,
    };
  }, {
    diagramSelector: LARGE_DIAGRAM_SELECTOR,
    unavailableSelector: UNAVAILABLE_SELECTOR,
    rootSelector: sectionSelector,
  });
}

async function waitForDiagramState(page, sectionSelector, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  let identical = 0;
  let last = null;
  while (Date.now() <= deadline) {
    last = await diagramSnapshot(page, sectionSelector);
    const signature = JSON.stringify({ diagrams: last.diagrams, unavailable: last.unavailable });
    identical = signature === previous ? identical + 1 : 1;
    previous = signature;
    if (last.loading.length === 0 && identical >= 2) return { ...last, timedOut: false };
    await page.waitForTimeout(250);
  }
  return { ...last, timedOut: true };
}

export async function runDiagramVisibilityAudit({
  url = "http://localhost:3000",
  viewport = { width: 1440, height: 1000 },
  theme = "system",
  routeFilter = null,
} = {}) {
  const { chromium } = await import("playwright");
  const routes = routeFilter
    ? LAYOUT_AUDIT_ROUTES.filter((route) => route.hash === routeFilter)
    : LAYOUT_AUDIT_ROUTES;
  if (routes.length === 0) throw new Error(`Unknown route '${routeFilter}'`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  if (theme !== "system") {
    await context.addInitScript((preference) => {
      try { window.localStorage.setItem("alphaengine-theme", preference); } catch { /* unavailable storage */ }
    }, theme);
  }
  const page = await context.newPage();
  const consoleErrors = [];
  const unavailableApiReads = [];
  const apiFailures = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isExpectedApiUnavailable(message.text(), message.location())) {
      unavailableApiReads.push(message.location().url);
      return;
    }
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() < 500) return;
    try {
      const parsed = new URL(response.url());
      if (parsed.pathname.startsWith("/api/")) {
        apiFailures.push({ url: parsed.pathname, status: response.status() });
      }
    } catch { /* Playwright supplied a non-URL response identifier. */ }
  });

  const readings = [];
  try {
    await enterWorkspace(page, url);
    for (const route of routes) {
      await page.evaluate((hash) => { window.location.hash = hash; }, route.hash);
      await waitForAuditRoute(page, route);
      const readiness = auditRouteReadiness(route);
      readings.push({
        route: route.hash,
        ...await waitForDiagramState(page, readiness.sectionSelector),
      });
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const failures = readings.flatMap((reading) => reading.diagrams
    .filter((diagram) => diagram.issues.length > 0)
    .map((diagram) => ({ route: reading.route, ...diagram })));
  const unsettled = readings.filter((reading) => reading.timedOut)
    .map(({ route, loading }) => ({ route, loading }));
  const unavailable = readings.filter((reading) => reading.unavailable.length > 0)
    .map(({ route, unavailable: states }) => ({ route, unavailable: states }));
  const uniqueApiFailures = [...new Map(apiFailures
    .map((failure) => [`${failure.status} ${failure.url}`, failure])).values()];
  const paintPassed = failures.length === 0 && unsettled.length === 0 && consoleErrors.length === 0;
  return {
    methodology: { routes: routes.length, viewport, theme },
    routes: readings.length,
    diagrams: readings.reduce((sum, reading) => sum + reading.diagrams.length, 0),
    // `passed` is deliberately the paint/layout verdict. `fullyAvailable` is
    // stricter and cannot be true while an honest unavailable panel or 5xx API
    // boundary remains, so a visual pass can never be quoted as gateway proof.
    passed: paintPassed,
    fullyAvailable: paintPassed
      && unavailable.length === 0
      && uniqueApiFailures.length === 0
      && unavailableApiReads.length === 0,
    failures,
    unsettled,
    unavailable,
    consoleErrors: [...new Set(consoleErrors)],
    unavailableApiReads: [...new Set(unavailableApiReads)],
    apiFailures: uniqueApiFailures,
    readings,
  };
}

async function main() {
  const report = await runDiagramVisibilityAudit({
    url: option("url", "http://localhost:3000"),
    viewport: parseViewport(option("viewport", "1440x1000")),
    theme: parseTheme(option("theme", "system")),
    routeFilter: option("route"),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
