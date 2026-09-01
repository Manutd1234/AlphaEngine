import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildProtectedBaseline } from "../scripts/frontend-content-baseline";

const read = (relative: string) => readFileSync(
  fileURLToPath(new URL(`../${relative}`, import.meta.url)),
  "utf8",
);
const consoleSource = read("components/DataConsole.tsx");
const replaySource = read("components/data/ReplayBackfillPanel.tsx");
const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures/frontend-content-baseline.json", import.meta.url)),
  "utf8",
));

describe("Data Lineage keeps replay orchestration behind one native disclosure", () => {
  it("hoists one exact heading for the card and disclosure trigger", () => {
    assert.match(replaySource, /export const REPLAY_BACKFILL_HEADING = "Replay & backfill";/);
    assert.match(replaySource, /<h2 id="replay-backfill-heading">\{REPLAY_BACKFILL_HEADING\}<\/h2>/);
    assert.match(consoleSource, /<summary>\{REPLAY_BACKFILL_HEADING\}<\/summary>/);
    assert.doesNotMatch(replaySource, /Replay &amp; backfill/);
  });

  it("leaves PipelineInspector visible and mounts the complete replay panel inside", () => {
    const lineage = consoleSource.slice(
      consoleSource.indexOf('tabId="lineage"'),
      consoleSource.indexOf('tabId="providers"'),
    );
    const pipelineAt = lineage.indexOf("<PipelineInspector");
    const detailsAt = lineage.indexOf("<details");
    const detailsEnd = lineage.indexOf("</details>", detailsAt);
    const replayAt = lineage.indexOf("<ReplayBackfillPanel", detailsAt);
    assert.ok(pipelineAt >= 0 && pipelineAt < detailsAt);
    assert.ok(replayAt > detailsAt && replayAt < detailsEnd);
    assert.match(lineage.slice(detailsAt, replayAt), /<details[\s\S]*?className="disclosure"/);
    assert.match(lineage.slice(detailsAt, replayAt), /onToggle=\{\(event\) => setReplayOpen\(event\.currentTarget\.open\)\}/);
    assert.doesNotMatch(lineage.slice(detailsAt, replayAt), /<details[^>]*\sopen(?:=|\s|>)/);
    assert.doesNotMatch(lineage.slice(detailsAt, detailsEnd), /<PipelineInspector/);
    for (const prop of [
      "symbol={workspaceSymbol}", "interval={workspaceInterval}",
      "pollMs={effectivePollMs}", 'active={active && section === "lineage" && replayOpen}',
      "guard={guard}", "operatorReady={operatorReady}", "operatorToken={view.token}",
    ]) assert.ok(lineage.slice(replayAt, detailsEnd).includes(prop), `${prop} was dropped`);
  });

  it("keeps the signed Data static-copy signature byte-identical", () => {
    assert.deepEqual(buildProtectedBaseline().signatures.data, fixture.protectedDataTransportTruth20260901.data);
  });
});
