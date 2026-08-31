import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  DATA_SECTIONS,
  DEVELOPER_SECTIONS,
  RELIABILITY_SECTIONS,
  RISK_SECTIONS,
} from "../lib/sections";

const root = join(import.meta.dirname, "..");
const cssPath = join(root, "app/globals/14zzd-protected-desk-b.css");
const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";

const shells = {
  risk: readFileSync(join(root, "components/RiskWorkspace.tsx"), "utf8"),
  data: readFileSync(join(root, "components/DataConsole.tsx"), "utf8"),
  reliability: readFileSync(join(root, "components/ReliabilityConsole.tsx"), "utf8"),
  developer: readFileSync(join(root, "components/DeveloperConsole.tsx"), "utf8"),
};

const scrollOwners = [
  ["components/data/DataQualityLedger.tsx", /className="table-wrap table-wrap--clamped"\s+tabIndex=\{0\}/],
  ["components/data/ReplayBackfillPanel.tsx", /className="table-wrap table-wrap--clamped"\s+tabIndex=\{0\}/],
  ["components/data/DataWorkBoard.tsx", /className="data-workboard__board"\s+tabIndex=\{0\}/],
  ["components/systems/QuarantinePanel.tsx", /className="table-wrap table-wrap--clamped"\s+tabIndex=\{0\}/],
  ["components/developer/DeveloperPipelines.tsx", /className="developer-cp-jobs__table"\s+tabIndex=\{0\}/],
  ["components/developer/DeveloperStatus.tsx", /className=\{`developer-cp-table[^`]*`}\s+tabIndex=\{0\}/],
  ["components/developer/DeveloperStatus.tsx", /className=\{`developer-cp-artifacts[^`]*`}\s+tabIndex=\{0\}/],
  ["components/developer/DeveloperWorkQueue.tsx", /className="developer-work__table-wrap"\s+tabIndex=\{0\}/],
] as const;

describe("protected desk B keeps one complete, ordered section composition", () => {
  const sections = {
    risk: RISK_SECTIONS,
    data: DATA_SECTIONS,
    reliability: RELIABILITY_SECTIONS,
    developer: DEVELOPER_SECTIONS,
  };

  it("keeps every canonical section represented by one tabpanel", () => {
    for (const [workspace, definitions] of Object.entries(sections)) {
      for (const definition of definitions) {
        const matches = shells[workspace as keyof typeof shells]
          .match(new RegExp(`tabId="${definition.id}"`, "g"));
        assert.equal(matches?.length, 1, `${workspace}/${definition.id} lost its one panel`);
      }
    }
  });

  it("keeps orientation, rail and active work in that order", () => {
    const heads = { risk: "<BookChrome", data: "<PageHead", reliability: "<ConsoleChrome", developer: "<PageHead" };
    for (const [workspace, source] of Object.entries(shells)) {
      const head = source.indexOf(heads[workspace as keyof typeof heads]);
      const rail = source.indexOf("<WorkspaceSubtabs", head);
      const panel = source.indexOf("<WorkspaceSubtabPanel", rail);
      assert.ok(head >= 0 && head < rail && rail < panel, `${workspace} zone order drifted`);
    }
  });
});

describe("protected desk B owns wide evidence inside its work surface", () => {
  it("makes every horizontal scroll port keyboard reachable", () => {
    for (const [path, pattern] of scrollOwners) {
      const source = readFileSync(join(root, path), "utf8");
      assert.match(source, pattern, `${path} has an unreachable horizontal scroll port`);
    }
  });

  it("has one late, four-workspace layout owner", () => {
    assert.ok(existsSync(cssPath), "the protected desk B CSS owner is missing");
    for (const scope of ["#panel-risk", ".data-control-plane", "#panel-reliability", ".developer-control-plane"]) {
      assert.match(css, new RegExp(scope.replace(/[.#-]/g, "\\$&")), `${scope} is outside the layout owner`);
    }
    assert.match(css, /overflow-x:\s*auto/);
    assert.match(css, /overscroll-behavior-inline:\s*contain/);
    assert.match(css, /scrollbar-gutter:\s*stable/);
    assert.match(css, /:focus-visible/);
  });

  it("cannot hide, clamp, animate or rewrite protected information", () => {
    assert.doesNotMatch(css, /(?:display|visibility)\s*:\s*(?:none|hidden)/);
    assert.doesNotMatch(css, /(?:line-clamp|text-overflow\s*:\s*ellipsis|white-space\s*:\s*nowrap)/);
    assert.doesNotMatch(css, /(?:^|[;{]\s*)content\s*:/m);
    assert.doesNotMatch(css, /(?:animation|transition)\s*:/);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(/i);
  });

  it("segregates guarded actions and adapts the dense inner controls", () => {
    assert.match(css, /border-block-start:\s*1px solid var\(--border\)/);
    assert.match(css, /@container\s*\(max-width:/);
    assert.match(css, /flex-wrap:\s*wrap/);
    assert.match(
      css,
      /#reliability-subpanel-planes \.reliability-overview\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
      "the phone-width dependency grid must not size itself from the five-label segment",
    );
  });
});
