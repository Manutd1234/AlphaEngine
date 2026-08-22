/**
 * The reliability tab was REWRITTEN shorter, and this is the receipt.
 *
 * Three passes have run over this tab, each with a different lever: deletion
 * (188 words of 10,086, then it stopped, correctly), disclosure (prose moved
 * behind `<details>` byte-identical, pinned by `disclosure-reliability.test.ts`)
 * and now rewriting — the same fact in fewer words.
 *
 * The third is the dangerous one, and this repository records what it costs
 * when it goes wrong: commit `8d091a3`, "Cut 610 words from the frontend, then
 * put 16 facts back". A rewrite reads fluently whether or not it still says
 * what the original said, so fluency proves nothing and only an enumeration
 * does.
 *
 * HOW THIS WORKS. Every sentence this pass rewrote is listed below as a FACT
 * LIST — the numbers, units, thresholds, named entities, negations and
 * qualifiers it carries — and each token is asserted present. A rewrite that
 * reads better and drops "rather than", "only", "never" or a threshold fails
 * here however good the prose is. Each entry also names the throat-clearing
 * that was cut (`wasteGone`), so the test bites both ways: the facts may not
 * leave, and the padding may not come back. Without that half, reverting a
 * rewrite would pass.
 *
 * IT DOES NOT CAP WORD COUNT. `copy-audit.test.ts` opens by explaining why:
 * "detailed" and "wordy" are not the same property, and a length cap pushes the
 * desk toward saying less than it knows. The honesty floor in
 * `disclosure-reliability.test.ts` is what stops this pass cutting a safety
 * statement, a cost, an empty state or a null explanation.
 *
 * THE EMPTY-SCAN TRAP. Every source is asserted non-empty before any assertion
 * runs over it. A scan of "" satisfies every negative assertion here and reads
 * exactly like a clean bill of health; that trap has been found twice in this
 * tree — see the `slice(-1)` note in `copy-audit.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Comments blanked. Load-bearing: `ReliabilityPlatform` says "a missing
 *  measurement, not a set of failures" in its doc block AND in its empty state,
 *  so a whole-file scan reported the fact as surviving after it had been cut
 *  from the UI. A fact test that reads a comment cannot fail. */
const uncommented = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (_m, lead: string) => lead);

/** Entities resolved, whitespace collapsed — JSX wraps a sentence anywhere. */
const normalise = (source: string) =>
  uncommented(source)
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;|&apos;/g, "’")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The readable text of a source, in BOTH forms, concatenated.
 *
 * A naive `replace(/<[^>]+>/g, " ")` is wrong on TSX and fails silently: a `<`
 * used as a comparison (`s.samples < DECISION_MIN_SAMPLES`) opens a "tag" that
 * runs to the next `>` anywhere in the file, swallowing every rendered string
 * in between. Three assertions here went red on real, present prose before this
 * was fixed. So both readings are searched — raw with whitespace collapsed
 * (a sentence written as one literal or prop value) and tag-stripped (a
 * sentence broken by `<strong>` or `<em>`). Either counts.
 */
const prose = (source: string) =>
  `${normalise(source)}\n⟦⟧\n${normalise(source.replace(/<[^>]+>/g, " "))}`;

const SOURCES = new Map<string, string>();
function load(path: string): string {
  const cached = SOURCES.get(path);
  if (cached) return cached;
  const text = readFileSync(join(root, path), "utf8");
  SOURCES.set(path, text);
  return text;
}

/** `facts`: every assertable token the ORIGINAL carried. `wasteGone`: a phrase
 *  the rewrite removed and must not bring back. `after`: the new sentence. */
interface Rewrite { path: string; what: string; facts: string[]; wasteGone: string; after: string }

const A = "components/systems/ReliabilityAttention.tsx";
const PLANES = "components/systems/ReliabilityPlanes.tsx";
const PLATFORM = "components/systems/ReliabilityPlatform.tsx";
const MIX = "components/systems/DependencyMix.tsx";
const BREAKER = "components/systems/BreakerStateMachine.tsx";
const MATRIX = "components/systems/HealthMatrix.tsx";
const LEDGER = "components/systems/RemediationLedger.tsx";
const FAILOVER = "components/systems/FailoverGraph.tsx";
const GUARD = "components/systems/OperatorGuard.tsx";
const PANEL = "components/systems/OperatorPanel.tsx";
const CONSOLE = "components/ReliabilityConsole.tsx";

const REWRITES: Rewrite[] = [
  {
    path: A, what: "the waiting-for-telemetry empty state",
    facts: ["health snapshot", "arrived yet"],
    wasteGone: "The first health snapshot has not arrived",
    after: "No health snapshot has arrived yet.",
  },
  {
    path: A, what: "the all-clear detail",
    facts: ["Provider routes have headroom", "no dependency drill is running"],
    wasteGone: "have headroom and no dependency drill",
    after: "Provider routes have headroom; no dependency drill is running.",
  },
  {
    path: A, what: "the degraded trading-path title",
    facts: ["Trading path is restricted"],
    wasteGone: "operating with restrictions",
    after: "Trading path is restricted",
  },
  {
    // The env var name is interpolated, so the token asserted is the binding.
    path: PLANES, what: "the not-configured provider detail",
    facts: ["provider.keyEnv", "to enable it"],
    wasteGone: "to enable this provider",
    after: "Set ${provider.keyEnv} to enable it.",
  },
  {
    path: PLANES, what: "the one-gateway tile note",
    facts: ["one FastAPI process", "no fleet to count"],
    wasteGone: "there is no fleet to count",
    after: "one FastAPI process; no fleet to count",
  },
  {
    path: PLANES, what: "the Idle disclosure",
    facts: [
      "Idle means configured", "within quota", "no open circuit",
      "no call in the fifteen-minute", "Only OpenBB is probed automatically",
      "every paid API", "would spend quota",
    ],
    wasteGone: "paid API on each refresh",
    after: "probing every paid API each refresh would spend quota.",
  },
  {
    path: PLATFORM, what: "the missing-gateway empty state",
    facts: [
      "No gateway ops snapshot is arriving",
      "market-data, risk, audit and queue components",
      "cannot be observed from here", "a missing measurement",
      "not a set of failures",
    ],
    wasteGone: "That is a missing measurement",
    after: "cannot be observed from here — a missing measurement, not a set of failures.",
  },
  {
    path: MIX, what: "the grey-is-not-red disclosure",
    facts: [
      "Grey is not red", "gateway is unreachable", "everything behind it",
      // One token, not "rather than" and "down" separately: both words occur
      // elsewhere in this file, so split tokens stayed green when the
      // comparison itself was cut. The comparison IS the fact.
      "rather than down",
      "Not configured", "likewise not a fault", "hollow dashed tile",
      "this deployment never had",
    ],
    wasteGone: "gateway cannot be reached",
    after: "When the gateway is unreachable, everything behind it reports",
  },
  {
    path: MIX, what: "the state-ring empty note",
    facts: ["No health snapshot yet", "no topology to compose"],
    wasteGone: "so there is no topology",
    after: "No health snapshot yet, so no topology to compose.",
  },
  {
    path: BREAKER, what: "the half-open disclosure",
    facts: [
      "Half-open is a moment, not a resting state", "dispatch gate",
      "retires an elapsed cooldown", "next call to the provider",
      "permanent zero there is correct",
    ],
    wasteGone: "next call that touches the provider",
    after: "on the next call to the provider, so a permanent zero there is correct.",
  },
  {
    path: MATRIX, what: "the unconfigured Test-button title",
    facts: ["Not configured", "nothing to probe"],
    wasteGone: "there is nothing to probe",
    after: "Not configured — nothing to probe.",
  },
  {
    path: LEDGER, what: "the no-MTTR-trend refusal",
    facts: [
      "No MTTR trend is drawn", "sample surviving a bounded ring",
      "biased short", "slope toward a recovery time nobody achieved",
    ],
    wasteGone: "sample that survives a bounded ring",
    after: "The sample surviving a bounded ring is biased short,",
  },
  {
    path: LEDGER, what: "the pairing disclosure",
    facts: [
      "both the trip and its closure", "event ring",
      "dispatch, cache and quota traffic",
      "a long outage loses its opening line first",
    ],
    wasteGone: "quota traffic, and a long outage",
    after: "dispatch, cache and quota traffic; a long outage loses its opening line first.",
  },
  {
    // One phrase, three places: the disclosure summary and both chart
    // aria-labels. Shortening only the visible one would leave a screen-reader
    // user reading the longer wording, so the passive went everywhere at once.
    path: LEDGER, what: "the matched-pairs summary and both chart aria-labels",
    facts: ["Every matched trip and closure", "with times", "how each closed", "Circuit trips by how each closed", "Circuit trips by provider and how each closed"],
    wasteGone: "how each was closed",
    after: "Every matched trip and closure, with times and how each closed",
  },
  {
    path: FAILOVER, what: "the served-by note",
    facts: ["after skipping every higher-ranked provider"],
    wasteGone: "higher-ranked provider above it",
    after: "after skipping every higher-ranked provider",
  },
  {
    path: FAILOVER, what: "the simulate-outage button title",
    facts: ["Simulate an outage", "watch the next request move down the chain"],
    wasteGone: "Simulate an outage here",
    after: "Simulate an outage and watch the next request move down the chain.",
  },
  {
    path: GUARD, what: "the clear-token button title",
    facts: ["Forget the token", "default identity"],
    wasteGone: "and return this tab to its default identity",
    after: "Forget the token; this tab returns to its default identity.",
  },
  {
    path: PANEL, what: "the blast-radius banner",
    facts: ["not fleet or trading controls", "affects only", "Next.js provider-routing instance that receives it", "nothing here halts or resumes", "Python trading gateway"],
    wasteGone: "receives it, and nothing here halts",
    after: "instance that receives it; nothing here halts or resumes the Python trading gateway.",
  },
  {
    path: CONSOLE, what: "the overall-state tile note when no health ever arrived",
    facts: ["no health snapshot"],
    wasteGone: "no health snapshot available",
    after: "no health snapshot",
  },
  {
    /* Not a shortening: the one word change a later DISCLOSURE pass made,
       recorded here because an unpinned word change is what this file exists to
       catch. That note was a method sentence and then a price; the method
       folded (pinned in `disclosure-reliability.test.ts`), leaving "It spends…"
       with nothing above it for "It" to mean. Both facts are untouched. */
    path: "components/systems/CrossSourceCheck.tsx", what: "the cost line, after the method sentence folded from above it",
    facts: ["spends a call per provider", "runs only when you ask"],
    wasteGone: "It spends a call per provider", after: "This check spends a call per provider, so it runs only when you ask.",
  },
];

describe("the rewritten sources are actually on disk", () => {
  // Without this the whole file is a scan of nothing: "" satisfies every
  // negative assertion below and reports a clean bill of health.
  it("loads every file this pass touched, non-empty", () => {
    const paths = [...new Set(REWRITES.map((r) => r.path))];
    assert.ok(paths.length >= 9, `expected the rewritten set, found ${paths.length}`);
    for (const path of paths) {
      assert.ok(load(path).length > 500, `${path} loaded empty or truncated`);
    }
  });
});

describe("every fact the original carried is still readable", () => {
  for (const { path, what, facts, after } of REWRITES) {
    it(`${path.split("/").pop()} — ${what}: ${facts.length} fact${facts.length === 1 ? "" : "s"}`, () => {
      const source = load(path);
      assert.ok(source.length > 500, `${path} did not load`);
      const text = prose(source);
      for (const fact of facts) {
        assert.ok(
          text.includes(fact),
          `the rewrite dropped a fact the original carried: "${fact}"\n`
          + "  (a number, unit, threshold, named entity, negation or qualifier is not optional)\n"
          + `  rewritten sentence expected to carry it: ${after}`,
        );
      }
    });
  }
});

describe("the rewrite actually landed, and the padding stays out", () => {
  for (const { path, what, wasteGone, after } of REWRITES) {
    it(`${path.split("/").pop()} — ${what}`, () => {
      const source = load(path);
      assert.ok(source.length > 500, `${path} did not load`);
      const text = prose(source);
      assert.ok(!text.includes(wasteGone), `the longer phrasing is back: "${wasteGone}"`);
      assert.ok(text.includes(after), `the rewritten sentence is not in the file: "${after}"`);
    });
  }
});

/** The negations this pass came closest to losing, asserted on their own: each
 *  is a sentence whose whole meaning is the word most easily "tightened" away. */
describe("the negations and qualifiers a shorter sentence would eat", () => {
  it("the dependency ring still says 'rather than', not just 'not observed'", () => {
    const source = load(MIX);
    assert.ok(source.length > 500, "DependencyMix did not load");
    assert.match(
      prose(source), /reports\s+not observed\s+rather than\s+down/,
      "'rather than down' is the comparison; without it the sentence claims the component is down",
    );
  });

  it("the ledger still says it is never an SLA", () => {
    const source = load(LEDGER);
    assert.ok(source.length > 500, "RemediationLedger did not load");
    assert.match(prose(source), /never an SLA/);
    assert.match(prose(source), /A closure is not a fix/);
  });

  it("the platform empty state still refuses to call an absence a failure", () => {
    const source = load(PLATFORM);
    assert.ok(source.length > 500, "ReliabilityPlatform did not load");
    assert.match(prose(source), /a missing measurement, not a set of failures/);
  });

  it("the Idle disclosure still bounds itself to OpenBB only", () => {
    const source = load(PLANES);
    assert.ok(source.length > 500, "ReliabilityPlanes did not load");
    assert.match(prose(source), /Only OpenBB is probed automatically/);
  });
});

/** The sentences this pass surveyed and REFUSED to shorten, so the next reader
 *  knows they were weighed rather than missed, each pinned at the token that
 *  makes it unshortenable. Matched against `prose`, not the raw file: JSX wraps
 *  these, and a needle tied to one line break rots the day a formatter moves it. */
describe("what was deliberately left alone", () => {
  const REFUSED: Array<{ path: string; why: string; needle: RegExp }> = [
    {
      path: "components/systems/DependencyTree.tsx",
      why: "'every row that is not healthy' cannot become 'every unhealthy row': the same "
        + "sentence has just said not-configured and not-observed are not faults",
      needle: /every row that is not healthy keeps its reason inline/,
    },
    {
      path: "components/systems/LatencyTrend.tsx",
      why: "the sample floor, the reason it is withheld and the way the window fills are "
        + "three separate facts in twenty-five words",
      needle: /nothing is drawn from a percentile that thin/,
    },
    {
      path: "components/systems/OperatorControls.tsx",
      why: "'our count, not the vendor's meter' is the whole cost of the control, and "
        + "'may still be' is the qualifier that keeps it honest",
      needle: /further requests may still be rejected upstream or billed/,
    },
    {
      path: GUARD,
      why: "the demo banner names the flag, the scope and that a typed credential is still "
        + "checked — every clause is a separate authorisation fact",
      needle: /a typed credential is still checked, and unsetting the flag requires one again/,
    },
    {
      path: "components/systems/TraceConsole.tsx",
      why: "'either … or' names two different causes of one gap; collapsing it would assert "
        + "the wrong one",
      needle: /either the server ring advanced past this client’s cursor or a poll landed on a different instance/,
    },
    {
      path: "components/systems/QuarantinePanel.tsx",
      why: "'not that every payload passed' is the negation the whole paragraph exists for",
      needle: /not\s+that\s+every payload passed/,
    },
    {
      path: "components/systems/RouteLatencyBars.tsx",
      why: "an empty state naming the measurement boundary and refusing to read it as slowness",
      needle: /a missing observer, not a slow desk/,
    },
    {
      path: MATRIX,
      why: "the two clocks are named with their spans, their windows and their sample floor; "
        + "every clause is a threshold or a boundary",
      needle: /nearest-rank over the rolling 15-minute pool, failures included; shown after 20 samples/,
    },
    { path: "components/systems/mutation-scope.ts",
      why: "'out of reach' is a fourth state, not a shorter 'no': three would fold the unreadable meter in with the six stores a write leaves alone",
      needle: /no control in this instance reaches the vendor's meter/ },
  ];

  for (const { path, why, needle } of REFUSED) {
    it(`${path.split("/").pop()}: ${why}`, () => {
      const source = load(path);
      assert.ok(source.length > 500, `${path} did not load`);
      assert.match(prose(source), needle);
    });
  }
});
