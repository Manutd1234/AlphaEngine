import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LAYOUT_VIEWPORTS,
  DEFAULT_AUDIT_HASH,
  EXPLICIT_LAYOUT_THEMES,
  LAYOUT_AUDIT_ROUTES,
  LAYOUT_SETTLING,
  OWNER_SELECTOR,
  SURFACE_SELECTOR,
  WORKSPACE_READY_SELECTOR,
  WORKSPACE_READY_STATE,
  auditGeometrySnapshot,
  auditRouteReadiness,
  browserSnapshot,
  canonicalAuditHash,
  enterWorkspace,
  geometrySnapshotSignature,
  intersection,
  overflowBy,
  waitForAuditRoute,
} from "../scripts/engine-layout-audit.mjs";
import { VISIBLE_COPY_ROUTES } from "../scripts/visible-copy-audit.mjs";

const auditSource = readFileSync(
  fileURLToPath(new URL("../scripts/engine-layout-audit.mjs", import.meta.url)),
  "utf8",
);
const geometrySource = readFileSync(
  fileURLToPath(new URL("../scripts/engine-layout-geometry.mjs", import.meta.url)),
  "utf8",
);
const diffusionControlSource = readFileSync(
  fileURLToPath(new URL("../components/coherence/diffusion/DiffusionViewControl.tsx", import.meta.url)),
  "utf8",
);

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
});

describe("the all-workspace geometry audit", () => {
  it("covers every addressable route at the layout breakpoints that have regressed", () => {
    assert.equal(VISIBLE_COPY_ROUTES.length, 120);
    assert.equal(LAYOUT_AUDIT_ROUTES.length, VISIBLE_COPY_ROUTES.length);
    assert.equal(new Set(LAYOUT_AUDIT_ROUTES.map(({ hash }) => hash)).size, VISIBLE_COPY_ROUTES.length);
    assert.ok(LAYOUT_AUDIT_ROUTES.some(({ hash }) => hash === "research/summary/setup"));
    assert.deepEqual(DEFAULT_LAYOUT_VIEWPORTS, [
      { width: 390, height: 844 },
      { width: 620, height: 900 },
      { width: 721, height: 900 },
      { width: 821, height: 900 },
      { width: 1101, height: 900 },
      { width: 1280, height: 900 },
      { width: 1401, height: 1000 },
      { width: 1720, height: 1100 },
    ]);
    assert.deepEqual(EXPLICIT_LAYOUT_THEMES, ["light", "dark"]);
    assert.deepEqual(LAYOUT_SETTLING, {
      timeoutMs: 35_000,
      sampleIntervalMs: 100,
      identicalSamples: 2,
    });
  });

  it("measures owned analytical surfaces after the workspace has hydrated", () => {
    assert.doesNotMatch(SURFACE_SELECTOR, /\[role=['"]?tabpanel/);
    assert.match(OWNER_SELECTOR, /header/);
    assert.match(WORKSPACE_READY_SELECTOR, /workspace-tabs/);
    assert.match(WORKSPACE_READY_SELECTOR, /workspace-bottom-nav/);
    assert.equal(WORKSPACE_READY_STATE, "attached");
    assert.equal(typeof browserSnapshot, "function");
    assert.match(auditSource, /from "\.\/engine-layout-geometry\.mjs"/);
    assert.match(auditSource, /option\("theme", "system"\)/);
    assert.match(auditSource, /window\.localStorage\.setItem\("alphaengine-theme", preference\)/);
    assert.match(auditSource, /readings\.push\(\{ route: route\.hash, viewport, theme, issues \}\)/);
    assert.match(auditSource, /document\.documentElement\.dataset\.workspaceBoot/);
    assert.doesNotMatch(auditSource, /waitForTimeout\(125\)/);
  });

  it("derives canonical hashes and visible markers for each routed view grammar", () => {
    const marketDefault = { desk: "markets", section: "universe", view: "baskets", hash: "markets/universe/baskets" };
    assert.equal(canonicalAuditHash(marketDefault), "markets/universe");
    assert.equal(
      auditRouteReadiness(marketDefault).viewSelector,
      '#markets-subpanel-universe:not([hidden]) [data-market-view="baskets"]',
    );

    const proof = { desk: "coherence", section: "certificate", view: "proof", hash: "coherence/certificate/proof" };
    assert.equal(canonicalAuditHash(proof), proof.hash);
    assert.equal(
      auditRouteReadiness(proof).viewSelector,
      '.coh-evidence[data-tab="coherence"][data-section="certificate"][data-view="proof"]',
      "Proofs evidence is a sibling of, not a descendant of, its section panel",
    );
    assert.equal(canonicalAuditHash({
      desk: "coherence",
      section: "lessons",
      view: "coverage",
      hash: "coherence/lessons/coverage",
    }), "coherence/lessons", "the sole named default must not be inferred from route order");
    assert.equal(canonicalAuditHash({
      desk: "coherence",
      section: "lessons",
      view: "prices",
      hash: "coherence/lessons/prices",
    }), "coherence/lessons/prices");

    const diffusion = { desk: "diffusion", section: "sandbox", view: "spectrum", hash: "diffusion/sandbox/spectrum" };
    assert.equal(
      auditRouteReadiness(diffusion).viewSelector,
      '#diffusion-subpanel-sandbox:not([hidden]) .diff-view-control [data-view="spectrum"][aria-pressed="true"]',
    );
    assert.match(diffusionControlSource, /data-view=\{name\}/);
    assert.equal(auditRouteReadiness({
      desk: "diffusion",
      section: "model",
      view: "measurement",
      hash: "diffusion/model/measurement",
    }).viewSelector, null, "a single-view structural landing has no redundant control");

    assert.equal(auditRouteReadiness({
      desk: "research",
      section: "summary",
      view: "setup",
      hash: "research/summary/setup",
    }).viewSelector, '#research-summary-setup-tab[data-state="active"]');
    assert.equal(auditRouteReadiness({
      desk: "live",
      section: "trade",
      view: null,
      hash: "live/trade",
    }).sectionSelector, "#execution-subpanel-trade:not([hidden])");
  });

  it("verifies workspace readiness even when the guest gate is already absent", async () => {
    let readyWaits = 0;
    let bootstrapWaited = false;
    let seededHash: string | null = null;
    const page = {
      goto: async () => undefined,
      waitForTimeout: async () => undefined,
      getByRole: () => ({
        first: () => ({ isVisible: async () => false }),
      }),
      locator: (selector: string) => ({
        first: () => ({
          waitFor: async (options: { state: string; timeout: number }) => {
            assert.equal(selector, WORKSPACE_READY_SELECTOR);
            assert.deepEqual(options, { state: WORKSPACE_READY_STATE, timeout: 15_000 });
            readyWaits += 1;
          },
        }),
      }),
      evaluate: async (_predicate: unknown, defaultHash: string) => {
        seededHash = defaultHash;
      },
      waitForFunction: async (
        predicate: unknown,
        argument: unknown,
        options: { timeout: number; polling: number },
      ) => {
        assert.equal(typeof predicate, "function");
        assert.equal(argument, null);
        assert.deepEqual(options, { timeout: 15_000, polling: 50 });
        bootstrapWaited = true;
      },
    };

    await enterWorkspace(page, "http://localhost:3000");
    assert.equal(readyWaits, 1);
    assert.equal(seededHash, DEFAULT_AUDIT_HASH);
    assert.equal(bootstrapWaited, true);
  });

  it("waits for the requested DOM state and two identical geometry samples", async () => {
    const route = { desk: "markets", section: "universe", view: "baskets", hash: "markets/universe/baskets" };
    const sample = (documentOverflow: boolean) => ({
      documentOverflow,
      overlay: false,
      elements: [],
      siblingPairs: [],
      obstructions: [],
    });
    const snapshots = [sample(true), sample(false), sample(false)];
    let readiness: Record<string, unknown> | null = null;
    let waitOptions: Record<string, unknown> | null = null;
    let samples = 0;
    const waits: number[] = [];
    const page = {
      waitForFunction: async (
        _predicate: unknown,
        nextReadiness: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        readiness = nextReadiness;
        waitOptions = options;
      },
      evaluate: async () => undefined,
      waitForTimeout: async (milliseconds: number) => { waits.push(milliseconds); },
    };

    const result = await waitForAuditRoute(page, route, {
      timeoutMs: 1_000,
      sampleIntervalMs: 0,
      identicalSamples: 2,
      snapshot: async () => {
        samples += 1;
        return snapshots.shift();
      },
    });

    assert.deepEqual(readiness, auditRouteReadiness(route));
    assert.deepEqual(waitOptions, { timeout: 1_000, polling: 100 });
    assert.equal(samples, 3);
    assert.deepEqual(waits, [0, 0]);
    assert.equal(result.documentOverflow, false);
    assert.equal(geometrySnapshotSignature(result), geometrySnapshotSignature(sample(false)));
  });

  it("reports which edge crossed its owning container", () => {
    assert.deepEqual(
      overflowBy(rect(8, 8, 208, 108), rect(10, 10, 200, 100), 1),
      { left: 2, top: 2, right: 8, bottom: 8 },
    );
    assert.equal(overflowBy(rect(11, 11, 199, 99), rect(10, 10, 200, 100), 1), null);
  });

  it("distinguishes adjacent borders from obstructing intersections", () => {
    assert.equal(intersection(rect(0, 0, 100, 80), rect(100, 0, 200, 80), 1), null);
    assert.deepEqual(
      intersection(rect(0, 0, 100, 80), rect(96, 4, 160, 72), 1),
      { width: 4, height: 68 },
    );
  });

  it("allows an explicitly named local scrollport but rejects silent clipping", () => {
    const issues = auditGeometrySnapshot({
      viewport: { width: 390, height: 844 },
      documentOverflow: false,
      elements: [
        {
          key: "formula-safe",
          role: "formula",
          rect: rect(8, 20, 450, 60),
          ownerRect: rect(8, 8, 382, 120),
          scrollWidth: 442,
          clientWidth: 374,
          overflowX: "auto",
          localScrollport: true,
          accessibleName: "Exact formula; scroll horizontally",
        },
        {
          key: "lesson-clipped",
          role: "card",
          rect: rect(8, 140, 430, 360),
          ownerRect: rect(8, 128, 382, 380),
          scrollWidth: 422,
          clientWidth: 374,
          overflowX: "clip",
          localScrollport: false,
          accessibleName: "Lesson",
        },
      ],
      siblingPairs: [],
      obstructions: [],
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.kind, "silent-clipping");
    assert.equal(issues[0]?.key, "lesson-clipped");
  });

  it("reports sibling and sticky-region obstruction as separate failures", () => {
    const issues = auditGeometrySnapshot({
      viewport: { width: 1440, height: 1000 },
      documentOverflow: false,
      elements: [],
      siblingPairs: [{
        first: "card-a",
        second: "card-b",
        overlap: { width: 3, height: 200 },
      }],
      obstructions: [{
        blocker: "workspace-rail",
        target: "panel-heading",
        overlap: { width: 240, height: 18 },
      }],
    });

    assert.deepEqual(issues.map((issue) => issue.kind), [
      "sibling-intersection",
      "sticky-obstruction",
    ]);
  });

  it("reports an intermediate clipping ancestor without inventing one for contained surfaces", () => {
    const issues = auditGeometrySnapshot({
      viewport: { width: 390, height: 844 },
      documentOverflow: false,
      elements: [{
        key: "wide-figure",
        role: "figure",
        rect: rect(8, 20, 382, 120),
        ownerRect: rect(8, 8, 382, 140),
        scrollWidth: 374,
        clientWidth: 374,
        overflowX: "visible",
        localScrollport: false,
        accessibleName: "",
        clipAncestors: [{
          key: "rounded-wrapper",
          overflow: { left: 0, right: 18 },
        }],
      }, {
        key: "contained-figure",
        role: "figure",
        rect: rect(8, 160, 382, 260),
        ownerRect: rect(8, 148, 382, 280),
        scrollWidth: 374,
        clientWidth: 374,
        overflowX: "visible",
        localScrollport: false,
        accessibleName: "",
        clipAncestors: [],
      }],
      siblingPairs: [],
      obstructions: [],
    });

    assert.deepEqual(issues, [{
      kind: "nested-clipping",
      key: "wide-figure",
      role: "figure",
      ancestor: "rounded-wrapper",
      overflow: { left: 0, right: 18 },
    }]);
  });
});

describe("the browser audit measures painted surfaces, not latent DOM boxes", () => {
  it("excludes bodies retained under a closed disclosure", () => {
    assert.match(
      geometrySource,
      /element\.parentElement\?\.closest\("details:not\(\[open\]\)"\)/,
      "closed details keep descendants in the DOM, but those descendants are not painted",
    );
    assert.doesNotMatch(
      geometrySource,
      /closedDetails !== element/,
      "a nested disclosure must not treat itself as the nearest closed painting boundary",
    );
  });

  it("excludes a surface wholly outside an ancestor's vertical clip or scroll viewport", () => {
    assert.match(geometrySource, /const paintedWithinVerticalClips = \(element\) =>/);
    assert.match(geometrySource, /\^\(auto\|scroll\|hidden\|clip\)\$/);
    assert.match(
      geometrySource,
      /rect\.bottom <= clip\.top \+ tolerance\s*\|\| rect\.top >= clip\.bottom - tolerance/,
      "a reachable child below a local scrollport is not painted until that scrollport moves",
    );
  });

  it("checks only actual crossings of intermediate horizontal clipping edges", () => {
    assert.match(geometrySource, /const nestedHorizontalClipsFor = \(element, owner\) =>/);
    assert.match(geometrySource, /\^\(hidden\|clip\)\$/);
    assert.match(geometrySource, /overflow\.left > tolerance \|\| overflow\.right > tolerance/);
    assert.match(geometrySource, /clipAncestors: nestedHorizontalClipsFor\(element, scrollport \?\? owner\)/);
  });

  it("includes active-panel sticky controls but ignores their own descendants", () => {
    assert.doesNotMatch(geometrySource, /activePanel\?\.contains\(element\)/);
    assert.doesNotMatch(geometrySource, /filter\(visible\)\.slice\(0, 2\)/);
    assert.match(geometrySource, /const paintedRectForObstruction = \(element\) =>/);
    assert.match(geometrySource, /clip\.top \+ ancestor\.clientTop \+ ancestor\.clientHeight/);
    assert.match(geometrySource, /clip\.left \+ ancestor\.clientLeft \+ ancestor\.clientWidth/);
    assert.match(
      geometrySource,
      /\{ element, rect: paintedRectForObstruction\(element\) \}/,
      "obstruction checks use the fragment painted inside every scroll or clip ancestor",
    );
    assert.match(
      geometrySource,
      /blocker === target \|\| blocker\.contains\(target\) \|\| target\.contains\(blocker\)/,
    );
  });
});
