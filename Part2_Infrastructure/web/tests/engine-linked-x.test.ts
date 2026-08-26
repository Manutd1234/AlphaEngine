/**
 * Two figures over one index space answer a pointer together, and a reader
 * can pin one position and read every other against it.
 *
 * WHY A LINK AND NOT A SECOND CROSSHAIR. The skill trend and the record of
 * every measure are drawn from the same runs; the index series and its
 * measurability strip from the same polls. Side by side, each answered the
 * pointer alone, so comparing them meant holding two positions in one's head.
 * `lib/coherence/linked-x.tsx` lets the figure under the pointer publish its
 * index and every sibling with the same key follow it — one position drawn
 * on both, spoken once.
 *
 * THE ONLY HONEST LINK IS A SHARED INDEX SPACE. A tape indexed by this
 * browser's polls beside a record indexed by the recorder's runs must never
 * share a key: the same index would name two moments and the follower would
 * draw a lie. So every pair is declared here with the ONE identifier both
 * members derive their `count` from, and a pair that cannot name one is not a
 * pair.
 *
 * WHAT MUST NOT CHANGE. Every field is additive and gated: a figure that sets
 * no `link` and no `pin` keeps its announce, its arrival and its blur exactly
 * as `coherence-plot-interaction.test.ts` pins them. The trap this file was
 * written against: `own = active ? … : null` computed for EVERY shared-x
 * figure would empty `announce` on blur — today the walked reading keeps
 * speaking after focus leaves, and the three figures outside this engine
 * rely on that.
 *
 * DERIVED, NEVER OBSERVED (CLAUDE.md, fact 6). Whether the follower's line
 * lands where the publisher's pointer is, and whether a keypress is spoken
 * once, are the arrival harness's to measure.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const hook = read("../lib/coherence/use-shared-x-readout.ts");
const code = stripNonCode(hook);
const figure = read("../components/coherence/Figure.tsx");
const overlays = read("../components/coherence/plot-overlays.tsx");
const linked = read("../lib/coherence/linked-x.tsx");
const manifest = read("../app/globals.css");
const forced = read("../app/globals/15-navigator-and-trailing-layer.css");
const PARTIAL = "../app/globals/10n-engine-interaction.css";

describe("the axis may declare a link, a pin and a diff, and a row may carry its raw value", () => {
  it("declares the four fields, each optional", () => {
    assert.match(hook, /link\?: string;/, "SharedX cannot name a pair");
    assert.match(hook, /pin\?: boolean;/, "SharedX cannot ask for a pinned comparison");
    assert.match(hook, /diff\?: \(current: SharedXRow, pinned: SharedXRow\) => string;/,
      "SharedX cannot say how two readings differ");
    assert.match(hook, /raw\?: number \| null;/, "a row cannot carry the number its value was printed from");
  });
});

describe("the link: publish when you are the one being asked, follow otherwise", () => {
  it("is a context with no element of its own", () => {
    assert.match(linked, /export function LinkedX\(/);
    assert.match(linked, /export function useLinkedX\(/);
    const body = stripNonCode(linked);
    assert.doesNotMatch(body, /<div|<p\b|role=/,
      "the provider renders an element, so it is the first thing in a view and the opens-on-a-drawing guard meets it");
  });

  it("only the owner clears, so a follower's pointer leaving cannot erase the other figure's position", () => {
    assert.match(stripNonCode(linked), /previous && previous\.owner === owner \? null : previous/);
  });

  it("the hook follows through the context and publishes only its own live index", () => {
    assert.match(code, /const \{ followed, publish \} = useLinkedX\(link, useId\(\)\)/,
      "the hook does not subscribe to the pair");
    // Gated on `link`: an unlinked figure has no `own`, so nothing below can
    // change what it announces or when.
    assert.match(code, /const own = link \? \(pointer \?\? \(focused \? walked : null\)\) : null;/,
      "`own` is computed for every figure, so blur empties the announce on the unlinked ones");
    assert.match(code, /const index = link \? \(own \?\? followed \?\? walked\) : \(pointer \?\? walked\);/,
      "the unlinked path is no longer `pointer ?? walked` byte for byte");
    assert.match(code, /useEffect\(\(\) => \{\s*if \(own !== null\) publish\(own\);/,
      "the hook publishes something other than its own live index, or publishes at mount");
  });

  it("a follower says nothing, so one keypress is one utterance", () => {
    assert.match(code, /const following = link !== undefined && own === null && followed !== null;/);
    assert.match(code, /announce: following \? ""/,
      "the follower speaks too, so a reader hears every position twice");
  });

  it("arrives on the followed index BEFORE the axis's own end, and never past the count", () => {
    const onIn = hook.slice(hook.indexOf("const onIn = () => setWalked("), hook.indexOf("svg.addEventListener(\"focusin\", onIn);"));
    assert.ok(onIn.length > 40, "onIn is no longer where this reads it");
    const followedAt = onIn.indexOf("followedRef.current");
    const endAt = onIn.indexOf('arriveRef.current === "first" ? 0 : countRef.current - 1');
    assert.ok(followedAt !== -1, "arrival ignores the followed index, so focus moving A to B lands on B's own end");
    assert.ok(endAt !== -1, "the pinned arrival ternary is gone");
    assert.ok(followedAt < endAt, "the followed index is read after the fallback, so it never wins");
    assert.match(onIn, /followedRef\.current < countRef\.current/, "a followed index past this axis's count is not ignored");
  });
});

describe("the pin: one position held, every other read against it", () => {
  it("pins by click only when the axis asked, and by Enter or Space on the keyboard", () => {
    assert.match(code, /\.\.\.\(shared\?\.pin \? \{ onClick \} : \{\}\)/,
      "click is bound on every shared-x figure, or on none");
    // RAW source: `stripNonCode` blanks string contents, so the key names
    // vanish and this would pass over a hook that binds nothing — the trap
    // `coherence-plot-interaction.test.ts` records for its Escape check.
    assert.match(hook, /event\.key === "Enter" \|\| event\.key === " "/, "the keyboard cannot pin");
  });

  it("merges the two readings as `now was then`, with the diff only when both raws exist", () => {
    assert.match(code, /`\$\{row\.value\} was \$\{other\.value\}`/, "the merged row does not say what the pinned value was");
    assert.match(code, /if \(diff && row\.raw != null && other\.raw != null\)/,
      "the diff runs on a row whose number was never sent — a dash minus a dash");
    assert.match(code, /pinnedAt: pinned !== null \? atOf\(pinned\) : null/, "the hook does not say where the pin sits");
    assert.match(figure, /pinnedAt=\{shared\.pinnedAt\}/, "the shell does not hand the pin to the overlay");
  });

  it("Escape lets go of the walked position first, and of the pin on a second press", () => {
    assert.match(code, /if \(walked !== null\) setWalked\(null\);\s*else setPinned\(null\);/);
  });

  it("draws the pinned line with a stroke ATTRIBUTE and a word, after the reference", () => {
    const at = overlays.indexOf("function SharedXReadout");
    const ref = overlays.indexOf("function ReferenceLine");
    assert.ok(at !== -1 && ref !== -1 && ref < at, "SharedXReadout is no longer after ReferenceLine — figure-reference slices from there");
    const block = overlays.slice(at);
    assert.match(block, /pinnedAt\?: number \| null;/);
    assert.match(block, /<line[^>]*className="coh-plot__crosshair is-pinned"[^>]*stroke=/,
      "the pinned line has no stroke attribute, so forced colours cannot recolour it and it vanishes in High Contrast");
    assert.match(block, /className="coh-plot__pin"[^>]*>pinned</, "the pinned line carries no word, so it means something by dash alone");
  });
});

describe("one CSS home for interaction state", () => {
  it("exists, is imported once between 10m and 11, and is scoped to the engine plane", () => {
    assert.ok(existsSync(new URL(PARTIAL, import.meta.url)), "10n-engine-interaction.css does not exist");
    const lines = manifest.split("\n");
    const at = lines.findIndex((line) => line.includes("10n-engine-interaction.css"));
    assert.ok(at !== -1, "10n is not imported");
    assert.ok(lines[at - 1].includes("10m-proofs-constraints.css") && lines[at + 1].includes("11-next-step-footer.css"),
      "10n is imported out of order");
    const sheet = read(PARTIAL).replace(/\/\*[\s\S]*?\*\//g, " ");
    // One selector per line, which is how every engine partial is written; a
    // declaration line has no `{` and so never matches.
    for (const selector of sheet.matchAll(/^([^{}\n@][^{}\n]*)\{/gm)) {
      for (const part of selector[1].split(",")) {
        assert.match(part.trim(), /^\.coherence-plane\b/, `10n selector not scoped to the engine plane: ${part.trim()}`);
      }
    }
    assert.doesNotMatch(sheet, /transition|animation/, "interaction STATE is scanned, never animated");
    assert.doesNotMatch(sheet, /--series-/, "a series colour is not a state");
    assert.doesNotMatch(sheet, /font-size:\s*\d/, "a size literal outside the ladder");
  });

  it("dashes the pinned line and sizes its word off the ladder", () => {
    const sheet = read(PARTIAL).replace(/\/\*[\s\S]*?\*\//g, " ");
    assert.match(sheet, /\.coherence-plane \.coh-plot__crosshair\.is-pinned \{[^}]*stroke-dasharray:/);
    assert.match(sheet, /\.coherence-plane \.coh-plot__pin \{[^}]*font-size: var\(--fs-/);
  });

  it("gives the head-state hairlines a real edge in High Contrast", () => {
    // Drawn by `box-shadow` today, which forced colours discard — a live
    // defect on the strip, fixed with one selector on an existing list.
    const listAt = forced.indexOf(".coherence-plane .coh-facts--tabled > div");
    assert.ok(listAt !== -1, "the tabled cells are not in the forced-colors block");
    const rule = forced.slice(listAt, forced.indexOf("}", listAt));
    assert.match(rule, /border: 1px solid CanvasText/, "the tabled cell is listed under a rule that draws no edge");
  });
});

/**
 * The pairs. Each row names the identifier BOTH members derive `count` from —
 * the shared index space — and the provider that wraps them. Filled by the
 * crosshair slice, figure by figure; a pair here is a pair a reader can walk
 * with one hand. Kept as a table so a fifth pair cannot arrive without
 * naming its space.
 */
const LINKED: Array<{ key: string; holder: string; members: [string, string]; space: string }> = [];

describe("every linked pair shares one index space", () => {
  for (const pair of LINKED) {
    it(`${pair.key}: ${pair.members.join(" and ")} both count ${pair.space}`, () => {
      const holder = read(`../components/coherence/${pair.holder}`);
      assert.match(holder, /<LinkedX>/, `${pair.holder} does not wrap the pair in a provider`);
      for (const member of pair.members) {
        const source = read(`../components/coherence/${member}`);
        const block = source.slice(source.indexOf("sharedX={"));
        assert.match(block.slice(0, 1200), new RegExp(`link: "${pair.key}"`), `${member} does not declare the link`);
        assert.match(block.slice(0, 1200), new RegExp(`count: ${pair.space.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
          `${member} counts something other than ${pair.space}`);
      }
    });
  }
  it("declares the pairs it has, and only those", () => {
    // Zero until the crosshair slice; the row shape is what this pins.
    assert.equal(LINKED.length, 0);
  });
});

describe("the two figures that pin today", () => {
  for (const file of ["CorpusHistory.tsx", "FamilyRidge.tsx"]) {
    it(`${file} declares pin: true and a diff`, () => {
      const source = read(`../components/coherence/${file}`);
      assert.match(source, /pin: true/, `${file} cannot be pinned`);
      assert.match(source, /diff: /, `${file} pins without saying how two readings differ`);
    });
  }
});
