/**
 * The feature tour describes a desk that exists.
 *
 * `docs/FEATURE_TOUR.md` walks a reader through all eight workspaces and names
 * the sections in each rail. Those lists were hand-mirrored from the app, and
 * every one of the eight had drifted: seven whole sections were missing
 * (Lineage, Fill quality, Equity & P&L, Monte Carlo, Feeds & Contracts,
 * Dependencies, Readiness), three tabs named the wrong opening section, and two
 * renames had never reached the document.
 *
 * Rewriting them fixes today. This file fixes tomorrow: `lib/sections.ts` is
 * the single source the rails, the command palette and the hash whitelist all
 * read, so it is the only thing the prose is allowed to disagree with by
 * accident — which is to say, never.
 *
 * The failure mode being closed is specific and cheap to hit: someone adds a
 * section, the app is correct, the suite is green, and the document that a
 * reviewer opens FIRST is quietly wrong. A tour is read by people who cannot
 * yet tell it is lying.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const sections = read("../lib/sections.ts");
const tour = read("../../../docs/FEATURE_TOUR.md");

/** Every `{ id, label }` pair of one workspace, in rail order. */
function railOf(workspace: string): { id: string; label: string }[] {
  const start = sections.indexOf(`export const ${workspace}_SECTIONS`);
  assert.ok(start >= 0, `lib/sections.ts defines no ${workspace}_SECTIONS`);
  const block = sections.slice(start, sections.indexOf("] as const", start));
  return [...block.matchAll(/\{\s*id:\s*"([a-z]+)"\s*,\s*label:\s*"([^"]+)"/g)]
    .map((m) => ({ id: m[1], label: m[2] }));
}

const WORKSPACES = [
  "OVERVIEW", "RESEARCH", "EXECUTION", "PORTFOLIO",
  "RISK", "DATA", "RELIABILITY", "DEVELOPER",
] as const;

/**
 * Markdown emphasis and entity escapes removed, whitespace collapsed.
 *
 * Underscores are NOT stripped, though markdown uses them for emphasis: the
 * document quotes environment variables, and `TELEGRAM_CONTROL_USER_IDS`
 * flattened to `TELEGRAMCONTROLUSERIDS` reports a missing sentence that is
 * plainly there.
 */
const plain = tour.replace(/[*`]/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the feature tour names the sections the app actually ships", () => {
  for (const workspace of WORKSPACES) {
    it(`${workspace.toLowerCase()} — every section label appears in the tour`, () => {
      const missing = railOf(workspace)
        .map((section) => section.label)
        .filter((label) => !plain.includes(label.replace(/&amp;/g, "&")));
      assert.deepEqual(
        missing,
        [],
        `the tour does not mention: ${missing.join(", ")}`,
      );
    });
  }

  it("the section total the tour quotes is the total that exists", () => {
    const total = WORKSPACES.reduce((n, workspace) => n + railOf(workspace).length, 0);
    assert.equal(total, 43, "the rail count moved; the tour and desk-sweep both quote it");
    assert.ok(
      plain.includes(`${total} section`),
      `the tour does not state the ${total}-section total`,
    );
  });

  it("names no section the app does not have", () => {
    // The other direction, and the one a rewrite gets wrong: a plausible label
    // invented for a section that was renamed or removed. Checked against the
    // handful of labels that have actually changed, because a general scan of
    // prose for section-shaped phrases would be noise.
    const retired = ["Codex", "Activity", "Telemetry & SLIs"];
    const shipped = new Set(WORKSPACES.flatMap((w) => railOf(w).map((s) => s.label)));
    for (const label of retired) {
      assert.ok(!shipped.has(label), `${label} is shipping again — update this list`);
      assert.ok(
        !new RegExp(`rail:? [^.]*\\b${label}\\b`).test(plain),
        `the tour still lists the retired section "${label}" in a rail`,
      );
    }
  });

  it("records that the ids and the labels are allowed to disagree", () => {
    // Two ids are frozen mid-rename because they are public deep links, which
    // is exactly the kind of thing a later reader "tidies up" without the note.
    assert.match(sections, /id: "codex"/);
    assert.match(sections, /id: "activity"/);
    assert.ok(
      plain.includes("codex") && plain.includes("activity"),
      "the tour does not explain why two section ids do not match their labels",
    );
  });
});

describe("the tour quotes no figure it cannot support", () => {
  it("uses the 17-defined / 15-on-every-path gate framing", () => {
    // "14 gates" was the last holdout of an older count. The two numbers are
    // different questions — how many exist, and how many run unconditionally.
    assert.ok(!/\b14 gates\b/.test(plain), "the tour still quotes the retired 14-gate count");
    assert.ok(
      /17\b[^.]*\b15\b/.test(plain) || /15\b[^.]*\b17\b/.test(plain),
      "the tour does not carry the 17-defined / 15-on-every-path framing",
    );
  });

  it("carries the Telegram surface at all", () => {
    // The Connect chip sits in every header and the tour had zero mentions of
    // it, which is a whole transport a reviewer would never find.
    assert.ok(plain.includes("Telegram"), "the tour does not mention Telegram");
    assert.ok(
      plain.includes("TELEGRAM_CONTROL_USER_IDS"),
      "the tour describes the binding without naming what still gates the controls",
    );
  });
});
