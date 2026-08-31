#!/usr/bin/env node

/**
 * Measures what a reader sees at rest across every addressable desk state.
 *
 * This is deliberately a browser measurement. Source strings include hidden
 * panels and cannot prove progressive disclosure reduced anything. Machine-
 * generated repository paths and streaming log rows are excluded: they are
 * data, not interface prose, and their volume changes between two identical
 * builds. Tables and analytical readouts remain in scope.
 */

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const CORE_SECTIONS = {
  overview: ["loop", "desks", "audit"],
  research: ["summary", "parameters", "walkforward", "attribution", "lineage", "decision", "runs", "fitted", "codex"],
  live: ["trade", "liquidity", "routing", "quality", "activity"],
  portfolio: ["overview", "equity", "positions", "allocation", "performance"],
  risk: ["limits", "model", "diagram", "drivers", "montecarlo", "oraclevar", "scenarios", "controls"],
  data: ["overview", "feeds", "quality", "incidents", "lineage", "providers", "queue"],
  reliability: ["overview", "planes", "services", "events", "controls"],
  developer: ["overview", "readiness", "quality", "apis", "codebase", "work"],
};

const ENGINE_VIEWS = {
  markets: {
    universe: ["baskets", "positions", "families"],
    settlement: ["reading", "formation", "pending"],
    books: ["ladder", "identity", "history"],
    dispersion: ["quotes", "channel"],
    lattice: ["survival", "mass", "moments", "support"],
    stake: ["plan", "capital", "method", "family"],
    fees: ["example", "shape", "comparison", "table"],
    shell: ["layout", "route", "tree"],
  },
  coherence: {
    certificate: ["verdict", "proof", "checks", "prices", "sizes"],
    portfolio: ["cover", "basket", "size"],
    combos: ["bands", "parlays", "inputs", "legs", "bounds"],
    index: ["series", "families"],
    calibration: ["score", "decomposition", "components", "measures", "reliability", "bands"],
    corpus: ["composition", "trend"],
    lessons: ["prices", "structure", "bounds", "record", "coverage", "states"],
  },
  diffusion: {
    arm: ["absorption", "floor", "clocks"],
    meetings: ["table", "calendar", "mechanism"],
    episodes: ["survival", "episodes"],
    model: ["measurement"],
    instrument: ["instrument"],
    sandbox: ["halflife", "simulator", "spectrum"],
    findings: ["plot", "table", "instrument"],
  },
};

export const COPY_EXCLUSIONS = [".codebase-filelist ul", ".console-log", "[role='log']"];

/**
 * Settled browser observation before the ten-percent reduction slices.
 *
 * This remains historical evidence for its 108-state inventory. The current
 * route inventory may grow; `compareVisibleCopy` refuses to calculate a
 * percentage or enforce this budget until both observations cover the same
 * number of states.
 */
export const VISIBLE_COPY_BASELINE = Object.freeze({
  words: 33_231,
  characters: 208_697,
  states: 108,
  viewport: "1440x1000",
  observedAt: "2026-08-28",
});

/** The requested release band: materially shorter without hiding too much context. */
export const VISIBLE_COPY_BUDGET = Object.freeze({
  maximumWords: 29_750,
  minimumReductionPercent: 10,
  maximumReductionPercent: 15,
});

/** A route is measurable only after two identical ready samples. */
export const VISIBLE_COPY_SETTLING = Object.freeze({
  sampleIntervalMs: 250,
  /* A cold certificate read has a 28s browser deadline. Giving the copy audit
     only 15s made a working Basket view indistinguishable from a stuck one. */
  timeoutMs: 35_000,
  identicalSamples: 2,
});

export const VISIBLE_COPY_ROUTES = [
  ...Object.entries(CORE_SECTIONS).flatMap(([desk, sections]) => (
    sections.map((section) => ({ desk, section, view: null, hash: `${desk}/${section}` }))
  )),
  { desk: "research", section: "summary", view: "setup", hash: "research/summary/setup" },
  ...Object.entries(ENGINE_VIEWS).flatMap(([desk, sections]) => (
    Object.entries(sections).flatMap(([section, views]) => (
      views.map((view) => ({ desk, section, view, hash: `${desk}/${section}/${view}` }))
    ))
  )),
];

export function countVisibleTokens(text) {
  return text.match(/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g)?.length ?? 0;
}

export function reductionPercent(before, after) {
  if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return null;
  return Number((((before - after) / before) * 100).toFixed(2));
}

/** A historical total is meaningful only against the same route inventory. */
export function compareVisibleCopy(baseline, current, budget = VISIBLE_COPY_BUDGET) {
  const inventoryComparable = baseline.states === current.states;
  const wordReductionPercent = inventoryComparable
    ? reductionPercent(baseline.words, current.words)
    : null;

  return {
    baseline,
    inventoryComparable,
    comparisonReason: inventoryComparable
      ? null
      : `Historical baseline covers ${baseline.states} states; current inventory covers ${current.states} states. Capture a same-inventory browser baseline before enforcing the reduction budget.`,
    wordReductionPercent,
    budget,
    wordsOverBudget: inventoryComparable
      ? Math.max(0, current.words - budget.maximumWords)
      : null,
    withinBudget: inventoryComparable
      ? current.words <= budget.maximumWords
        && wordReductionPercent !== null
        && wordReductionPercent >= budget.minimumReductionPercent
        && wordReductionPercent <= budget.maximumReductionPercent
      : null,
  };
}

export function hashVisibleText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function percentile(values, proportion) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * proportion) - 1);
  return sorted[index];
}

function readingDistribution(readings) {
  const words = readings.map((reading) => reading.words);
  const maximumWords = Math.max(0, ...words);
  return {
    medianWords: words.length % 2
      ? percentile(words, 0.5)
      : Number(((percentile(words, 0.5) + percentile(words, 0.5 + 1 / words.length)) / 2).toFixed(1)),
    p95Words: percentile(words, 0.95),
    maximumWords,
    maximumState: readings.find((reading) => reading.words === maximumWords)?.hash ?? null,
  };
}

/** Aggregate the fixed route inventory without hiding any analytical table. */
export function summariseReadings(readings) {
  const tabs = [...new Set(readings.map((reading) => reading.desk))];
  const byTab = Object.fromEntries(tabs.map((desk) => {
    const states = readings.filter((reading) => reading.desk === desk);
    return [desk, {
      states: states.length,
      words: total(states, "words"),
      characters: total(states, "characters"),
      ...readingDistribution(states),
    }];
  }));
  return { byTab, distribution: readingDistribution(readings) };
}

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function total(items, field) {
  return items.reduce((sum, item) => sum + item[field], 0);
}

async function enterWorkspace(page) {
  await page.goto(option("url", "http://localhost:3000"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const guest = page.getByRole("button", { name: /Continue as guest|Open the workspace/i }).first();
  if (!await guest.isVisible().catch(() => false)) return;
  await guest.click();
  await page.waitForURL((url) => !url.pathname.includes("login"), {
    timeout: 15_000,
    waitUntil: "domcontentloaded",
  });
}

async function readVisibleState(page) {
  return page.evaluate((exclusions) => {
    const workspace = document.querySelector("main") ?? document.querySelector(".workspace-main") ?? document.body;
    const visible = (node) => {
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
    };
    const busy = [...workspace.querySelectorAll('[aria-busy="true"], [data-state="loading"]')]
      .filter(visible)
      .map((node) => node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "busy");
    const excluded = [...workspace.querySelectorAll(exclusions.join(", "))];
    const prior = excluded.map((node) => node.hidden);
    excluded.forEach((node) => { node.hidden = true; });
    const text = workspace.innerText.replace(/\s+/g, " ").trim();
    excluded.forEach((node, index) => { node.hidden = prior[index]; });
    return {
      text,
      busy,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      overlay: Boolean(document.querySelector("[data-nextjs-dialog-overlay], #nextjs__container_errors_label")),
    };
  }, COPY_EXCLUSIONS);
}

async function waitForSettledVisibleState(page, hash) {
  const timeoutMs = Number(option("settle-timeout", String(VISIBLE_COPY_SETTLING.timeoutMs)));
  const deadline = Date.now() + timeoutMs;
  let previousHash = null;
  let identicalSamples = 0;
  let samples = 0;
  let last = null;

  while (Date.now() <= deadline) {
    last = await readVisibleState(page);
    samples += 1;
    const digest = hashVisibleText(last.text);
    if (last.busy.length === 0 && !last.overlay && digest === previousHash) {
      identicalSamples += 1;
    } else if (last.busy.length === 0 && !last.overlay) {
      identicalSamples = 1;
    } else {
      identicalSamples = 0;
    }
    previousHash = digest;
    if (identicalSamples >= VISIBLE_COPY_SETTLING.identicalSamples) {
      return { ...last, digest, samples };
    }
    await page.waitForTimeout(VISIBLE_COPY_SETTLING.sampleIntervalMs);
  }

  const reason = last?.busy?.length ? `busy: ${last.busy.join(" | ")}` : "visible text did not stabilise";
  throw new Error(`${hash} did not settle within ${timeoutMs}ms (${reason})`);
}

async function measure() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    const httpFailures = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() < 400) return;
      httpFailures.push({
        method: response.request().method(),
        status: response.status(),
        url: response.url(),
      });
    });
    await enterWorkspace(page);
    await page.evaluate(() => document.fonts.ready);

    const readings = [];
    for (const route of VISIBLE_COPY_ROUTES) {
      await page.evaluate((hash) => { window.location.hash = hash; }, route.hash);
      const state = await waitForSettledVisibleState(page, route.hash);
      readings.push({
        ...route,
        words: countVisibleTokens(state.text),
        characters: state.text.length,
        overflow: state.overflow,
        overlay: state.overlay,
        digest: state.digest,
        settleSamples: state.samples,
      });
    }

    const summary = summariseReadings(readings);
    const words = total(readings, "words");
    const characters = total(readings, "characters");
    const report = {
      methodology: {
        states: readings.length,
        viewport: "1440x1000",
        exclusions: COPY_EXCLUSIONS,
        settling: VISIBLE_COPY_SETTLING,
        note: "Visible active-workspace text after fonts and two identical non-loading samples; machine-generated paths and live log rows excluded.",
      },
      words,
      characters,
      comparison: compareVisibleCopy(
        VISIBLE_COPY_BASELINE,
        { words, states: readings.length },
        VISIBLE_COPY_BUDGET,
      ),
      byTab: summary.byTab,
      distribution: summary.distribution,
      strategies: readings.find((reading) => reading.hash === "research/codex"),
      failures: readings.filter((reading) => reading.overflow || reading.overlay),
      consoleErrors: [...new Set(errors)],
      httpFailures: [...new Map(httpFailures.map((failure) => (
        [`${failure.method} ${failure.status} ${failure.url}`, failure]
      ))).values()],
      ...(process.argv.includes("--details") ? { readings } : {}),
    };
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes("--enforce-budget") && !report.comparison.withinBudget) process.exitCode = 1;
  } finally {
    /* A failed settle used to leave Chromium running indefinitely, so the
       audit command never returned the failure it had already diagnosed. */
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void measure().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
