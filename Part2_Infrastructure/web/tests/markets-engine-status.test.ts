import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { marketClockLabel, marketNextReadState } from "../components/coherence/LiveControls";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

function ordered(source: string, labels: readonly string[]) {
  let cursor = -1;
  for (const label of labels) {
    const next = source.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${label} is missing or out of order`);
    cursor = next;
  }
}

describe("Markets and Proofs share exactly two explicit status rows", () => {
  const stateSource = read("components/coherence/EngineStatePanel.tsx");
  const start = stateSource.indexOf("export function EngineTopbarStatus");
  const end = stateSource.indexOf("/** Compatibility name", start);
  const topbarStatus = stateSource.slice(start, end);
  const marketsConsole = read("components/MarketsConsole.tsx");
  const proofsConsole = read("components/CoherenceConsole.tsx");
  const controls = read("components/coherence/LiveControls.tsx");

  it("keeps the requested venue and recorder order", () => {
    assert.equal((topbarStatus.match(/className="engine-topbar-status__row/g) ?? []).length, 2);
    ordered(topbarStatus, [
      "Reading exchange",
      "Exchange reachable",
      "Fixed-point schema",
      "Read-only",
      'word="Recorder"',
      "{controls}",
    ]);
    ordered(controls, ['word="Updated"', 'word="Next read"', ">Read now</button>", '{paused ? "Resume" : "Pause"}']);
  });

  it("uses one shared top-bar concept on both desks", () => {
    assert.match(stateSource, /export const MarketsEngineStatus = EngineTopbarStatus;/);
    assert.match(marketsConsole, /actions=\{[\s\S]*?<MarketsEngineStatus/);
    assert.match(marketsConsole, /controls=\{[\s\S]*?<LiveControls[\s\S]*?variant="markets"/);
    assert.doesNotMatch(marketsConsole, /label:\s*status\.data\.state === "ok" \? "Reading the exchange"/);
    assert.match(proofsConsole, /actions=\{[\s\S]*?<EngineTopbarStatus/);
    assert.match(proofsConsole, /controls=\{[\s\S]*?<LiveControls[\s\S]*?variant="markets"/);
    assert.doesNotMatch(proofsConsole, /<EngineChips\b/);
  });

  it("preserves grouped controls and pressed-state semantics", () => {
    assert.match(topbarStatus, /role="group"[\s\S]*aria-label="Exchange status"/);
    assert.match(topbarStatus, /role="group"[\s\S]*aria-label="Recorder and polling status"/);
    assert.match(topbarStatus, /error && !status[\s\S]*?Exchange unavailable/);
    assert.match(topbarStatus, /status && !reading[\s\S]*?`Exchange \$\{status\.state\}`/);
    assert.match(topbarStatus, /status\.dry_run \? "Read-only" : "Order path enabled"/);
    assert.match(controls, /role="group"[\s\S]*aria-label="Polling"/);
    assert.match(controls, /aria-pressed=\{paused\}/);
    assert.match(controls, /onClick=\{onReadNow\}/);
    assert.match(controls, /onClick=\{\(\) => onPause\(!paused\)\}/);
  });
});

describe("Markets' live values are exact and width-stable", () => {
  it("formats the update clock as fixed HH:MM:SS", () => {
    assert.equal(marketClockLabel(new Date(2026, 7, 28, 9, 4, 3)), "09:04:03");
    assert.equal(marketClockLabel(null), "awaiting");
  });

  it("keeps one countdown vocabulary across running, due, paused and overdue states", () => {
    const updatedAt = new Date(1_000_000);
    assert.deepEqual(marketNextReadState(updatedAt, 20_000, false, 1_009_001), {
      mark: "●", value: "11s", tone: "good",
    });
    assert.deepEqual(marketNextReadState(updatedAt, 20_000, false, 1_020_000), {
      mark: "●", value: "now", tone: "good",
    });
    assert.deepEqual(marketNextReadState(updatedAt, 20_000, false, 1_030_001), {
      mark: "▲", value: "overdue", tone: "warn",
    });
    assert.deepEqual(marketNextReadState(updatedAt, 20_000, true, 1_009_001), {
      mark: "○", value: "paused", tone: "muted",
    });
    assert.deepEqual(marketNextReadState(null, 20_000, false, 1_009_001), {
      mark: "◌", value: "awaiting", tone: "muted",
    });
  });

  it("reserves changing values and enforces two desktop lines without clipping narrow layouts", () => {
    const css = read("app/globals/14w-engine-topbar.css");
    assert.match(css, /\.coherence-plane \.engine-topbar-status\s*\{[^}]*display:\s*grid;[^}]*min-inline-size:\s*0;/s);
    assert.match(css, /engine-topbar-status__recorder > \.coh-chip \.coh-chip__value\s*\{[^}]*inline-size:\s*12ch;/s);
    assert.match(css, /engine-topbar-status :is\(\.coh-live__updated, \.coh-live__next\) \.coh-chip__value\s*\{[^}]*inline-size:\s*8ch;/s);
    assert.match(css, /@media \(min-width: 1280px\)\s*\{[\s\S]*?engine-topbar-status__row,[\s\S]*?coh-live--markets[\s\S]*?flex-wrap:\s*nowrap;/);
    assert.match(css, /\.engine-topbar-status__row\s*\{[^}]*min-inline-size:\s*0;[^}]*flex-wrap:\s*wrap;/s);
    assert.match(css, /@media \(max-width: 620px\)\s*\{[\s\S]*?engine-topbar-status__row,[\s\S]*?max-inline-size:\s*100%;/);
  });
});
