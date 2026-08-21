/**
 * Tabs that read the same snapshot share one fetch.
 *
 * The book and the system health are each polled by one hook, and every surface
 * that renders them reads that hook. A tab fetching either for itself would be a
 * second source of truth, and two tabs quoting different equity is worse than one
 * tab holding both — the desk cannot tell which number to act on, and neither is
 * visibly wrong. The same argument applies to the health poll the three consoles
 * share, with a cost attached: an unattended poll that spends interactive provider
 * reserve takes budget from the person actually looking at the screen.
 *
 * These are source-level assertions on purpose. There is no DOM in this suite, and
 * the property worth pinning is structural: a hand-rolled fetch is easy to write
 * and invisible to a type checker, so a future edit has to break this deliberately.
 *
 * Split from `tests/workspace-routing-hook-order.test.ts` on 2026-08-21; the hook-order rule
 * that governs the same hooks is in `workspace-routing-hook-order.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

describe("tabs that read the same snapshot share one fetch", () => {
  it("only the hooks own the gateway polls", () => {
    const bookHook = read("../lib/use-book.ts");
    assert.ok(bookHook.includes("/api/gateway/portfolio"), "the book hook no longer fetches the book");

    // A tab fetching the book itself would be a second source of truth: two
    // tabs quoting different equity is worse than one tab holding both.
    // Every file that renders the book, not only the two that used to hold all
    // of it: the Portfolio sections are where a hand-rolled fetch would now be
    // written, and a scan that still looked only at the workspace would go
    // quiet about exactly the code that moved.
    for (const relative of [
      "../components/PortfolioWorkspace.tsx",
      "../components/portfolio/OverviewSection.tsx",
      "../components/portfolio/OverviewStanding.tsx",
      "../components/portfolio/OverviewBook.tsx",
      "../components/portfolio/PositionsSection.tsx",
      "../components/portfolio/AllocationSection.tsx",
      "../components/portfolio/PerformanceSection.tsx",
      "../components/RiskWorkspace.tsx",
    ]) {
      const code = stripNonCode(read(relative));
      assert.ok(
        !code.includes("/api/gateway/portfolio"),
        `${relative} fetches the book directly instead of reading the shared hook`,
      );
    }
  });

  it("the console tabs share one health poll", () => {
    const healthHook = read("../lib/use-system-health.ts");
    assert.ok(healthHook.includes("/api/system/health"), "the health hook no longer fetches health");
    assert.ok(
      healthHook.includes('quiet ? "background" : "interactive"'),
      "unattended health polls spend interactive provider reserve",
    );

    for (const relative of [
      "../components/DataConsole.tsx",
      "../components/ReliabilityConsole.tsx",
      "../components/DeveloperConsole.tsx",
    ]) {
      const code = stripNonCode(read(relative));
      assert.ok(
        !code.includes("/api/system/health"),
        `${relative} polls health directly instead of reading the shared hook`,
      );
    }
  });
});
