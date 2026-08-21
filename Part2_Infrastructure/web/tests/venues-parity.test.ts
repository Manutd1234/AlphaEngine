/**
 * The portal and the gateway share one fill tolerance.
 *
 * The behavioural suites beside this one — `venues-book-maths`, `venues-routing`,
 * `venues-fill-tolerance` — prove the TypeScript port is internally consistent.
 * They cannot prove it agrees with `modules/tca_engine.py`, and that is the
 * property that failed: the tolerance moved on the Python side and this port did
 * not follow, so the same book and the same order got one verdict from the gateway
 * and another from the portal. A trader then sees one execution cost on the web
 * and a different one in Telegram for the same order.
 *
 * So this reads both files. The next person to change one tolerance has to change
 * the other or watch this fail, which is the only mechanism that has ever kept two
 * hand-maintained mirrors in step.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { FILL_TOLERANCE } from "../lib/venues";
import { readVenues } from "./helpers/venue-books";

describe("the portal and the gateway share one fill tolerance", () => {
  const ts = readVenues();
  // The WHOLE gateway-side package, concatenated, not one named file.
  //
  // This read `../../modules/tca_engine.py` directly and broke the moment that
  // module became a package — `FILL_TOLERANCE` now lives in `tolerance.py`.
  // Pointing it at the new path would only move the breakage to the next
  // split. Reading every module in the package means a symbol may travel
  // WITHIN the gateway's TCA code without this mirror test caring, while the
  // property it actually guards — that the two ports declare one tolerance —
  // still fails loudly if either side changes alone.
  //
  // `modules/telegram.py` taught this the expensive way: two source scans there
  // used `Path(module.__file__).read_text()`, which for a package reads only
  // `__init__.py`, so both went green scanning nothing at all.
  const pkg = fileURLToPath(new URL("../../modules/tca_engine/", import.meta.url));
  const files = readdirSync(pkg).filter((f) => f.endsWith(".py"));
  const py = files.map((f) => readFileSync(join(pkg, f), "utf8")).join("\n");

  it("reads a gateway-side package worth checking", () => {
    // A directory that silently held no .py files would make every assertion
    // below pass by matching nothing.
    assert.ok(files.length >= 2, `only found ${files.length} python files in tca_engine/`);
    assert.ok(py.includes("FILL_TOLERANCE"), "the concatenated package does not mention FILL_TOLERANCE");
  });

  it("declares the same FILL_TOLERANCE literal on both sides", () => {
    const tsLiteral = /^export const FILL_TOLERANCE = (.+);$/m.exec(ts)?.[1];
    const pyLiteral = /^FILL_TOLERANCE = (.+)$/m.exec(py)?.[1];
    assert.ok(tsLiteral, "venues.ts must declare FILL_TOLERANCE");
    assert.ok(pyLiteral, "tca_engine.py must declare FILL_TOLERANCE");
    assert.equal(
      tsLiteral,
      pyLiteral,
      "a portal that says routable where the gateway says not is worse than either answer alone",
    );
    assert.equal(String(FILL_TOLERANCE), String(Number(pyLiteral)), "and the value must be the one in force");
  });

  it("keeps the same names across the port", () => {
    // Same names, so the two files diff. `_dust` carries Python's private
    // underscore for exactly that reason.
    assert.match(ts, /export function absorbs\(filled: number, requested: number\): boolean/);
    assert.match(py, /^def absorbs\(filled: float, requested: float\) -> bool:$/m);
    assert.match(ts, /function _dust\(targetNotional: number\): number/);
    assert.match(py, /^def _dust\(target_notional: float\) -> float:$/m);
  });

  it("leaves no absolute epsilon in the walk or the router", () => {
    // The whole point of the convention is that the boundary scales with the
    // order. A bare `1e-6` reintroduced anywhere in these two functions puts it
    // back on the dollar, and would be invisible at the one order size where the
    // two conventions happen to coincide.
    const walk = /export function walkBook[\s\S]*?\n}/.exec(ts)?.[0] ?? "";
    const route = /export function smartRoute[\s\S]*?\n}/.exec(ts)?.[0] ?? "";
    assert.ok(walk && route, "both functions must still be found");
    for (const [name, body] of [["walkBook", walk], ["smartRoute", route]] as const) {
      assert.ok(
        !/\d+e-\d+/.test(body),
        `${name} must decide fills through absorbs/_dust, not a fixed epsilon`,
      );
    }
  });
});
