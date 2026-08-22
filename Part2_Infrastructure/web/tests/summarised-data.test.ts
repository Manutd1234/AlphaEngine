/**
 * The Data tab's summarisation pass, pinned fact by fact.
 *
 * Two sweeps came before this one. The first DELETED what was redundant and
 * stopped at 188 words, because what remained was load-bearing. The second
 * FOLDED prose behind `<details>` byte-identically, so the screen shortened
 * while the DOM kept every word. This one is neither: it says the same fact in
 * fewer words.
 *
 * That is the most dangerous of the three, and this repository has the receipt.
 * Commit `8d091a3` is titled "Cut 610 words from the frontend, then put 16
 * facts back" — a summarisation pass that read fluently, lost sixteen assertable
 * facts, and had to restore them after a verifier caught four areas failing.
 *
 * So a rewrite is not pinned by its prose. It is pinned by its FACTS: the
 * numbers, units, thresholds, named entities, negations and qualifiers the
 * original asserted. Each entry below carries
 *
 *   before  — the exact source text as it stood, asserted GONE
 *   after   — the exact source text as it stands now, asserted PRESENT
 *   facts   — every assertable token the sentence carried, each asserted to
 *             survive somewhere in the file
 *
 * and the word count is asserted to have actually fallen, so an "edit" that
 * reworded without shortening fails rather than counting as a win.
 *
 * The negations and qualifiers are the load-bearing half and are listed as
 * facts in their own right. "Nothing is shown rather than a figure built on an
 * assumed correlation" becomes a different claim when "rather than" goes, and
 * "usually" shortened to nothing is a lie. A rewrite that reads better and
 * drops one of those has done the thing `8d091a3` had to undo.
 *
 * Anti-vacuity: every file is read from disk and asserted non-empty BEFORE any
 * negative assertion runs. A `doesNotMatch` — or an `includes` inverted — over
 * an empty string passes and proves nothing, and that trap has been found
 * repeatedly in this tree.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Every file this sweep owns — the same set `disclosure-data.test.ts` reads. */
const OWNED = [
  "components/DataConsole.tsx",
  ...readdirSync(join(root, "components/data"))
    .filter((entry) => entry.endsWith(".tsx") || entry.endsWith(".ts"))
    .map((entry) => `components/data/${entry}`),
];

const sources = new Map<string, string>();
for (const relative of OWNED) sources.set(relative, readFileSync(join(root, relative), "utf8"));

/** JSX wraps prose at the margin, so every comparison is whitespace-flattened. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const source = (relative: string) => {
  const text = sources.get(relative);
  assert.ok(text, `${relative} is not in the owned set`);
  return flat(text!);
};

/** A word: a run carrying at least one letter or digit, placeholders collapsed. */
const words = (text: string) =>
  text
    .replace(/&[a-z]+;/g, "X")
    .replace(/\$\{[^}]*\}/g, "N")
    .replace(/<[^>]+>/g, " ")
    .match(/[A-Za-z0-9’'&%/.-]+/g)
    ?.filter((word) => /[A-Za-z0-9]/.test(word)) ?? [];

describe("the files this sweep rewrites are really there", () => {
  it("loads every owned file, non-empty, before anything is asserted absent", () => {
    assert.ok(OWNED.length >= 15, `expected the data tab's component set, found ${OWNED.length}`);
    for (const relative of OWNED) {
      assert.ok(
        (sources.get(relative)?.length ?? 0) > 500,
        `${relative} read as empty or near-empty, so scanning it proves nothing`,
      );
    }
  });
});

interface Rewrite {
  file: string;
  what: string;
  before: string;
  after: string;
  /** Every assertable token the ORIGINAL carried. Each must survive. */
  facts: string[];
}

const REWRITES: Rewrite[] = [
  {
    file: "components/data/QuotaHeadroom.tsx",
    what: "the quota bars' aria-label",
    before: "ariaLabel=\"Each metered provider's quota window: the share spent, the share free for background polling, and the share reserved for interactive lookups.\"",
    after: "ariaLabel=\"Each metered provider's quota window: the share spent, free for background polling, and reserved for interactive lookups.\"",
    facts: ["Each metered provider's quota window", "share spent", "free for background polling", "reserved for interactive lookups"],
  },
  {
    file: "components/data/QuotaHeadroom.tsx",
    what: "the all-clear when nothing has reached its reserve",
    before: '"No provider has reached its reserve, so background and interactive traffic are both funded."',
    after: '"No provider has reached its reserve; background and interactive traffic are both funded."',
    facts: ["No provider has reached its reserve", "background and interactive traffic are both funded"],
  },
  {
    file: "components/data/QuotaHeadroom.tsx",
    what: "the bar-reading disclosure's summary",
    before: "<summary>How should a bar&rsquo;s length be read, and where is the reset clock?</summary>",
    after: "<summary>How is a bar&rsquo;s length read, and where is the reset clock?</summary>",
    facts: ["length read", "where is the reset clock"],
  },
  {
    file: "components/data/QuotaHeadroom.tsx",
    what: "why the unmetered providers keep no ledger",
    before: "keyless or billed by request weight, not by call count, so no local ledger is kept.",
    after: "keyless or billed by request weight, not call count, so no local ledger is kept.",
    facts: ["keyless", "billed by request weight", "not call count", "no local ledger is kept", "Their absence from the chart is not headroom."],
  },
  {
    file: "components/data/ReplayBackfillPanel.tsx",
    what: "the missing-executor banner",
    before: "Replay and equity backfill run through this workspace&apos;s fetch path, which the gateway cannot reach without <code>WEB_WORKSPACE_URL</code>. Crypto backfill (Binance) still works.",
    after: "Replay and equity backfill use this workspace&apos;s fetch path, which the gateway cannot reach without <code>WEB_WORKSPACE_URL</code>. Crypto backfill (Binance) still works.",
    facts: ["Executor not configured.", "Replay and equity backfill", "this workspace&apos;s fetch path", "the gateway cannot reach without", "WEB_WORKSPACE_URL", "Crypto backfill (Binance) still works."],
  },
  {
    file: "components/data/DataWorkBoard.tsx",
    what: "the queue's loading state",
    before: "<>The persisted queue arrives with the first read from the gateway.</>",
    after: "<>The persisted queue arrives with the first gateway read.</>",
    facts: ["The persisted queue arrives with the first gateway read"],
  },
  {
    file: "components/data/DataWorkBoard.tsx",
    what: "how a gateway-persisted queue versions an edit",
    before: "Every create and status change is versioned in the gateway&apos;s work-item table, and a stale edit is refused rather than overwritten.",
    after: "Every create and status change is versioned in the gateway&apos;s work-item table; a stale edit is refused rather than overwritten.",
    facts: ["Every create and status change", "versioned", "work-item table", "a stale edit is refused rather than overwritten", "This is a queue, not a ticket system."],
  },
  {
    file: "components/DataConsole.tsx",
    what: "why the work queue is read-only on a locked deployment",
    before: '"Operator actions are disabled on this deployment, so the queue is read-only here."',
    after: '"Operator actions are disabled on this deployment, so this queue is read-only."',
    facts: ["Operator actions are disabled on this deployment", "read-only"],
  },
  {
    file: "components/data/DataQualityLedger.tsx",
    what: "the escalation-rule disclosure's summary",
    before: "<summary>What opens one of these, and what closes it again?</summary>",
    after: "<summary>What opens one of these, and what closes it?</summary>",
    facts: ["What opens one of these", "what closes it", "a fatal burst or a fail rate over threshold, per provider; auto-resolved when it clears."],
  },
  {
    file: "components/data/DataQualityLedger.tsx",
    what: "an acknowledgement the gateway had nothing to apply",
    before: '"There was nothing open to take — it has already resolved."',
    after: '"Nothing was open to take — it has already resolved."',
    facts: ["Nothing was open to take", "already resolved"],
  },
  {
    file: "components/data/DataQualityLedger.tsx",
    what: "an acknowledgement made with a credential rather than by a person",
    before: "` Taken at ${utc(e.acknowledged_at)} by an operator credential, which does not name a person.`",
    after: "` Taken at ${utc(e.acknowledged_at)} by an operator credential, which names no person.`",
    facts: ["Taken at ${utc(e.acknowledged_at)}", "operator credential", "names no person"],
  },
  {
    file: "components/data/DataQualityLedger.tsx",
    what: "an acknowledgement taken from this desk this moment",
    before: "` Taken from this desk just now; the ledger catches up on the next poll.`",
    after: "` Taken from this desk just now; the ledger catches up next poll.`",
    facts: ["Taken from this desk just now", "the ledger catches up next poll"],
  },
  {
    file: "components/data/TrustResponsePane.tsx",
    what: "why a withheld p95 still carries a sample count",
    before: "has no aggregate on the wire, so its sample count comes from the window&rsquo;s own buckets.",
    after: "publishes no aggregate, so its sample count comes from the window&rsquo;s own buckets.",
    facts: ["minSamplesPerBucket ?? 3", "drawn as", "a gap, not bridged", "p95 n/a", "the gateway probe is one", "publishes no aggregate", "sample count comes from the window&rsquo;s own buckets"],
  },
  {
    file: "components/data/SupplyPosture.tsx",
    what: "the bar-order disclosure's summary",
    before: "<summary>Does a bar&rsquo;s left-to-right order tell you which node is tried first?</summary>",
    after: "<summary>Does a bar&rsquo;s left-to-right order say which node is tried first?</summary>",
    facts: ["left-to-right order", "which node is tried first", "by rank; which provider answers first lives in Providers."],
  },
  {
    file: "components/data/TrustCompositionPane.tsx",
    what: "the provenance ring's aria-label",
    before: 'ariaLabel="Answers served, by contract-checked against replayed from cache."',
    after: 'ariaLabel="Answers served: contract-checked against replayed from cache."',
    facts: ["Answers served", "contract-checked against replayed from cache"],
  },
  {
    file: "components/data/FeedThroughput.tsx",
    what: "a venue whose every book reports a measured stop",
    before: "emptyNote={`Every ${feed.venue} book reports 0 Hz. That is a measured stop, not a missing measurement.`}",
    after: "emptyNote={`Every ${feed.venue} book reports 0 Hz — a measured stop, not a missing measurement.`}",
    facts: ["Every ${feed.venue} book reports 0 Hz", "a measured stop, not a missing measurement"],
  },
];

describe("a rewrite says the same fact in fewer words", () => {
  it("has rewrites to check at all", () => {
    // Without this the loops below are a no-op that reports success.
    assert.ok(REWRITES.length >= 12, `expected this sweep's rewrites, found ${REWRITES.length}`);
  });

  for (const rewrite of REWRITES) {
    const name = `${rewrite.file.split("/").pop()}: ${rewrite.what}`;

    it(`${name} — landed`, () => {
      assert.ok(
        source(rewrite.file).includes(flat(rewrite.after)),
        `the rewritten text is not in ${rewrite.file}:\n    ${flat(rewrite.after)}`,
      );
    });

    it(`${name} — is actually shorter`, () => {
      const before = words(rewrite.before).length;
      const after = words(rewrite.after).length;
      assert.ok(
        after < before,
        `${rewrite.file}: the "rewrite" is ${after} words against ${before} — a reword, not a cut`,
      );
    });

    it(`${name} — the old wording is gone`, () => {
      // Safe only because the suite above proved the file loaded non-empty.
      assert.ok(
        !source(rewrite.file).includes(flat(rewrite.before)),
        `${rewrite.file} still carries the pre-rewrite wording, so nothing was saved`,
      );
    });

    it(`${name} — every fact it carried survives`, () => {
      for (const fact of rewrite.facts) {
        assert.ok(
          source(rewrite.file).includes(flat(fact)),
          `${rewrite.file} lost a fact the original asserted: "${fact}"\n`
            + "    A shorter sentence that drops a number, a unit, a threshold, a named entity,\n"
            + "    a negation or a qualifier is the failure `8d091a3` had to undo.",
        );
      }
    });
  }
});

/**
 * The refusals.
 *
 * Every sentence here was measured for this pass and deliberately left alone,
 * because the shortest honest form of it is the form it already has. They are
 * pinned so that a later pass which "finishes the job" has to argue with a
 * named reason rather than with a diff.
 */
const REFUSED: Array<[relative: string, sentence: string, why: string]> = [
  ["components/data/TrustResponsePane.tsx",
    "No source has enough calls in the last fifteen minutes to plot; a quiet instance, not a broken one.",
    "every clause is a fact: the window bound, the reason nothing is plotted, and the negation that stops a quiet desk reading as a broken one"],
  ["components/data/FeedThroughput.tsx",
    "The registry can still answer requests, but nothing here proves streaming freshness or update rate. An absent monitor is not a silent tape.",
    "an empty state carrying two measurements it does not prove and one negation; nothing compresses without dropping one"],
  ["components/data/FeedThroughput.tsx",
    "is derived from lifetime counters and assumes every book was subscribed at connect; a venue with reconnects has gaps no counter here measures",
    "the assumption is the whole point of the fold; the only available cut was one function word"],
  ["components/data/SupplyPosture.tsx",
    "Every routable chain has more than one node able to serve it.",
    "\"able to serve it\" is not restated by \"routable\": a chain may hold nodes that cannot serve it, which is the case this sentence excludes"],
  ["components/data/DataQualityLedger.tsx",
    "newest first; every instance and every replay job writes here.",
    "the second \"every\" is a universal over replay jobs, not a repetition of the first; distributing one \"every\" across both weakens it for one word"],
  ["components/data/DataQualityLedger.tsx",
    "The gateway did not answer within the deadline; the ledger is unreachable.",
    "two facts — the deadline expired, and what that means for the ledger — in eleven words"],
  ["components/data/DataWorkBoard.tsx",
    "Nothing here is lost silently, and nothing here is confirmed either.",
    "both \"here\"s are scope bounds; dropping either turns a claim about this panel into a claim about the queue"],
  ["components/data/ReplayBackfillPanel.tsx",
    "Binance for a crypto pair, this workspace&apos;s registry for an equity; capped at",
    "two named routes, the instrument class each serves, and the cap — no word is free"],
  ["components/DataConsole.tsx",
    "What each metered provider has left before background polling is fenced out",
    "the threshold behaviour (\"fenced out\") and its scope (\"background polling\") are the hint's whole content"],
];

describe("what this sweep refused to touch is still there", () => {
  it("has refusals on the record", () => {
    assert.ok(REFUSED.length >= 8, `expected the refusal list, found ${REFUSED.length}`);
  });

  for (const [relative, sentence, why] of REFUSED) {
    it(`${relative.split("/").pop()}: "${sentence.slice(0, 40)}…"`, () => {
      assert.ok(
        source(relative).includes(flat(sentence)),
        `${relative} lost a sentence this pass refused to shorten — ${why}`,
      );
    });
  }
});

/**
 * The tab's fact vocabulary, checked as one set.
 *
 * The per-rewrite checks above only guard the sentences this pass touched. A
 * later pass that shortens a sentence nobody listed can still take a number,
 * a unit, a threshold or a named entity off the tab — which is exactly the
 * shape of the loss `8d091a3` records. These are the tokens no rewrite of the
 * Data tab may spend, whichever sentence carries them.
 */
const VOCABULARY: Array<[token: string, where: string]> = [
  ["0 Hz", "components/data/FeedThroughput.tsx"],
  ["fifteen minutes", "components/data/TrustResponsePane.tsx"],
  ["minSamplesPerBucket ?? 3", "components/data/TrustResponsePane.tsx"],
  ["WEB_WORKSPACE_URL", "components/data/ReplayBackfillPanel.tsx"],
  ["DATA_SCHEDULES", "components/data/ReplayBackfillPanel.tsx"],
  ["Binance", "components/data/ReplayBackfillPanel.tsx"],
  ["max_backfill_bars", "components/data/ReplayBackfillPanel.tsx"],
  ["tick_seconds", "components/data/ReplayBackfillPanel.tsx"],
  ["retentionDays", "components/data/DataQualityLedger.tsx"],
  ["Telegram", "components/data/DataQualityLedger.tsx"],
  ["‹sample›", "components/data/DataWorkBoard.tsx"],
  ["work-in-progress limit of", "components/data/DataWorkBoard.tsx"],
  ["PROGRESS_WIP_LIMIT", "components/data/data-console-metrics.tsx"],
  ["held in reserve", "components/data/QuotaHeadroom.tsx"],
  ["p95 n/a", "components/data/TrustResponsePane.tsx"],
];

describe("no rewrite spends a number, a unit or a named entity", () => {
  for (const [token, where] of VOCABULARY) {
    it(`${where.split("/").pop()} still names ${token}`, () => {
      assert.ok(source(where).includes(flat(token)), `${where} no longer names ${token}`);
    });
  }
});

describe("the house rules a rewrite could break", () => {
  it("adds no middle dot to any rewritten line", () => {
    for (const rewrite of REWRITES) {
      assert.ok(!rewrite.after.includes("·"), `${rewrite.file}: a rewrite introduced the middle dot`);
    }
  });

  it("adds no emoji, and keeps to the house glyph vocabulary", () => {
    for (const rewrite of REWRITES) {
      assert.ok(
        !/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(rewrite.after),
        `${rewrite.file}: a rewrite introduced an emoji`,
      );
    }
  });

  it("stays in British spelling", () => {
    // The tree-wide rule lives in british-spelling.test.ts; this is the same
    // rule applied to the strings this pass authored, so a regression fails
    // here with the sentence that caused it.
    const AMERICAN = /\b\w*(?:analyze|behavior|color|customiz|initializ|labeled|labeling|normaliz|optimiz|organiz|prioritiz|recogniz|summariz|utiliz)\w*\b/i;
    for (const rewrite of REWRITES) {
      const hit = AMERICAN.exec(rewrite.after);
      assert.equal(hit, null, `${rewrite.file}: "${hit?.[0]}" is American spelling`);
    }
  });
});

/**
 * The restatements this pass cut, each pinned twice: gone from the file that
 * repeated it, still printed by the file that prints it first. Both files are
 * in OWNED above, so both were read non-empty before these negatives ran.
 */
const LEDGER = "components/data/DataQualityLedger.tsx";
const METRICS = "components/data/data-console-metrics.tsx";
const FRESH = "components/data/FeedsFreshnessPane.tsx";
const RESTATED: Array<[gone: string, repeat: string, keeps: string, kept: string]> = [
  [LEDGER, "<dt>Payloads evaluated</dt>", METRICS, 'label: "Payloads evaluated"'],
  [LEDGER, "<dt>Findings</dt>", METRICS, 'label: "Fatal findings"'],
  [FRESH, "Gateway source:", FRESH, 'gateway {gatewaySource?.state?.replace("_", " ") ?? "not observed"}'],
];

describe("a figure cut as a restatement is still printed on the same screen", () => {
  for (const [gone, repeat, keeps, kept] of RESTATED) {
    it(`${gone.split("/").pop()} drops "${repeat}"`, () => {
      assert.ok(!source(gone).includes(flat(repeat)), `${gone} restates what its page head prints`);
      assert.ok(source(keeps).includes(flat(kept)), `${keeps} stopped printing ${kept}`);
    });
  }
});
