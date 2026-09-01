import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cadenceAt, episodeFloors, outagesOf, pollsOf } from "../components/coherence/diffusion/episode-cadence";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("the Kalshi campaign is visible without manufacturing episodes", () => {
  const watch = read("components/coherence/diffusion/EpisodeWatch.tsx");
  const types = read("lib/coherence/types.ts");

  it("types restart, campaign, and storage evidence on the recorder payload", () => {
    assert.match(types, /episodes_recovered\?: number/);
    assert.match(types, /certification_decisions\?: number/);
    assert.match(types, /campaign\?: CoherenceObservationCampaignStatus/);
    assert.match(types, /storage\?: CoherenceRecorderStorageStatus/);
    assert.match(types, /poll_seconds\?: number/);
    assert.match(types, /tape_bytes\?: number \| null/);
  });

  it("labels the target as successful observation polls, never episodes", () => {
    assert.match(watch, /word="Observation campaign"/);
    assert.match(watch, /successful polls/);
    assert.match(watch, /word="Certification decisions"/);
    assert.match(watch, /word="Storage guard"/);
    assert.match(watch, /word="Polls this process"/);
    assert.match(watch, /word="Two-poll episode floors"/);
    assert.doesNotMatch(watch, /Observation campaign[\s\S]{0,240}episodes/i);
  });

  it("reconstructs gaps with the cadence in force in each durable phase", () => {
    const schedule = {
      baselineSeconds: 300,
      campaignSeconds: 60,
      campaignFromMs: 300_000,
      campaignThroughMs: 600_000,
    };
    assert.equal(cadenceAt(schedule, 200_000), 300);
    assert.equal(cadenceAt(schedule, 400_000), 60);
    assert.equal(cadenceAt(schedule, 700_000), 300);

    const points = [0, 40, 300, 320, 360, 900, 940]
      .map((seconds) => ({ ts_ns: seconds * 1e9 }));
    const polls = pollsOf(points, schedule);
    assert.deepEqual(polls.map(({ at, readings }) => [at / 1000, readings]), [
      [0, 2], [300, 2], [360, 1], [900, 2],
    ]);
    assert.deepEqual(outagesOf(polls, schedule), [
      { from: 360_000, to: 900_000, missed: 4 },
    ]);
  });

  it("keeps the completed campaign's two-minute floor beside the current ten-minute floor", () => {
    const completed = {
      baselineSeconds: 300,
      campaignSeconds: 60,
      campaignFromMs: 300_000,
      campaignThroughMs: 600_000,
    };
    assert.deepEqual(episodeFloors(completed, 300, true), {
      campaign: 120,
      baseline: 600,
      current: 600,
    });
    assert.match(watch, /campaign \$\{seconds\(floors\.campaign\)\}; baseline \$\{seconds\(floors\.baseline\)\}; current/);
  });
});
