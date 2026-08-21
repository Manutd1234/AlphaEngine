/**
 * The research tab's progressive-disclosure sweep, pinned so it stays honest.
 *
 * A deletion sweep and a disclosure sweep look identical from the outside: both
 * make the page shorter. Only one of them still knows what it knew. So every
 * assertion here is paired — the sentence must be BEHIND a fold, and the same
 * sentence must still be IN the file, word for word. A regression that deletes
 * a caveat instead of folding it fails the second half of its own pair.
 *
 * The other half of the file is the honesty floor, which a fold must never
 * cross. Four shapes may not go behind a summary, and they are not a matter of
 * taste:
 *
 *   - An EMPTY STATE. A panel whose "nothing to show" is folded reads as broken.
 *   - A NULL EXPLANATION that is the panel's only content. Fold it and the card
 *     is a heading over two dashes.
 *   - A SAFETY statement — paper order, no funds, no real venue, not advice.
 *   - A figure a reader acts on, and the sentence that qualifies it.
 *
 * Each of those is listed below with the file it lives in, and the test asserts
 * it is reachable with nothing opened.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/** The files this sweep owns: the research tab and the two panels beside it. */
const RESEARCH_FILES = [
  "components/ResearchWorkspace.tsx",
  "components/Controls.tsx",
  "components/Verdict.tsx",
  ...readdirSync(join(root, "components/research"))
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => `components/research/${entry}`),
];

/** Comments blanked. A comment is not on screen, and cannot satisfy a fold. */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (_m, lead: string) => lead);

const ENTITIES: Record<string, string> = {
  "&apos;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ndash;": "–",
  "&mdash;": "—",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&amp;": "&",
  "&nbsp;": " ",
};

/**
 * Source reduced to the words a reader would see.
 *
 * Only well-formed JSX tags are stripped — `<` followed by a letter or a slash.
 * A blanket `<[^>]*>` would eat from a `p < 0.001` comparison to the next
 * closing tag and quietly delete the prose in between, which is exactly the
 * kind of scan that passes by finding nothing.
 */
function prose(source: string): string {
  return stripComments(source)
    .replace(/\{\s*["'`]\s*["'`]\s*\}/g, " ")
    .replace(/<\/?[A-Za-z][^>]*>|<\/>/g, " ")
    .replace(/&[a-z]+;/g, (entity) => ENTITIES[entity] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Block {
  /** Everything between the opening tag and its matching `</details>`. */
  inner: string;
  start: number;
  end: number;
}

/**
 * Every `<details>` element, nesting-aware, and aware that an opening tag can
 * carry a `>` inside a brace — `onToggle={(event) => …}` is one, and a regex
 * that stops at the first `>` cuts that element in half.
 */
function detailsBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf("<details", from);
    if (at === -1) break;
    let i = at + "<details".length;
    let braces = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "{") braces += 1;
      else if (ch === "}") braces -= 1;
      else if (ch === ">" && braces === 0) break;
      i += 1;
    }
    const openEnd = i + 1;
    let j = openEnd;
    let depth = 1;
    while (depth > 0) {
      const nextOpen = source.indexOf("<details", j);
      const nextClose = source.indexOf("</details>", j);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        j = nextOpen + "<details".length;
      } else {
        depth -= 1;
        j = nextClose + "</details>".length;
      }
    }
    blocks.push({ inner: source.slice(openEnd, j - "</details>".length), start: at, end: j });
    from = j;
  }
  return blocks;
}

/** The page at rest: every fold removed, summary included. */
function atRest(source: string): string {
  let out = source;
  for (const block of detailsBlocks(source).reverse()) {
    out = out.slice(0, block.start) + " " + out.slice(block.end);
  }
  return prose(out);
}

/** A block's `<summary>`, as text. */
function summaryOf(inner: string): string {
  const at = inner.indexOf("<summary");
  if (at === -1) return "";
  const close = inner.indexOf("</summary>", at);
  if (close === -1) return "";
  return prose(inner.slice(inner.indexOf(">", at) + 1, close));
}

/** A block with its summary removed: what opening it actually buys. */
function bodyOf(inner: string): string {
  const close = inner.indexOf("</summary>");
  return prose(close === -1 ? inner : inner.slice(close + "</summary>".length));
}

/**
 * The sweep's ledger. `fact` is the sentence as a reader hears it; where the
 * body is interpolated, `token` names the expression that renders it and
 * `factIn` names the module the words actually live in.
 */
const MOVED: {
  file: string;
  summary: string;
  fact: string;
  token?: string;
  factIn?: string;
}[] = [
  {
    file: "components/research/RegimePanel.tsx",
    summary: "How were these regimes classified, and what can they not be used for?",
    token: "{regimes.note}",
    factIn: "lib/regimes.ts",
    fact: "hindsight, so it describes where returns came from and is not a tradable signal.",
  },
  {
    file: "components/research/FavouritesPanel.tsx",
    summary: "Which column flatters, and which one warns?",
    fact:
      "The in-sample column flatters every method by construction. A negative last column"
      + " means the portfolio lost to one of its own members out of sample.",
  },
  {
    file: "components/research/BenchmarkPanel.tsx",
    summary: "How much should these t-statistics be trusted?",
    fact:
      "Plain OLS t-statistics. A Newey–West correction for heteroskedastic, autocorrelated"
      + " returns would widen these standard errors, so the significance shown is generous.",
  },
  {
    file: "components/research/StabilityPanel.tsx",
    summary: "What counts as a neighbour on this grid?",
    fact:
      "Adjacency is in grid-index space — with a step of 5, the neighbour of 25 is 20,"
      + " because 24 was never tested.",
  },
  {
    file: "components/research/SizingPanel.tsx",
    summary: "How reliable are the odds behind this fraction?",
    fact:
      "These odds are estimates from an already-optimised search, so they are biased upward"
      + " and over-betting hurts super-linearly.",
  },
  {
    file: "components/research/WalkForwardTimeline.tsx",
    summary: "Which window does a fold trade, and what does the gap mean?",
    fact:
      "Each fold trades the window after the one it fitted; the in-sample →"
      + " out-of-sample gap is the overfitting.",
  },
];

/** The honesty floor: reachable with nothing opened, or the panel is lying. */
const STAYS: { file: string; why: string; fragments: string[] }[] = [
  {
    file: "components/research/SignalDAGViewer.tsx",
    why: "SAFETY — the sandbox statement for the whole signal path",
    fragments: [
      "Consolidated depth through the pre-trade battery to a paper order: no funds, no real venue.",
      "Each stage is read from the health snapshot.",
    ],
  },
  {
    file: "components/research/SizingPanel.tsx",
    why: "SAFETY, and every banner qualifying the recommended fraction",
    fragments: [
      "This candidate has not cleared the promotion gate",
      "The sizing below is arithmetic on the sweep's own numbers, not advice.",
      "trades the standard error on R is wide enough that the honest reading is",
      "Payoff ratio is undefined, not infinite.",
      "Negative Kelly — no edge at these odds.",
      "Capped at the single-strategy ceiling.",
    ],
  },
  {
    file: "components/research/BenchmarkPanel.tsx",
    why: "NULL EXPLANATION, and the clause that stops Alpha reading as an edge",
    fragments: [
      "No benchmark selected. Alpha and beta need an instrument other than the one this",
      "strategy trades, so both are withheld.",
      "The Summary stat row already answers whether the timing helped.",
      "Only a second instrument answers whether the position was worth holding.",
      "Ordinary least squares on",
      "does not explain — not, on its own, evidence of an edge.",
    ],
  },
  {
    file: "components/research/FactorPanel.tsx",
    why: "NULL EXPLANATION in the !report branch, and the panel's stated scope caveat",
    fragments: [
      "The regression could not be estimated: too few bars, or a perfectly collinear factor",
      "set on this series.",
      "Strategy return regressed on three factors built from this instrument's own bars.",
      "A large loading means the edge is that exposure.",
    ],
  },
];

describe("the research disclosure sweep reads what it is checking", () => {
  it("loads every research source, non-empty", () => {
    // A scan of an empty string passes every doesNotMatch ever written.
    assert.ok(RESEARCH_FILES.length >= 20, `expected the research tree, found ${RESEARCH_FILES.length}`);
    for (const file of RESEARCH_FILES) {
      assert.ok(read(file).trim().length > 200, `${file} loaded empty or near-empty`);
    }
  });

  it("finds the folds it is meant to be checking", () => {
    const folds = RESEARCH_FILES.flatMap((file) => detailsBlocks(read(file)));
    assert.ok(folds.length >= MOVED.length, `expected at least ${MOVED.length} folds, found ${folds.length}`);
  });
});

describe("every fact moved behind a fold is still a fact", () => {
  for (const moved of MOVED) {
    const source = read(moved.file);
    const needle = moved.token ?? moved.fact;

    it(`${moved.file}: the sentence survives the move`, () => {
      // A disclosure sweep that deleted this would otherwise look like success.
      const home = moved.factIn ?? moved.file;
      assert.ok(
        prose(read(home)).includes(moved.fact),
        `the words are gone from ${home}, not folded: "${moved.fact}"`,
      );
    });

    it(`${moved.file}: the sentence renders inside a details`, () => {
      const holder = detailsBlocks(source).find((block) =>
        moved.token ? block.inner.includes(moved.token) : prose(block.inner).includes(moved.fact));
      assert.ok(holder, `nothing folds "${needle}" in ${moved.file}`);
      assert.ok(bodyOf(holder.inner).length > 0, "the fold has no body");
    });

    it(`${moved.file}: it is not also on screen at rest`, () => {
      // Folded AND still printed above the fold is not a sweep, it is a second
      // copy. Cut the blocks out of the RAW source before blanking comments:
      // every offset a block carries was measured against that string, and
      // stripping first slides them all left by however long the comments were.
      let outside = source;
      for (const block of detailsBlocks(source).reverse()) {
        outside = outside.slice(0, block.start) + " " + outside.slice(block.end);
      }
      assert.ok(prose(outside).length > 0, "the at-rest scan found nothing to scan");
      if (moved.token) {
        assert.ok(
          !stripComments(outside).includes(moved.token),
          `${moved.token} still renders outside the fold`,
        );
      } else {
        assert.ok(!prose(outside).includes(moved.fact), `"${moved.fact}" is still on screen at rest`);
      }
    });

    it(`${moved.file}: its summary asks the question`, () => {
      const holder = detailsBlocks(source).find((block) =>
        moved.token ? block.inner.includes(moved.token) : prose(block.inner).includes(moved.fact));
      assert.ok(holder, `no fold to read a summary from in ${moved.file}`);
      assert.equal(summaryOf(holder.inner), moved.summary);
    });
  }
});

describe("the honesty floor is reachable with nothing opened", () => {
  for (const stay of STAYS) {
    it(`${stay.file}: ${stay.why}`, () => {
      const rest = atRest(read(stay.file));
      assert.ok(rest.length > 100, `the at-rest scan of ${stay.file} found nothing to scan`);
      for (const fragment of stay.fragments) {
        assert.ok(rest.includes(fragment), `folded, or gone, and it may be neither: "${fragment}"`);
      }
    });
  }
});

describe("every fold on the research tab is a real bargain", () => {
  it("each has a summary and something behind it", () => {
    const empty: string[] = [];
    for (const file of RESEARCH_FILES) {
      for (const block of detailsBlocks(read(file))) {
        if (!summaryOf(block.inner)) empty.push(`${file}: a fold with no summary`);
        else if (!bodyOf(block.inner)) empty.push(`${file}: "${summaryOf(block.inner)}" hides nothing`);
      }
    }
    assert.deepEqual(empty, []);
  });

  it("no summary states the answer it is hiding", () => {
    // The same four-word invariant `copy-audit.test.ts` holds the whole tree
    // to, restated here so this sweep fails on its own terms rather than on a
    // neighbour's. A summary names a question; opening it buys the answer.
    const phrases = (text: string, n = 4) => {
      const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
      return new Set(Array.from({ length: Math.max(0, words.length - n + 1) },
        (_, i) => words.slice(i, i + n).join(" ")));
    };
    const offenders: string[] = [];
    for (const file of RESEARCH_FILES) {
      for (const match of read(file).matchAll(/<summary>([^<]{10,})<\/summary>([\s\S]{0,400})/g)) {
        const summary = match[1].replace(/\s+/g, " ").trim();
        if (summary.includes("{")) continue;
        const body = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300);
        const bodyPhrases = phrases(body);
        const repeated = [...phrases(summary)].filter((phrase) => bodyPhrases.has(phrase));
        if (repeated.length) offenders.push(`${file}: "${summary}" repeats "${repeated[0]}"`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
