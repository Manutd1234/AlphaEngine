import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const MARKETS_ROUTES = 26;
const PROOFS_ROUTES = 29;

const MARKETS_PREMISE =
  "Executable family totals, two-sided ladders, implied distributions, constrained stakes and venue fees.";
const PROOFS_PREMISE =
  "LP feasibility returns a basket that wins in every state; settled calibration tests the record.";

const SECONDARY_ENGINE_LABELS = [
  "Recorded so far",
  "Last poll",
  "Read budget",
  "Coherence solver",
  "How this budget was chosen",
] as const;

const words = (value: string) =>
  value.match(/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g)?.length ?? 0;

describe("Markets and Proofs retire repeated secondary chrome from at-rest copy", () => {
  it("conservatively removes at least 1,200 settled route-words", () => {
    const engineLabels = SECONDARY_ENGINE_LABELS.reduce((sum, label) => sum + words(label), 0);
    const routeWeightedReduction =
      engineLabels * (MARKETS_ROUTES + PROOFS_ROUTES)
      + words(MARKETS_PREMISE) * MARKETS_ROUTES
      + words(PROOFS_PREMISE) * PROOFS_ROUTES;

    // Dynamic snapshots, poll ages, solver names, budgets and family counts
    // also leave the at-rest DOM. They are deliberately excluded here so the
    // contract stays deterministic and the claimed saving is a lower bound.
    assert.equal(routeWeightedReduction, 1_517);
    assert.ok(routeWeightedReduction >= 1_200);
  });

  it("keeps every engine metric but mounts it only inside Engine detail", () => {
    const source = read("components/coherence/EngineStatePanel.tsx");
    const panel = source.slice(source.indexOf("export default function EngineStatePanel"));
    const sheet = panel.indexOf("<SheetContent");
    assert.ok(sheet >= 0, "Engine detail lost its bounded Sheet");

    for (const label of SECONDARY_ENGINE_LABELS) {
      const at = panel.indexOf(label);
      assert.ok(at > sheet, `${label} is still repeated at rest instead of living in Engine detail`);
    }

    for (const metric of [
      "tape.book_snapshots",
      "tape.tickers_seen",
      "recorder.seconds_since_last_poll",
      "status.budget.tokens_per_second",
      "status.budget.tokens_spent",
      "solver",
      "familiesPriced",
    ]) assert.ok(panel.slice(sheet).includes(metric), `Engine detail dropped ${metric}`);
  });

  it("moves both exact desk premises into the existing Evidence Sheet", () => {
    const evidence = read("components/coherence/EngineViewEvidence.tsx");
    const sheet = evidence.indexOf("<SheetContent");
    assert.ok(sheet >= 0);
    assert.doesNotMatch(evidence.slice(evidence.indexOf("return ("), sheet), /\{deskContext\}/);
    assert.match(evidence.slice(sheet), /\{deskContext\}/);

    const cases = [
      ["components/MarketsConsole.tsx", MARKETS_PREMISE],
      ["components/CoherenceConsole.tsx", PROOFS_PREMISE],
    ] as const;
    for (const [file, premise] of cases) {
      const source = read(file);
      const pageHead = source.slice(source.indexOf("<PageHead"), source.indexOf("<EngineStatePanel"));
      assert.doesNotMatch(pageHead, /description=/, `${file} still front-loads its repeated premise`);
      assert.ok(source.includes(`deskContext="${premise}"`), `${file} dropped its exact premise`);
    }
  });
});
