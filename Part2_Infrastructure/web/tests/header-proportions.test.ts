/**
 * The global header is one proportion system, not a row of unrelated boxes.
 *
 * The regression photographed at a Retina desktop width had two causes:
 * navigation buttons consumed every spare pixel while the compact operator
 * controls were allowed to collapse to 36–56px. The result was wide apparent
 * gaps between destinations beside tiny command, kill and settings targets.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

describe("global header proportions", () => {
  it("lets destination tabs fill the rail with one invariant gap and inset", () => {
    assert.match(
      css,
      /\.workspace-tabs button \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;[^}]*min-height: 42px;[^}]*padding: 7px 6px;[^}]*border: 0;[^}]*border-radius: 6px;/,
    );
    assert.match(css, /\.workspace-tabs \{[^}]*gap: 2px;[^}]*flex: 1 1 auto;/);
    assert.match(css, /@media \(min-width: 901px\) \{\s*\.workspace-tabs \{\s*margin-left: 0;/,
      "the utility row's own 8px gap must be the only brand-to-navigation gap");
    assert.doesNotMatch(css, /\.workspace-tabs \{\s*margin-left: (?!0)[^;}]+;/,
      "responsive rungs may fold labels, not change navigation rhythm");
    assert.doesNotMatch(css, /\.workspace-tabs button \{[^}]*padding-inline:/);
    assert.match(css, /\.workspace-tabs::after \{\s*content: none;\s*\}/);
    assert.doesNotMatch(read("components/WorkspaceHeader.tsx"), /header-spacer/,
      "a flex spacer would turn real viewport surplus into a variable Diffusion-to-Telegram gap");
  });

  it("gives compact operator controls comparable targets", () => {
    assert.match(css, /\.header-command-button \{[^}]*min-width: 56px;[^}]*padding: 0 8px;/);
    assert.match(css, /\.header-command-button span\[aria-hidden\] \{[^}]*font-size: var\(--fs-chrome-brand\);/);
    assert.match(css, /@media \(max-width: 2160px\) \{\s*\.header-command-button \{ width: 56px; \}/);
    const dataTier = /\.data-tier \{([^}]*)\}/.exec(css)?.[1] ?? "";
    assert.match(dataTier, /min-width: 72px;/);
    assert.match(dataTier, /justify-content: center;/);
    const health = /\.system-health-action \{([^}]*)\}/.exec(css)?.[1] ?? "";
    assert.match(health, /min-width: 46px;/);
    assert.match(health, /max-width: 46px;/);
    assert.match(health, /justify-content: center;/);
    assert.match(
      css,
      /\.workspace-header__utility > \.system-health-action \{[^}]*grid-template-columns: max-content max-content;[^}]*justify-content: center;[^}]*align-content: center;/,
      "the provider dot and short count should be centred as one compact unit",
    );
    assert.match(css, /\.header-kill-trigger \{[^}]*min-width: 48px;[^}]*justify-content: center;/);
    assert.match(css, /\.header-account-trigger \{[^}]*min-width: 44px;[^}]*justify-content: center;/);
  });

  it("gives every direct utility action the same 42px floor and a quiet operator boundary", () => {
    assert.match(
      css,
      /\.workspace-header__utility > :is\(button, a\),\s*\.workspace-header__utility > \.header-anchor > :is\(button, a\) \{\s*min-height: 42px;\s*\}/,
      "the shared floor must reach both direct actions and triggers inside an anchor wrapper",
    );
    assert.match(
      css,
      /\.workspace-header__utility > :is\(\.telegram-cta, \.header-command-button, \.latency-chip, \.system-health-action\),[\s\S]*?\.header-anchor > :is\(\.data-tier, \.header-kill-trigger\)[\s\S]*?border-color: color-mix[^}]*box-shadow:/,
      "the six live operator actions must retain their subtle shared edge and lift",
    );
    assert.match(css, /border-color: color-mix\(in srgb, var\(--border-strong\) 24%, transparent\)/);
  });

  it("puts stable sizing hooks on variable React branches", () => {
    assert.match(read("components/header/KillSwitchControl.tsx"), /header-kill-trigger/);
    const account = read("components/header/AccountChip.tsx");
    assert.ok(account.match(/header-account-trigger/g)?.length === 3, "all three account states need the same target hook");
  });
});
