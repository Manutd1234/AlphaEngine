/**
 * The capture script's redactor, run against the URLs the capture script
 * itself builds.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The redactor matched only the alternation `(apikey|token)` with no `i` flag,
 * while the Massive target builds `apiKey=` with a capital K. So a keyed Massive
 * capture wrote the live credential verbatim into the fixture's `_url`.
 * `raw-contracts-rest-calibration.test.ts` would have caught it, but only AFTER the key was on
 * disk, and a credential that has been written is not un-written by deleting
 * the file.
 *
 * ── Why it reads the source rather than importing ─────────────────────────
 *
 * `capture-provider-fixtures.mjs` performs the captures at module load — there
 * is nothing to import without making live vendor calls. So the regex literal
 * and the target URLs are lifted out of the source and exercised here. That is
 * weaker than importing a pure function and stronger than asserting the source
 * merely CONTAINS an `i`: the thing under test is whether a key survives, and
 * that is what is measured.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../scripts/capture-provider-fixtures.mjs", import.meta.url)),
  "utf8",
);

/** The `.replace(/…/flags, "…")` chain that makes up `redact`. */
function redactor(): (url: string) => string {
  const body = /const redact = \(url\) =>([\s\S]*?);\n/.exec(source)?.[1];
  assert.ok(body, "could not find `redact` in the capture script");
  const steps = [...body.matchAll(/\.replace\(\/(.+?)\/([a-z]*), "(.*?)"\)/g)];
  assert.ok(steps.length >= 2, `found only ${steps.length} replace steps in redact`);
  return (url) => steps.reduce(
    (acc, [, pattern, flags, replacement]) => acc.replace(new RegExp(pattern, flags), replacement),
    url,
  );
}

/** Every credential-bearing URL template the script can build. */
function keyedTemplates(): string[] {
  const block = /const KEYED = \[([\s\S]*?)\n\];/.exec(source)?.[1];
  assert.ok(block, "could not find the KEYED target list");
  return [...block.matchAll(/url: \((?:key|base)\) => `(.+?)`/g)].map((m) => m[1]);
}

const SECRET = "L1vE-Cr3d3nt1al-VALUE";

describe("the capture script cannot write a credential to disk", () => {
  const redact = redactor();

  it("finds the targets it claims to check", () => {
    // A regex that silently matched nothing would make every case below pass
    // for the wrong reason.
    const templates = keyedTemplates();
    assert.ok(templates.length >= 3, `only found ${templates.length} keyed targets`);
  });

  for (const spelling of ["apikey", "apiKey", "APIKEY", "api_key", "api-key", "token", "accessToken", "key", "secret"]) {
    it(`redacts ?${spelling}=`, () => {
      const out = redact(`https://vendor.example/v1/data?${spelling}=${SECRET}&symbol=AAPL`);
      assert.doesNotMatch(out, new RegExp(SECRET),
        `a credential spelled "${spelling}" survives redaction:\n  ${out}`);
    });
  }

  it("redacts every keyed target the script actually builds", () => {
    // The real templates, with the real interpolation substituted. This is the
    // case that regressed: the target spelled it `apiKey` and the redactor
    // matched only lower case.
    for (const template of keyedTemplates()) {
      const url = template.replace(/\$\{key\}/g, SECRET).replace(/\$\{[^}]*\}/g, "https://svc.local");
      assert.doesNotMatch(redact(url), new RegExp(SECRET),
        `this target leaks its credential into the committed fixture:\n  ${template}`);
    }
  });

  it("refuses the write outright if a secret survives anyway", () => {
    // Defence in depth, and the half that does not have to guess a spelling:
    // the writer reads the secret VALUES out of the environment and throws.
    // A pattern-matcher is always one vendor spelling behind.
    assert.match(source, /const SECRET_ENV = /,
      "the value-based backstop is gone; the redactor is guessing alone again");
    assert.match(source, /refusing to write a fixture/,
      "write() no longer refuses on a surviving credential");
    const guard = /function write\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    assert.match(guard, /for \(const secret of secrets\(\)\)/,
      "write() does not scan the payload it is about to commit");
    assert.ok(
      guard.indexOf("secrets()") < guard.indexOf("writeFileSync"),
      "the scan must run BEFORE the write; a check afterwards is a check after the leak",
    );
  });

  it("does not name the provider or the variable when it refuses", () => {
    // An error message is the other place a credential leaks — into a CI log,
    // which is retained longer than the working tree.
    const guard = /function write\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const thrown = /new Error\((.*?)\)/.exec(guard)?.[1] ?? "";
    assert.doesNotMatch(thrown, /\$\{/,
      `the refusal interpolates a value into its message: ${thrown}`);
  });
});
