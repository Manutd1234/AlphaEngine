/**
 * The data tab's progressive-disclosure sweep, pinned in both directions.
 *
 * A deletion sweep had already taken what could honestly be deleted — 188 words
 * of the desk, and then it stopped, because what remained was load-bearing. The
 * remaining lever is not deletion but disclosure: a scope caveat, a methodology
 * note or a chart-reading rule stays in the DOM word for word and moves behind
 * a `<details>`, so the screen is shorter while the desk still knows everything
 * it knew.
 *
 * That trade has exactly one failure mode, and it is silent: a sweep that
 * DELETED a sentence looks identical to a sweep that folded it, because both
 * make the pane shorter. So every fact this sweep moved is asserted PRESENT
 * here, byte for byte, and separately asserted to be inside a fold. A deletion
 * fails the first assertion; a fold that never happened fails the second.
 *
 * The other direction matters more. Four kinds of sentence may never be folded
 * on this desk, because hiding them changes what a reader believes:
 *
 *   1. An EMPTY STATE. "Nothing has been submitted" behind a fold is a panel
 *      that looks broken, and a reader must never open a disclosure to learn
 *      that nothing was captured.
 *   2. A NULL EXPLANATION that is the panel's only content — fold it and a
 *      heading sits over a blank card.
 *   3. The reason a control the reader can SEE is dimmed. A fold is the same
 *      dead end as a tooltip: unreachable by touch, and invisible to anyone who
 *      never thinks to look.
 *   4. A figure a reader acts on.
 *
 * Each is listed below by its exact wording and asserted to be outside every
 * `<details>` in its file. That list is the honesty floor, not a style
 * preference, so it is spelled out rather than inferred — and a second, looser
 * assertion states the same rule as a property, for the pane nobody has written
 * yet.
 *
 * Every assertion reads the real file from disk, and every file is checked
 * non-empty before it is scanned: a `doesNotMatch` over an empty string passes
 * and proves nothing, which is how a source-scanning suite goes quietly vacuous.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Every file this sweep owns. */
const OWNED = [
  "components/DataConsole.tsx",
  ...readdirSync(join(root, "components/data"))
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => `components/data/${entry}`),
];

const sources = new Map<string, string>();
for (const relative of OWNED) sources.set(relative, readFileSync(join(root, relative), "utf8"));

/** JSX wraps prose at the margin, so every comparison is whitespace-flattened. */
const flat = (text: string) => text.replace(/\s+/g, " ");

const source = (relative: string) => {
  const text = sources.get(relative);
  assert.ok(text, `${relative} is not in the owned set`);
  return flat(text!);
};

/** Each `<details>` in a file, flattened. These panes nest none. */
const folds = (relative: string) =>
  [...source(relative).matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/g)].map((match) => match[1]);

/** What each `<details>` HIDES: everything after its own `</summary>`. */
const hidden = (relative: string) =>
  folds(relative).map((fold) => fold.replace(/^[\s\S]*?<\/summary>/, ""));

const summaryOf = (fold: string) => fold.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "";

describe("the files this sweep reads are really there", () => {
  // The anti-vacuity guard. Every assertion below is a substring test over
  // these strings; an empty or renamed file would make the negative ones pass
  // by scanning nothing, and the positive ones fail with a confusing message.
  it("loads every owned file, non-empty", () => {
    assert.ok(OWNED.length >= 15, `expected the data tab's component set, found ${OWNED.length}`);
    for (const relative of OWNED) {
      assert.ok(
        (sources.get(relative)?.length ?? 0) > 500,
        `${relative} read as empty or near-empty, so scanning it proves nothing`,
      );
    }
  });
});

/**
 * The sweep's ledger: what moved, and out of which file.
 *
 * Written as the exact source substring — entities and `<strong>` included — so
 * that a reword is a failure rather than a silent loss. Every entry is checked
 * twice: present in the file at all, and present inside a fold.
 */
const MOVED: Array<[relative: string, sentence: string]> = [
  ["components/data/TrustCompositionPane.tsx",
    "Green means <strong>no fatal finding</strong>; warnings and drift may remain. The ring counts payloads, the bar findings, and one payload can carry several."],
  ["components/data/SupplyPosture.tsx",
    "Each bar groups a chain&rsquo;s nodes by state, <strong>not</strong> by rank; which provider answers first lives in Providers."],
  ["components/data/ReplayBackfillPanel.tsx",
    "the queue&apos;s in-process memory since the gateway started; the audit log keeps status rows."],
  ["components/data/DataQualityLedger.tsx",
    "a fatal burst or a fail rate over threshold, per provider; auto-resolved when it clears."],
  ["components/data/QuotaHeadroom.tsx",
    "Each bar is a share of its own window; the absolute count sits beside it."],
  ["components/data/QuotaHeadroom.tsx",
    "The window countdown and per-call ledger live in Providers."],
  ["components/data/FeedsContractsPane.tsx",
    "Aggregate counts reset with the function instance and are not tied to {symbol}."],
  ["components/data/FeedsFreshnessPane.tsx",
    "Ages belong to each venue and symbol; fetching does not make an old feed fresh."],
];

describe("a disclosure moves a fact; it never spends one", () => {
  for (const [relative, sentence] of MOVED) {
    const file = relative.split("/").pop();

    it(`${file} still says "${sentence.slice(0, 34)}…"`, () => {
      assert.ok(
        source(relative).includes(sentence),
        `a sentence this sweep claimed to FOLD is gone from ${relative}. Folding keeps the `
          + "words; deleting them is a different change and needs a different argument.",
      );
    });

    it(`${file} keeps "${sentence.slice(0, 34)}…" off the screen at rest`, () => {
      assert.ok(
        hidden(relative).some((body) => body.includes(sentence)),
        `"${sentence.slice(0, 60)}…" is still on screen at rest in ${relative}`,
      );
    });
  }
});

/**
 * The honesty floor: prose that may never move behind a fold.
 *
 * Every entry carries the reason it is here, because the next reader will be
 * looking at a long pane and these are the sentences that look most like slack.
 */
const MUST_STAY: Array<[relative: string, sentence: string, why: string]> = [
  ["components/data/DataQualityLedger.tsx",
    "The gateway did not return its quality ledger, so the counts here are this instance's own window and say nothing about other instances or earlier hours.",
    "when `ledger` is null this is the card's ONLY content — folded, a heading sits over nothing"],
  ["components/data/DataQualityLedger.tsx",
    "Take is disabled: it needs the operator credential. Enter the operator token in Reliability → Remediation, or /ack from Telegram.",
    "the reason a control the reader can SEE is dimmed, and it names the escape hatch that works"],
  ["components/data/DataQualityLedger.tsx",
    "Take is disabled: operator actions are switched off on this deployment; /ack from Telegram still works.",
    "the same refusal on a locked deployment"],
  ["components/data/DataQualityLedger.tsx",
    "a fail rate is a dash until something was evaluated.",
    "the null explanation for the em dash in the Fail rate column directly beneath; hidden, that dash reads as a broken cell"],
  ["components/data/DataQualityLedger.tsx",
    "An empty list means the rules did not fire, not that every payload was clean.",
    "half of an empty state — methodology may collapse, the absence of evidence may not"],
  ["components/data/FeedsContractsPane.tsx",
    "Serverless routes do not reliably share module memory. An empty aggregate is not evidence that every payload passed.",
    "the pane's empty state, and the hardest claim on the surface"],
  ["components/data/FeedsContractsPane.tsx",
    "<strong>No aggregate in the health-route instance.</strong>",
    "the empty state's headline"],
  ["components/data/FeedsFreshnessPane.tsx",
    "<strong>No gateway feed evidence.</strong>",
    "empty state"],
  ["components/data/FeedsFreshnessPane.tsx",
    "The registry may still answer requests, but it cannot prove feed freshness.",
    "empty state: what the absence does and does not prove"],
  ["components/data/ReplayBackfillPanel.tsx",
    "No replay or backfill job has been submitted since the gateway started.",
    "empty state"],
  ["components/data/ReplayBackfillPanel.tsx",
    "Nothing here says the queue is empty.",
    "a read failure is not an empty queue, and this is the sentence that says so"],
  ["components/data/QuotaHeadroom.tsx",
    "No provider in this environment keeps a local quota ledger, so there is no headroom to report.",
    "empty state for the bars"],
  ["components/data/QuotaHeadroom.tsx",
    "at or past the reserve, so background refreshes there are refused while interactive lookups still work",
    "a figure a reader acts on: background polling is already being refused"],
  ["components/data/QuotaHeadroom.tsx",
    "Their absence from the chart is not headroom.",
    "names the chart's excluded half — unnamed, those providers look like ones this deployment lacks"],
  ["components/data/TrustCompositionPane.tsx",
    "Nothing evaluated in this function instance. Zero evidence is not a clean bill of health.",
    "empty state, and the exact misreading this tab exists to prevent"],
  ["components/data/TrustCompositionPane.tsx",
    "No finding in this window.",
    "empty state"],
  ["components/data/TrustCompositionPane.tsx",
    "No provider payload evaluated on this instance.",
    "empty state"],
  ["components/data/SupplyPosture.tsx",
    "No provider registry in this snapshot, so nothing can be said about supply.",
    "empty state"],
  ["components/data/SupplyPosture.tsx",
    "No failover chain is exposed in this snapshot.",
    "empty state"],
  ["components/data/SupplyPosture.tsx",
    "no routable node at all.",
    "a figure a reader acts on: chains that cannot be served at all"],
];

describe("an empty state, a null explanation and a refusal stay on screen", () => {
  for (const [relative, sentence, why] of MUST_STAY) {
    const needle = flat(sentence);
    it(`${relative.split("/").pop()}: "${needle.slice(0, 34)}…"`, () => {
      assert.ok(
        source(relative).includes(needle),
        `${relative} lost a sentence the honesty floor names: ${why}`,
      );
      for (const body of hidden(relative)) {
        assert.ok(!body.includes(needle), `${relative} folded what must stay visible — ${why}`);
      }
    });
  }

  it("no fold on this tab hides a phrase that marks an absence", () => {
    // The list above is by sentence, which a reword slips past. This is the
    // same rule stated as a property: the vocabulary of "we captured nothing"
    // and "an absence is not a pass" may not appear inside a fold anywhere on
    // the tab, whoever writes the next pane.
    const MARKERS = [
      /is not evidence/i,
      /not that every/i,
      /nothing here says/i,
      /zero evidence/i,
      /is a dash until/i,
      /is not headroom/i,
      /no .{0,30}has been submitted/i,
      /clean bill of health/i,
      /\bis disabled\b/i,
    ];
    const offenders: string[] = [];
    for (const relative of OWNED) {
      for (const body of hidden(relative)) {
        for (const marker of MARKERS) {
          if (marker.test(body)) offenders.push(`${relative}: ${marker} inside a <details>`);
        }
      }
    }
    assert.deepEqual(offenders, [],
      `a disclosure on the data tab hides an absence:\n    ${offenders.join("\n    ")}`);
  });
});

describe("every fold on this tab is a real bargain", () => {
  it("finds the folds it is meant to be checking", () => {
    // Without this the assertions below pass on a tab with no disclosures at
    // all, which is the state this sweep started from.
    const total = OWNED.reduce((sum, relative) => sum + folds(relative).length, 0);
    assert.ok(total >= 9, `expected the data tab's disclosures, found ${total}`);
  });

  it("has a non-empty summary and a non-empty body", () => {
    for (const relative of OWNED) {
      for (const fold of folds(relative)) {
        const summary = summaryOf(fold);
        assert.ok(
          summary.replace(/<[^>]+>/g, "").trim().length >= 10,
          `a <details> in ${relative} opens onto nothing named: "${summary}"`,
        );
        const body = fold.replace(/^[\s\S]*?<\/summary>/, "").replace(/<[^>]+>/g, " ").trim();
        assert.ok(
          body.length >= 20,
          `a <details> in ${relative} hides nothing — an empty fold costs a click and pays nothing`,
        );
      }
    }
  });

  it("no summary answers the question it is charging a click for", () => {
    // The invariant `copy-audit.test.ts` holds over the whole tree, run here
    // over the data tab alone so this sweep fails in its own file rather than
    // in a suite about something else. A summary NAMES the question; the body
    // answers it. Four contiguous shared words means the reader pays twice.
    const phrases = (text: string, n = 4) => {
      const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
      return new Set(
        Array.from({ length: Math.max(0, words.length - n + 1) },
          (_, i) => words.slice(i, i + n).join(" ")),
      );
    };
    const offenders: string[] = [];
    for (const relative of OWNED) {
      for (const match of source(relative).matchAll(/<summary>([^<]{10,})<\/summary>([\s\S]{0,400})/g)) {
        const summary = match[1].replace(/\s+/g, " ").trim();
        if (summary.includes("{")) continue;
        const body = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);
        const bodyPhrases = phrases(body);
        const repeated = [...phrases(summary)].filter((phrase) => bodyPhrases.has(phrase));
        if (repeated.length) offenders.push(`${relative}: "${summary}" repeats "${repeated[0]}"`);
      }
    }
    assert.deepEqual(offenders, [],
      `these summaries state the answer they are hiding:\n    ${offenders.join("\n    ")}`);
  });

  it("every summary asks or names, so the doubt stays on screen", () => {
    // Local to this sweep, not a house rule elsewhere. Everything folded here
    // is a caveat or a reading rule, and the risk each carries is that a reader
    // never opens it. A summary phrased as a question leaves the DOUBT on
    // screen even when the answer is not. The two folds that predate this
    // sweep name their subject instead, which is the older half of the rule.
    for (const relative of OWNED) {
      for (const fold of folds(relative)) {
        const summary = summaryOf(fold);
        const text = summary.replace(/<[^>]+>/g, "").trim();
        if (!text || summary.includes("{")) continue;
        if (/\?$/.test(text)) continue;
        assert.ok(
          /^(Why|What|How|The|A )/.test(text),
          `a <summary> in ${relative} neither asks nor names: "${text}"`,
        );
      }
    }
  });
});

describe("the house rules this sweep could break", () => {
  it("adds no middle dot and no emoji to a summary", () => {
    for (const relative of OWNED) {
      for (const fold of folds(relative)) {
        const summary = summaryOf(fold);
        assert.ok(!summary.includes("·"), `a <summary> in ${relative} carries the middle dot`);
        assert.ok(
          !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(summary),
          `a <summary> in ${relative} carries an emoji`,
        );
      }
    }
  });

  it("uses the tree's one disclosure class, not a second pattern", () => {
    for (const relative of OWNED) {
      for (const match of source(relative).matchAll(/<details\b([^>]*)>/g)) {
        assert.match(
          match[1],
          /className="disclosure"/,
          `${relative} opens a <details> outside the shared .disclosure grammar: <details${match[1]}>`,
        );
      }
    }
  });
});
