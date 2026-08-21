/**
 * The Risk tab's progressive-disclosure sweep, pinned so it cannot become a
 * deletion sweep by accident.
 *
 * A previous pass measured the tab and stopped: what was left was load-bearing
 * prose, and removing any of it would have cost the desk a fact. The lever that
 * remains is not "say less" but "say it later" — a methodology note, a scope
 * caveat, a "why this is withheld" explanation each stay in the DOM, byte for
 * byte, and move behind a `<details>` so the tab reads short at rest.
 *
 * THE FAILURE MODE THIS FILE EXISTS FOR
 * ------------------------------------------------------------------------
 * A disclosure sweep and a deletion sweep produce the same screenshot. Both
 * shorten the page; only one of them still knows the thing it stopped saying.
 * So every sentence this sweep moved is asserted PRESENT, verbatim, in the file
 * that used to render it openly — a diff that quietly dropped one would light
 * this suite up rather than looking like a bigger win.
 *
 * THE HONESTY FLOOR
 * ------------------------------------------------------------------------
 * Four kinds of sentence may never be folded, because folding them makes the
 * desk lie by omission rather than merely read long: an EMPTY STATE (a kicker
 * over blank space is indistinguishable from broken); a NULL EXPLANATION that
 * is a panel's only content (the one thing separating a deliberate blank from
 * a bug); a SAFETY statement (two destructive-looking buttons with nothing
 * beside them saying they cannot fire is the worst screen on the desk); and a
 * figure a reader ACTS on, with any caveat that changes what it means — fold
 * "this total is understated" and someone sizes against a number they believe
 * is complete. Each is named below with its reason attached, so a future fold
 * fails with an argument rather than a diff.
 *
 * `tests/copy-audit.test.ts` holds the tree-wide rule that a `<summary>` may not
 * repeat a contiguous four-word phrase from what it hides. It is re-run here
 * over just these six files, so this suite fails on its own terms rather than
 * pointing at another one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource, stripCode } from "./helpers/source-files";

/** The six files the Risk tab draws itself from. */
const PATHS = [
  "components/RiskWorkspace.tsx",
  "components/portfolio/RiskEngine.tsx",
  "components/portfolio/StressTest.tsx",
  "components/portfolio/VarBacktestChart.tsx",
  "components/portfolio/OracleVarPanel.tsx",
  "components/portfolio/ExposureHeatmap.tsx",
] as const;

type Path = (typeof PATHS)[number];

/**
 * Raw text and comment-stripped code for each file, read once. Both forms are
 * needed: several of these files carry comments that mention `<details>` by
 * name while explaining why one is or is not there, and a depth scanner that
 * counted those would nest itself into nonsense.
 */
const raw = new Map<Path, string>();
const code = new Map<Path, string>();
for (const path of PATHS) {
  const text = readSource(path);
  raw.set(path, text);
  code.set(path, stripCode(text));
}

/** JSX wraps prose across lines at whatever indent it lands on. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * Is `index` inside an open `<details>`?
 *
 * Counts opens against closes up to that point rather than pairing tags, which
 * is enough for a depth question and survives the nested `<details>` this tree
 * already has (PipelineRestTrace has one; the Risk tab may grow one).
 */
function foldDepthAt(source: string, index: number): number {
  let depth = 0;
  for (const tag of source.matchAll(/<details\b|<\/details>/g)) {
    if ((tag.index ?? 0) >= index) break;
    depth += tag[0] === "</details>" ? -1 : 1;
  }
  return depth;
}

/**
 * Where a sentence sits, or `null` if it is not in the file at all. Whitespace
 * is flattened on both sides, so the answer indexes the FLATTENED source —
 * which is what `foldDepthAt` is handed, flattening moving no tag past another.
 */
function locate(path: Path, sentence: string): number | null {
  const at = flat(code.get(path) as string).indexOf(flat(sentence));
  return at === -1 ? null : at;
}

/** A sentence that moved behind a fold: still in the file, now folded. */
interface Moved {
  path: Path;
  text: string;
  /** Why it was safe to fold — none of the four must-stay kinds. */
  because: string;
}

/** A sentence that must stay on screen at rest, with the reason it must. */
interface Visible {
  path: Path;
  text: string;
  because: string;
}

const MOVED: Moved[] = [
  {
    path: "components/portfolio/VarBacktestChart.tsx",
    text:
      "Today&apos;s signed notionals replayed over {points.length + series.window} daily returns — a "
      + "counterfactual about this book&apos;s composition, not what the desk earned.",
    because:
      "Methodology: which returns were replayed and over what. It names no figure a reader "
      + "sizes against, and the chart, its legend, the exception rug and the exception table "
      + "all stay on screen beside it.",
  },
  {
    path: "components/portfolio/VarBacktestChart.tsx",
    text:
      "The forecast is a {series.window}-bar rolling sigma, a tighter window than the covariance "
      + "behind the headline VaR above: related estimators, not the same one.",
    because:
      "The second half of the same methodology note: which estimator drew the band, and how it "
      + "differs from the one behind the headline VaR. A correction to no verdict.",
  },
  {
    path: "components/portfolio/VarBacktestChart.tsx",
    text:
      "Dates are not shown: the instruments&apos; bar times did not agree at every index, so the "
      + "axis is the observation number.",
    because:
      "A why-this-is-withheld note and nothing else. The ordinal axis labels themselves stay "
      + "drawn; only the reason for them folds, directly under the axis that prompts the question.",
  },
  {
    path: "components/portfolio/StressTest.tsx",
    text:
      "Untouched rows move by their measured beta against {referenceSymbol}. A row at 0% is "
      + "pinned flat, not left alone.",
    because:
      "A methodology note on sparse-record semantics, already double-encoded on screen: ShockRow "
      + "draws a literal β for an unset slider, and the per-position table's Source column reads "
      + "\"pinned\" against a hand-set row. The summary points at the SLIDER, not at beta, because "
      + "the foot-gun it guards is dragging a slider to 0% meaning \"leave this one alone\".",
  },
];

const VISIBLE: Visible[] = [
  {
    path: "components/portfolio/VarBacktestChart.tsx",
    text: "Generated notionals, measured returns: real Binance closes on an invented book.",
    because:
      "SAFETY. It says the notionals are invented. It was interpolated INTO the middle of the "
      + "methodology paragraph that folded, so folding that paragraph would have taken it along "
      + "as a passenger — it needs its own visible line, which is why this assertion exists at "
      + "all rather than being obvious.",
  },
  {
    path: "components/RiskWorkspace.tsx",
    text:
      "This workspace holds no gateway credential and cannot move risk. These compose the "
      + "authenticated request your gateway would gate and audit.",
    because:
      "SAFETY. It is the sentence that makes \"Flatten the book\" and \"Halt trading\", rendered "
      + "immediately below it, read as request composers rather than live controls.",
  },
  {
    path: "components/RiskWorkspace.tsx",
    text: "A flat book has no exposure for a shock to move. Load the sandbox to see the engine.",
    because:
      "EMPTY STATE, and the entire content of the scenarios panel when the book is empty. Behind "
      + "a fold the subtab renders a kicker, a heading and blank space.",
  },
  {
    path: "components/RiskWorkspace.tsx",
    text: "sandbox thresholds — same limits, generated book",
    because:
      "SAFETY. It says the book under these limits is generated, and it is a heading meta span "
      + "rather than prose beneath a heading, so there is no body for a fold to hold.",
  },
  {
    path: "components/portfolio/RiskEngine.tsx",
    text:
      "Not enough price history for a covariance: this needs at least 20 aligned observations per "
      + "instrument. Nothing is shown rather than a figure built on an assumed correlation.",
    because:
      "NULL EXPLANATION and the card's only content in the early return. It is the sole thing "
      + "distinguishing \"we withheld this\" from \"this is broken\".",
  },
  {
    path: "components/portfolio/RiskEngine.tsx",
    text: "Realised losses are fatter than the normal model.",
    because:
      "A figure a reader ACTS on, inside a role=\"status\" banner that ends in a position-sizing "
      + "instruction. It fires only when the tail gap exceeds 15% of parametric VaR, so it is on "
      + "screen exactly when it matters.",
  },
  {
    path: "components/portfolio/RiskEngine.tsx",
    text: "Size against the historical figure.",
    because: "The instruction the banner above exists to deliver.",
  },
  {
    path: "components/portfolio/RiskEngine.tsx",
    text:
      "Excluded for want of price history: {missing.join(\", \")}. Total risk is understated by "
      + "whatever those carry.",
    because:
      "Reads as a movable scope caveat and is not one: it states that the four VaR tiles directly "
      + "above are understated, while the banner beside them tells the reader to size against one "
      + "of those figures.",
  },
  {
    path: "components/portfolio/RiskEngine.tsx",
    text: "Scored on the next bar, never on data it was fitted to.",
    because:
      "A genuine methodology note left visible anyway: at eleven words it is shorter than an "
      + "honest summary asking the question would be, so a fold would cost lines rather than save "
      + "them. Folded here, it would also strand the Kupiec verdict it is appended to.",
  },
];

describe("the Risk tab's sources are actually being read", () => {
  // A scan of an empty string passes every doesNotMatch and every depth check
  // in this file. Without this test the whole suite could be green over nothing.
  it("every file loads with content and renders a component", () => {
    for (const path of PATHS) {
      const text = raw.get(path) as string;
      assert.ok(text.length > 500, `${path} read as ${text.length} chars — too short to be real`);
      assert.match(text, /export default function/, `${path} renders no component`);
    }
  });

  it("the fold scanner finds the folds it is meant to be measuring", () => {
    const folds = PATHS.reduce(
      (n, path) => n + [...(code.get(path) as string).matchAll(/<details\b/g)].length,
      0,
    );
    assert.ok(folds >= 4, `expected at least four disclosures across the Risk tab, found ${folds}`);
  });
});

describe("no fact was deleted: everything moved is still in the file", () => {
  for (const { path, text } of MOVED) {
    it(`${path.split("/").pop()} still says "${text.slice(0, 46)}…"`, () => {
      assert.notEqual(
        locate(path, text),
        null,
        `this sentence is GONE from ${path}, not folded. A disclosure sweep that deleted it `
        + `would otherwise read as a bigger win:\n    ${text}`,
      );
    });
  }
});

describe("everything moved is behind a fold, or the sweep did nothing", () => {
  for (const { path, text, because } of MOVED) {
    it(`${path.split("/").pop()}: "${text.slice(0, 46)}…" is folded`, () => {
      const at = locate(path, text);
      assert.notEqual(at, null, `sentence missing from ${path}`);
      assert.ok(
        foldDepthAt(flat(code.get(path) as string), at as number) > 0,
        `this is still on screen at rest in ${path}; the sweep claims it moved.\n    ${because}`,
      );
    });
  }
});

describe("the honesty floor: these stay on screen at rest", () => {
  for (const { path, text, because } of VISIBLE) {
    it(`${path.split("/").pop()}: "${text.slice(0, 46)}…" is not folded`, () => {
      const at = locate(path, text);
      assert.notEqual(at, null, `this sentence has been deleted from ${path}:\n    ${text}`);
      assert.equal(
        foldDepthAt(flat(code.get(path) as string), at as number),
        0,
        `this has been folded and it may not be:\n    ${because}`,
      );
    });
  }
});

describe("every fold on this tab is a real bargain with the reader", () => {
  /**
   * `<details>` blocks in the six files, paired by depth so a nested one is
   * measured as its own fold rather than swallowing its parent's close tag.
   */
  function folds(source: string): Array<{ open: number; end: number }> {
    const out: Array<{ open: number; end: number }> = [];
    const stack: number[] = [];
    for (const tag of source.matchAll(/<details\b|<\/details>/g)) {
      const at = tag.index ?? 0;
      if (tag[0] === "</details>") {
        const open = stack.pop();
        if (open !== undefined) out.push({ open, end: at });
      } else stack.push(at);
    }
    assert.deepEqual(stack, [], "a <details> is never closed");
    return out;
  }

  it("each has a non-empty summary and a non-empty body", () => {
    let checked = 0;
    for (const path of PATHS) {
      for (const { open, end } of folds(code.get(path) as string)) {
        const block = (code.get(path) as string).slice(open, end);
        const summary = block.match(/<summary>([\s\S]*?)<\/summary>/);
        assert.ok(summary, `a <details> in ${path} has no <summary>`);
        const named = (summary as RegExpMatchArray)[1].replace(/<[^>]+>/g, " ").trim();
        assert.ok(named.length > 0, `a <summary> in ${path} names nothing`);
        const body = block.slice(block.indexOf("</summary>") + "</summary>".length).trim();
        assert.ok(body.length > 0, `the fold "${named}" in ${path} hides nothing`);
        assert.match(
          body,
          /[<{]/,
          `the fold "${named}" in ${path} hides no element and no value`,
        );
        checked += 1;
      }
    }
    assert.ok(checked >= 4, `expected at least four folds to check, checked ${checked}`);
  });

  /**
   * The same invariant `tests/copy-audit.test.ts` holds tree-wide, re-run over
   * these six files. A summary is a question; paying to open it must buy an
   * answer that was not already given away. Four contiguous words is the
   * narrow, unarguable form of "already given away" — a looser overlap measure
   * punishes a summary for naming its own subject, which it must do.
   */
  it("no summary repeats a four-word phrase from the first 300 chars it hides", () => {
    const phrases = (text: string, n = 4) => {
      const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
      return new Set(
        Array.from({ length: Math.max(0, words.length - n + 1) }, (_, i) =>
          words.slice(i, i + n).join(" ")),
      );
    };

    const offenders: string[] = [];
    let seen = 0;
    for (const path of PATHS) {
      const source = code.get(path) as string;
      for (const match of source.matchAll(/<summary>([^<]{10,})<\/summary>([\s\S]{0,400})/g)) {
        const summary = match[1].replace(/\s+/g, " ").trim();
        // Interpolated summaries are built from data, not prose.
        if (summary.includes("{")) continue;
        seen += 1;
        const body = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);
        const shared = phrases(body);
        const repeated = [...phrases(summary)].filter((p) => shared.has(p));
        if (repeated.length) offenders.push(`${path}: "${summary}" repeats "${repeated[0]}"`);
      }
    }
    assert.ok(seen >= 3, `expected at least three prose summaries on this tab, found ${seen}`);
    assert.deepEqual(
      offenders,
      [],
      `these summaries answer what they are hiding:\n    ${offenders.join("\n    ")}`,
    );
  });

  /**
   * The summaries this sweep wrote, pinned by shape rather than by string.
   *
   * A question mark is not decoration here: it is the whole difference between
   * "What happens to a slider you never touch?" and "A row at 0% is pinned
   * flat", which is the body. The four-gram rule above cannot see a summary
   * that answers in different words; this can see that it stopped asking.
   */
  it("the three new summaries ask a question", () => {
    const asked = [
      ["components/portfolio/VarBacktestChart.tsx", "What window and which returns produced this forecast?"],
      ["components/portfolio/VarBacktestChart.tsx", "Why does the axis count observations?"],
      ["components/portfolio/StressTest.tsx", "What happens to a slider you never touch?"],
    ] as const;
    for (const [path, summary] of asked) {
      assert.ok(
        summary.endsWith("?"),
        `this suite's own expectation is malformed: "${summary}" does not ask`,
      );
      assert.ok(
        (code.get(path as Path) as string).includes(`<summary>${summary}</summary>`),
        `${path} does not carry the summary this sweep wrote: "${summary}"`,
      );
    }
  });
});
