/**
 * Progressive disclosure on the execution tab: what folded, and what may not.
 *
 * The desk reads long at rest and the deletion sweep has already finished —
 * what is left is prose that other suites defend sentence by sentence. The only
 * remaining lever is where a sentence sits, not whether it exists: a scope
 * caveat, a methodology note or a "why this is withheld" explanation stays in
 * the DOM word for word and moves behind a `<details>`, so the reader meets a
 * question at rest and buys the answer by opening it.
 *
 * That lever has an obvious failure mode, and it is the reason this file exists
 * rather than a diff review. A sweep that DELETED a sentence looks identical to
 * a sweep that folded it — the screen gets shorter either way, and every other
 * suite that only greps the source file still passes because a folded sentence
 * is still in the source. So the first two describes are a pair and have to be
 * read together: the sentence is still here, AND it is inside a fold. Neither
 * assertion means anything alone.
 *
 * The third describe is the honesty floor, and it is the half that says no. Four
 * kinds of sentence may never go behind a fold, whatever it costs in height:
 *
 *   - an EMPTY STATE, because "this panel has nothing to show" behind a fold is
 *     a panel that looks broken;
 *   - a NULL EXPLANATION that is a panel's only content, because folding it
 *     leaves a heading over nothing;
 *   - a SAFETY statement — orders are paper-only, generated, never sent, the
 *     desk is a sandbox — because a one-time notice is already how a generated
 *     desk gets mistaken for a real one, and a fold is a one-time notice with
 *     extra steps;
 *   - a figure a reader acts on.
 *
 * Those are asserted against files this sweep did not touch as well as ones it
 * did. That is deliberate: they are the sentences a LATER sweep would come for,
 * and today's green is what makes tomorrow's red mean something.
 *
 * `copy-audit.test.ts` owns the tree-wide version of the summary invariant
 * re-checked below. It is duplicated here, scoped to these files, so this suite
 * fails on its own rather than through a neighbour.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const PATHS = {
  spread: "../components/execution/SpreadDecomposition.tsx",
  venueMix: "../components/execution/VenueMixDonut.tsx",
  book: "../components/execution/LiquidityBook.tsx",
  tape: "../components/execution/DeskTape.tsx",
  chrome: "../components/execution/CockpitChrome.tsx",
  ticket: "../components/execution/OrderTicket.tsx",
  pnl: "../components/execution/PnlStrip.tsx",
  heatmap: "../components/execution/FillQualityHeatmap.tsx",
} as const;

type Key = keyof typeof PATHS;

const SOURCE = Object.fromEntries(
  (Object.keys(PATHS) as Key[]).map((key) => [key, read(PATHS[key])]),
) as Record<Key, string>;

/**
 * Comments stripped. Every one of these files argues in prose about what it
 * refuses to hide — CockpitChrome's banner comment says a one-time notice is
 * the defect — so scanning raw text finds the argument and reports the
 * safeguard as the violation.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/**
 * JSX tags out, whitespace collapsed: the shape a sentence has on screen, so a
 * paragraph wrapped across three source lines still matches as one sentence.
 * The tag pattern demands a letter after the angle bracket, which is what keeps
 * it from eating `seen > rows.length` and the prose on the far side of it.
 */
const flat = (source: string) =>
  code(source).replace(/<\/?[A-Za-z][^<>]*>/g, "").replace(/\s+/g, " ").trim();

/** Every `<details>…</details>` region, comments already stripped. */
function folds(key: Key): string[] {
  const text = code(SOURCE[key]);
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf("<details", at);
    if (open === -1) return out;
    const close = text.indexOf("</details>", open);
    assert.notEqual(close, -1, `${PATHS[key]} has an unterminated <details>`);
    out.push(text.slice(open, close + "</details>".length));
    at = close + 1;
  }
}

const present = (key: Key, sentence: string) => flat(SOURCE[key]).includes(sentence);
const folded = (key: Key, sentence: string) =>
  folds(key).some((block) => flat(block).includes(sentence));
/** For prose that reaches the screen through an attribute, which `flat` strips. */
const presentRaw = (key: Key, literal: string) => code(SOURCE[key]).includes(literal);
const foldedRaw = (key: Key, literal: string) =>
  folds(key).some((block) => block.includes(literal));

/**
 * What the sweep moved. `summary` is the line the reader meets instead, and it
 * is recorded here so the pair can be checked against each other below.
 */
const MOVED: { key: Key; summary: string; sentence: string }[] = [
  {
    key: "spread",
    summary: "What is the spread measured against, and why is one column left blank?",
    sentence:
      "Effective spread is 2 × |slippage| against the consolidated mid the gateway priced "
      + "each decision at. {REALIZED_SPREAD_WITHHELD}",
  },
  {
    key: "venueMix",
    summary: "What is missing from the denominator?",
    sentence:
      "Share of fills, not a fill ratio: an order that never filled never reached a venue, "
      + "so the audit log holds no denominator for one.",
  },
  {
    key: "book",
    summary: "How should this curve be read?",
    sentence:
      "Size resting between the mid and any price. A near-vertical step is a wall; a shallow "
      + "ramp is a thin book that costs to cross.",
  },
  {
    key: "book",
    summary: "Whose levels are these, and in what order?",
    sentence: "Every venue&apos;s levels by price, the book a smart router walks.",
  },
  {
    key: "tape",
    summary: "Why is this not the record?",
    sentence:
      "The complete record is the Blotter pane, polled from the gateway&apos;s authoritative "
      + "store; a stream can drop silently, so this is watched, not counted on.",
  },
];

/**
 * The honesty floor. `why` is not decoration — it is the reason a future sweep
 * has to argue with rather than a line it can quietly re-file.
 */
const VISIBLE: { key: Key; why: string; sentence: string }[] = [
  // SAFETY. Says the orders were never sent and the book is generated.
  { key: "chrome", why: "safety", sentence: "Sandbox desk — these orders were never sent." },
  { key: "chrome", why: "safety", sentence: "are generated from a fixed seed." },
  // SAFETY plus provenance: the claim that separates a stale desk from a sandbox.
  { key: "chrome", why: "safety", sentence: "Nothing here is generated." },
  // EMPTY STATE, and the whole content of the banner.
  { key: "chrome", why: "empty state", sentence: "No gateway in this deployment, so the live desk has nothing to show." },
  // SAFETY, directly above a Send button.
  { key: "ticket", why: "safety", sentence: "Sandbox: verdicts are computed in this browser. No order leaves this page." },
  // SAFETY and a capability boundary, with its sibling branch of one ternary.
  { key: "ticket", why: "safety", sentence: "paper model, MARKET only; no L2 routing is claimed." },
  { key: "ticket", why: "stance", sentence: "A rejection is the answer, not an error." },
  // Where a secret goes, readable as the secret is typed.
  { key: "ticket", why: "credential handling", sentence: "Required for live orders. Held in memory for this tab only." },
  { key: "ticket", why: "credential handling", sentence: "Override ready; held in memory for this tab only." },
  { key: "ticket", why: "credential handling", sentence: "Using the deployment credential; paste a token to override." },
  // NULL EXPLANATION as the panel's only content: a heading, this, and a button.
  {
    key: "pnl",
    why: "null explanation",
    sentence:
      "The risk gateway is a long-lived process, which a serverless deployment cannot host. "
      + "The sandbox desk runs the same workflow on a generated book.",
  },
  // NULL EXPLANATION as the panel's only content.
  { key: "heatmap", why: "null explanation", sentence: "no priced fills to grid; the audit feed has no source while Live gateway is selected" },
  // Empty states in the panels this sweep did edit.
  { key: "spread", why: "empty state", sentence: "No audit log is reachable here, so no fill has a price to measure a spread against." },
  { key: "spread", why: "empty state", sentence: "No priced fill in this window. Rejections carry no execution price, so this is an absence of trading, not of measurement." },
  { key: "venueMix", why: "empty state", sentence: "No audit log is reachable here, so there are no fills to attribute to a venue." },
  { key: "book", why: "empty state", sentence: "waiting for book…" },
  // The withheld column keeps its word and its basis, on screen, beside the figure.
  { key: "spread", why: "withheld leg", sentence: "Realized spread — not measured" },
  { key: "spread", why: "withheld leg", sentence: "measured, measured, not measurable" },
  // SAFETY: generated data, in both panels that can render it.
  { key: "spread", why: "safety", sentence: "Generated desk." },
  { key: "venueMix", why: "safety", sentence: "Generated desk." },
  // A figure a reader acts on: without it the ring disagrees with the KPI count.
  { key: "venueMix", why: "figure", sentence: "excluded from the ring." },
  // The only at-rest discovery of click-to-trade.
  { key: "book", why: "affordance", sentence: "Click a level to stage it as a limit in the ticket." },
  // Nothing else on the tape panel says the table is symbol-scoped.
  { key: "tape", why: "scope", sentence: "Filtered to {symbol}." },
];

/** Same rule, for prose that lives in an attribute or a call `flat` strips. */
const VISIBLE_RAW: { key: Key; why: string; literal: string }[] = [
  { key: "venueMix", why: "empty state", literal: 'emptyNote="No priced fill has been attributed to a venue in this window."' },
  { key: "book", why: "null explanation", literal: '"no book snapshot"' },
  { key: "tape", why: "empty state", literal: "{describeTape(state, rows.length)}" },
];

describe("the files this sweep reads are really being read", () => {
  // A scan of an empty string passes every doesNotMatch and proves nothing.
  // This is the assertion that makes the negative ones below mean something.
  for (const key of Object.keys(PATHS) as Key[]) {
    it(`${PATHS[key]} loads with content`, () => {
      assert.ok(SOURCE[key].length > 500, `${PATHS[key]} read as ${SOURCE[key].length} bytes`);
      // CockpitChrome exports two named banners rather than a default, so the
      // guard is "this renders something", not "this has a default export".
      assert.match(SOURCE[key], /export (default )?function/);
    });
  }
});

describe("every sentence the sweep moved is still here, word for word", () => {
  // The half that catches a deletion wearing a disclosure's clothes.
  for (const { key, sentence } of MOVED) {
    it(`${PATHS[key].split("/").pop()}: "${sentence.slice(0, 44)}…"`, () => {
      assert.ok(present(key, sentence),
        `this sentence is no longer in ${PATHS[key]} — a fold moves prose, it does not remove it`);
    });
  }
});

describe("and it moved behind a fold rather than staying on screen", () => {
  // The half that catches a sweep that claimed a saving it never made.
  for (const { key, sentence, summary } of MOVED) {
    it(`${PATHS[key].split("/").pop()}: under "${summary}"`, () => {
      assert.ok(folds(key).length > 0, `${PATHS[key]} has no <details> at all`);
      assert.ok(folded(key, sentence),
        `this sentence is still at rest in ${PATHS[key]}; nothing was saved`);
      assert.ok(code(SOURCE[key]).includes(`<summary>${summary}</summary>`),
        `${PATHS[key]} does not carry the summary this sentence folded under`);
    });
  }
});

describe("the honesty floor: what may never go behind a fold", () => {
  for (const { key, sentence, why } of VISIBLE) {
    it(`${PATHS[key].split("/").pop()} keeps its ${why}: "${sentence.slice(0, 40)}…"`, () => {
      assert.ok(present(key, sentence),
        `${PATHS[key]} no longer contains this sentence at all`);
      assert.ok(!folded(key, sentence),
        `a ${why} sentence is behind a fold in ${PATHS[key]} — it must be readable at rest`);
    });
  }

  for (const { key, literal, why } of VISIBLE_RAW) {
    it(`${PATHS[key].split("/").pop()} keeps its ${why}: ${literal.slice(0, 40)}…`, () => {
      assert.ok(presentRaw(key, literal), `${PATHS[key]} no longer contains ${literal}`);
      assert.ok(!foldedRaw(key, literal),
        `a ${why} is behind a fold in ${PATHS[key]} — it must be readable at rest`);
    });
  }
});

describe("every fold is a real bargain", () => {
  const swept: Key[] = ["spread", "venueMix", "book", "tape"];

  it("each swept panel folded at least one note", () => {
    for (const key of swept) {
      assert.ok(folds(key).length >= 1, `${PATHS[key]} folded nothing`);
    }
    const total = swept.reduce((n, key) => n + folds(key).length, 0);
    assert.equal(total, MOVED.length,
      `${total} folds across the swept panels for ${MOVED.length} moved notes`);
  });

  it("each one uses the house class rather than a second pattern", () => {
    // Twenty files reach for `.disclosure`; a private variant would be a
    // second grammar for one idea and would miss the stylesheet's rules.
    for (const key of swept) {
      for (const block of folds(key)) {
        assert.match(block, /^<details className="disclosure"[ >]/,
          `${PATHS[key]} opens a <details> that is not a .disclosure`);
      }
    }
  });

  it("each one has a non-empty summary and a non-empty body", () => {
    for (const key of swept) {
      for (const block of folds(key)) {
        const summary = /<summary>([\s\S]*?)<\/summary>/.exec(block);
        assert.ok(summary, `${PATHS[key]} has a <details> with no <summary>`);
        assert.ok(summary![1].replace(/\s+/g, " ").trim().length >= 10,
          `${PATHS[key]} has a <summary> too short to name a question`);
        const body = flat(block.replace(/<summary>[\s\S]*?<\/summary>/, ""));
        assert.ok(body.length >= 20,
          `${PATHS[key]} has a <details> whose body is empty — a fold over nothing`);
      }
    }
  });

  it("each summary asks rather than answers", () => {
    // The `copy-audit.test.ts` invariant, scoped to these files so this suite
    // fails on its own: a contiguous four-word phrase shared between a summary
    // and the first 300 characters it hides is the reader paying twice.
    const phrases = (text: string, n = 4) => {
      const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
      return new Set(Array.from({ length: Math.max(0, words.length - n + 1) },
        (_, i) => words.slice(i, i + n).join(" ")));
    };
    const offenders: string[] = [];
    for (const key of swept) {
      for (const match of SOURCE[key].matchAll(/<summary>([^<]{10,})<\/summary>([\s\S]{0,400})/g)) {
        const summary = match[1].replace(/\s+/g, " ").trim();
        const body = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);
        const hidden = phrases(body);
        const repeated = [...phrases(summary)].filter((phrase) => hidden.has(phrase));
        if (repeated.length) offenders.push(`${PATHS[key]}: "${summary}" repeats "${repeated[0]}"`);
      }
    }
    assert.deepEqual(offenders, [],
      `these summaries state the answer they hide:\n    ${offenders.join("\n    ")}`);
  });

  it("no summary reaches for a mark the house rules ban", () => {
    // The middle dot is not a word, and `<summary>` is on the named list.
    for (const key of swept) {
      for (const match of SOURCE[key].matchAll(/<summary>([\s\S]*?)<\/summary>/g)) {
        assert.doesNotMatch(match[1], /·/, `${PATHS[key]} uses a middle dot in a <summary>`);
        assert.doesNotMatch(match[1], /\p{Extended_Pictographic}/u,
          `${PATHS[key]} uses an emoji in a <summary>`);
      }
    }
  });
});
