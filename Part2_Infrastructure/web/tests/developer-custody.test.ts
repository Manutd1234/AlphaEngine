/**
 * The numerics custody chain, and the one shortening this tab may never do.
 *
 * THE DEFECT THIS FILE EXISTS FOR. The whole result of the browser parity check
 * used to be a status pill reading `Byte-exact — … sha256 009be58f34bb…`.
 * Twelve of sixty-four characters, inside a pill sized for a word.
 *
 * The prefix was not wrong. Two SHA-256 values agreeing on twelve hex
 * characters is a one-in-2^48 coincidence, so as a claim it was sound. It was
 * USELESS, which is a different fault and a worse one on this surface: a reader
 * could not take those twelve characters to a terminal, could not compare them
 * against `sha256sum`, could not do anything with them except believe the
 * sentence around them. A custody panel whose evidence can only be believed has
 * the shape of custody and none of the function.
 *
 * So this file bans the truncation, and pins the three things that replaced it:
 *
 *   1. THE WHOLE DIGEST, at --fs-h1, grouped in eights, selectable as sixty-four
 *      contiguous characters. The grouping is drawn with margins rather than a
 *      grid `gap` or a literal space, and the reason is a clipboard: grid items
 *      are blockified and copy as eight lines, and a space copies as a value
 *      that compares equal to nothing.
 *   2. THE CHAIN, as a node per artefact and an operation per edge, in the
 *      idiom of `components/research/SignalDAGViewer.tsx`. Every node is a real
 *      file in this repository and the assertions below name them, so a chain
 *      that drifts from the code it draws fails here rather than misleading a
 *      reader who trusted a picture.
 *   3. WHAT IT REFUSES TO CLAIM. Before a run the computing links say "not
 *      run"; they do not wear ticks. A committed digest that no longer matches
 *      its own committed bytes is "stale", which is an actionable failure with
 *      a named remedy, and the panel prints the remedy rather than only the
 *      fault.
 *
 * The chain derivation is a pure function over three readings, so most of this
 * runs with no DOM — the same argument `lib/signal-path.ts` makes for
 * `deriveSignalPath`, and the reason that shape was chosen here.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { MC_PARITY_REFERENCE_JSON, MC_PARITY_REFERENCE_SHA256 } from "../lib/mc-parity-reference.generated";

import { readSource } from "./helpers/source-files";

const CHAIN = "components/developer/NumericsCustodyChain.tsx";
const DIGEST = "components/developer/NumericsCustodyDigest.tsx";
const INTERFACES = "components/developer/DeveloperInterfaces.tsx";
const STATUS = "components/developer/DeveloperStatus.tsx";
/**
 * The renderer, extracted when the gateway OpenAPI chain was drawn and both
 * chains started sharing it. It is in this list rather than swapped for CHAIN:
 * the assertions below split cleanly into "what this chain claims" (still the
 * chain file, where the derivation lives) and "how any chain is drawn" (now
 * here), and every whole-surface scan — the truncation sweep, the dependency
 * sweep — must read both or it reads less than it did before the split.
 */
const TRACK = "components/developer/CustodyChainTrack.tsx";

const FILES = [CHAIN, DIGEST, INTERFACES, STATUS, TRACK] as const;
const sources = new Map<string, string>(FILES.map((file) => [file, readSource(file)] as const));

/**
 * One file's source, guarded non-empty.
 *
 * The trap this tree has found repeatedly: a scan of an empty string satisfies
 * every `doesNotMatch` and proves nothing, so a broken read reads exactly like
 * a clean bill of health. Nothing below runs until this has passed.
 */
const source = (file: string) => {
  const text = sources.get(file);
  assert.ok(text && text.length > 500, `${file} read as empty or far too short — every scan below would pass on nothing`);
  return text;
};

/** Comments blanked: a comment quoting a sentence is not the sentence rendering. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/[^\n]*/g, "$1");

/** What the reader sees: every run of whitespace collapsed to one space. */
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

const rendered = (file: string) => collapse(code(source(file)));

/** Every file the custody surface renders from, as one string. */
const panel = () => FILES.map(rendered).join(" ");

// ---------------------------------------------------------------------------

describe("the custody surface reads as the real files", () => {
  it("reads five non-empty sources", () => {
    for (const file of FILES) assert.ok(source(file).length > 500, `${file} is too short to be the real file`);
    assert.ok(panel().length > 10_000, "the panel read short — every assertion below would scan almost nothing");
  });
});

describe("no digest is shown truncated", () => {
  it("nothing slices a hash down to a prefix", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const match of rendered(file).matchAll(/(\w*(?:DIGEST|SHA256|Digest|digest)\w*)\.slice\(/g)) {
        offenders.push(`${file}: ${match[0]}…`);
      }
    }
    assert.deepEqual(
      offenders, [],
      "a digest is being truncated for display again. The full value is what a reader carries to a "
        + `terminal; a prefix is a claim they can only believe:\n    ${offenders.join("\n    ")}`,
    );
  });

  it("the schema row's numerics detail carries the whole digest", () => {
    // This string is the row's `title`, where a pill's width is not the
    // constraint. It used to end `${evidence.expectedDigest.slice(0, 12)}…`.
    assert.match(rendered(STATUS), /sha256 \$\{evidence\.expectedDigest\}/);
  });

  it("the parity pill stopped quoting a digest it cannot fit", () => {
    // The pill says what happened and points at the panel; the digits are in
    // the panel, at a size that can be read.
    const interfaces = rendered(INTERFACES);
    assert.match(interfaces, /reproduced the committed reference byte for byte; both digests are below\./);
    assert.doesNotMatch(interfaces, /MC_PARITY_REFERENCE_SHA256/);
  });
});

describe("the whole digest is legible, grouped and copyable", () => {
  const digest = rendered(DIGEST);

  it("prints all sixty-four characters of the committed digest", () => {
    assert.equal(MC_PARITY_REFERENCE_SHA256.length, 64, "the committed digest is not a SHA-256");
    assert.match(rendered(CHAIN), /hex=\{MC_PARITY_REFERENCE_SHA256\}/);
    assert.match(digest, /groupDigest\(hex\)\.map/);
  });

  it("groups with margins, not with a grid gap or a literal space", () => {
    /**
     * The clipboard is the whole argument. `display: grid` with `gap` reads
     * beautifully and copies as eight lines, because grid items are blockified;
     * a literal space between groups copies as `009be58f 34bb20fb …`, which
     * compares equal to nothing until someone strips it by hand. Inline spans
     * with a right margin contribute no characters at all, so the selection is
     * the sixty-four hex characters and the gaps are still on screen.
     */
    assert.match(digest, /marginRight: "0\.62em"/);
    assert.doesNotMatch(digest, /gridTemplateColumns/);
    assert.doesNotMatch(digest, /\{" "\}/);
  });

  it("reads its size from the ladder and is big enough to compare by eye", () => {
    assert.match(digest, /fontSize: "var\(--fs-h1\)"/);
    assert.match(digest, /className="num"/, "the digest is not in the tabular mono of .num");
    // A `ch`-derived width breaks the value after the fourth group on a wide
    // card and earlier on a narrow one, rather than pinning one line length.
    assert.match(digest, /calc\(32ch \+ 2\.6em\)/);
    assert.match(digest, /overflowWrap: "anywhere"/);
  });

  it("says why when there is no digest, rather than showing an empty box", () => {
    assert.match(digest, /hex === null \? \(/);
    assert.match(digest, /\{note\}/);
    // The dash is decoration; the reason is the text beside it.
    assert.match(digest, /<span aria-hidden>—<\/span> \{note\}/);
  });
});

describe("the chain drawn is the chain in the repository", () => {
  const chain = rendered(CHAIN);

  it("names every artefact on the path, and nothing that is not one", () => {
    /**
     * Each of these is a file this repository actually holds, and together they
     * are the whole path from the pinned fixture to the committed digest. A
     * diagram whose boxes are not real files is the defect `SignalDAGViewer`
     * was rewritten to remove — it drew a "FIX Protocol Execution Engine" into
     * a system with no FIX in it.
     */
    for (const artefact of [
      "lib/mc-parity.ts",
      "lib/mc-distribution.ts",
      "lib/canonical-json.ts",
      "crypto.subtle",
      "lib/mc-parity-reference.generated.ts",
    ]) {
      assert.ok(chain.includes(`artefact: "${artefact}"`), `the chain no longer draws ${artefact}`);
    }
  });

  it("labels every edge with the operation that produces the next artefact", () => {
    for (const operation of ["run the bootstrap", "canonicalise", "SHA-256", "compare"]) {
      assert.ok(chain.includes(`operation: "${operation}"`), `the edge "${operation}" is gone`);
    }
    // The terminal node has no outgoing edge, and says so in the type rather
    // than by pointing at itself.
    assert.match(chain, /operation: null/);
  });

  it("borrows the signal path's idiom rather than inventing a second one", () => {
    const track = rendered(TRACK);
    for (const className of [
      "signal-workflow__track",
      "signal-workflow__stage",
      "signal-workflow__node",
      "signal-workflow__step",
      "signal-workflow__meta",
      "signal-workflow__arrow",
      "signal-workflow__detail",
      "signal-workflow__source",
    ]) {
      assert.ok(track.includes(className), `${className} is gone — the panel has grown a second dialect`);
    }
    // Same glyph table as the signal path, imported rather than restated.
    assert.match(track, /import \{ STAGE_GLYPH \} from "@\/lib\/signal-path"/);
    // And this chain still goes THROUGH that renderer. Without this line the
    // loop above would stay green over a track file nothing draws with, which
    // is exactly the shape of a second dialect being grown quietly.
    assert.match(chain, /<CustodyChainTrack chain=\{chain\} label="Numerics custody chain" \/>/);
  });

  it("lets a reader check each link instead of trusting it", () => {
    // The provenance line is the point of the panel, as it is in SignalDAG.
    assert.match(rendered(TRACK), /Read from <code>\{opened\.source\}<\/code>/);
    for (const path of ["scripts/generate-mc-parity.ts", "lib/mc-parity-reference.generated.ts"]) {
      assert.ok(chain.includes(`source: "${path}"`), `the chain stopped citing ${path}`);
    }
  });

  it("never lets colour carry a state on its own", () => {
    // Every node prints the glyph AND the word; the tint is applied beside
    // both, never instead of them.
    assert.match(rendered(TRACK), /<span aria-hidden>\{STAGE_GLYPH\[link\.state\]\}<\/span> \{link\.word\}/);
    assert.match(rendered(DIGEST), /<span aria-hidden>\{glyph\}<\/span> \{word\}/);
  });
});

describe("the panel states what it knows and no more", () => {
  const chain = rendered(CHAIN);

  it("wears no tick before anything has run", () => {
    // `runState` is the single place the four computing links get their state,
    // so an idle chain cannot be green in one link and honest in the next.
    assert.match(chain, /if \(run\.phase === "idle"\) return \{ state: "unknown", word: "not run" \}/);
    assert.match(chain, /if \(run\.phase === "failed"\) return \{ state: "down", word: "failed" \}/);
  });

  it("separates a digest nobody asked for from one this browser cannot compute", () => {
    /**
     * The same distinction the readiness ladder makes between a gate that has
     * not run and a gate that could not run. `crypto.subtle` is undefined on an
     * insecure origin, which is a real configuration rather than a
     * hypothetical, and "nobody pressed the button" is not that fact.
     */
    const digest = rendered(DIGEST);
    assert.match(digest, /state: "unrequested"/);
    assert.match(digest, /state: "unavailable"/);
    assert.match(digest, /This context exposes no Web Crypto digest/);
    assert.match(chain, /No run in this session, so nothing has been hashed in this browser yet\./);
  });

  it("computes its digest with the platform's SHA-256 and no dependency", () => {
    // A hash function written for a UI panel is a second implementation of the
    // thing the panel exists to check, and it would agree with itself whatever
    // the platform did. NO NEW NPM DEPENDENCY is a hard rule here besides.
    assert.match(rendered(DIGEST), /subtle\s*\.digest\("SHA-256", new TextEncoder\(\)\.encode\(text\)\)/);
    // React and Next are the framework this tree is built on; everything else
    // an import may name is a path inside it. A new package specifier here is
    // what "no new npm dependency" looks like the moment before it is broken.
    const inTree = /^(react|react-dom|next(\/.+)?|node:.+|@\/.+|\.{1,2}\/.+)$/;
    for (const file of FILES) {
      for (const [, specifier] of rendered(file).matchAll(/from "([^"]+)"/g)) {
        assert.match(specifier, inTree, `${file} imports "${specifier}", which is neither this tree nor the framework`);
      }
    }
  });

  it("treats a stale committed digest as an actionable failure with a remedy", () => {
    /**
     * The committed module ships the reference bytes and their digest together,
     * so the pair can be checked against each other with no network. If they
     * disagree the module is stale and no verdict computed from it means
     * anything — which is why the terminal node reports "stale digest" ahead of
     * any verdict, and why the note is a command rather than a complaint.
     */
    assert.match(chain, /state: "down", word: "stale digest"/);
    assert.match(chain, /node --import tsx scripts\/generate-mc-parity\.ts/);
    assert.match(chain, /a digest edited to match is a check switched off/);
  });

  it("prints where two digests part company instead of colouring the difference", () => {
    // A colour is the one thing a reader with forced colours or a monochrome
    // screen does not receive, and "differs at character 3" is more useful anyway.
    assert.match(chain, /The two part company at character \$\{divergence \?\? 1\}/);
    assert.match(rendered(DIGEST), /export function firstDifference/);
  });
});

describe("the committed reference is what the panel says it is", () => {
  it("the committed digest describes the committed bytes", () => {
    // The same check the panel performs in the browser with `crypto.subtle`,
    // performed here with `node:crypto`. If this fails, the panel's "stale"
    // branch is not hypothetical and the generated module needs regenerating.
    const digest = createHash("sha256").update(MC_PARITY_REFERENCE_JSON, "utf8").digest("hex");
    assert.equal(
      digest, MC_PARITY_REFERENCE_SHA256,
      "lib/mc-parity-reference.generated.ts is stale: regenerate it with "
        + "`node --import tsx scripts/generate-mc-parity.ts` and review the diff",
    );
  });

  it("groups sixty-four characters into eight groups of eight", () => {
    // Pinned as arithmetic rather than as a screenshot: eight groups of eight
    // is the shape a `sha256sum` reader already knows how to scan.
    assert.match(rendered(DIGEST), /const GROUP = 8;/);
    assert.equal(MC_PARITY_REFERENCE_SHA256.length % 8, 0);
  });
});

describe("the capability has a caller", () => {
  it("the chain is mounted by the Numerics pane, not exported for a later one", () => {
    // A capability with no caller is the defect this repository keeps a scar
    // about. The pane switcher's own contract — one mount, conditional render —
    // is pinned in `tests/developer-panes-switching.test.ts`.
    const interfaces = rendered(INTERFACES);
    assert.match(interfaces, /<NumericsCustodyChain run=\{run\} \/>/);
    assert.match(interfaces, /import NumericsCustodyChain, \{ browserRun, engineWord \} from "\.\/NumericsCustodyChain"/);
    assert.equal(interfaces.match(/<NumericsCustodyChain /g)?.length, 1);
  });
});
