/**
 * The three diffusion proxy routes, and what their `validate` actually refuses.
 *
 * Until 2026-08-26 all three passed an inline arrow asserting only
 * `typeof payload.state === "string"`, while the seventeen coherence routes
 * each passed a NAMED guard out of a types module. Two consequences, both
 * fixed here and both pinned below:
 *
 *  - `isAbsorptionRead` and `isEventsRead` already existed in
 *    `components/coherence/diffusion/types.ts` and had NO CALLER anywhere in
 *    the tree. A guard nothing calls is not a guard, and the routes were
 *    carrying a second, weaker copy of the check it was written to make.
 *  - `typeof state === "string"` accepts a state RENAMED upstream. The panes
 *    compare `state === "ok"` and take the else-branch on anything else, so a
 *    rename paints "nothing here" instead of failing — the exact flattening
 *    the field exists to prevent.
 *
 * The interesting assertions are the REFUSALS. A guard that only ever sees
 * well-formed fixtures is not known to bite; see the `drift` cases.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";
import {
  isAbsorptionRead,
  isEventsRead,
  isFindingsRead,
  isReadState,
} from "../components/coherence/diffusion/types";

const ROUTES = {
  absorption: { guard: "isAbsorptionRead", file: "../app/api/gateway/diffusion/absorption/route.ts" },
  events: { guard: "isEventsRead", file: "../app/api/gateway/diffusion/events/route.ts" },
  findings: { guard: "isFindingsRead", file: "../app/api/gateway/diffusion/findings/route.ts" },
} as const;

describe("every diffusion proxy validates with a named guard", () => {
  for (const [name, { guard, file }] of Object.entries(ROUTES)) {
    it(`${name} passes ${guard}, not an inline arrow`, () => {
      const source = stripNonCode(read(file));
      assert.match(source, new RegExp(`validate:\\s*${guard}\\b`), `${name} no longer validates with ${guard}`);
      assert.doesNotMatch(
        source,
        /validate:\s*\(payload\)/,
        `${name} has gone back to an inline arrow; the named guard is the one the types module keeps in step with schemas_diffusion.py`,
      );
    });
  }
});

describe("the read state is a closed set, not any string", () => {
  for (const state of ["ok", "unconfigured", "unavailable", "unreadable"]) {
    it(`accepts ${state}`, () => assert.equal(isReadState(state), true));
  }

  // The drift cases. `not_configured` is the plausible rename — it is what the
  // field would be called by someone who had not read `ReadState` — and the old
  // `typeof === "string"` check accepted it.
  for (const state of ["not_configured", "OK", "ready", "", "not_found"]) {
    it(`refuses ${JSON.stringify(state)}`, () => assert.equal(isReadState(state), false));
  }

  // `not_found` belongs to `DiffusionEventResponse` (singular), which is a
  // different model with its own five-member Literal. It must not leak into
  // the plural read's vocabulary — the two are easy to conflate by route name.
  it("does not accept the singular event read's extra member", () => {
    assert.equal(isReadState("not_found"), false);
  });
});

describe("each guard refuses a payload the panes would misread", () => {
  const OK = {
    absorption: { state: "ok", runs: [] },
    events: { state: "ok", events: [] },
    findings: { state: "ok", findings: [] },
  };
  const guards = { absorption: isAbsorptionRead, events: isEventsRead, findings: isFindingsRead };
  const collection = { absorption: "runs", events: "events", findings: "findings" } as const;

  for (const name of ["absorption", "events", "findings"] as const) {
    const guard = guards[name];
    const good = OK[name];

    it(`${name} accepts every legitimate state, not just ok`, () => {
      for (const state of ["ok", "unconfigured", "unavailable", "unreadable"]) {
        assert.equal(guard({ ...good, state }), true, `${name} refused a legitimate ${state} read`);
      }
    });

    it(`${name} refuses a renamed state`, () => {
      assert.equal(guard({ ...good, state: "not_configured" }), false);
    });

    it(`${name} refuses a payload whose ${collection[name]} went missing`, () => {
      const { [collection[name]]: _dropped, ...without } = good as Record<string, unknown>;
      assert.equal(guard(without), false);
    });

    it(`${name} refuses a non-object`, () => {
      assert.equal(guard(null), false);
      assert.equal(guard("ok"), false);
    });
  }
});
