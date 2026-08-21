/**
 * The Overview tab's progressive-disclosure floor.
 *
 * A disclosure sweep is meant to shorten a page WITHOUT shortening what it
 * says: a caveat, a methodology note or a limitation keeps every word, and only
 * moves behind a `<details>` so it is off screen until asked for. Two failure
 * modes look identical in a diff and are opposites in the product:
 *
 *   1. The sentence was folded. Good, if it was a caveat.
 *   2. The sentence was deleted. The page got shorter and less honest, and the
 *      word count improved either way — which is exactly why a word count is
 *      not allowed to be the only thing watching.
 *
 * So the first group below asserts SURVIVAL: every sentence on this tab is
 * still in its file, byte for byte, folded or not. The second asserts
 * VISIBILITY for the subset that may never be folded at all — empty states,
 * null explanations, safety statements and the figures a reader acts on. A
 * panel whose only content is "book connecting" reads as broken when that line
 * is behind a fold; a dash with its reason hidden is the precise defect the
 * null-honesty doctrine exists to stop.
 *
 * The third group holds any `<details>` this tab does grow to: a summary that
 * asks rather than answers (the same four-word invariant
 * `tests/copy-audit.test.ts` applies tree-wide, restated here so the Overview
 * files fail locally), a non-empty summary, and a non-empty body.
 *
 * Scope: the files one agent owns for this sweep. `Sparkline.tsx` is in the
 * list with no prose of its own — it is read so the guard below can prove it
 * read something, rather than passing over a path that quietly stopped
 * resolving.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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
] as const;

type Owned = (typeof OWNED)[number];

const SOURCE = new Map<string, string>(OWNED.map((path) => [path, read(`../${path}`)]));

/** An anchor per file, so "the file loaded" means more than "not zero bytes". */
const ANCHOR: Record<Owned, string> = {
  "components/WorkspaceOverview.tsx": "export default function WorkspaceOverview",
  "components/overview/AuditTrail.tsx": "export default function AuditTrail",
  "components/overview/DecisionLoopPipeline.tsx": "export default function DecisionLoopPipeline",
  "components/overview/KpiDeck.tsx": "export default function KpiDeck",
  "components/overview/RoleCards.tsx": "export default function RoleCards",
  "components/overview/Sparkline.tsx": "export default function Sparkline",
  "components/common/NextStepFooter.tsx": "export default function NextStepFooter",
};

function src(path: Owned): string {
  return SOURCE.get(path)!;
}

// ---------------------------------------------------------------------------
// Fold geometry
// ---------------------------------------------------------------------------

/**
 * Is the character at `index` hidden at rest?
 *
 * Depth counting rather than a non-greedy `<details>…</details>` match, because
 * a nested disclosure would end the outer range early and report content after
 * the inner close as visible. A `<summary>` is the part of a closed `<details>`
 * that IS on screen, so text inside one is visible by definition.
 *
 * `<details open>` counts as folded here on purpose: a reader can collapse it,
 * so its body is not something the page guarantees is on screen.
 */
function foldedAt(source: string, index: number): boolean {
  const before = source.slice(0, index);
  const opens = (before.match(/<details\b/g) ?? []).length;
  const closes = (before.match(/<\/details>/g) ?? []).length;
  if (opens <= closes) return false;
  const summaryOpens = (before.match(/<summary\b/g) ?? []).length;
  const summaryCloses = (before.match(/<\/summary>/g) ?? []).length;
  return summaryOpens <= summaryCloses;
}

interface Disclosure {
  summary: string;
  body: string;
}

/** Every `<details>` in a source, as the summary it shows and the body it hides. */
function disclosures(source: string): Disclosure[] {
  const out: Disclosure[] = [];
  const opener = /<details\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source))) {
    const from = match.index + match[0].length;
    let depth = 1;
    let cursor = from;
    let end = source.length;
    const boundary = /<details\b|<\/details>/g;
    boundary.lastIndex = from;
    let step: RegExpExecArray | null;
    while ((step = boundary.exec(source))) {
      depth += step[0] === "</details>" ? -1 : 1;
      if (depth === 0) {
        end = step.index;
        break;
      }
      cursor = step.index;
    }
    void cursor;
    const inner = source.slice(from, end);
    const summaryMatch = inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/);
    const summary = (summaryMatch?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const afterSummary = summaryMatch
      ? inner.slice(inner.indexOf(summaryMatch[0]) + summaryMatch[0].length)
      : inner;
    out.push({ summary, body: afterSummary });
  }
  return out;
}

/** Body text as a reader meets it: tags gone, JSX comments gone, whitespace flat. */
function bodyText(body: string): string {
  return body
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Contiguous n-word phrases, lowercased — the shape copy-audit's invariant uses. */
function phrases(text: string, n = 4): Set<string> {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(
    Array.from({ length: Math.max(0, words.length - n + 1) }, (_, i) => words.slice(i, i + n).join(" ")),
  );
}

// ---------------------------------------------------------------------------
// 1. Nothing was deleted
// ---------------------------------------------------------------------------

/**
 * Every sentence the sweep touched or considered touching, byte-identical.
 *
 * Folding is allowed here; disappearing is not. Single-quoted deliberately
 * where a string carries `${…}` — the interpolation is part of the sentence
 * the file must still hold.
 */
const MUST_SURVIVE: { file: Owned; text: string }[] = [
  { file: "components/WorkspaceOverview.tsx", text: "One {request.symbol} context across the loop, and one record they all reconcile to." },
  { file: "components/WorkspaceOverview.tsx", text: "start ${usd(equity.start_of_day, 0)}; gateway snapshot" },
  { file: "components/WorkspaceOverview.tsx", text: "${signedPct(equity.daily_return)} on the session" },
  { file: "components/WorkspaceOverview.tsx", text: "backtested in this browser" },
  { file: "components/WorkspaceOverview.tsx", text: "measured from this browser's polls" },
  { file: "components/WorkspaceOverview.tsx", text: "fewer than 20 polls measured" },
  { file: "components/WorkspaceOverview.tsx", text: "book connecting" },
  { file: "components/WorkspaceOverview.tsx", text: "needs price history" },
  { file: "components/overview/KpiDeck.tsx", text: "no finite record proves this edge" },
  { file: "components/overview/KpiDeck.tsx", text: "needs ~${fmt(trl.years, 1)} y of history; ${signedPct(shown.best.totalReturn)} in-sample" },
  { file: "components/overview/KpiDeck.tsx", text: "track record met; ${signedPct(shown.best.totalReturn)} in-sample" },
  { file: "components/overview/KpiDeck.tsx", text: "no completed run" },
  { file: "components/overview/KpiDeck.tsx", text: "awaiting result" },
  { file: "components/overview/KpiDeck.tsx", text: "sweep in progress" },
  { file: "components/overview/KpiDeck.tsx", text: "no limit engaged yet" },
  { file: "components/overview/KpiDeck.tsx", text: "checking data plane" },
  { file: "components/overview/KpiDeck.tsx", text: "no lookups yet" },
  { file: "components/overview/KpiDeck.tsx", text: "modelled cost" },
  { file: "components/overview/AuditTrail.tsx", text: "Every paper order, accepted or refused, with the refusing gate." },
  { file: "components/overview/AuditTrail.tsx", text: "Generated ledger — these orders were not sent." },
  { file: "components/overview/AuditTrail.tsx", text: "The same orders the Execution blotter shows, so the two tabs reconcile." },
  { file: "components/overview/AuditTrail.tsx", text: "No orders in the audit window yet — send a paper order from Execution." },
  { file: "components/overview/AuditTrail.tsx", text: "paper-only, recorded by the gateway itself." },
  { file: "components/overview/AuditTrail.tsx", text: "generated for this session; paper-only, recorded by nothing." },
];

// ---------------------------------------------------------------------------
// 2. The honesty floor stays on screen
// ---------------------------------------------------------------------------

/**
 * The subset that may never be folded, each with the reason it may not.
 *
 * Four kinds, and the reason is always the same underneath: at the moment this
 * line renders, it is either the panel's whole content or the thing a reader
 * acts on. A fold turns the first into a blank panel and the second into a
 * figure with no provenance.
 */
const MUST_STAY_VISIBLE: { file: Owned; text: string; kind: string }[] = [
  { file: "components/WorkspaceOverview.tsx", text: "One {request.symbol} context across the loop, and one record they all reconcile to.", kind: "the tab's thesis line, read by copy-audit as the question this tab answers" },
  { file: "components/WorkspaceOverview.tsx", text: "backtested in this browser", kind: "provenance for the VaR figure a risk reader acts on" },
  { file: "components/WorkspaceOverview.tsx", text: "measured from this browser's polls", kind: "provenance that stops p99 reading as gateway-measured" },
  { file: "components/WorkspaceOverview.tsx", text: "fewer than 20 polls measured", kind: "null explanation, the whole content of the chip under a dash" },
  { file: "components/WorkspaceOverview.tsx", text: "book connecting", kind: "null explanation under the Equity and Day P&L dashes" },
  { file: "components/WorkspaceOverview.tsx", text: "needs price history", kind: "null explanation under the VaR dash" },
  { file: "components/overview/KpiDeck.tsx", text: "no finite record proves this edge", kind: "null explanation for the Not available out-of-sample value" },
  { file: "components/overview/KpiDeck.tsx", text: "needs ~${fmt(trl.years, 1)} y of history; ${signedPct(shown.best.totalReturn)} in-sample", kind: "sample floor beside a figure a strategy is promoted on" },
  { file: "components/overview/KpiDeck.tsx", text: "no completed run", kind: "empty state" },
  { file: "components/overview/KpiDeck.tsx", text: "awaiting result", kind: "empty state" },
  { file: "components/overview/KpiDeck.tsx", text: "checking data plane", kind: "empty state" },
  { file: "components/overview/KpiDeck.tsx", text: "no limit engaged yet", kind: "empty state" },
  { file: "components/overview/KpiDeck.tsx", text: "no lookups yet", kind: "null explanation, not a zero cache hit rate" },
  { file: "components/overview/KpiDeck.tsx", text: "book connecting", kind: "null explanation under the Gross exposure dash" },
  { file: "components/overview/KpiDeck.tsx", text: "needs price history", kind: "null explanation under the CVaR dash" },
  { file: "components/overview/KpiDeck.tsx", text: "; sandbox", kind: "safety statement on the order intent card" },
  { file: "components/overview/AuditTrail.tsx", text: "Generated ledger — these orders were not sent.", kind: "safety statement" },
  { file: "components/overview/AuditTrail.tsx", text: "No orders in the audit window yet — send a paper order from Execution.", kind: "empty state" },
  { file: "components/overview/AuditTrail.tsx", text: "paper-only, recorded by the gateway itself.", kind: "safety statement" },
  { file: "components/overview/AuditTrail.tsx", text: "generated for this session; paper-only, recorded by nothing.", kind: "safety statement" },
];

describe("the Overview sources were actually read", () => {
  for (const path of OWNED) {
    it(`${path} loaded with its component in it`, () => {
      const source = src(path);
      // A scan of "" satisfies every doesNotMatch below and proves nothing, so
      // the length and the anchor are the precondition for the rest of the file.
      assert.ok(source.length > 400, `${path} loaded ${source.length} bytes`);
      assert.ok(source.includes(ANCHOR[path]), `${path} lost ${ANCHOR[path]}`);
    });
  }
});

describe("a folded fact is still a fact", () => {
  for (const { file, text } of MUST_SURVIVE) {
    it(`${file} still says "${text.slice(0, 52)}"`, () => {
      assert.ok(
        src(file).includes(text),
        `a disclosure sweep deleted this instead of folding it: ${text}`,
      );
    });
  }
});

describe("the honesty floor is on screen at rest", () => {
  for (const { file, text, kind } of MUST_STAY_VISIBLE) {
    it(`${file}: "${text.slice(0, 44)}" is not behind a fold`, () => {
      const source = src(file);
      const at = source.indexOf(text);
      assert.notEqual(at, -1, `the line this rule protects is gone: ${text}`);
      // Every occurrence, not the first: the same null explanation is reused by
      // several tiles, and folding the second one is the same defect.
      for (let index = at; index !== -1; index = source.indexOf(text, index + 1)) {
        assert.ok(
          !foldedAt(source, index),
          `${kind} — folded at offset ${index}: ${text}`,
        );
      }
    });
  }
});

describe("the fold scanner can see a fold", () => {
  /**
   * Groups two and three are negative over files that currently hold no
   * `<details>` at all, and a negative assertion is only worth what the scanner
   * behind it is worth. These two point it at a disclosure that does exist —
   * elsewhere in the tree, deliberately, so the proof does not depend on this
   * sweep having moved anything.
   */
  const control = read("../components/portfolio/AllocationDonut.tsx");

  it("finds the AllocationDonut disclosure, summary and body", () => {
    const found = disclosures(control);
    assert.equal(found.length, 1, "the control file's disclosure count changed");
    assert.equal(found[0].summary, "How this is sized, and what it does not tell you");
    assert.match(bodyText(found[0].body), /Sized by gross notional/);
  });

  it("reports a body as folded and its summary as visible", () => {
    const body = control.indexOf("Sized by gross notional");
    assert.notEqual(body, -1);
    assert.ok(foldedAt(control, body), "a disclosure body read as visible");
    const summary = control.indexOf("How this is sized");
    assert.notEqual(summary, -1);
    assert.ok(!foldedAt(control, summary), "a summary read as hidden");
  });
});

describe("every Overview disclosure keeps its side of the bargain", () => {
  for (const path of OWNED) {
    const found = disclosures(src(path));
    if (found.length === 0) continue;

    for (const [index, disclosure] of found.entries()) {
      it(`${path} disclosure ${index + 1} shows a summary and hides a body`, () => {
        assert.ok(disclosure.summary.length > 0, "a <details> with nothing on its summary line");
        assert.ok(bodyText(disclosure.body).length > 0, "a <details> that folds nothing away");
      });

      it(`${path} disclosure ${index + 1} asks rather than answers`, () => {
        // Interpolated summaries are built from data, not prose — copy-audit
        // skips them for the same reason.
        if (disclosure.summary.includes("{")) return;
        const hidden = bodyText(disclosure.body).slice(0, 300);
        const shared = [...phrases(disclosure.summary)].filter((p) => phrases(hidden).has(p));
        assert.deepEqual(
          shared,
          [],
          `"${disclosure.summary}" states the answer it is hiding: "${shared[0]}"`,
        );
      });
    }
  }

  it("no Overview summary carries the banned separator", () => {
    for (const path of OWNED) {
      for (const disclosure of disclosures(src(path))) {
        assert.ok(!disclosure.summary.includes("·"), `${path}: a summary is a name, not a compound`);
      }
    }
  });
});
