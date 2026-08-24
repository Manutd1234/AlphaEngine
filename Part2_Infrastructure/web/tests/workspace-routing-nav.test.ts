/**
 * The workspace is one tab per desk role, and every tab in the nav must have a
 * panel behind it.
 *
 * A tab whose panel id was never added renders an empty shell — the header
 * highlights it, the URL updates, and the page goes blank. That is a routing
 * table and a render tree agreeing by convention, which is exactly the kind of
 * agreement that rots. The same rot in the other direction is a panel nothing in
 * the nav can reach, and a retired hash that now points at nothing.
 *
 * These are source-level assertions on purpose. There is no DOM in this suite,
 * and the property worth pinning is structural: a future edit has to break it
 * deliberately.
 *
 * The rest of what the former `workspace-routing.test.ts` guarded before its split by
 * concern: the section rails inside each tab in `workspace-routing-sections`,
 * the hook-order rule in `workspace-routing-hook-order`, the one-fetch rule in
 * `workspace-routing-shared-fetch`, and the one-head-per-tab rule in
 * `workspace-routing-page-head`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";
import { navIds, read } from "./helpers/workspace-sources";

const header = read("../components/WorkspaceHeader.tsx");
/**
 * The ten `<section role="tabpanel">` elements left `page.tsx` on 2026-08-21
 * for `components/workspace/WorkspacePanels.tsx`; the shell kept the hooks, the
 * header and `#workspace-content`. Every scan below that looks for a panel — an
 * id, a `view === "x"` branch — reads `panels`, and the ones that look at the
 * header keep reading `header`. Left on `page` the panel scans would find nothing
 * and pass.
 */
const panels = read("../components/workspace/WorkspacePanels.tsx");
/**
 * Where the reader is, and every way the desk moves them, left `page.tsx` for
 * `lib/use-workspace-routing.ts` over `lib/workspace-hash.ts`. The legacy hash
 * table is read from the file that now owns it; left pointed at page.tsx this
 * would scan a file that no longer contains what it was written to guard.
 */
const workspaceHash = read("../lib/workspace-hash.ts");
const roleCards = read("../components/overview/RoleCards.tsx");
const styles = globalsCss;

describe("the nav and the render tree describe the same workspace", () => {
  const ids = navIds(header);

  it("declares the overview plus one tab per desk role", () => {
    assert.deepEqual(ids, [
      "overview",
      "research",
      "live",
      "portfolio",
      "risk",
      "data",
      "reliability",
      "developer",
      "markets",
      "coherence",
    ]);
  });

  it("keeps instrument and horizon controls out of the global header", () => {
    for (const retiredSurface of ["context-strip", "workspace-symbol", "workspace-interval"]) {
      assert.ok(!header.includes(retiredSurface), `${retiredSurface} returned to the global header`);
    }
  });

  it("balances the seven overview role cards and keeps their actions on one baseline", () => {
    assert.ok(roleCards.includes('className="role-card__actions"'), "role actions lost their layout hook");
    assert.ok(!roleCards.includes("flex-wrap"), "role actions can wrap onto mismatched baselines");
    assert.ok(
      styles.includes("grid-template-columns: repeat(8, minmax(0, 1fr));"),
      "desktop role cards no longer share the centred four-plus-three grid",
    );
    for (const card of [5, 6, 7]) {
      assert.ok(styles.includes(`.role-card:nth-child(${card})`), `role card ${card} is not centred`);
    }
  });

  it("every nav id renders a panel with the matching id", () => {
    for (const id of ids) {
      assert.ok(
        panels.includes(`id="panel-${id}"`) || id === "overview",
        `nav has a "${id}" tab with no panel-${id} behind it`,
      );
      assert.ok(
        panels.includes(`view === "${id}"`),
        `nav has a "${id}" tab that no branch in WorkspacePanels.tsx renders`,
      );
    }
  });

  it("every panel is reachable from the nav rather than only by hash", () => {
    for (const match of panels.matchAll(/id="panel-([a-z]+)"/g)) {
      assert.ok(ids.includes(match[1]), `panel-${match[1]} has no tab in the nav`);
    }
  });

  it("the retired systems hash still lands somewhere real", () => {
    // Scoped to the LEGACY_VIEWS literal — a page-wide `key: "value"` scan
    // also matches unrelated records (e.g. the per-workspace section ref).
    const start = workspaceHash.indexOf("export const LEGACY_VIEWS");
    assert.ok(start >= 0, "lib/workspace-hash.ts no longer declares LEGACY_VIEWS");
    const block = workspaceHash.slice(start, workspaceHash.indexOf("};", start));
    const legacy = [...block.matchAll(/([a-z]+):\s*"([a-z]+)"/g)]
      .filter(([, , target]) => ids.includes(target));
    assert.ok(legacy.length > 0, "no legacy hash redirects survive");
    for (const [, from, to] of legacy) {
      assert.ok(!ids.includes(from), `"${from}" is a live tab and should not be redirected`);
      assert.ok(ids.includes(to), `legacy hash "${from}" points at "${to}", which is not a tab`);
    }
  });
});
