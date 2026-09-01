/** Sparse Diffusion states must preserve the distinction between a plan and evidence. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findingIsAssessable,
  findingsEvidenceValue,
  summarizeFindings,
} from "../components/coherence/diffusion/findings-summary";
import type { Finding } from "../components/coherence/diffusion/types";
import { read, stripNonCode } from "./helpers/workspace-sources";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    name: "planned relationship",
    question: "Can this relationship be assessed?",
    stage: "release",
    n: 0,
    t_statistic: null,
    correlation: null,
    shuffled_p: null,
    verdict: "not_assessable",
    note: null,
    ...overrides,
  };
}

describe("Diffusion findings evidence semantics", () => {
  it("reports six planned rows as zero assessable, never zero of six holds", () => {
    const summary = summarizeFindings(Array.from({ length: 6 }, () => finding()));
    assert.deepEqual(summary, { planned: 6, assessable: 0, holds: 0 });
    assert.equal(findingsEvidenceValue(summary), "0 of 6 planned");
  });

  it("requires an assessable verdict and a complete finite t/p pair", () => {
    const partial = finding({ t_statistic: 3.2, shuffled_p: 0.01 });
    const held = finding({ verdict: "holds", n: 18, t_statistic: 3.2, shuffled_p: 0.01 });
    const incomplete = finding({ verdict: "absent", n: 18, t_statistic: 0.4 });
    const invalid = finding({ verdict: "holds", n: 18, t_statistic: Number.NaN, shuffled_p: 0.01 });

    assert.equal(findingIsAssessable(partial), false, "a not-assessable wire verdict must remain gated");
    assert.equal(findingIsAssessable(held), true);
    assert.equal(findingIsAssessable(incomplete), false);
    assert.equal(findingIsAssessable(invalid), false);
    assert.deepEqual(summarizeFindings([partial, held, incomplete, invalid]), {
      planned: 4,
      assessable: 1,
      holds: 1,
    });
    assert.equal(
      findingsEvidenceValue(summarizeFindings([partial, held, incomplete, invalid])),
      "1 of 4 planned; 1 hold",
    );
  });

  it("labels the summary as assessability and keeps the representation gate unchanged", () => {
    const source = read("../components/coherence/diffusion/FindingsPane.tsx");
    const code = stripNonCode(source);
    assert.match(source, /word="Assessable relationships"/);
    assert.match(code, /value=\{findingsEvidenceValue\(evidence\)\}/);
    assert.doesNotMatch(source, /word="Relationships that hold"/);
    assert.match(code, /gate\?\.r_squared != null/);
    assert.match(source, /gate\?\.state === "passed"/);
  });
});

describe("Diffusion zero-sample figures", () => {
  it("keeps connected dependency diagrams in the empty Calendar, Clocks and Effect views", () => {
    for (const [file, kind] of [
      ["MeetingCalendar", "calendar"],
      ["ClockAgreement", "clocks"],
      ["EffectField", "effects"],
    ] as const) {
      const source = read(`../components/coherence/diffusion/${file}.tsx`);
      assert.match(source, new RegExp(`<DiffusionSparseState kind="${kind}"`));
      assert.match(stripNonCode(source), /sampleCount=/);
    }
  });

  it("labels only the source provenance fields the current wire actually exposes", () => {
    const calendar = stripNonCode(read("../components/coherence/diffusion/MeetingCalendar.tsx"));
    const findings = stripNonCode(read("../components/coherence/diffusion/FindingsPane.tsx"));
    assert.match(calendar, /read\.backend/);
    assert.match(calendar, /read\.observed_at/);
    assert.match(findings, /read\.backend/);
    assert.match(findings, /read\.observed_at/);
    assert.doesNotMatch(`${calendar}\n${findings}`, /bootstrap(?:ped)? sample|live historical sample/i);
  });
});
