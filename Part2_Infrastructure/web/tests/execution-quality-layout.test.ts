import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource } from "./helpers/source-files";

const histogram = readSource("components/execution/LatencyHistogram.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const css = readSource("app/globals/14zzk-execution-layout-followup.css")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("Execution Quality distributions keep readable geometry", () => {
  it("scales both histogram axes together instead of stretching only x", () => {
    assert.match(histogram, /preserveAspectRatio="xMidYMid meet"/);
    assert.match(histogram, /style=\{\{ aspectRatio: `\$\{width\} \/ \$\{height\}` \}\}/);
    assert.doesNotMatch(histogram, /height=\{height\}/);
    assert.doesNotMatch(histogram, /preserveAspectRatio="none"/);
    assert.match(css, /\.latency-histogram > svg\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;/s);
  });

  it("aligns and stretches the blue and red peer cards from one shared row", () => {
    assert.match(
      css,
      /\.cockpit-quality__distributions\s*\{[^}]*display:\s*grid;[^}]*gap:\s*var\(--space-3\);[^}]*align-items:\s*stretch;/s,
    );
    assert.match(
      css,
      /\.cockpit-quality__distribution\s*\{[^}]*min-width:\s*0;[^}]*margin-top:\s*0;[^}]*align-content:\s*start;/s,
    );
  });
});
