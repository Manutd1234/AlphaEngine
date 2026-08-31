import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearWorkspaceEntity,
  readWorkspaceEntity,
  workspaceEntityFocusIds,
  workspaceEntityTarget,
  writeWorkspaceEntity,
} from "../lib/workspace-entities";
import { read } from "./helpers/workspace-sources";

describe("typed cross-workspace entity links", () => {
  it("writes and reads a canonical entity URL without weakening the hash route", () => {
    const target = workspaceEntityTarget("order", "ord/42");
    const url = writeWorkspaceEntity(new URL("https://desk.test/dashboard#overview/audit"), target);
    assert.equal(url.hash, "#live/activity");
    assert.equal(url.searchParams.get("entity"), "order");
    assert.equal(url.searchParams.get("entityId"), "ord/42");
    assert.deepEqual(readWorkspaceEntity(url), target);
  });

  it("round-trips a caller's more specific destination through reload and history", () => {
    const target = workspaceEntityTarget("ticker", "ETHUSDT", {
      view: "data",
      section: "feeds",
    });
    const url = writeWorkspaceEntity(new URL("https://desk.test/dashboard#overview/loop"), target);
    assert.equal(url.hash, "#data/feeds");
    assert.deepEqual(
      readWorkspaceEntity(url),
      target,
      "the URL reader discarded the destination the link writer published",
    );
  });

  it("rejects incomplete or unknown selections and clears stale entity state", () => {
    assert.equal(readWorkspaceEntity(new URL("https://desk.test/?entity=order")), null);
    assert.equal(readWorkspaceEntity(new URL("https://desk.test/?entity=unknown&entityId=x")), null);
    const url = new URL("https://desk.test/?entity=trace&entityId=t-1#reliability/events");
    clearWorkspaceEntity(url);
    assert.equal(url.search, "");
    assert.equal(url.hash, "#reliability/events");
  });

  it("names an exact focus target and a deterministic panel fallback", () => {
    assert.deepEqual(
      workspaceEntityFocusIds(workspaceEntityTarget("provider", "alpha vantage")),
      ["provider-row-alpha-vantage", "reliability-subpanel-services"],
    );
    const providers = read("../components/systems/HealthMatrix.tsx");
    const limits = read("../components/risk/LimitsPanel.tsx");
    const traces = read("../components/systems/TraceTimeline.tsx");
    assert.match(providers, /id=\{`provider-row-/);
    assert.match(limits, /id=\{`risk-constraint-/);
    assert.match(traces, /"trace-event-" \+ entityDomToken/);
  });

  it("enhances a real anchor and preserves keyboard/native-link semantics", () => {
    const link = read("../components/workspace/WorkspaceEntityLink.tsx");
    const bridge = read("../components/workspace/WorkspaceEntityBridge.tsx");
    assert.match(link, /<a className=\{className\} href=\{relativeHref\} onClick=\{follow\}>/);
    assert.match(link, /window\.history\.pushState/);
    assert.match(link, /window\.dispatchEvent\(new PopStateEvent\("popstate"\)\)/);
    assert.match(link, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey/);
    assert.match(bridge, /workspaceEntityFocusIds\(target\)/);
    assert.match(bridge, /onTicker\(target\.value\.toUpperCase\(\)\)/);
    assert.match(bridge, /attempts < 12/);
  });

  it("links audit order IDs and tickers, then selects the matching blotter arm", () => {
    const audit = read("../components/overview/AuditTrail.tsx");
    const blotter = read("../components/execution/BlotterViews.tsx");
    assert.match(audit, /WorkspaceEntityLink kind="order" value=\{row\.order_id\}/);
    assert.match(audit, /WorkspaceEntityLink kind="ticker" value=\{row\.symbol\}/);
    assert.match(audit, /WorkspaceEntityLink kind="breach" value=\{row\.rejected_by\}/);
    assert.match(blotter, /useWorkspaceEntity\("order"\)/);
    assert.match(blotter, /setQuery\(selectedOrder\.value\)/);
    assert.match(blotter, /setView\(row\.accepted \? "fills" : "unfilled"\)/);
  });

  it("links provider and correlation evidence to their owning consoles", () => {
    const providers = read("../components/data/FeedsContractsPane.tsx");
    const transport = read("../components/coherence/ProofsTransportNotice.tsx");
    const traces = read("../components/systems/TraceConsole.tsx");
    assert.match(providers, /WorkspaceEntityLink kind="provider" value=\{provider\}/);
    assert.match(transport, /WorkspaceEntityLink kind="trace" value=\{transport\.requestId\}/);
    assert.match(traces, /useWorkspaceEntity\("trace"\)/);
    assert.match(traces, /setFilter\(selectedTrace\.value\)/);
  });

  it("normal workspace navigation clears an obsolete record selection", () => {
    const routing = read("../lib/use-workspace-routing.ts");
    assert.ok((routing.match(/clearWorkspaceEntity\(url\)/g) ?? []).length >= 3);
  });
});
