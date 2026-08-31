import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { measuredOpenRequests } from "../lib/coherence/rfq-measurements";
import { read } from "./helpers/workspace-sources";

const rfq = read("../components/coherence/RfqPane.tsx");
const makerChromeCss = read("../app/globals/10g-coherence-shell.css");
const channel = read("../components/coherence/ChannelStates.tsx");
const channelCss = read("../components/coherence/ChannelStates.module.css");
const dispersion = read("../components/coherence/DispersionStrips.tsx");
const dispersionCss = read("../components/coherence/DispersionStrips.module.css");
const dispersionTable = read("../components/coherence/DispersionTable.tsx");
const stakeBars = read("../components/coherence/surface/StakeBars.tsx");
const stakeView = read("../components/coherence/surface/StakeView.tsx");
const kellyGrowth = read("../components/coherence/surface/KellyGrowthSimulator.tsx");
const stakeCss = read("../components/coherence/StakeInstrument.module.css");

describe("RFQ state semantics", () => {
  it("calls zero measured only after the private list was read", () => {
    for (const state of ["signing_unavailable", "unavailable", "refused", "future_state"]) {
      assert.equal(measuredOpenRequests({ state, open_requests: 0 }), null);
    }
    assert.equal(measuredOpenRequests({ state: "empty", open_requests: 0 }), 0);
    assert.equal(measuredOpenRequests({ state: "available", open_requests: 3 }), 3);
    assert.match(rfq, /openRequests=\{measuredOpenRequests\(data\)\}/);
  });

  it("draws terminal outcomes as branches rather than a progress ladder", () => {
    assert.match(channel, /function activePath/);
    assert.match(channel, /alternative outcomes, not earlier steps/);
    assert.doesNotMatch(channel, /Request outcomes in order/);
    assert.match(channel, /minWidth=\{MIN_WIDTH\}/);
    assert.equal((channel.match(/<title>/g) ?? []).length, 1, "each state must contribute exactly one selectable mark");
    assert.match(channelCss, /\.nodeHit\s*\{[^}]*pointer-events:\s*all;/s);
  });

  it("names the time series as maker-to-maker spread", () => {
    assert.match(rfq, /maker-to-maker price spread/);
    assert.doesNotMatch(rfq, /median width between independent maker quotes/);
    assert.match(rfq, /Not one of the five/);
  });

  it("uses an actionable private-channel state without the removed placeholder copy", () => {
    assert.match(rfq, /Private channel setup/);
    assert.match(rfq, /<ProofsTransportNotice/);
    const readings = rfq.slice(rfq.indexOf("function channelReadings"), rfq.indexOf("function ChannelNotice"));
    assert.doesNotMatch(readings, /label: "Private channel"/,
      "the setup state returned as a duplicate full-width KPI row");
    assert.match(readings, /if \(openRequests == null\) return \[\];/);
    assert.match(rfq, /role=\{fault \? "alert" : "status"\}/,
      "routine connected or empty reads should not interrupt the reader as an assertive alert");
    for (const removed of [
      "No view, unsigned",
      "No dispersion to rank on this read",
      "the private list was not read, so zero would not be a measurement",
      "no panel came back on this read, so there is none to count",
    ]) assert.doesNotMatch(rfq, new RegExp(removed));
  });

  it("lets the bordered Channel card own its only top rule", () => {
    const nestedDisclosure = /\.markets-plane \.coh-rfq__state > details\.disclosure\s*\{([^}]*)\}/
      .exec(makerChromeCss)?.[1] ?? "";
    assert.match(nestedDisclosure, /margin-top:\s*0/);
    assert.match(nestedDisclosure, /padding-top:\s*0/);
    assert.match(nestedDisclosure, /border-top:\s*0/);
  });
});

describe("Stake and maker instruments remain valid and usable when narrow or tall", () => {
  it("keeps block content out of phrasing-only output elements", () => {
    for (const [name, source] of [["Stake bars", stakeBars], ["Stake capital", stakeView], ["Channel", channel]] as const) {
      for (const output of source.match(/<output\b[\s\S]*?<\/output>/g) ?? []) {
        assert.doesNotMatch(output, /<p\b/, `${name} nests a paragraph in output`);
      }
    }
  });

  it("keeps the bankroll and fixed Kelly chart legible on a phone", () => {
    assert.match(stakeCss, /@media \(max-width:\s*760px\)[\s\S]*?\.coinField\s*\{\s*grid-template-columns:\s*repeat\(5,/);
    assert.match(stakeCss, /\.frontierScroll\s*\{[^}]*inline-size:\s*100%;[^}]*min-inline-size:\s*0;[^}]*overflow-x:\s*auto;/s);
    assert.match(stakeCss, /\.frontierSvg\s*\{[^}]*min-width:\s*640px;/s);
    assert.match(stakeBars, /data-reserve-edge=\{reserveEdge\}/);
  });

  it("gives the Stake threshold a concise accessible name and numeric reference", () => {
    assert.match(stakeBars, /const ariaLabel = `Outcome admission against the returned cash rate:/);
    assert.match(stakeBars, /const reserveLabel = reserve == null/);
    assert.match(stakeBars, /className=\{styles\.admissionAxis\}\s+role="img"\s+aria-label=\{reserveLabel\}/);
    assert.doesNotMatch(stakeBars, /const ariaLabel = stakes\.map/);
  });

  it("focuses the Kelly scroll owner only while it actually overflows", () => {
    assert.match(kellyGrowth, /scrollWidth > node\.clientWidth \+ 1/);
    assert.match(kellyGrowth, /role=\{frontierScrollable \? "region" : undefined\}/);
    assert.match(kellyGrowth, /tabIndex=\{frontierScrollable \? 0 : undefined\}/);
    assert.doesNotMatch(kellyGrowth, /className=\{styles\.frontierScroll\}[^>]*tabIndex=\{0\}/s);
  });

  it("makes exact Stake rows one keyboard-linked roving sequence", () => {
    assert.match(stakeView, /data-stake-row/);
    assert.match(stakeView, /tabIndex=\{stake\.ticker === focusKey \? 0 : -1\}/);
    assert.match(stakeView, /event\.key === "ArrowUp"/);
    assert.match(stakeView, /event\.key === "ArrowDown"/);
    assert.match(stakeCss, /\.stakeTableRow:focus-visible\s*\{/);
  });

  it("names both Makers table scrollports and keeps fallback selection visible", () => {
    assert.match(rfq, /className="table-wrap"\s+role="region"\s+aria-label="Private-channel outcome definitions"\s+tabIndex=\{0\}/);
    assert.match(dispersionTable, /className="table-wrap"\s+role="region"\s+aria-label="Maker dispersion evidence"\s+tabIndex=\{0\}/);
    assert.match(dispersion, /const chosen = row\.market_ticker === selected\.market_ticker/);
  });

  it("bounds large maker panels and preserves both scroll axes", () => {
    assert.match(dispersion, /PLOT_MAX_HEIGHT\s*=\s*680/);
    assert.ok((dispersion.match(/data-scrollable=\{scrollable\}/g) ?? []).length >= 2);
    assert.match(dispersion, /minWidth=\{PLOT_MIN_WIDTH\}/);
    assert.match(dispersionCss, /\.plotViewport\[data-scrollable="true"\]\s*\{[^}]*max-block-size:[^;}]*680px[^}]*overflow-y:\s*auto;/s);
  });
});
