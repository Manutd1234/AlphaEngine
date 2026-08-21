/**
 * The progressive-disclosure sweep on the reliability tab, pinned.
 *
 * A previous pass tried to make this tab read shorter by DELETING, got 188
 * words out of 10,086 and stopped, correctly: what was left was load-bearing.
 * The lever that remains is disclosure — a scope caveat or a methodology note
 * stays in the DOM word for word and moves behind a `<details>`, so the tab is
 * shorter at rest and nothing has been given up.
 *
 * That trade is only honest if two things are true at once, and a sweep can
 * quietly break either while looking like a success:
 *
 *   1. The prose SURVIVED. A deletion and a disclosure produce the same
 *      screenshot at rest. Only reading the file tells them apart, so every
 *      sentence this sweep moved is asserted present, verbatim, below.
 *   2. The things that must NOT fold are still unfolded. Empty states, null
 *      explanations, safety statements and costs beside the buttons that spend
 *      them are exactly the copy a reader would be wrong not to have seen —
 *      `13-warm-bright-pass.css` states the rule over `.disclosure` itself:
 *      "a formula does not [change what someone believes], a limit does".
 *
 * Everything here reads real file content off disk. Each group asserts its
 * sources loaded first, because a scan of an empty string satisfies every
 * `doesNotMatch` in the file and proves nothing — the same trap
 * `copy-audit.test.ts` documents after a `slice(-1)` quietly scanned one byte.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/** The reliability tab: the console shell and every panel it mounts. */
const OWNED = [
  "components/ReliabilityConsole.tsx",
  ...readdirSync(join(root, "components/systems"))
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => `components/systems/${entry}`),
];

const SOURCES = new Map(OWNED.map((path) => [path, read(path)]));

/** Tags stripped, whitespace collapsed: what a reader would actually read. */
const prose = (source: string) =>
  source
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;/g, "’")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The `[start, end)` span of every `<details>` element in a source.
 *
 * A stack rather than a regex pair, because these nest — `PipelineRestTrace`
 * puts a payload `<details>` inside a `.disclosure` — and a flat match would
 * report the outer element's end for the inner one.
 */
function detailsRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const open: number[] = [];
  for (const match of source.matchAll(/<details\b|<\/details>/g)) {
    if (match[0] === "</details>") {
      const start = open.pop();
      assert.notEqual(start, undefined, "an unmatched </details> — this scanner cannot be trusted");
      ranges.push([start as number, match.index + match[0].length]);
    } else {
      open.push(match.index);
    }
  }
  assert.deepEqual(open, [], "an unclosed <details> — this scanner cannot be trusted");
  return ranges;
}

/** Is `needle` inside a fold in this file? Throws if the needle is not there. */
function foldedIn(path: string, needle: string): boolean {
  const source = SOURCES.get(path);
  assert.ok(source && source.length > 500, `${path} did not load`);
  const at = source.indexOf(needle);
  assert.notEqual(at, -1, `${path} no longer contains: ${needle.slice(0, 90)}`);
  return detailsRanges(source).some(([start, end]) => at > start && at < end);
}

/** Contiguous n-word phrases, lowercased — the copy audit's own measure. */
const phrases = (text: string, n = 4) => {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(
    Array.from({ length: Math.max(0, words.length - n + 1) }, (_, i) => words.slice(i, i + n).join(" ")),
  );
};

describe("the sources this file is about are actually loaded", () => {
  it("reads the console and every systems panel", () => {
    // Without this the whole file is a scan of nothing. `OWNED` is built by
    // reading the directory, so a renamed panel widens the scan instead of
    // silently dropping out of it.
    assert.ok(OWNED.length >= 20, `expected the reliability panel set, found ${OWNED.length}`);
    for (const [path, source] of SOURCES) {
      assert.ok(source.length > 200, `${path} loaded empty`);
    }
  });
});

// --------------------------------------------------------------------------
// 1 — nothing was deleted. Every sentence the sweep moved is still here.
// --------------------------------------------------------------------------

describe("a disclosure is not a deletion", () => {
  /**
   * Each entry: the file, the sentence verbatim (tags stripped, whitespace
   * collapsed, exactly as it will read once opened), and whether the sweep
   * claims to have folded it. `folded: true` is what separates this from a
   * presence check — it fails if the prose is on screen at rest, AND the
   * presence assertion inside `foldedIn` fails if it was cut instead.
   */
  /* One entry per line from here down. `file-size.test.ts`'s 400-line ceiling
     reaches `tests/` as of 2026-08-21, and a suite that cannot record what the
     next sweep moved is a suite that has stopped guarding. No entry lost a
     character in the reflow; the strings are the assertions. */
  const MOVED = [
    { path: "components/systems/HealthMatrix.tsx", what: "the decision p99 methodology note",
      sentence: "Decision p99 (header chip) — in-process inside the gateway, pushed with the ops snapshot; every sample since start, excluding kernel and wire." },
    { path: "components/systems/HealthMatrix.tsx", what: "the upstream p99 methodology note",
      sentence: "Upstream p99 (this table) — network, polled from this browser; nearest-rank over the rolling 15-minute pool, failures included; shown after 20 samples." },
    { path: "components/systems/RouteLatencyBars.tsx", what: "the in-process measurement boundary and the thin-row reading key",
      sentence: "Measured inside the gateway process : handler time, not the round trip a browser pays and not exchange order-to-ack. Sorted slowest first by p95; a route with fewer than {MIN_SAMPLES} samples prints its numbers and draws no bar." },
    /* A second pass, three folds, each split from something that had to stay —
       which is why each is pinned on both sides. The reconciliation note kept
       its price and folded its method; the MTTR refusal kept its headline and
       its truncation caveat and folded its reasoning; the quarantine footnote
       folded whole, scope and handling being provenance, with none of the
       evidence — the evaluated/passed figures, both empty states, every flagged
       excerpt — ever having been in that paragraph. The halves that stayed are
       in the honesty floor below, each named by the kind that held it there. */
    { path: "components/systems/CrossSourceCheck.tsx", what: "what a median across sources catches",
      sentence: "Each leg&apos;s distance from the median, the only check here that catches a stale price served with HTTP 200." },
    { path: "components/systems/RemediationLedger.tsx", what: "the reasoning under the MTTR refusal",
      sentence: "The sample surviving a bounded ring is biased short, so a trend through it would slope toward a recovery time nobody achieved." },
    { path: "components/systems/QuarantinePanel.tsx", what: "the gateway-ledger scope of the counts",
      sentence: "the counts are the gateway's durable ledger, merged across instances, kept across restarts; the excerpts are this instance's bounded buffer." },
    { path: "components/systems/QuarantinePanel.tsx", what: "the per-instance scope of the counts",
      sentence: "this health-route instance only, bounded in memory — not every route, provider, symbol or instance." },
    { path: "components/systems/QuarantinePanel.tsx", what: "how a rejected payload and a retained excerpt are handled",
      sentence: "Rejected payloads were never cached; excerpts follow the redaction rules." },
  ] as const;

  for (const { path, what, sentence } of MOVED) {
    it(`${path.split("/").pop()} keeps ${what}, word for word`, () => {
      const source = SOURCES.get(path);
      assert.ok(source && source.length > 500, `${path} did not load`);
      assert.ok(
        prose(source).includes(sentence),
        `this sweep was meant to MOVE this sentence, not remove it:\n    ${sentence}`,
      );
    });
  }

  it("and each of them is genuinely behind a fold, not merely still present", () => {
    // The other half of the bargain. If a sentence is present and unfolded the
    // sweep did nothing; if it is absent `foldedIn` fails on the lookup above.
    assert.ok(
      foldedIn("components/systems/HealthMatrix.tsx", "<strong>Decision p99 (header chip)</strong>"),
      "the tail-latency methodology is still on screen at rest",
    );
    assert.ok(
      foldedIn("components/systems/RouteLatencyBars.tsx", "not exchange order-to-ack"),
      "the route-timing caveat is still on screen at rest",
    );
    for (const [path, needle] of [
      ["components/systems/CrossSourceCheck.tsx", "the only check here that catches a stale price"],
      ["components/systems/RemediationLedger.tsx", "The sample surviving a bounded ring is biased"],
      ["components/systems/QuarantinePanel.tsx", "excerpts follow the redaction rules"],
    ] as const) assert.ok(foldedIn(path, needle), `${path}: the second pass's prose is still on screen at rest`);
  });
});

// --------------------------------------------------------------------------
// 2 — the honesty floor. These may never be behind a fold.
// --------------------------------------------------------------------------

describe("what a reader would be wrong not to have seen stays on screen", () => {
  /**
   * Four kinds, and the kind is the reason:
   *
   *   SAFETY — the blast radius of a control, or that this desk is paper-only
   *   and unauthenticated. Behind a fold, a reader mid-incident has to open
   *   something to find out what a button cannot reach.
   *
   *   COST — what an action spends. A cost you must open a fold to find is a
   *   cost you meet after clicking.
   *
   *   EMPTY STATE — a panel with nothing to show says so. Folded, it is a
   *   panel that looks broken.
   *
   *   NULL EXPLANATION — why a figure is withheld, when the explanation is all
   *   the panel has. Folded, the panel is blank.
   */
  const VISIBLE = [
    { path: "components/systems/OperatorPanel.tsx", kind: "SAFETY", needle: "<strong>These are not fleet or trading controls.</strong>" },
    { path: "components/systems/HealthMatrix.tsx", kind: "COST and SAFETY", needle: "Test spends one real provider call." },
    { path: "components/systems/HealthMatrix.tsx", kind: "COST and SAFETY", needle: "Neither reaches another instance or the trading" },
    { path: "components/systems/OperatorGuard.tsx", kind: "SAFETY", needle: "<strong>Demo deployment: operator actions are open to anyone with this URL.</strong>" },
    { path: "components/systems/OperatorGuard.tsx", kind: "SAFETY", needle: "<strong>Actions are disabled on this deployment.</strong>" },
    { path: "components/systems/OperatorGuard.tsx", kind: "handling promise", needle: "session storage; gone when the tab closes, never logged." },
    { path: "components/systems/RouteLatencyBars.tsx", kind: "EMPTY STATE", needle: "No gateway ops snapshot in this deployment." },
    { path: "components/systems/RouteLatencyBars.tsx", kind: "EMPTY STATE", needle: "The gateway answered but has recorded no route timing in the last" },
    { path: "components/systems/HealthMatrix.tsx", kind: "EMPTY STATE", needle: "No providers are registered." },
    { path: "components/systems/HealthMatrix.tsx", kind: "EMPTY STATE", needle: "Loading provider health…" },
    { path: "components/systems/ReliabilityPlatform.tsx", kind: "EMPTY STATE", needle: "Authoritative gateway" },
    /* The second pass folded three things and put these four back, each named
       by the kind that stopped it. The recovery rate is not printed below
       MIN_TRIPS_FOR_RATE and this sentence is the only reason a reader can see
       for the missing percentage. The MTTR headline and the truncation caveat
       are the halves that fold left standing — a chart absent by decision says
       so unopened, and eviction changes what the counts above MEAN. The
       reconciliation price is what its note kept, on the line above the button
       that spends it. Four more were weighed and refused for the same reasons,
       and did not need a new pin to hold them: OutageIncidents' "says nothing
       about whether the providers are healthy" (an empty state's whole point),
       QuotaMeters' "a timeout still costs a unit" (cost), LatencyTrend's "gaps
       are polls below" (the key to a gap being read right now) and
       PipelineSocketTrace's "no streaming venue coverage" (empty state). */
    { path: "components/systems/RemediationLedger.tsx", kind: "NULL EXPLANATION", needle: "A recovery rate is withheld below" },
    { path: "components/systems/RemediationLedger.tsx", kind: "REFUSAL HEADLINE", needle: "<strong>No MTTR trend is drawn.</strong>" },
    { path: "components/systems/RemediationLedger.tsx", kind: "CAVEAT ON A FIGURE", needle: "the counts above are a floor." },
    { path: "components/systems/CrossSourceCheck.tsx", kind: "COST", needle: "This check spends a call per provider, so it runs only when you ask." },
    /**
     * The one candidate this sweep surveyed and did NOT move, recorded here so
     * the next reader knows it was weighed rather than missed.
     *
     * It is a scope caveat and it would qualify, but it is written as a
     * grammatical continuation of the table's label — "Direct venue clients —
     * reached by …" is one sentence, and a `<summary>` can only cut it in half.
     * Worse, it lives inside `<p className="console-subhead">`: `<details>` is
     * flow content, so a browser would close that paragraph to make room for
     * it and `.console-subhead small` would stop styling the text. Nineteen
     * words hidden behind nine words of summary, in exchange for a split
     * sentence and lost styling, is a worse screen rather than a shorter one.
     */
    {
      path: "components/systems/HealthMatrix.tsx",
      kind: "not worth folding",
      needle: "so they have no failover chain and no breaker.",
    },
  ] as const;

  for (const { path, kind, needle } of VISIBLE) {
    it(`${kind} — ${path.split("/").pop()}: "${needle.replace(/<[^>]+>/g, "").trim().slice(0, 52)}"`, () => {
      assert.equal(
        foldedIn(path, needle),
        false,
        `this is a ${kind} statement and a reader must meet it without opening anything`,
      );
    });
  }
});

// --------------------------------------------------------------------------
// 3 — a summary asks; its body answers.
// --------------------------------------------------------------------------

describe("no summary states the answer it is hiding", () => {
  /**
   * The same invariant `copy-audit.test.ts` enforces tree-wide, restated here
   * over `<summary[^>]*>` rather than a bare `<summary>`: this sweep puts an
   * `id` on a summary so the header's latency chip can still land on it, and
   * the audit's regex would skip any summary carrying an attribute. A rule
   * that stops applying the moment you add an attribute is not a rule.
   */
  it("finds the summaries it is meant to be checking", () => {
    const found = OWNED.flatMap((path) =>
      [...(SOURCES.get(path) ?? "").matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)],
    );
    assert.ok(found.length >= 10, `expected the tab's disclosures, found ${found.length}`);
  });

  it("shares no contiguous four-word phrase with the first 300 characters it hides", () => {
    const offenders: string[] = [];
    for (const [path, source] of SOURCES) {
      for (const match of source.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]{0,600})/g)) {
        const summary = prose(match[1]);
        // Interpolated summaries are built from data, not written as prose.
        if (summary.includes("{") || summary.length < 10) continue;
        const body = prose(match[2]).slice(0, 300);
        const bodyPhrases = phrases(body);
        const repeated = [...phrases(summary)].filter((phrase) => bodyPhrases.has(phrase));
        if (repeated.length) offenders.push(`${path}: "${summary}" repeats "${repeated[0]}"`);
      }
    }
    assert.deepEqual(offenders, [],
      `these summaries answer their own question:\n    ${offenders.join("\n    ")}`);
  });
});

// --------------------------------------------------------------------------
// 4 — every fold is a real bargain: a question on the outside, prose inside.
// --------------------------------------------------------------------------

describe("every disclosure on this tab has both halves", () => {
  it("names a question on its summary and hides prose behind it", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const [path, source] of SOURCES) {
      for (const [start, end] of detailsRanges(source)) {
        const inner = source.slice(start, end);
        const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(inner);
        if (!summary) {
          offenders.push(`${path}: a <details> with no <summary> at all`);
          continue;
        }
        checked += 1;
        const label = prose(summary[1]);
        // Interpolated labels render text this scan cannot see.
        if (!label && !summary[1].includes("{")) offenders.push(`${path}: an empty <summary>`);
        const body = inner.slice(summary.index + summary[0].length, inner.length - "</details>".length);
        if (!prose(body) && !/\{/.test(body)) offenders.push(`${path}: "${label}" hides nothing`);
      }
    }
    assert.ok(checked >= 10, `expected the tab's disclosures, checked ${checked}`);
    assert.deepEqual(offenders, [], `broken disclosures:\n    ${offenders.join("\n    ")}`);
  });
});

// --------------------------------------------------------------------------
// 5 — the header's latency chip still lands on the evidence it names.
// --------------------------------------------------------------------------

describe("the tail-latency anchor survives being folded", () => {
  /**
   * `app/dashboard/page.tsx` wires the header's latency chip to
   * `openReliabilitySection("services", "reliability-latency-guide")`, and
   * `lib/use-workspace-routing.ts` resolves that by
   * `document.getElementById(targetId)?.focus()`.
   *
   * Folding the guide's two paragraphs moves that id onto the `<summary>`, so
   * the chip focuses the closed triangle and one Enter opens the answer. Left
   * on the wrapping `<section>` instead, a reader who pressed a chip to have
   * p99 explained would be focused on a box whose contents are hidden with no
   * indication that pressing anything would help.
   *
   * `data-reliability-consolidation-reliability.test.ts` asserts the id exists
   * in this file; it cannot see WHICH element wears it, which is the part that
   * decides whether the chip still works.
   */
  const healthMatrix = SOURCES.get("components/systems/HealthMatrix.tsx") ?? "";
  const page = read("app/dashboard/page.tsx");

  it("keeps the chip pointed at the guide", () => {
    assert.ok(healthMatrix.length > 500 && page.length > 500, "sources did not load");
    assert.match(page, /openReliabilitySection\("services", "reliability-latency-guide"\)/);
  });

  it("puts the id on the summary, so focus lands on something that opens", () => {
    assert.match(
      healthMatrix,
      /<summary\b[^>]*\bid="reliability-latency-guide"/,
      "the anchor is not on the summary: the chip focuses a box the reader cannot open from",
    );
  });

  it("does not take the summary out of the keyboard tab order", () => {
    // A `<summary>` is focusable natively, so `getElementById(...).focus()`
    // works without help. `tabIndex={-1}` — which the wrapping section needed,
    // because a section is not focusable — would REMOVE this one from
    // sequential navigation, making the only control on the guide reachable by
    // mouse alone.
    const at = healthMatrix.indexOf('id="reliability-latency-guide"');
    assert.notEqual(at, -1);
    const element = healthMatrix.slice(healthMatrix.lastIndexOf("<", at), healthMatrix.indexOf(">", at));
    assert.doesNotMatch(element, /tabIndex/, "the summary was pulled out of the tab order");
  });
});
