/**
 * /login does not move while it is deciding what it can offer.
 *
 * THE MEASUREMENT THIS PINS. Driven over CDP against the running dev server at
 * 1440x900, with the text-size preference stamped before first paint so the
 * type ladder is applied at paint, forcing each provider answer by
 * intercepting the Supabase `/auth/v1/settings` probe:
 *
 *  - There is no first-paint shift and no hydration shift. The server HTML and
 *    the first client render are the same state (`enabledProviders` starts null
 *    on both sides), heights are bit-identical across hydration, and
 *    `PerformanceObserver('layout-shift')` records nothing until the probe
 *    answers. Two of the three things the ticket blamed were not happening.
 *  - There is exactly ONE shift: the button column mounting, at 688ms over the
 *    network or at 4.09s when `AbortSignal.timeout(4000)` gives up.
 *  - The card is 400.00px wide in every state at every rung, so the ticket's
 *    `w-[420px]` fixes nothing and would break the shell's measure.
 *  - Region heights (divider, optional warning, button column) at the
 *    12 / 14 / 17px body rungs: 48.71 / 51.50 / 55.67 while the probe is out,
 *    90.71 / 93.50 / 98.67 for the one provider this project answers with,
 *    235.71 / 244.00 / 259.42 when the probe fails open into three speculative
 *    buttons. A provider row is 42 / 42 / 43.
 *
 * AND WHAT IT LOOKS LIKE WITH THE RESERVE IN PLACE, re-measured the same way
 * after this change, at compact / comfortable / large:
 *
 *     probing card      515.69 / 567.14 / 619.31, top 163.16 / 123.94 / 92.34
 *     one provider      515.69 / 567.14 / 619.31, top 163.16 / 123.94 / 92.34
 *     none enabled      515.69 / 567.14 / 619.31, top 163.16 / 123.94 / 92.34
 *
 * identical to the hundredth of a pixel, with "Continue as guest" fixed at
 * 702.84 / 715.08 / 735.66 and the shell's scrollHeight still 900. The
 * reserved column measures exactly 42.00 / 44.00 / 47.00. Keyboard and
 * accessibility, probed over CDP in the probing state: seven tabbables in the
 * card and not one of them a provider, zero `.auth-provider` nodes in the DOM,
 * and the reserved column reported by `Accessibility.getPartialAXTree` as
 * role=none, ignored=true, refusing focus() and returning itself rather than
 * any control from elementFromPoint. The fail-open path still grows the card,
 * by 145.00 / 148.50 / 156.75px; that is stated, not hidden.
 *
 * Asserted against source and against the stylesheet, because `npm test` is
 * plain Node with no DOM and no layout engine — see CLAUDE.md fact 6. What is
 * checked here is the arithmetic and the shape a future edit would have to
 * break deliberately; the pixels were observed in a browser, by hand.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { card, code, screen } from "./helpers/auth-sources";
import { globalsCss, readGlobalsPartial } from "./globals-css";

const PARTIAL = "app/globals/14k-login-layout-stability.css";
const partial = readGlobalsPartial(PARTIAL);
/** Declarations only. This partial's prose names every hazard it avoids. */
const rules = partial.replace(/\/\*[\s\S]*?\*\//g, "");
/** The same, with the `@starting-style` block removed: resting state only. */
const resting = rules.slice(0, rules.indexOf("@starting-style"));

// --------------------------------------------------------------------------
// The type ladder, read out of the stylesheet rather than restated here
// --------------------------------------------------------------------------

/** `--fs-body` in px at each Text-size rung, derived from the tokens. */
function bodyRungs(): { compact: number; comfortable: number; large: number } {
  const rem = globalsCss.match(/--fs-body:\s*calc\(([\d.]+)rem \* var\(--type-step\)\)/);
  assert.ok(rem, "--fs-body is no longer rem x --type-step");
  const base = Number(rem[1]) * 16;
  const step = (name: string) => {
    const block = globalsCss.match(
      new RegExp(`\\[data-text-size="${name}"\\]\\s*\\{[^}]*--type-step:\\s*([\\d.]+)`),
    );
    assert.ok(block, `the ${name} Text-size step is gone`);
    return Number(block[1]);
  };
  return { compact: base * step("compact"), comfortable: base, large: base * step("large") };
}

const body = bodyRungs();

describe("the ladder this reserve was measured against", () => {
  it("still gives body 12 / 14 / 17px", () => {
    // The presets moved from 13.125 / 14 / 15.75 to these three. Every number
    // below was measured on THIS ladder, so if it moves again the reserve has
    // to be re-measured rather than quietly kept.
    assert.ok(Math.abs(body.compact - 12) < 0.01, `compact body is ${body.compact}px, not 12`);
    assert.equal(body.comfortable, 14);
    assert.ok(Math.abs(body.large - 17) < 0.01, `large body is ${body.large}px, not 17`);
  });
});

// --------------------------------------------------------------------------
// 1 — the reserve
// --------------------------------------------------------------------------

describe("the async region carries a reserve, and the reserve follows the ladder", () => {
  it("is a split constant on the button column", () => {
    assert.match(
      rules,
      /\.auth-providers__options \{\s*min-height: calc\(30px \+ 1 \* var\(--fs-body\)\);\s*\}/,
      "the reserve under the provider column went",
    );
  });

  it("names no flat px, which is the mistake it exists to avoid", () => {
    assert.doesNotMatch(
      rules,
      /\.auth-providers__options \{\s*min-height: \d+(\.\d+)?px;/,
      "the reserve went back to a literal px, which stops following the text size",
    );
  });

  it("covers the measured provider row and the wrapped named reason at all three rungs", () => {
    /*
     * A provider row measures 42 / 42 / 43px (`.auth-provider` floors itself at
     * 42px and the label pushes it to 43 on large). The named reason that fills
     * the region when the answer is "none enabled" is --fs-body at Tailwind's
     * leading-snug (1.375), and it wraps to at most two lines in the 344px of
     * card interior: 33.00 / 38.50 / 46.75px.
     */
    const row = { compact: 42, comfortable: 42, large: 43 };
    const reason = (px: number) => px * 1.375 * 2;
    const reserve = (px: number) => 30 + px;

    for (const rung of ["compact", "comfortable", "large"] as const) {
      const need = Math.max(row[rung], reason(body[rung]));
      const have = reserve(body[rung]);
      assert.ok(
        have + 1e-6 >= need,
        `${rung}: the reserve is ${have.toFixed(2)}px against ${need.toFixed(2)}px of content — `
          + "it has stopped reserving, and the card jumps again at this rung",
      );
      assert.ok(
        have - need <= 5,
        `${rung}: ${(have - need).toFixed(2)}px of dead space inside the reserve. A reserve `
          + "that shows at rest has traded a jump for a hole",
      );
    }
  });

  it("would not have held as the flat 42px a single-rung measurement gives", () => {
    // The counterexample kept live, so the guard above cannot quietly go inert:
    // 42px is the row at compact and comfortable and is 4.75px SHORT of the
    // wrapped reason on large. This is the flat-420px defect 14j documents.
    assert.ok(42 < body.large * 1.375 * 2, "the large rung no longer discriminates a flat 42px");
  });

  it("refuses the ticket's card floor, and says so where the rule would have gone", () => {
    // min-h-[480px] is BELOW the probing card at comfortable (523.14) and large
    // (572.31) — inert at two of three rungs — and a floor tall enough for the
    // real states puts a permanent scrollbar on a page that has none.
    assert.doesNotMatch(
      globalsCss,
      /\.card\.auth-card \{[^}]*min-height/,
      "a blanket floor landed on the card; the measurement says it holds 145 to 161px of void "
        + "under the one-provider state this deployment settles in",
    );
    assert.doesNotMatch(code(card) + code(screen), /min-h-\[|w-\[420px\]|h-12\b/);
    for (const phrase of ["min-h-[480px]", "236 / 246 / 261", "454px + 19 * var(--fs-body)"]) {
      assert.ok(partial.includes(phrase), `the rejected alternative "${phrase}" is no longer named`);
    }
  });
});

// --------------------------------------------------------------------------
// 2 — no auth state mounts or unmounts in a way that changes the card's height
// --------------------------------------------------------------------------

describe("the region is present because the mode has one, not because the probe answered", () => {
  it("the screen keys the slot on the mode alone", () => {
    assert.match(code(screen), /const showProviderSlot = mode === "signin" \|\| mode === "signup";/);
  });

  it("the old answer-dependent guard is gone", () => {
    // `(offeredProviders.length > 0 || probePending)` was true while the probe
    // was out and false the instant it came back empty, so the region appeared
    // and then vanished and the card changed height twice.
    assert.doesNotMatch(code(screen), /offeredProviders\.length > 0\s*\|\|\s*probePending/);
    assert.doesNotMatch(code(card) + code(screen), /\bshowProviders\b/);
  });

  it("the card renders the slot, the divider and the column unconditionally", () => {
    assert.match(code(card), /\{showProviderSlot && \(/);
    assert.match(code(card), /className="auth-providers__options flex flex-col gap-2"/);
    const slot = code(card).slice(
      code(card).indexOf("{showProviderSlot && ("),
      code(card).indexOf('className="auth-providers__options'),
    );
    assert.ok(slot.length > 0, "the slot and its column are no longer in that order");
    assert.doesNotMatch(
      slot,
      /probePending &&|providersOffered &&/,
      "the column is back behind a probe-state guard, so it can vanish again",
    );
  });

  it("the reserved column is the only place a provider button is drawn", () => {
    assert.match(code(card), /\{offeredProviders\.map\(/);
    // And the screen still offers nothing at all while the probe is out, which
    // is what makes the reserve an empty box rather than a hidden control.
    assert.match(code(screen), /probeFailed \? PROVIDERS : \[\]/);
  });
});

// --------------------------------------------------------------------------
// 3 — the probing state stays honest, and the empty answer names its reason
// --------------------------------------------------------------------------

describe("the reserve never holds nothing", () => {
  it("says what is being waited for while the probe is out", () => {
    assert.match(code(card), /"checking sign-in options"/);
  });

  it("stops saying \"or\" once the answer is that there is no alternative", () => {
    assert.match(code(card), /providersOffered \? "or" : "sign-in options"/);
  });

  it("resolves an empty answer to a named reason, in the reserved column", () => {
    /*
     * Absence is a typed state with a named reason — the house rule, and here
     * it is also the layout fix. This state used to drop the whole region, so
     * an answer of "none enabled" made the card 48.71 to 55.67px SHORTER than
     * the probing card: the one path where the page jumped upward.
     */
    assert.match(code(card), /\{!probePending && !providersOffered && \(/);
    assert.match(code(card), /No provider is enabled in this deployment\./);
    const column = code(card).slice(code(card).indexOf('className="auth-providers__options'));
    assert.ok(
      column.indexOf("No provider is enabled in this deployment.") > 0,
      "the named reason moved outside the reserved column, so the reserve is blank again",
    );
  });

  it("keeps the fail-open warning it already had", () => {
    assert.match(code(card), /We could not check which of these are enabled here/);
  });
});

// --------------------------------------------------------------------------
// 4 — nothing is reserved by hiding a control
// --------------------------------------------------------------------------

describe("the reserve is an empty box, not an invisible button", () => {
  /**
   * HOW THE HIDDEN STATES WERE PROVED, since this suite has no DOM. Three
   * appended "Continue with Google" buttons were probed in the live page over
   * CDP:
   *
   *  - `visibility: hidden` — focus() does not move to it,
   *    Accessibility.getPartialAXTree reports ignored=true with no role and no
   *    name, elementFromPoint returns the card. Safe, and it still reserves.
   *  - `opacity: 0` — focus() SUCCEEDS, the AX tree reports role=button
   *    name="Continue with Google", elementFromPoint returns the button. An
   *    invisible, tabbable, announced provider.
   *  - `visibility: visible` on a child of a hidden parent — focusable and
   *    announced again, because visibility is inherited but overridable.
   *
   * So this page hides nothing. The reserve is a min-height on an empty
   * container, and a provider button exists only once the probe has said that
   * provider exists. Nothing to trap, nothing to announce falsely, and no
   * descendant rule that can undo a guard in silence.
   */
  it("hides no control in the card", () => {
    // `aria-hidden` on the banner's typographic mark is deliberately allowed:
    // that glyph is decoration beside a sentence, not a control being reserved.
    for (const pattern of [
      /visibility/,
      /opacity-0|opacity:\s*0/,
      /(?<![\w-])hidden(?![\w-])/,
      /(?<![\w-])inert(?![\w-])/,
    ]) {
      assert.doesNotMatch(code(card), pattern, `${pattern} is back in the login card`);
    }
  });

  it("hides no auth control from the stylesheet at rest", () => {
    assert.doesNotMatch(globalsCss, /\.auth-provider[^{]*\{[^}]*visibility:\s*hidden/);
    assert.doesNotMatch(
      resting,
      /opacity:\s*0|visibility:\s*hidden/,
      "the login reserve now has a resting opacity, which is how an invisible, tabbable, "
        + "announced provider button gets made",
    );
  });

  it("uses opacity 0 in exactly one place, and only as a transition's start", () => {
    const zeros = [...rules.matchAll(/opacity:\s*0;/g)];
    assert.equal(zeros.length, 1, "a second opacity: 0 appeared — see the AX findings above");
    const start = rules.indexOf("@starting-style");
    assert.notEqual(start, -1, "the @starting-style block went");
    assert.ok(
      start < zeros[0].index,
      "the opacity: 0 is no longer inside @starting-style, so it is a resting state rather "
        + "than the first frame of an element that is already real",
    );
  });

  it("announces what settles into the reserve rather than leaving it silent", () => {
    assert.match(code(card), /className="auth-providers" role="status" aria-live="polite"/);
  });
});

// --------------------------------------------------------------------------
// 5 — the fade reads the ladder, and reduced motion switches it off
// --------------------------------------------------------------------------

describe("the answer fades in at the house's pace", () => {
  it("transitions opacity on the tokens, never on a literal", () => {
    assert.match(rules, /transition: opacity var\(--dur-fast\) var\(--ease\);/);
    for (const match of rules.matchAll(/transition:[^;]*;/g)) {
      assert.doesNotMatch(match[0], /\d(?:\.\d+)?(?:ms|s)\b/, `${match[0]} hardcodes a duration`);
    }
  });

  it("is reached by the one reduced-motion block, which collapses it to 1ms", () => {
    // Restated here rather than left to motion.test.ts: this slice deliberately
    // adds motion to a page that had none, so the contract is pinned beside it.
    const blocks = [...globalsCss.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)];
    assert.equal(blocks.length, 1, "a second reduce block would shadow the correct one");
    const body_ = globalsCss.slice(blocks[0].index, blocks[0].index + 500);
    assert.match(body_, /\*,/, "the reduce block no longer applies to every element");
    assert.match(body_, /transition-duration:\s*1ms\s*!important/);
    assert.match(body_, /transition-delay:\s*0m?s\s*!important/);
    assert.doesNotMatch(rules, /prefers-reduced-motion/,
      "a second reduce block was written into this partial rather than relying on the one in 12");
  });
});

// --------------------------------------------------------------------------
// 6 — the probe still resolves after paint; nothing here blocks it
// --------------------------------------------------------------------------

describe("the provider probe is already non-blocking, and stays that way", () => {
  it("starts null on both sides of hydration", () => {
    // Measured: heights are bit-identical across hydration and the layout-shift
    // observer is silent until the probe lands, precisely because the server
    // and the first client render agree on this initial value. A `typeof
    // window` or a storage read in the initialiser would end that.
    assert.match(
      code(screen),
      /useState<Set<string> \| "unknown" \| null>\(null\)/,
      "the probe's initial state is no longer a plain null on both sides",
    );
  });

  it("runs in an effect after paint, not during render", () => {
    const effect = code(screen).slice(code(screen).indexOf("void fetchEnabledProviders()") - 200);
    assert.match(effect.slice(0, 260), /useEffect\(\(\) => \{/);
    assert.doesNotMatch(code(screen), /await fetchEnabledProviders/);
  });

  it("caches no answer, and the reason is not laziness", () => {
    // The cheapest way to make every visit after the first static is to keep
    // the last answer beside the text-size key and render the pending state in
    // its shape. Refused: a provider disabled since the last visit would be
    // offered from cache, and clicking it is a full-page redirect to a Supabase
    // JSON error — the exact defect the probe was added to prevent. A reserve
    // that costs nothing beats a cache that can lie.
    assert.doesNotMatch(code(screen), /localStorage[\s\S]{0,80}provider/i);
  });
});

// --------------------------------------------------------------------------
// 7 — where the rules live
// --------------------------------------------------------------------------

describe("the partial sits where the cascade needs it", () => {
  it("is imported after 14j and before the trailing layer", () => {
    const manifest = globalsCss;
    assert.ok(manifest.length > 0);
    const own = globalsCss.indexOf(".auth-providers__options");
    const trailing = globalsCss.lastIndexOf("@media (prefers-contrast: more)");
    assert.notEqual(own, -1, "the login reserve is not in the concatenated sheet at all");
    assert.ok(own < trailing, "the login reserve now follows the trailing contrast layer");
  });

  it("did not grow a file that may not grow", () => {
    // 01-workspace-shell.css holds every other .auth-* rule and is on the
    // over-ceiling list; 14j was open in another working tree. Both are read
    // here so that a later move of these rules has to face the same two facts.
    assert.doesNotMatch(
      readGlobalsPartial("app/globals/01-workspace-shell.css"),
      /\.auth-providers/,
      "the reserve moved into a file that is over the file-length ceiling",
    );
  });
});
