/**
 * Every browser fetch has a deadline, and a deadline that fires says so.
 *
 * `no-dead-ends.test.ts` already holds the line for gateway reads. This is the
 * rest of the app: session mints, credential probes, similarity searches, exit
 * quotes and the health poll were all bare `fetch` calls, and a bare fetch has
 * no failure mode — against a server that accepts and never answers it is a
 * spinner with no end, indistinguishable from work still in progress.
 *
 * Two rules, and the second is the one that is easy to lose:
 *
 *  - **Bounded.** Every call carries `AbortSignal.timeout`, on a named constant,
 *    with a comment saying why that number and not another. No blanket value: a
 *    poll that must fit inside its own interval and a five-backtest combination
 *    have nothing in common but the type.
 *  - **Honest when it fires.** A timeout is not a network failure. "The index
 *    was not reached", "the request never reached the engine" and "the action
 *    failed" are all claims about something that did not happen, and an abort
 *    cannot make them — it abandoned a request that may well have been working.
 *    Where the message reaches a reader, the two must read differently.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { describeProbeFailure } from "../lib/use-exit-quotes";
import { describeSearchFailure } from "../lib/use-research-search";
import {
  describeActionFailure,
  describeHealthFailure,
  healthDeadlineMs,
} from "../lib/use-system-health";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** Comment-free view: this file's subject is vocabulary that appears in prose. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/**
 * The argument list of the call starting at `open`, balanced rather than
 * regexed. A `fetch` whose options object contains a nested call — and several
 * here do — defeats a lazy `fetch\([^)]*\)`, and the failure mode of getting
 * this wrong is a test that passes by reading half a call site.
 */
function callArgs(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

function fetchCalls(source: string): string[] {
  const stripped = code(source);
  return [...stripped.matchAll(/\bfetch\(/g)].map((match) => callArgs(stripped, match.index!));
}

/**
 * The call sites this pass bounded, by the file that owns them.
 *
 * Listed by name rather than discovered by walking the tree, so a new unbounded
 * fetch elsewhere is a separate conversation and removing one of these is a
 * deliberate act rather than a test quietly finding nothing to check.
 */
const BOUNDED = [
  "../lib/use-system-health.ts",
  "../lib/desk-pass.ts",
  "../lib/auth-client.ts",
  "../lib/use-research-search.ts",
  "../lib/use-exit-quotes.ts",
  "../components/auth/AuthCallback.tsx",
  "../components/auth/LoginScreen.tsx",
  "../components/research/FavouritesPanel.tsx",
];

describe("every call site carries a deadline", () => {
  it("no fetch in any of them is unbounded", () => {
    const offenders: string[] = [];
    for (const file of BOUNDED) {
      const calls = fetchCalls(read(file));
      assert.ok(calls.length > 0, `${file} has no fetch left — the list is stale`);
      for (const call of calls) {
        if (!/signal:\s*AbortSignal\.timeout\(/.test(call)) {
          offenders.push(`${file} — ${call.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a fetch with no deadline is a spinner with no end — against a server that accepts and "
        + `never answers these wait for the life of the tab:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("the duration is a named constant, never a number dropped inline", () => {
    /**
     * A literal in the call is a number with no author. The name is where the
     * reasoning lives, and the reasoning is the only thing that tells the next
     * person whether 4s was measured or guessed.
     */
    const offenders: string[] = [];
    for (const file of BOUNDED) {
      for (const call of fetchCalls(read(file))) {
        const argument = /AbortSignal\.timeout\(([^)]*)\)/.exec(call)?.[1]?.trim() ?? "";
        if (/^\d/.test(argument)) offenders.push(`${file} — AbortSignal.timeout(${argument})`);
      }
    }
    assert.deepEqual(offenders, [], `unnamed deadlines:\n  ${offenders.join("\n  ")}`);
  });

  it("each constant says why that number and not another", () => {
    const offenders: string[] = [];
    for (const file of BOUNDED) {
      const source = read(file);
      for (const match of source.matchAll(/^const ([A-Z][A-Z0-9_]*_MS) = /gm)) {
        // The prose immediately above the declaration, block or line comment.
        const before = source.slice(0, match.index!);
        const comment = /(?:\/\*\*[\s\S]*?\*\/|(?:\/\/[^\n]*\n)+)\s*$/.exec(before)?.[0] ?? "";
        // Long enough to be an argument rather than a restatement of the name.
        if (comment.replace(/[^A-Za-z ]/g, "").trim().length < 80) {
          offenders.push(`${file} — ${match[1]}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `deadlines with no stated reason:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("is not one blanket value wearing eight names", () => {
    const values = new Set<string>();
    for (const file of BOUNDED) {
      for (const match of read(file).matchAll(/^const [A-Z][A-Z0-9_]*_MS = ([\d_]+);/gm)) {
        values.add(match[1]);
      }
    }
    // A 3s logout, a 10s book walk and a 45s five-backtest combination are not
    // the same tolerance, and giving them one number would be choosing which of
    // them to break.
    assert.ok(values.size >= 5, `only ${values.size} distinct budgets across ${BOUNDED.length} files`);
  });
});

describe("a poll's deadline fits inside its own interval", () => {
  /** The cadences the console actually offers, read rather than restated.
   *  `SessionControls`, not `OperatorPanel`: the CADENCES table moved with the
   *  poll-rate picker when the operator panel was split into its controls, its
   *  guard and its confirmation. The next assertion is what proves this path
   *  still finds them — a list read from the wrong file is an empty list, and
   *  an empty list makes every check below it vacuous. */
  const cadences = [...read("../components/systems/SessionControls.tsx")
    .matchAll(/\{ label: "[^"]+", ms: ([\d_]+),/g)]
    .map((match) => Number(match[1].replace(/_/g, "")))
    .filter((ms) => ms > 0);

  it("reads the cadence list rather than assuming one", () => {
    assert.ok(cadences.length >= 3, "the console's cadence list moved; this test is now checking nothing");
  });

  it("never outlasts the interval, except at the deliberate floor", () => {
    for (const ms of cadences) {
      const deadline = healthDeadlineMs(ms);
      if (deadline <= ms) continue;
      /**
       * One cadence is allowed to overrun: 80% of the 1s debugging tick is
       * shorter than a healthy round trip, so a deadline that small would abort
       * good requests and paint a permanent outage over a working desk. Overlap
       * there is already contained by the `sequence` guard. Anything slower has
       * no such excuse.
       */
      assert.ok(ms < healthDeadlineMs(0), `the ${ms}ms cadence overruns without being under the floor`);
    }
  });

  it("never outlasts the gateway's own budget", () => {
    // Past the point where the server has given up there is nothing to wait for.
    const server = Number(
      /DEFAULT_TIMEOUT_MS = ([\d_]+)/.exec(read("../lib/gateway.ts"))?.[1]?.replace(/_/g, ""),
    );
    assert.ok(server > 0, "the gateway's own deadline is gone");
    for (const ms of [...cadences, 600_000]) {
      assert.ok(healthDeadlineMs(ms) <= server, `${ms}ms cadence budgets past the gateway's ${server}ms`);
    }
  });
});

describe("a timeout is not a failure, and does not say it is", () => {
  /** Exactly what `AbortSignal.timeout` throws; the other is a dead network. */
  const timeout = new DOMException("The operation timed out.", "TimeoutError");
  const dead = new TypeError("Failed to fetch");

  it("the health poll distinguishes them", () => {
    const timedOut = describeHealthFailure(timeout, 8_000);
    assert.notEqual(timedOut, describeHealthFailure(dead, 8_000));
    assert.match(timedOut, /8s/);
    // Three consoles render this verbatim after the words "System health is
    // unreachable." — the sentence must not agree with a claim it cannot make.
    assert.doesNotMatch(timedOut, /unreachable/i);
  });

  it("a timed-out poll is transient state, not a latch", () => {
    // The message itself has to say a later poll may succeed, and the code has
    // to make that true: a successful snapshot clears the error unconditionally.
    assert.match(describeHealthFailure(timeout, 4_000), /next poll may well succeed/);
    const health = code(read("../lib/use-system-health.ts"));
    const applySnapshot = /const applySnapshot = [\s\S]*?\n  \}, \[\]\);/.exec(health)?.[0] ?? "";
    assert.ok(applySnapshot, "applySnapshot is gone");
    assert.match(
      applySnapshot, /setHealthError\(null\)/,
      "nothing clears the error, so one stalled poll degrades the console for the life of the tab",
    );
  });

  it("an aborted operator action never claims nothing happened", () => {
    const timedOut = describeActionFailure(timeout);
    /**
     * The order ticket's rule, applied to the other write in this app. Purging a
     * cache or resetting a breaker may well have been done by the time the
     * browser gave up, and an operator who re-fires on "action failed" is acting
     * on a claim this code invented.
     */
    assert.match(timedOut, /may still have been applied/);
    assert.match(timedOut, /re-read the snapshot/);
    assert.notEqual(timedOut, describeActionFailure(dead));
    assert.match(describeActionFailure(dead), /Failed to fetch/);
  });

  it("a timed-out search does not report an index it never asked", () => {
    for (const backend of ["supabase", "oracle"] as const) {
      const timedOut = describeSearchFailure(timeout, backend);
      assert.match(timedOut, new RegExp(backend));
      assert.doesNotMatch(timedOut, /was not reached/);
      // And it must not read as "nothing similar is recorded", which is a real
      // and different outcome this panel exists to keep separate.
      assert.match(timedOut, /says nothing about whether anything similar is recorded/);
      assert.notEqual(timedOut, describeSearchFailure(dead, backend));
    }
  });

  it("a timed-out exit probe does not read as a missing book", () => {
    const timedOut = describeProbeFailure(timeout);
    assert.match(timedOut, /not necessarily unable to/);
    assert.notEqual(timedOut, describeProbeFailure(dead));
    assert.match(describeProbeFailure(dead), /Failed to fetch/);
  });

  it("the favourites panel distinguishes them too", () => {
    // A component, so this is the source rather than the value — but the same
    // rule: an abort cannot know the request never reached the engine.
    const panel = read("../components/research/FavouritesPanel.tsx");
    assert.match(panel, /cause instanceof DOMException && cause\.name === "TimeoutError"/);
    assert.match(panel, /may still have been re-running/);
    assert.match(
      code(panel), /never reached the engine/,
      "the transport sentence is gone, so both paths now say the same thing",
    );
  });

  it("a failed credential probe never accuses the credential", () => {
    /**
     * Neither a timeout nor a dead network is evidence about a token. Settling
     * on "rejected" would tell an operator their good credential is bad because
     * the wifi dropped, and the badge is the only thing that would say so.
     */
    const health = code(read("../lib/use-system-health.ts"));
    const probe = /const probe = async \(\) => \{[\s\S]*?\n    \};/.exec(health)?.[0] ?? "";
    assert.ok(probe, "the credential probe is gone");
    const caught = probe.slice(probe.indexOf("} catch"));
    assert.doesNotMatch(caught, /setTokenStatus\("rejected"\)/);
    // And it must not rest on a spinner either: one retry before it settles.
    assert.match(caught, /setTimeout\(\(\) => void probe\(\)/);
  });
});

describe("the streamed desk is wired, not orphaned", () => {
  /**
   * These two were deleted once, and the reason was specific rather than
   * general: the hook had no importer, and it could not reach its own
   * `unconfigured` state because `EventSource` exposes neither the status code
   * nor the body of a response — so the proxy's deliberate 503 on a
   * gateway-less deployment was invisible, and the panel would have read
   * "Connecting to the live desk feed…" forever on the deployment most people
   * see. The note that removed them said re-proxying was "a small job for
   * whoever has a consumer that needs it".
   *
   * There is a consumer now, and the invisible-503 problem is solved rather
   * than inherited: the route answers 200 and puts the state in-band as its
   * first event, which a client that cannot read status codes can still read.
   * So the invariant flips from "these must not exist" to "if they exist, the
   * two things that made them wrong must not have come back".
   */
  const streamRoute = read("../app/api/stream/desk/route.ts");
  const streamHook = read("../lib/use-desk-stream.ts");

  it("the hook has a consumer", () => {
    const importers = [...BOUNDED, "../app/dashboard/page.tsx", "../lib/use-book.ts"]
      .filter((file) => /use-desk-stream|useDeskStream/.test(read(file)));
    assert.ok(
      importers.length > 0,
      "use-desk-stream is orphaned again — it was deleted for exactly this once",
    );
  });

  it("the route never signals unavailability with a status code", () => {
    // The whole reason the first attempt failed. A 503 here is invisible to
    // EventSource, so the state has to travel as data.
    assert.doesNotMatch(streamRoute, /status:\s*503/,
      "the proxy is back to answering 503, which EventSource cannot see");
    assert.match(streamRoute, /event: desk-state/,
      "the proxy no longer states its availability in-band");
    assert.match(streamRoute, /"unavailable"/);
  });

  it("the hook stops rather than reconnect-storming an unavailable stream", () => {
    /**
     * EventSource retries roughly every 3s on its own, forever, with no
     * backoff and no idea whether anyone is looking at the tab. Against a
     * deployment that has just said there is nothing to stream, that is a poll
     * wearing a push's clothes.
     *
     * This used to read `es.close()` out of the 900 characters after the
     * desk-state handler opened, which was a proximity check standing in for
     * the invariant. The teardown is now a named function the handler calls,
     * so the text moved and the check went red against code that had got
     * MORE careful — the shape of a test agreeing with itself rather than
     * with the codebase. Asserted against the behaviour instead, and against
     * more of it than before.
     */
    const handler = streamHook.slice(streamHook.indexOf('addEventListener("desk-state"'));
    assert.match(handler.slice(0, 900), /fail\(/,
      "the unavailable branch no longer routes to a teardown");
    assert.match(streamHook, /const fail = \([\s\S]{0,200}?es\.close\(\)/,
      "the teardown does not close the EventSource, so it retries forever");
    assert.match(streamHook, /es\.onerror = \(\) => fail\(/,
      "a dropped connection is left to EventSource's own unbounded retry");
  });

  it("reconnection is the shared controller's, so it is hidden-gated and backed off", () => {
    // Reuse the controller's hidden gate and backoff; do not rebuild its curve.
    assert.match(streamHook, /new PollingController\(/,
      "the stream rolled its own reconnect loop instead of using the adopted one");
    assert.match(streamHook, /maxBackoffMs/, "the reconnect loop has no ceiling");
    // `gateway_not_configured` cannot change without a redeploy, so it is not
    // retried on any curve at all — the cockpit's reasoning for `!unconfigured`.
    assert.match(streamHook, /gateway_not_configured"\) loop\?\.stop\(\)/,
      "a deployment with no gateway is still being asked for a stream");
    assert.match(streamRoute, /STREAM_SESSION_MS\s*=\s*4\s*\*\s*60_000/); assert.match(streamRoute, /setTimeout\(rotateSession,\s*STREAM_SESSION_MS\)/);
    assert.match(streamRoute, /signal:\s*session\.signal/); assert.match(streamRoute, /clearTimeout\(sessionTimer\)/);
    assert.match(streamRoute, /stateFrame\("rotate"\)/, "planned rotation is indistinguishable from a dropped stream");
    assert.match(streamHook, /body\.state === "rotate"\) rotate\(\)/); assert.match(streamHook, /const rotate = \(\) => \{[\s\S]{0,300}?loop\?\.runNow\(\)/);
    assert.doesNotMatch(streamHook.match(/const rotate = \(\) => \{[\s\S]*?\n    \};/)?.[0] ?? "", /publish\([^)]*unavailable/);
  });

  it("one connection serves every consumer", () => {
    // Two consumers now, and the workspace keeps its panels mounted behind
    // `hidden`, so both are live at once. One EventSource per consumer would
    // open a second proxy route holding a second upstream gateway stream, and
    // the per-origin connection cap would starve the polls underneath.
    assert.match(streamHook, /subscribers \+= 1/, "the stream store is not refcounted");
    assert.match(streamHook, /if \(subscribers === 1\)/,
      "the connection is opened per consumer rather than once for the page");
    assert.match(streamHook, /if \(subscribers > 0\) return;/,
      "the last consumer leaving does not close the connection");
  });

  it("every surface on the stream says which transport is live", () => {
    /**
     * "Pushed" and "polled" are different freshness guarantees — about a
     * second against up to fifteen — and a surface that implies the better one
     * while delivering the worse one is this codebase's central defect. Both
     * surfaces must say it, and both must say it in the same words, which is
     * why the wording is a function rather than a literal in each.
     */
    assert.match(streamHook, /export function transportLabel/);
    for (const file of [
      "../components/portfolio/BookChrome.tsx",
      "../components/execution/PnlStrip.tsx",
    ]) {
      assert.match(read(file), /transportLabel\(/,
        `${file} shows streamed figures without saying how they arrived`);
    }
  });

  it("the stream is a signal, not the only source", () => {
    // The book must still poll. A push that dies quietly and takes the numbers
    // with it is worse than a poll that is occasionally late.
    const book = read("../lib/use-book.ts");
    assert.match(book, /usePolling\(/, "useBook stopped polling once the stream landed");
  });
});
