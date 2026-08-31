import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MARKETS_SECTIONS } from "../lib/sections";
import { viewsFor } from "../lib/section-views";
import { read, stripNonCode } from "./helpers/workspace-sources";

/**
 * The owner of the primary visual surface at every canonical Markets address.
 * This is deliberately exhaustive: adding a route without adding a real
 * diagram/table/topology surface must fail here rather than open as prose.
 */
const VIEW_INSTRUMENTS: Record<string, [string, RegExp]> = {
  "universe/baskets": ["../components/coherence/UniversePane.tsx", /<BasketComposition\b[\s\S]*?<BasketOverview\b/],
  "universe/positions": ["../components/coherence/UniversePane.tsx", /<BasketSize\b/],
  "universe/families": ["../components/coherence/UniversePane.tsx", /<PriceHistogram\b/],
  "settlement/reading": ["../components/coherence/SettlementPane.tsx", /<IndexBasisChart\b/],
  "settlement/formation": ["../components/coherence/SettlementPane.tsx", /<FormationDiagram\b/],
  "settlement/pending": ["../components/coherence/SettlementPane.tsx", /<PendingMinutes\b/],
  "books/ladder": ["../components/coherence/BooksPane.tsx", /<LadderChart\b/],
  "books/identity": ["../components/coherence/BooksPane.tsx", /<IdentityStrip\b/],
  "books/history": ["../components/coherence/BooksSection.tsx", /<BookHistory\b/],
  "dispersion/quotes": ["../components/coherence/RfqPane.tsx", /<DispersionStrips\b/],
  "dispersion/channel": ["../components/coherence/RfqPane.tsx", /<ChannelStates\b/],
  "lattice/survival": ["../components/coherence/surface/DistributionView.tsx", /<SurvivalChart\b/],
  "lattice/mass": ["../components/coherence/surface/DistributionView.tsx", /<PmfChart\b/],
  "lattice/moments": ["../components/coherence/surface/DistributionView.tsx", /<MomentsShape\b/],
  "lattice/support": ["../components/coherence/surface/DistributionView.tsx", /<MassReservoir\b/],
  "stake/plan": ["../components/coherence/surface/StakeView.tsx", /<AdmittedPlan\b/],
  "stake/capital": ["../components/coherence/surface/StakeView.tsx", /<CapitalBar\b/],
  "stake/method": ["../components/coherence/surface/StakeView.tsx", /<GrowthBars\b/],
  "stake/family": ["../components/coherence/surface/FamilyView.tsx", /<StakeBars\b[\s\S]*?<StakeTable\b/],
  "fees/example": ["../components/coherence/FeesPane.tsx", /<FeeTotalsBar\b/],
  "fees/shape": ["../components/coherence/FeesSection.tsx", /<FeeCurve\b/],
  "fees/comparison": ["../components/coherence/AblationPane.tsx", /<Bars\b/],
  "fees/table": ["../components/coherence/AblationPane.tsx", /<ReplayTable\b/],
  "shell/layout": ["../components/coherence/ShellPane.tsx", /<ShellTree\b[\s\S]*?<CommandReference\b/],
  "shell/route": ["../components/coherence/ShellPane.tsx", /<ShellRouteFlow\b/],
  "shell/tree": ["../components/coherence/ShellBrowser.tsx", /<ShellListing\b[\s\S]*?<LiveTape\b/],
};

describe("every Markets destination owns a non-placeholder technical surface", () => {
  const routes = MARKETS_SECTIONS.flatMap((section) =>
    viewsFor("markets", section.id).map(([view]) => `${section.id}/${view}`));

  it("covers the complete 26-view inventory", () => {
    assert.equal(routes.length, 26);
    assert.deepEqual(Object.keys(VIEW_INSTRUMENTS).sort(), [...routes].sort());
    for (const route of routes) {
      const [file, contract] = VIEW_INSTRUMENTS[route];
      assert.match(stripNonCode(read(file)), contract, `${route} lost its primary instrument`);
    }
  });
});
