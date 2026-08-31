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
const ledgerSource = read("components/data/DataQualityLedger.tsx");
const ledgerFacts = [
  "The gateway did not return its quality ledger, so the counts here are this instance's own window and say nothing about other instances or earlier hours.",
  "Take is disabled: it needs the operator credential. Enter the operator token in Reliability → Remediation, or /ack from Telegram.",
  "Take is disabled: operator actions are switched off on this deployment; /ack from Telegram still works.",
  "a fail rate is a dash until something was evaluated.",
  "An empty list means the rules did not fire, not that every payload was clean.",
];
const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL("./fixtures/frontend-content-baseline.json", import.meta.url)),
  "utf8",
));

describe("Data Quality gives reconciliation and its ledger one boundary each", () => {
  it("keeps the exact existing ledger heading on its single disclosure trigger", () => {
    assert.match(
      ledgerSource,
      /export const DATA_QUALITY_LEDGER_HEADING = "Quality ledger & escalations";/,
    );
    assert.match(
      ledgerSource,
      /<summary[^>]*>[\s\S]*?\{DATA_QUALITY_LEDGER_HEADING\}[\s\S]*?<\/summary>/,
    );
    assert.doesNotMatch(consoleSource, /DATA_QUALITY_LEDGER_HEADING/);
    assert.equal(ledgerSource.match(/<details\b/g)?.length, 1, "the ledger must have one disclosure owner");
    assert.doesNotMatch(ledgerSource, /Quality ledger &amp; escalations/);
  });

  it("keeps CrossSourceCheck primary and mounts one self-owned ledger disclosure", () => {
    const quality = consoleSource.slice(
      consoleSource.indexOf('tabId="quality"'),
      consoleSource.indexOf('tabId="incidents"'),
    );
    const crossSourceAt = quality.indexOf("<CrossSourceCheck");
    const ledgerAt = quality.indexOf("<DataQualityLedger");

    assert.ok(crossSourceAt >= 0 && crossSourceAt < ledgerAt);
    assert.equal(quality.match(/<DataQualityLedger/g)?.length, 1);
    assert.doesNotMatch(quality, /<details\b|<summary\b/,
      "DataConsole must not wrap the ledger's own disclosure in a second border owner");
    assert.match(ledgerSource, /<details className="card console-card data-quality-ledger"/);
    assert.doesNotMatch(ledgerSource, /<section className="card console-card"/);
    for (const prop of [
      "validation={validation}", "healthLoaded={health !== null}",
      "guard={guard}", "operatorReady={operatorReady}", "operatorToken={view.token}",
    ]) assert.ok(quality.slice(ledgerAt).includes(prop), `${prop} was dropped`);
  });

  it("keeps all ledger context inside that owner without nested disclosures", () => {
    assert.match(ledgerSource, /<summary[^>]*>[\s\S]*?data-quality-ledger-heading[\s\S]*?<\/summary>/);
    assert.match(ledgerSource, /<div className="data-quality-ledger__body"/);
    assert.match(ledgerSource, /What opens one of these, and what closes it\?/);
    assert.match(ledgerSource, /The order, and who writes here/);
    assert.doesNotMatch(ledgerSource, /<details className="disclosure">/);
    for (const fact of ledgerFacts) assert.ok(ledgerSource.includes(fact), `ledger fact was deleted: ${fact}`);
    assert.match(ledgerSource, /data-quality-ledger__body[\s\S]*?\{lockNote\}/,
      "operator refusal context must remain reachable inside the disclosure owner");
  });

  it("keeps the signed Data static-copy signature byte-identical", () => {
    assert.deepEqual(buildProtectedBaseline().signatures.data, fixture.protectedFrontendSweep20260831.data);
  });
});
