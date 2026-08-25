/**
 * The next-step footer follows the section, not a fixed ring.
 *
 * Every panel closes with a suggestion of where to go next. A ring keyed only
 * on the workspace gives all of a tab's sections the same answer, which is the
 * same defect as a cross-link that names a workspace and not a section: it is
 * right roughly one time in however many sections that tab has.
 *
 * So the footer carries a per-section map, and this block measures it against
 * `lib/sections` in both directions — a step keyed on a section that no longer
 * exists is dead, and a step pointing at one that no longer exists is worse,
 * because it still navigates. The ring stays underneath as the fallback so no
 * section loses its footer entirely, and the eight mounts are counted because
 * the footers travelled with the panels when the shell was split: a scan left
 * on page.tsx would have found zero of them and reported "0 !== 8" — or, had
 * the assertion been a `>= 0`, nothing at all.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RAILS, isRealLocation } from "./helpers/desk-rails";
import { footerCode, panelsCode } from "./helpers/desk-shell-sources";

describe("the next step follows what was just read", () => {
  const steps = [...footerCode.matchAll(
    /"([a-z]+)\/([a-z]+)":\s*\{\s*view:\s*"([a-z]+)",\s*section:\s*"([a-z]+)"/g,
  )].map(([, fromView, fromSection, view, section]) => ({ fromView, fromSection, view, section }));

  it("covers the sections measured as having no outbound link of their own", () => {
    assert.ok(steps.length >= 23, `only ${steps.length} sections have a measured next step`);
  });

  it("every source and every destination is a real section", () => {
    const dead: string[] = [];
    for (const step of steps) {
      if (!isRealLocation(step.fromView, step.fromSection)) {
        dead.push(`from ${step.fromView}/${step.fromSection}`);
      }
      if (!isRealLocation(step.view, step.section)) {
        dead.push(`to ${step.view}/${step.section}`);
      }
    }
    assert.deepEqual(
      dead,
      [],
      "the footer is keyed on, or points at, a section lib/sections does not define — "
        + `this is the drift a component with no test accumulates:\n  ${dead.join("\n  ")}`,
    );
  });

  it("no step offers the section the reader is already on", () => {
    const circular = steps
      .filter((step) => step.fromView === step.view && step.fromSection === step.section)
      .map((step) => `${step.fromView}/${step.fromSection}`);
    assert.deepEqual(circular, [], `a next step that goes nowhere:\n  ${circular.join("\n  ")}`);
  });

  it("keeps the role ring as the fallback so no section loses its footer", () => {
    const start = footerCode.indexOf("const FLOW_MAP");
    assert.notEqual(start, -1, "the fallback ring is gone");
    const block = footerCode.slice(start, footerCode.indexOf("\n};", start));
    const ring = [...block.matchAll(/^ {2}([a-z]+):\s*\{\s*\n\s*nextId:\s*"([a-z]+)"/gm)];
    assert.equal(ring.length, 11,
      "the ring no longer covers all eleven workspaces");
    for (const [, from, to] of ring) {
      assert.ok(RAILS[from], `the ring starts from "${from}", which is not a workspace`);
      assert.ok(RAILS[to], `the ring points at "${to}", which is not a workspace`);
    }
  });

  it("reads the destination's name from the rail rather than mirroring it", () => {
    assert.match(footerCode, /from "@\/lib\/sections"/);
    assert.match(footerCode, /SECTIONS_BY_VIEW\[contextual\.view\]\.find/);
  });

  it("is told which section it is standing on, on every view", () => {
    // The footers travelled with the panels they close — first out of page.tsx,
    // then again on 2026-08-25 when the three engine tabs moved to
    // `EnginePanels`. A scan left on either single file would find a subset and
    // report a smaller number confidently, so `panelsCode` spans both.
    const mounts = [...panelsCode.matchAll(
      /<NextStepFooter currentView="([a-z]+)" currentSection=\{(\w+)\} onNavigate=\{openSection\} \/>/g,
    )];
    assert.equal(
      mounts.length,
      11,
      "a view mounts the footer without telling it where the reader is, so that whole "
        + "workspace falls back to the ring",
    );
    assert.equal(new Set(mounts.map((match) => match[1])).size, 11);
  });
});
