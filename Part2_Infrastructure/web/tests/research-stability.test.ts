/**
 * Research ▸ Fitted models under a flapping gateway.
 *
 * The panel's old `Load` union had four states and only ever held one of them,
 * so `refresh()` began by setting `{ status: "loading" }` — discarding the
 * measured table — and a single failed probe then landed on `{ status:
 * "error" }`. One dropped poll after a good read replaced real runs with a
 * failure card; a gateway answering every other request alternated the two on
 * the refresh cadence, and the capsule, the tiles and the table unmounted and
 * remounted with each swing. That is the cockpit's `setBook(null)` defect in
 * miniature, and the cure is the same machine.
 *
 * These are state-sequence tests: a scripted pass/fail sequence against
 * `DeskSourceMachine`, read through `runsView` — the pure function that decides
 * what the panel renders. No DOM, no renderer, no timers.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { runsView } from "../components/research/runs-view";
import { DeskSourceMachine, PROMOTION_STREAK, type ProbeOutcome } from "../lib/desk-source";

/** The panel's payload stands in as any measured reading; the view is generic. */
interface Corpus { observed_at: string }

const ok = (at: string): ProbeOutcome<Corpus> => ({ ok: true, payload: { observed_at: at } });
const down = (message = "the gateway did not answer"): ProbeOutcome<Corpus> => ({
  ok: false,
  failure: { message },
});

/** Replay a script and collect the view after every settled probe. */
function replay(script: ProbeOutcome<Corpus>[]) {
  const machine = new DeskSourceMachine<Corpus>({ now: () => 1_000 });
  return script.map((outcome) => {
    machine.observe(outcome);
    return runsView(machine.state);
  });
}

describe("one failed poll never blanks the fitted-models table", () => {
  it("a failure after a good read keeps the measured list on screen, marked", () => {
    const [, view] = replay([ok("t1"), down("refused")]);
    assert.equal(view.kind, "runs", "the measured table was replaced by a failure card");
    assert.deepEqual(view.kind === "runs" ? view.payload : null, { observed_at: "t1" });
    // Not silently, though: the reader is told the list is a held reading.
    assert.ok(view.kind === "runs" && view.caution !== null, "a failed read must be said");
  });

  it("an alternating pass/fail gateway renders the table at every step", () => {
    const views = replay([ok("t1"), down(), ok("t2"), down(), ok("t3"), down()]);
    const kinds = views.map((view) => view.kind);
    assert.deepEqual(
      kinds,
      ["runs", "runs", "runs", "runs", "runs", "runs"],
      `the panel flickered: ${kinds.join(" → ")}`,
    );
  });

  it("the caution does not flap on the alternation", () => {
    // After the first failure the promotion streak is unreachable while the
    // gateway alternates, so the caution must hold through every step — a note
    // that appears and disappears on the poll cadence is the badge twitch.
    const views = replay([ok("t1"), down(), ok("t2"), down(), ok("t3"), down(), ok("t4")]);
    const cautions = views.slice(1).map((view) => view.kind === "runs" && view.caution !== null);
    assert.deepEqual(
      cautions,
      [true, true, true, true, true, true],
      "the caution note flapped with the gateway",
    );
  });

  it("recovery clears the caution only after the promotion streak", () => {
    const script = [ok("t1"), down(), ...Array.from(
      { length: PROMOTION_STREAK },
      (_, i) => ok(`r${i}`),
    )];
    const views = replay(script);
    const last = views[views.length - 1];
    const beforeLast = views[views.length - 2];
    assert.ok(
      beforeLast.kind === "runs" && beforeLast.caution !== null,
      "one success after a failure must not read as fully recovered",
    );
    assert.ok(last.kind === "runs" && last.caution === null, "a settled recovery still cautioned");
  });
});

describe("a corpus that has never answered is reported, not invented", () => {
  it("before the first probe settles, the panel is connecting, not failed", () => {
    const machine = new DeskSourceMachine<Corpus>();
    assert.equal(runsView(machine.state).kind, "connecting");
  });

  it("a failure with nothing measured is the failure card, with its reason", () => {
    const [view] = replay([down("ECONNREFUSED on :8000")]);
    assert.equal(view.kind, "unreachable");
    assert.match(view.kind === "unreachable" ? view.reason : "", /ECONNREFUSED/);
  });

  it("the first success replaces the failure card with the table", () => {
    const views = replay([down(), ok("t1")]);
    assert.equal(views[1].kind, "runs");
  });
});

describe("the panel routes through the desk-source machine", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../components/research/FittedModels.tsx", import.meta.url)),
    "utf8",
  );
  /** Comments removed, so prose about the old defect cannot satisfy a match. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("reads its list through useDeskSource and runsView, not a discarding Load state", () => {
    assert.match(code, /useDeskSource</, "the panel no longer routes through the machine");
    assert.match(code, /runsView\(/, "the panel no longer reads the shared view decision");
    // The discarding shape: a union whose loading arm holds no payload, so
    // every refresh — and every failure — starts by blanking the table.
    assert.doesNotMatch(code, /useState<Load>/, "the discarding Load state is back");
    assert.doesNotMatch(code, /status:\s*"loading"/, "a loading arm with no payload is back");
  });

  it("a dashed OOS Sharpe wears no tone", () => {
    // `(r.walkForwardOosSharpe ?? 0) >= 0` gave the null branch the `pos`
    // class, so the em dash rendered green — a sign asserted for a value the
    // cell itself declines to state. Null is never coerced, not even for a
    // className.
    const history = readFileSync(
      fileURLToPath(new URL("../components/research/ExperimentHistory.tsx", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(history, /walkForwardOosSharpe \?\? 0/);
  });

  it("a failed job poll is retried, never surfaced as a flip", () => {
    // The fit loop polls /api/gateway/jobs/{id} every 1.5s. A dropped poll is
    // not an outcome for the job — the next attempt answers — so it must not
    // set the notice, abort the loop, or touch the corpus list.
    assert.match(code, /if \(!polled\.ok\) continue;/);
  });
});
