/**
 * The Execution tab, said in fewer words — and the proof that nothing was lost
 * saying it.
 *
 * Two earlier passes over this tab did different jobs. The first DELETED
 * sentences that restated something already on the same screen, and stopped at
 * 188 words because that was all there honestly was. The second FOLDED prose
 * behind `<details>` byte-identically, which `disclosure-execution.test.ts`
 * pins sentence by sentence. This pass is neither: the same fact, in fewer
 * words, in the same place on the screen.
 *
 * That is the failure mode `8d091a3` records — "Cut 610 words from the
 * frontend, then put 16 facts back". A rewrite reads fluently whether or not it
 * still carries the number, the unit, the threshold, the named entity, the
 * negation or the qualifier that was the reason the sentence existed. Fluency
 * is not the property worth testing; survival is.
 *
 * So each entry below is a rewritten sentence recorded as ASSERTABLE TOKENS —
 * the facts it carries, one string each. Three things are checked per entry and
 * all three are needed:
 *
 *   1. every fact token is still in the file (the loss guard);
 *   2. the shortened form is actually present (without this the suite is
 *      satisfied by never editing anything, which is not a pass);
 *   3. the wording that was cut is gone (without this a "rewrite" that appended
 *      a second sentence would count as one).
 *
 * The file-loaded guard at the top is not ceremony. A scan of an empty string
 * passes every `doesNotMatch` and proves nothing, and that trap has been found
 * in this tree more than once — `copy-audit.test.ts` and
 * `execution-controls-fill-quality.test.ts` both carry a comment about an
 * `indexOf` that returned -1 and made a negative assertion pass having read one
 * byte. Nothing negative below runs until the source has been measured.
 *
 * What this file does NOT do is cap length, for the reason `copy-audit.test.ts`
 * states at its own head: "detailed" and "wordy" are not the same property, and
 * a test that could not tell them apart would push the desk toward saying less
 * than it knows. Every sentence this pass REFUSED to shorten is refused because
 * a token had nowhere to go, not because it was already short.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PATHS = {
  probe: "../components/execution/RoutingProbe.tsx",
  quality: "../components/execution/ExecutionQuality.tsx",
  alerts: "../components/execution/AlertFeed.tsx",
  cockpit: "../components/execution/ExecutionCockpit.tsx",
  tape: "../components/execution/DeskTape.tsx",
  ticketForm: "../components/execution/OrderTicketForm.tsx",
  pnl: "../components/execution/PnlStrip.tsx",
  dislocation: "../components/DislocationStrip.tsx",
  spread: "../components/execution/SpreadDecomposition.tsx",
  venueMix: "../components/execution/VenueMixDonut.tsx",
} as const;

type Key = keyof typeof PATHS;

const SOURCE = Object.fromEntries(
  (Object.keys(PATHS) as Key[]).map((key) => [
    key,
    readFileSync(fileURLToPath(new URL(PATHS[key], import.meta.url)), "utf8"),
  ]),
) as Record<Key, string>;

/**
 * Comments stripped. Every file here argues in prose about the wording it
 * carries, and several of those comments quote the exact phrase that was
 * replaced — scanning raw text would find the explanation and report it as the
 * violation. `disclosure-execution.test.ts` strips for the same reason.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/**
 * TWO views of the same file, because prose reaches a reader by two routes and
 * one normaliser cannot read both.
 *
 * `flat` is the shape a sentence has on screen: tags out, whitespace collapsed,
 * so a paragraph wrapped over three source lines — or split by a `<code>` — is
 * one sentence. What it cannot see is prose that lives INSIDE a tag: `title=`
 * and `aria-label=` are swallowed whole with the element that carries them.
 * That is not hypothetical here; `PnlStrip`'s two transport labels are `title=`
 * on a `<span>`, and a first draft of this file asserted them against `flat`
 * alone and reported a sentence as deleted that was sitting in front of it.
 * `disclosure-execution.test.ts` carries the same split for the same reason.
 *
 * So `raw` keeps the tags and only collapses whitespace. A sentence must appear
 * in EITHER view to count as present, and must be gone from BOTH to count as
 * cut.
 */
const flat = (key: Key) =>
  code(SOURCE[key]).replace(/<\/?[A-Za-z][^<>]*>/g, "").replace(/\s+/g, " ").trim();
const raw = (key: Key) => code(SOURCE[key]).replace(/\s+/g, " ").trim();

const present = (key: Key, text: string) => flat(key).includes(text) || raw(key).includes(text);
const absent = (key: Key, text: string) => !flat(key).includes(text) && !raw(key).includes(text);

interface Rewrite {
  key: Key;
  /** What the reader used to meet. Kept for the report, not asserted. */
  before: string;
  /** What the reader meets now, exactly. */
  after: string;
  /** The facts the sentence carries. Every one must survive the rewrite. */
  facts: string[];
  /** Wording that must be gone, so a rewrite cannot pass by adding a sentence. */
  cut: string[];
}

const REWRITES: Rewrite[] = [
  {
    key: "probe",
    before: "Walks the live ladder for a target order, and the cross-venue split that minimises it.",
    after: "Walks the live ladder for a target order, and the cheapest cross-venue split.",
    // "cheapest" IS the minimisation, and it is the whole of it: the split this
    // card reports is chosen on cost. `copy-audit.test.ts` separately requires
    // "live ladder" within 400 characters of the heading, because that the walk
    // is live is the one thing the heading does not say.
    facts: ["Walks", "live ladder", "target order", "cheapest", "cross-venue split"],
    cut: ["that minimises it"],
  },
  {
    key: "probe",
    before:
      "The ladders stream over WebSockets from your browser to Binance and Bybit. The same "
      + "maths serves REST snapshots at /api/depth and /api/tca for non-browser callers. "
      + "Pre-trade risk checks and the kill-switch stay on the gateway.",
    after:
      "Ladders stream over WebSockets from your browser to Binance and Bybit; the same maths "
      + "serves /api/depth and /api/tca as REST snapshots for non-browser callers. Pre-trade "
      + "risk checks and the kill-switch stay on the gateway.",
    // Thirteen tokens, and the two route names are the ones a reader would
    // actually go and use. The semicolon is doing the work the second "The"
    // was doing: same two clauses, one subject stated once.
    facts: [
      "Ladders", "stream over WebSockets", "your browser", "Binance", "Bybit",
      "the same maths", "/api/depth", "/api/tca", "REST snapshots",
      "non-browser callers", "Pre-trade risk checks", "kill-switch",
      "stay on the gateway",
    ],
    cut: ["The ladders stream", "REST snapshots at"],
  },
  {
    key: "quality",
    before: "Nothing has been sent yet, so there is nothing to measure.",
    after: "Nothing sent yet, so there is nothing to measure.",
    // "has been" is the whole of the cut. The claim, its scope ("yet") and its
    // consequence are unchanged.
    facts: ["Nothing sent yet", "nothing to measure"],
    cut: ["Nothing has been sent yet"],
  },
  {
    key: "quality",
    before: "There is nothing to measure without a source.",
    after: "Nothing to measure without a source.",
    // Throat-clearing only: "There is" carries no fact. The bound — that this
    // is about a MISSING SOURCE and not about a quiet desk — is the reason this
    // sentence is separate from the one above it, and it stays.
    facts: ["Nothing to measure", "without a source"],
    cut: ["There is nothing to measure"],
  },
  {
    key: "alerts",
    before: "A generated event stream in the risk monitor's shape, from a seed rather than a desk.",
    after: "Generated in the risk monitor's shape, from a seed rather than a desk.",
    // The restated subject goes: the h3 immediately above reads "Alerts & risk
    // events". "rather than" stays — without it this says a seed and a desk are
    // the same thing, which is the claim the sandbox exists to deny.
    facts: ["Generated", "risk monitor's shape", "from a seed", "rather than", "a desk"],
    cut: ["A generated event stream"],
  },
  {
    key: "cockpit",
    before: "Which venue, which part of the spread, and which hour the cost came from",
    after: "Which venue, which part of the spread, which hour the cost came from",
    // Three parallel questions; the conjunction is the only word removed.
    facts: ["Which venue", "which part of the spread", "which hour the cost came from"],
    cut: ["spread, and which hour"],
  },
  {
    key: "tape",
    before: "{seen} decisions seen this session; the {rows.length} most recent are shown.",
    after: "{seen} decisions seen this session; showing the {rows.length} most recent.",
    // Both counts survive. This line is the tape's own admission that it is
    // showing a window rather than everything it saw, so neither number may go.
    facts: ["{seen} decisions seen this session", "{rows.length} most recent"],
    cut: ["most recent are shown"],
  },
  {
    key: "dislocation",
    before: "Gross of fees and transfer. Size is the smaller resting leg, since both have to fill.",
    after: "Gross of fees and transfer. Size is the smaller resting leg, since both must fill.",
    // "must" for "have to". The edge being GROSS is the sentence's reason for
    // existing — the file's own header says a number presented as an
    // opportunity is harder to un-see than one presented with its cost.
    facts: ["Gross of fees and transfer", "smaller resting leg", "both must fill"],
    cut: ["both have to fill"],
  },
  {
    key: "ticketForm",
    before:
      "Type a limit price to enable Send, or switch back to Market. The grey number is the "
      + "current mark, not a filled-in value.",
    after:
      "Type a limit price to enable Send, or switch back to Market. The grey number is the "
      + "mark, not a filled-in value.",
    // "the mark" is already the house term, and the Send button's own title in
    // this same file says "the grey number is the mark, not a value". The
    // negation is the point of the sentence and is asserted as one token.
    facts: [
      "Type a limit price", "enable Send", "switch back to Market",
      "The grey number is the mark", "not a filled-in value",
    ],
    cut: ["the current mark"],
  },
  {
    key: "pnl",
    before: "Pushed by the gateway when the risk state changes — about a second old.",
    after: "Pushed by the gateway on a risk-state change — about a second old.",
    // The age is the fact a reader acts on, and "about" is the qualifier that
    // keeps it from being a guarantee. Both are tokens.
    facts: ["Pushed by the gateway", "risk-state change", "about a second old"],
    cut: ["when the risk state changes"],
  },
  {
    key: "spread",
    before: "Cost decomposition Effective spread and fee",
    after: "Effective spread and fee",
    // A kicker over a heading that said the same thing in other words, and it
    // survived only in the two EMPTY-STATE returns: the populated card lost the
    // portfolio header grammar and its kicker with it, so "Cost decomposition"
    // was a phrase no reader of a working panel ever met. The h3 names the two
    // measured legs, which is the decomposition. Both empty sentences are
    // untouched and `disclosure-execution.test.ts` still pins them as floor
    // entries; what went is the shell around the heading.
    facts: ["Effective spread and fee"],
    cut: ["Cost decomposition"],
  },
  {
    key: "venueMix",
    before: "Execution venues Share of fills by venue",
    after: "Share of fills by venue",
    // Same shape, same reason, in the one early return this card has. "Share of
    // fills by venue" already carries what is counted AND the denominator
    // caveat the heading exists to make — the kicker only restated the subject.
    facts: ["Share of fills by venue"],
    cut: ["Execution venues"],
  },
  {
    key: "pnl",
    before: "Polled on a timer — up to one poll interval old, and the stream is not carrying it.",
    after: "Polled on a timer — up to one poll interval old; the stream is not carrying it.",
    // "up to" is a bound and "not" is the whole claim: this label exists
    // because a desk on the fallback poll looked exactly like one running live.
    facts: [
      "Polled on a timer", "up to one poll interval old",
      "the stream is not carrying it",
    ],
    cut: ["old, and the stream"],
  },
];

/**
 * Sentences this pass looked at and left alone, with the token that had nowhere
 * to go. Recorded as a test rather than a comment so a later sweep that comes
 * for one of them fails with the argument instead of a diff.
 *
 * `disclosure-execution.test.ts` already freezes a further twenty-odd sentences
 * on this tab word for word; those are not repeated here.
 */
const REFUSED: { key: Key; sentence: string; token: string }[] = [
  {
    key: "quality",
    sentence: "Sandbox latencies are generated uniform 140–250 µs; the flat shape is the generator.",
    token: "140–250 µs — a range and a unit; dropping either leaves the flat shape unexplained",
  },
  {
    key: "quality",
    sentence: "Time inside the pre-trade battery, not order-to-fill.",
    token: "not order-to-fill — the negation is the entire caveat under a latency chart",
  },
  {
    key: "quality",
    sentence: "Sandbox fills are taker-side by construction, so none can beat the mid.",
    token: "by construction — the reason a zero here is correct rather than broken",
  },
  {
    key: "probe",
    sentence: "No venue is streaming yet, so there is nothing to include or exclude.",
    token: "yet — an empty control that says 'nothing to include' without it reads as broken",
  },
  {
    key: "cockpit",
    sentence: "The record: every order sent, what it cost, which gate stopped it, and the resting book",
    token: "the resting book — a fourth column of content, not a restatement of the first three",
  },
  {
    key: "spread",
    sentence: "No priced fill in this window. Rejections carry no execution price, so this is an absence",
    token: "no execution price — the reason the window is empty, which is what separates it from a broken feed",
  },
  {
    key: "venueMix",
    sentence: "No audit log is reachable here, so there are no fills to attribute to a venue.",
    token: "No audit log is reachable here — names the missing source rather than blaming a quiet desk",
  },
];

describe("the files this pass rewrote are really being read", () => {
  // Nothing negative below is allowed to run against an empty string.
  for (const key of Object.keys(PATHS) as Key[]) {
    it(`${PATHS[key]} loads with content`, () => {
      assert.ok(SOURCE[key].length > 500, `${PATHS[key]} read as ${SOURCE[key].length} bytes`);
      assert.match(SOURCE[key], /export (default )?(function|memo\()/);
      assert.ok(flat(key).length > 400, `${PATHS[key]} flattened to nothing`);
      assert.ok(raw(key).length > 500, `${PATHS[key]} collapsed to nothing`);
    });
  }

  it("covers every file it claims to", () => {
    const touched = new Set(REWRITES.map((r) => r.key));
    assert.equal(touched.size, Object.keys(PATHS).length,
      `${touched.size} of ${Object.keys(PATHS).length} listed files carry a rewrite`);
  });
});

describe("every fact the rewritten sentence carried is still on the screen", () => {
  for (const { key, after, facts } of REWRITES) {
    it(`${PATHS[key].split("/").pop()}: "${after.slice(0, 40)}…" keeps ${facts.length} tokens`, () => {
      for (const fact of facts) {
        assert.ok(present(key, fact),
          `"${fact}" is no longer in ${PATHS[key]} — the rewrite dropped a fact`);
      }
    });
  }
});

describe("and the sentence really did get shorter", () => {
  for (const { key, before, after, cut } of REWRITES) {
    it(`${PATHS[key].split("/").pop()}: "${after.slice(0, 40)}…"`, () => {
      assert.ok(present(key, after),
        `${PATHS[key]} does not carry the rewritten sentence`);
      for (const phrase of cut) {
        assert.ok(absent(key, phrase),
          `${PATHS[key]} still carries "${phrase}" — nothing was saved`);
      }
      const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
      assert.ok(words(after) < words(before),
        `"${after}" is not shorter than what it replaced`);
    });
  }
});

describe("the sentences this pass refused to touch", () => {
  for (const { key, sentence, token } of REFUSED) {
    it(`${PATHS[key].split("/").pop()} keeps "${sentence.slice(0, 36)}…" — ${token.split(" — ")[0]}`, () => {
      assert.ok(present(key, sentence),
        `${PATHS[key]} lost a sentence this pass declined to shorten: ${token}`);
    });
  }
});
