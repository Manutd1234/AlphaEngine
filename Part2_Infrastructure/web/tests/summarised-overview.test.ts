/**
 * The Overview tab's summarisation pass, and the facts it was not allowed to lose.
 *
 * This is the third sweep over the same words and it is a different operation
 * from the first two. Sweep one DELETED sentences that restated a neighbour.
 * Sweep two FOLDED caveats behind `<details>`, byte for byte. This one
 * REWRITES: the same fact, in fewer words — which is the only one of the three
 * that can lose a fact while every line still looks present in the diff.
 *
 * `8d091a3` ("Cut 610 words from the frontend, then put 16 facts back") is the
 * commit this file exists because of: four of six areas swept in that pass
 * failed a fact-loss verifier, and the three worst losses were the same shape —
 * a shortened sentence that reads fluently and no longer carries a number, a
 * negation or the reason a measurement is missing.
 *
 * So each rewrite below is pinned three ways:
 *
 *   1. The new wording is present.
 *   2. The OLD wording is gone — otherwise a test that only checks the new
 *      text passes on a file where nothing happened, or where the rewrite was
 *      pasted in beside the sentence it was meant to replace.
 *   3. Every fact token the original carried is still somewhere in the file:
 *      the numbers, the units, the named entities, the negations and the
 *      qualifiers, enumerated one by one before the rewrite was written.
 *
 * The second block is wider than the rewrites. It is the tab's whole fact
 * inventory — every threshold, every null explanation with its reason, every
 * "not"/"no"/"cannot"/"only" that carries the meaning of the line it sits in.
 * A rewrite three cards away is not allowed to take one of these with it.
 *
 * The third block measures. It counts the visible prose the way the report
 * counts it, and ratchets: this tab's rendered words may go down and may not
 * go back up. The count is deliberately NOT the only thing watching, for the
 * reason `copy-audit.test.ts` opens with — a word count improves whether a
 * sentence was tightened or amputated.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { perWorkspaceTableWords, routingReasons } from "./helpers/next-step-prose";
import { fileURLToPath } from "node:url";

import { proseNodes, wordsIn } from "./helpers/overview-visible-prose";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const OWNED = [
  "components/WorkspaceOverview.tsx",
  "components/overview/AuditTrail.tsx",
  "components/overview/DecisionLoopPipeline.tsx",
  "components/overview/KpiDeck.tsx",
  "components/overview/RoleCards.tsx",
  "components/overview/Sparkline.tsx",
  "components/common/NextStepFooter.tsx",
  "components/Heatmap.tsx",
] as const;

type Owned = (typeof OWNED)[number];

/** An anchor per file, so "it loaded" means more than "it was not zero bytes". */
const ANCHOR: Record<Owned, string> = {
  "components/WorkspaceOverview.tsx": "export default function WorkspaceOverview",
  "components/overview/AuditTrail.tsx": "export default function AuditTrail",
  "components/overview/DecisionLoopPipeline.tsx": "export default function DecisionLoopPipeline",
  "components/overview/KpiDeck.tsx": "export default function KpiDeck",
  "components/overview/RoleCards.tsx": "export default function RoleCards",
  "components/overview/Sparkline.tsx": "export default function Sparkline",
  "components/common/NextStepFooter.tsx": "export default function NextStepFooter",
  "components/Heatmap.tsx": "export default function Heatmap",
};

const SOURCE = new Map<string, string>(OWNED.map((path) => [path, read(`../${path}`)]));
const src = (path: Owned): string => SOURCE.get(path)!;

// ---------------------------------------------------------------------------
// 0. The scan has something to scan
// ---------------------------------------------------------------------------

describe("the Overview sources were read before anything is asserted about them", () => {
  for (const path of OWNED) {
    it(`${path} loaded with its component in it`, () => {
      const source = src(path);
      // Every negative assertion below — "the old wording is gone" — is
      // satisfied by the empty string, which is why this runs first.
      assert.ok(source.length > 400, `${path} loaded ${source.length} bytes`);
      assert.ok(source.includes(ANCHOR[path]), `${path} lost ${ANCHOR[path]}`);
    });
  }
});

// ---------------------------------------------------------------------------
// 1. The rewrites, and the facts each one had to keep
// ---------------------------------------------------------------------------

interface Rewrite {
  file: Owned;
  /** What the reader used to see. Must be gone, or nothing was rewritten. */
  was: string;
  /** What the reader sees now, as the file spells it. */
  now: string;
  /** The assertable tokens the original carried, enumerated before rewriting. */
  facts: string[];
}

const REWRITES: Rewrite[] = [
  {
    // "Equity through the session, ending at $1,204,880" — the hero sparkline's
    // accessible name. The chart is a curve, so saying so costs nothing and
    // replaces four words of scaffolding.
    file: "components/WorkspaceOverview.tsx",
    was: "Equity through the session",
    now: "Session equity curve, ending at ${usd(equitySpark[equitySpark.length - 1], 0)}",
    facts: ["Session", "equity curve", "ending at", "usd(equitySpark[equitySpark.length - 1], 0)"],
  },
  {
    // The deck's candidate sparkline. "of the current" was four words holding
    // one possessive.
    file: "components/overview/KpiDeck.tsx",
    was: "Equity curve of the current candidate",
    now: "Current candidate's equity curve, ending at ${fmt(equitySpark[equitySpark.length - 1], 2)}×",
    facts: [
      "Current candidate's",
      "equity curve",
      "ending at",
      "fmt(equitySpark[equitySpark.length - 1], 2)",
      "×",
    ],
  },
  {
    // The heatmap legend's hint, in both modes. "for its parameters" is the
    // same instruction as "to inspect those parameters" and matches the hover
    // line already under the grid ("Hover a cell for its metrics.").
    file: "components/Heatmap.tsx",
    was: "to inspect those parameters",
    now: "beige = no edge; click a cell for its parameters",
    facts: ["beige = no edge", "click a cell", "parameters"],
  },
  {
    file: "components/common/NextStepFooter.tsx",
    was: "Provider quotas, contract evidence, the pipeline DAG.",
    now: "Provider quotas, contract evidence, pipeline DAG.",
    facts: ["Provider quotas", "contract evidence", "pipeline DAG"],
  },
  {
    file: "components/common/NextStepFooter.tsx",
    was: "Deployment topology, OpenAPI diffs, the task queue.",
    now: "Deployment topology, OpenAPI diffs, task queue.",
    facts: ["Deployment topology", "OpenAPI diffs", "task queue"],
  },
  {
    file: "components/common/NextStepFooter.tsx",
    was: "Equity, the decision pipeline, the audit trail.",
    now: "Equity, decision pipeline, audit trail.",
    facts: ["Equity", "decision pipeline", "audit trail"],
  },
  {
    // The hero thesis: three nouns and eleven words of scaffolding that
    // claimed scope instead of stating it. "trade" is asserted capitalised
    // because it moved into the sentence-initial slot "Your" vacated.
    file: "components/WorkspaceOverview.tsx",
    was: "Your one-stop infrastructure that can solve all needs from trade execution, debugging and research.",
    now: "Trade execution, debugging and research on one desk.",
    facts: ["Trade execution", "debugging and research"],
  },
  {
    // Both the sr-only table caption and the row-count line under it.
    file: "components/overview/AuditTrail.tsx",
    was: "most recent",
    now: "Order audit rows, newest first.",
    facts: ["Order audit rows", "newest first", "newest rows", "state.rows.length"],
  },
];

describe("a rewritten line still carries every fact it carried", () => {
  for (const rewrite of REWRITES) {
    it(`${rewrite.file}: "${rewrite.now.slice(0, 44)}" replaced its longer form`, () => {
      const source = src(rewrite.file);
      assert.ok(
        source.includes(rewrite.now),
        `the rewritten line is not in the file: ${rewrite.now}`,
      );
      assert.ok(
        !source.includes(rewrite.was),
        `the old wording is still there, so this is an addition and not a rewrite: ${rewrite.was}`,
      );
    });

    for (const fact of rewrite.facts) {
      it(`${rewrite.file}: the rewrite kept "${fact}"`, () => {
        assert.ok(
          src(rewrite.file).includes(fact),
          `a rewrite dropped a fact the original stated: ${fact}`,
        );
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. The tab's fact inventory, which no rewrite anywhere may nick
// ---------------------------------------------------------------------------

/**
 * Numbers, units, thresholds, named entities, negations and qualifiers.
 *
 * `disclosure-overview.test.ts` already pins most of these as whole sentences,
 * because sweep two was forbidden to delete them. This list is the other half
 * of the guarantee and the half a REWRITE can break: the sentence may survive
 * and quietly lose its "not", its "20" or the reason it gives for a dash.
 */
const FACTS: { file: Owned; token: string; why: string }[] = [
  // ---- numbers, units and thresholds ----
  { file: "components/WorkspaceOverview.tsx", token: "fewer than 20 polls measured", why: "the p99 sample floor, and the reason for the dash above it" },
  { file: "components/WorkspaceOverview.tsx", token: "(latency.n ?? 0) >= 20", why: "the threshold the copy states, in the code that enforces it" },
  { file: "components/WorkspaceOverview.tsx", token: "VaR 95, 1 day", why: "the confidence level and the horizon; VaR without either is not a figure" },
  { file: "components/WorkspaceOverview.tsx", token: "Data plane p99", why: "which percentile, not just latency" },
  { file: "components/overview/KpiDeck.tsx", token: "needs ~${fmt(trl.years, 1)} y of history", why: "how much history is missing, in years, not merely that some is" },
  { file: "components/overview/KpiDeck.tsx", token: "Upstream p99 latency", why: "whose latency, and which percentile" },
  { file: "components/overview/KpiDeck.tsx", token: "milliseconds", why: "the unit, spelled out because a screen reader says it" },
  { file: "components/overview/RoleCards.tsx", token: "${c.slippageBps} bps modelled cost budget", why: "the unit, and that this is a budget rather than a realised cost" },
  { file: "components/common/NextStepFooter.tsx", token: "L2 depth", why: "which book depth the trader is being sent to" },
  { file: "components/overview/AuditTrail.tsx", token: "limit=40", why: "the audit window the row count is drawn from" },

  // ---- negations and qualifiers ----
  { file: "components/overview/AuditTrail.tsx", token: "No rows are substituted.", why: "an unreadable live ledger is not padded with generated orders" },
  { file: "components/overview/AuditTrail.tsx", token: "paper-only", why: "the scope bound on both provenance lines" },
  { file: "components/overview/AuditTrail.tsx", token: "accepted or refused", why: "both outcomes, not just the fills" },
  { file: "components/overview/AuditTrail.tsx", token: "No orders in the audit window yet", why: "the empty state, reported rather than hidden" },
  { file: "components/overview/KpiDeck.tsx", token: "no finite record proves this edge", why: "null explanation for a Not available out-of-sample figure" },
  { file: "components/overview/KpiDeck.tsx", token: "no completed run", why: "empty state" },
  { file: "components/overview/KpiDeck.tsx", token: "no lookups yet", why: "a missing cache hit rate, never a zero one" },
  { file: "components/overview/KpiDeck.tsx", token: "no limit engaged yet", why: "empty state for the binding constraint" },
  { file: "components/overview/KpiDeck.tsx", token: "; sandbox", why: "the order intent is against a sandbox book" },
  { file: "components/overview/KpiDeck.tsx", token: "rerun required", why: "the stale result is not merely old, it is not to be acted on" },
  { file: "components/WorkspaceOverview.tsx", token: "Context changed; rerun required", why: "same claim on the role card" },
  { file: "components/Heatmap.tsx", token: "cannot judge", why: "a grid-edge cell is unjudgeable, not merely unremarkable" },
  { file: "components/Heatmap.tsx", token: "no edge", why: "grey is zero Sharpe, and the legend says so in words as well as colour" },
  { file: "components/Heatmap.tsx", token: '"n/a"', why: "retention with no neighbours is missing, not zero" },

  // ---- the reason a measurement is missing ----
  { file: "components/WorkspaceOverview.tsx", token: "needs price history", why: "why the VaR tile shows a dash" },
  { file: "components/WorkspaceOverview.tsx", token: "book connecting", why: "why Equity and Day P&L show a dash" },
  { file: "components/overview/KpiDeck.tsx", token: "needs price history", why: "why Loss beyond VaR shows a dash" },
  { file: "components/overview/KpiDeck.tsx", token: "book connecting", why: "why Gross exposure and Book concentration show a dash" },
  { file: "components/overview/KpiDeck.tsx", token: "checking data plane", why: "why the Data plane card has no figure yet" },
  { file: "components/overview/KpiDeck.tsx", token: "unreachable — snapshot from", why: "the figure is stale and the line says when it was read" },

  // ---- provenance a reader acts on ----
  { file: "components/WorkspaceOverview.tsx", token: "backtested in this browser", why: "the VaR is not a gateway number" },
  { file: "components/WorkspaceOverview.tsx", token: "measured from this browser's polls", why: "the p99 is not a fleet measurement" },
  { file: "components/WorkspaceOverview.tsx", token: "gateway snapshot", why: "where the equity figure came from" },
  { file: "components/overview/AuditTrail.tsx", token: "recorded by the gateway itself", why: "the live ledger's provenance" },
  { file: "components/overview/KpiDeck.tsx", token: "modelled cost", why: "the order intent cost is modelled, not quoted" },

  // ---- named entities a shortened line would swallow ----
  { file: "components/overview/RoleCards.tsx", token: "Exposure, concentration and sleeve attribution", why: "three destinations, not a summary of them" },
  { file: "components/overview/RoleCards.tsx", token: "VaR scored against historical limits and kill switch", why: "the limits and the switch are separate surfaces" },
  { file: "components/overview/RoleCards.tsx", token: "Feed freshness, source agreement and payload lineage", why: "three separate data-desk questions" },
  { file: "components/overview/RoleCards.tsx", token: "Circuit breakers, latency percentiles & incident triage", why: "three separate reliability surfaces" },
  { file: "components/overview/RoleCards.tsx", token: "OpenAPI contract diffs, CI pipeline and launch gates", why: "three separate developer surfaces" },
  { file: "components/Heatmap.tsx", token: "neighbours retain", why: "the stability tooltip's own measurement" },
  { file: "components/Heatmap.tsx", token: "Sharpe ratio across", why: "the grid's accessible name states the quantity in full" },
];

describe("no rewrite took a number, a unit, a negation or a reason with it", () => {
  for (const { file, token, why } of FACTS) {
    it(`${file}: "${token.slice(0, 46)}" — ${why}`, () => {
      assert.ok(src(file).includes(token), `a fact this tab stated is gone: ${token}`);
    });
  }
});

/**
 * The hero thesis, shortened on the record.
 *
 * This block was "the hero thesis was refused, not quietly reworded", holding
 * fourteen words because they were the user's own. That argument is spent: the
 * user pointed at this line wrapping onto a second row and asked for one row.
 *
 * Written down rather than done quietly, because the failure `8d091a3` records
 * is a verifier loosened to fit a sweep and this must be distinguishable from
 * that. The pin did not weaken, it MOVED: the REWRITES entry above holds the
 * new line to the same three-way proof and `disclosure-overview.test.ts` carries
 * it in both lists. What is new is a ceiling on the line's LENGTH — the property
 * the user asked for, which no assertion on the old wording expressed.
 */
describe("the hero thesis fits the row it is given", () => {
  const hero = "Trade execution, debugging and research on one desk.";

  it("is the description PageHead is handed, and holds one row", () => {
    // The `description={<>…</>}` shape is asserted, not just the sentence:
    // copy-audit.test.ts reads the tab's thesis through that exact wrapper, and
    // a description moved to any other form leaves that suite reading nothing.
    assert.ok(
      src("components/WorkspaceOverview.tsx").includes(`description={<>${hero}</>}`),
      "the hero thesis is not the description PageHead is handed",
    );
    // `.page-heading__copy` is `flex: 1 1 340px` beside the CTA, so on a 1440px
    // desk the copy measures ~880px; the description sets at --fs-xl, which the
    // large preset takes to ~18.8px — about 95 characters before it wraps, and
    // fewer as the band narrows. 60 keeps margin at every rung; 101 cleared none.
    assert.ok(hero.length <= 60, `the hero thesis is ${hero.length} characters and will wrap again`);
  });

  it("and the headline above it stands in the words the user chose", () => {
    assert.ok(
      src("components/WorkspaceOverview.tsx").includes("From market signal to governed decision."),
      "the h1 is the desk's tagline and the user's explicit choice",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. The measurement, and the ratchet on it
// ---------------------------------------------------------------------------

/**
 * The keyed next-step reasons, which the ceiling below deliberately does NOT
 * count.
 *
 * `NEXT_FROM` is a lookup keyed on `view/section`, and the footer renders
 * exactly one entry: the one for the location the reader is standing on. A
 * `risk/*` reason therefore cannot put a word on the Overview tab, and neither
 * can twenty of the other twenty-five. The scanner's own rule — "every
 * occurrence counts, because three cards each rendering `book connecting` are
 * three lines a reader can meet" — is right for a card that renders three times
 * and wrong for a map that renders one value of twenty-six.
 *
 * It was wrong quietly until splitting the Risk rail's "VaR & model" into "Risk
 * engine" and "Risk diagram" added one routing entry and moved this tab's
 * measured word count by nine, with nothing on this tab changed. Pulling the
 * table out makes the number below SMALLER and the ceiling on it STRICTER; the
 * reasons are not left unwatched, they are watched by the rule that fits them,
 * two blocks down. `FLOW_MAP`'s ring prose is subtracted for the same reason,
 * found the same way: the ninth tab moved this count thirteen words with
 * nothing on this tab changed. */
const reasons = routingReasons();
const tableWords = perWorkspaceTableWords(wordsIn); // both per-workspace tables

/** 722 before this sweep, 711 after, 572 once the `why:` table was measured
 *  apart, 427 once the role ring was too. It may fall; it may not rise. */
const WORD_CEILING = 427;

describe("the Overview tab's visible prose only gets shorter", () => {
  const nodes = OWNED.flatMap((path) => proseNodes(src(path)));
  const total = nodes.reduce((sum, node) => sum + wordsIn(node).length, 0) - tableWords;

  it("the scanner found this tab's prose, so the count below means something", () => {
    // A scanner that silently stopped matching would report zero words and
    // sail under every ceiling in this block.
    assert.ok(nodes.length >= 150, `only ${nodes.length} prose nodes found`);
    assert.ok(
      nodes.includes("Every paper order, accepted or refused, with the refusing gate."),
      "the scanner no longer sees a sentence this tab definitely renders",
    );
    assert.ok(
      nodes.includes("no finite record proves this edge"),
      "the scanner no longer sees a null explanation this tab definitely renders",
    );
  });

  it("counts no import path, class string or CSS value as prose", () => {
    for (const node of nodes) {
      assert.ok(!node.includes("@/"), `an import path was counted as prose: ${node}`);
      assert.ok(!node.includes("var(--"), `a CSS value was counted as prose: ${node}`);
      assert.ok(!/\bimport\b|\bconst\b|=>/.test(node), `code was counted as prose: ${node}`);
    }
  });

  it(`renders ${WORD_CEILING} visible words or fewer`, () => {
    assert.ok(
      total <= WORD_CEILING,
      `the tab grew back to ${total} visible words, over the ${WORD_CEILING} this sweep left it at`,
    );
    // The floor is the other half of the ratchet: a sweep that got the count
    // down by deleting a paragraph would pass the ceiling and fail here, and
    // the fact blocks above would fail first. 520 → 375 when the role ring was
    // subtracted: the same margin against a smaller basis, not a loosening.
    assert.ok(total >= 375, `the tab is down to ${total} visible words — what was deleted?`);
  });

  it("a next step gives its reason in a line, not a paragraph", () => {
    // The ratchet that replaces counting these as Overview prose, and a tighter
    // one: it holds per reason rather than in aggregate, so a section added
    // later earns its words instead of spending slack another entry left. The
    // floor stops the scanner passing by matching nothing.
    assert.ok(reasons.length >= 26,
      `only ${reasons.length} keyed next steps found — the scanner stopped matching`);
    assert.ok(
      reasons.reduce((sum, why) => sum + wordsIn(why).length, 0) <= reasons.length * 6,
      `the ${reasons.length} routing reasons average over six words: the `
      + "footer's hint line is one clause saying why the destination follows what was just read",
    );
  });
});
