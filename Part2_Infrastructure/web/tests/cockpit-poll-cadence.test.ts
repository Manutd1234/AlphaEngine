/**
 * What the cockpit's poll is allowed to ask for, and how often.
 *
 * One of the two properties this suite defends about the cockpit's data layer:
 * the loop must not spend a request re-reading a page that cannot have changed
 * since the last tick. The block below records the arithmetic; what is worth
 * saying at the top of the file is which way the default points, because that
 * is the half a formatting pass could invert without a single assertion going
 * red on a stale blotter.
 *
 * A caller that says nothing — a Retry button, a mutation, a submitted order —
 * gets the audit feeds. Only the poll opts out, and only on most ticks. Every
 * test here is one side of that asymmetry.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/cockpit-sources";

/**
 * The cockpit's data layer, split out of the component it feeds.
 *
 * The poll, the mode and the single invalidation path moved here when
 * `ExecutionCockpit` was split, and so did the assertions about them. Anything
 * left reading the component for a probe URL would be reading a file that no
 * longer contains one, and would agree with itself rather than with the
 * codebase.
 */
const cockpitFeed = read("components/execution/use-cockpit-feed.ts");

describe("the cockpit does not refetch history that cannot have changed", () => {
  /**
   * Three requests every four seconds, two of them re-reading append-only
   * pages. The book re-marks at 4 Hz and has to be fetched every tick; the
   * order blotter and the risk-event feed only change when an order is placed
   * or a breaker fires, and both of those already force a refresh.
   *
   * Asserted against the source because the alternative is a fake timer around
   * a React component, and what actually matters here is that the two audit
   * URLs are behind a condition — which is a property of the code, not of a
   * render.
   */
  const source = cockpitFeed;

  it("fetches the book unconditionally", () => {
    assert.match(source, /probeGateway<PortfolioSnapshot>\("\/api\/gateway\/portfolio"\)/);
  });

  it("puts both audit feeds behind the same condition", () => {
    for (const feed of ["orders", "events"]) {
      const line = source
        .split("\n")
        .find((l) => l.includes(`feed=${feed}`) && l.includes("probeGateway"));
      assert.ok(line, `no probeGateway call for feed=${feed}`);
      assert.match(
        line, /auditToo \?/,
        `feed=${feed} is fetched on every tick; it is append-only history`,
      );
    }
  });

  it("a caller that does not say otherwise gets the audit feeds", () => {
    // `refresh()` from a mutation, a Retry button or a submitted order must
    // read the history back. Only the poll opts out, and only on most ticks.
    assert.match(source, /const refresh = useCallback\(async \(auditToo = true\)/);
  });

  it("the poll passes the counter rather than a constant", () => {
    assert.match(source, /refresh\(ticks\.current\+\+ % AUDIT_EVERY === 0\)/);
  });
});
