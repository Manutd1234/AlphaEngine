/**
 * What the desk sweep sweeps, and under what.
 *
 * Three lists and one count, kept together because they only mean anything
 * together: every rail section the desk ships, the fault profiles each one is
 * walked under, and the phrases that mean a panel gave up.
 *
 * `EXPECTED_SECTIONS` lives beside `TABS` on purpose. The rail is mirrored here
 * by hand — the sweep runs against a built page, not against `lib/sections.ts`
 * — so the count is the only thing standing between a renamed section and a
 * section nobody sweeps. `desk-sweep.mjs` refuses to run when the two disagree,
 * and `tour-truth.test.ts` holds the same 47 against the rails themselves.
 */

/** Every rail section, from lib/sections.ts. Kept in sync by hand — a missing
 *  section here is a section nobody swept, so the count is asserted below. */
const TABS = {
  overview: ["loop", "desks", "audit"],
  research: ["summary", "parameters", "walkforward", "attribution", "lineage", "decision", "runs", "fitted", "codex"],
  live: ["trade", "liquidity", "routing", "quality", "activity"],
  portfolio: ["overview", "equity", "positions", "allocation", "performance"],
  risk: ["limits", "model", "drivers", "montecarlo", "oraclevar", "scenarios", "controls"],
  data: ["overview", "feeds", "quality", "incidents", "lineage", "providers", "queue"],
  reliability: ["overview", "planes", "services", "events", "controls"],
  developer: ["overview", "readiness", "quality", "apis", "codebase", "work"],
};

const EXPECTED_SECTIONS = 47;

/**
 * The two tabs whose job is to report infrastructure truth.
 *
 * Everywhere else, "unreachable" is a dead end to be removed. Here it is the
 * correct answer, and replacing it with generated green would be the failure.
 * What they must still never do is render an empty panel or a bare spinner.
 */
const TRUTH_TABS = new Set(["reliability", "data"]);

/**
 * Phrases that mean "this panel gave up".
 *
 * Deliberately narrow. "Pending" and "connecting" appear legitimately in
 * transient states and in prose about how the desk works, so they are matched
 * only as a whole-panel verdict — see `deadEnded`, which requires the panel to
 * be BOTH substantially empty AND carrying one of these.
 */
const DEAD_END_PHRASES = [
  "unavailable",
  "unreachable",
  "could not reach",
  "could not load",
  "no audit rows",
  "needs price history",
  "book connecting",
  "temporarily unavailable",
  // Added after reading the panels rather than guessing at them. Each of these
  // is a real surface's exact wording, and none matched the list above — the
  // fill-quality card ("nothing to measure without a source") sailed through a
  // sweep that was looking for the word "unavailable".
  "nothing to measure",
  "nothing to list",
  "no decision history",
  "is reachable in this deployment",
  "refuses to invent",
  "no completed run",
];

/** Fault profiles. Each maps a URL predicate to what should happen to it. */
const PROFILES = {
  /** No interception. Locally the gateway is already absent, which is the
   *  deployed workspace's own normal state. */
  "as-deployed": null,

  /** The public deployment: a same-origin route that reports no gateway. */
  "gateway-absent": {
    match: (url) => url.includes("/api/gateway/"),
    action: { fulfill: { status: 503, body: { code: "gateway_not_configured", error: "No gateway is configured for this deployment." } } },
  },

  /** The state a redeploying container is in. Never answers; the client's 2.5s
   *  deadline is the only thing that can end it. */
  "gateway-hang": {
    match: (url) => url.includes("/api/gateway/"),
    action: { hang: true },
  },

  /** A gateway that is up and unwell. */
  "gateway-503": {
    match: (url) => url.includes("/api/gateway/"),
    action: { fulfill: { status: 503, body: { error: "upstream risk gateway returned 503" } } },
  },

  /** The Always-Free Autonomous Database auto-stopping, which is routine. */
  "oracle-down": {
    match: (url) => url.includes("/api/oracle"),
    action: { fail: "ConnectionRefused" },
  },

  /** No provider API keys, and no bars to derive anything from. */
  "providers-keyless": {
    match: (url) => url.includes("/api/ohlcv") || url.includes("/api/providers") || url.includes("/api/quote"),
    action: { fail: "ConnectionRefused" },
  },
};

/**
 * Rendering axes, orthogonal to the fault profiles.
 *
 * A dead end is a data-flow state and shows up under any of these; what these
 * catch is the other half of the claim — that the desk stays legible while it is
 * degraded. Forced-colors is the sharpest of them, because it discards every
 * colour the app chose, so anything that carried meaning in colour alone stops
 * carrying it at all.
 */
const MEDIA = {
  "dark": [{ name: "prefers-color-scheme", value: "dark" }],
  "light": [{ name: "prefers-color-scheme", value: "light" }],
  "reduce": [{ name: "prefers-reduced-motion", value: "reduce" }],
  "forced": [{ name: "forced-colors", value: "active" }],
};

export { TABS, EXPECTED_SECTIONS, TRUTH_TABS, DEAD_END_PHRASES, PROFILES, MEDIA };
