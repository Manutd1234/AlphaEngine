import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../components/research/WalkForwardTimeline.tsx", import.meta.url)),
  "utf8",
);

const CAPTION = "Walk-forward results, one row per fold.";
const OPEN = '<details className="disclosure walkforward-table-disclosure">';

describe("Research Walk-forward progressively discloses only the exact fold table", () => {
  it("single-owns the signed caption and reuses it for summary and table semantics", () => {
    assert.equal(source.split(CAPTION).length - 1, 1, "signed static copy must remain exact");
    assert.ok(source.includes(`const WALK_FORWARD_TABLE_CAPTION = "${CAPTION}";`));
    assert.match(source, /<summary>\{WALK_FORWARD_TABLE_CAPTION\}<\/summary>/);
    assert.match(
      source,
      /<caption className="sr-only">\s*\{WALK_FORWARD_TABLE_CAPTION\}\s*<\/caption>/,
    );
  });

  it("keeps verdict, figure, ladder and KPI tiles visible before the closed table", () => {
    const details = source.indexOf(OPEN);
    assert.ok(details >= 0, "the exact fold table needs a native disclosure");
    assert.ok(source.indexOf('className="stability-verdict"') < details);
    assert.ok(source.indexOf("<Figure") < details);
    assert.ok(source.indexOf("<FoldLadder folds={folds} />") < details);
    assert.ok(source.indexOf('<div className="tiles stability-tiles">') < details);
    assert.ok(!OPEN.includes(" open"), "the exact fold table must be closed at rest");
  });

  it("retains the linked table, every fold and every interaction handler inside", () => {
    const start = source.indexOf(OPEN);
    const end = source.indexOf("</details>", start);
    assert.ok(end > start);
    const body = source.slice(start, end);

    assert.ok(body.includes('className="table-wrap walkforward-table"'));
    assert.ok(body.includes("tabIndex={0}"));
    assert.ok(body.includes("onFocus={() => setHot((hotFold ?? 0) * 2)}"));
    assert.ok(body.includes("onBlur={() => setHot(null)}"));
    assert.ok(body.includes("onKeyDown={moveTable}"));
    assert.ok(body.includes("folds.map((f, index) => ("));
    assert.ok(body.includes('data-linked={hotFold === index ? "true" : undefined}'));
    assert.ok(body.includes("onPointerEnter={() => setHot(index * 2)}"));
    assert.ok(body.includes("onPointerLeave={() => setHot(null)}"));

    for (const column of [
      "Fold", "Train window", "Test window", "Params", "Drift", "IS Sharpe",
      "OOS Sharpe", "OOS return", "Efficiency",
    ]) {
      assert.ok(body.includes(`>${column}</th>`), `missing exact-table column: ${column}`);
    }
  });
});
