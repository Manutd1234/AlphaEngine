import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../components/overview/AuditTrail.tsx", import.meta.url)),
  "utf8",
);

const CAPTION = "Order audit rows, newest first.";

describe("Overview audit rows use content-neutral progressive disclosure", () => {
  it("owns the signed caption once and reuses it for the visible summary and table caption", () => {
    assert.equal(
      (source.match(new RegExp(CAPTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? [])
        .length,
      1,
      "the protected string must remain a single static-copy entry",
    );
    assert.ok(source.includes(`const AUDIT_ROWS_CAPTION = "${CAPTION}";`));
    assert.match(source, /<summary>\{AUDIT_ROWS_CAPTION\}<\/summary>/);
    assert.match(
      source,
      /<caption className="sr-only">\s*\{AUDIT_ROWS_CAPTION\}\s*<\/caption>/,
    );
  });

  it("keeps the complete live table in a closed native details element", () => {
    const opener = '<details className="disclosure overview-audit-rows">';
    const start = source.indexOf(opener);
    assert.notEqual(start, -1, "the table needs an addressable native disclosure");
    assert.ok(!opener.includes(" open"), "audit rows must be collapsed at rest");

    const end = source.indexOf("</details>", start);
    assert.notEqual(end, -1, "the audit-row disclosure must close");
    const body = source.slice(start, end);
    assert.ok(body.includes('<div className="table-wrap table-wrap--clamped" tabIndex={0}>'));
    assert.ok(body.includes("state.rows.map((row) => ("), "all source rows must remain rendered");
    assert.ok(body.includes("row.latency_ms"), "the final latency field must remain in the table");
  });

  it("leaves row count and source provenance visible below the closed disclosure", () => {
    const detailsStart = source.indexOf('<details className="disclosure overview-audit-rows">');
    const detailsEnd = source.indexOf("</details>", detailsStart);
    const noteStart = source.indexOf('<p className="research-note">', detailsEnd);
    const branchEnd = source.indexOf("</>", detailsEnd);

    assert.ok(detailsStart >= 0 && detailsEnd > detailsStart);
    assert.ok(noteStart > detailsEnd, "the provenance note must not be folded with the table");
    assert.ok(noteStart < branchEnd, "the provenance note must remain in the populated-row branch");

    const visibleNote = source.slice(noteStart, branchEnd);
    assert.ok(visibleNote.includes("{state.rows.length} newest rows;"));
    assert.ok(visibleNote.includes("paper-only, recorded by the gateway itself."));
    assert.ok(!visibleNote.includes("generated for this session"));
  });
});
