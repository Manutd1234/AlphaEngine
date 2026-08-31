import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
const header = read("components/WorkspaceHeader.tsx");
const commandBar = read("components/header/CommandBar.tsx");
const engineTopbar = read("app/globals/14w-engine-topbar.css");

describe("shared page-heading geometry", () => {
  it("lets the owning card provide the only horizontal inset", () => {
    assert.match(
      css,
      /\.page-heading__copy\s*\{[^}]*padding:\s*8px 0;/s,
      "the shared heading must not sit 24px to the right of its context strip",
    );
    assert.doesNotMatch(
      engineTopbar,
      /padding-inline-start:\s*calc\(24px - var\(--space-4\) - 1px\)/,
      "analytical tabs must not compensate for an inset the shared heading no longer owns",
    );
  });

  it("restores the familiar bold title weight and gives role-only headings a full display rung", () => {
    assert.match(
      css,
      /\.page-heading h1\s*\{[^}]*margin:\s*0;[^}]*font-size:\s*var\(--fs-hero-line\);[^}]*font-weight:\s*700;/s,
    );
    assert.match(
      css,
      /\.page-heading h1\.page-role-title\s*\{[^}]*font-size:\s*var\(--fs-hero-sub\);[^}]*font-weight:\s*700;/s,
      "the single role heading replaces a former two-line hierarchy and must retain its visual authority",
    );
    assert.match(
      css,
      /\.page-heading__copy\.is-role-only p\s*\{[^}]*font-size:\s*var\(--fs-xl\);/s,
      "role descriptions must remain readable beside the enlarged identity",
    );
  });
});

describe("global command rail geometry", () => {
  it("does not render flexible whitespace between navigation and Telegram", () => {
    assert.doesNotMatch(header, /className="header-spacer"/);
    assert.match(css, /\.workspace-tabs::after\s*\{[^}]*content:\s*none;/s);
  });

  it("keeps navigation borderless and gives operator signals tactile depth", () => {
    assert.match(
      css,
      /\.workspace-tabs button\s*\{[^}]*min-height:\s*42px;[^}]*padding:\s*7px 6px;[^}]*border:\s*0;[^}]*border-radius:\s*6px;/s,
    );
    assert.match(
      css,
      /\.workspace-header__utility > :is\(\.telegram-cta, \.header-command-button, \.latency-chip, \.system-health-action\),[\s\S]*?\.header-anchor > :is\(\.data-tier, \.header-kill-trigger\)[\s\S]*?box-shadow:/s,
      "specified operator signals must keep a quiet shared edge and shallow depth",
    );
  });

  it("keeps command-palette option ids distinct from navigation-tab ids", () => {
    assert.match(commandBar, /const commandOptionId = \(commandId: string\) => RECENTS_KEY \+ commandId;/);
    assert.match(commandBar, /id=\{commandOptionId\(command\.id\)\}/);
    assert.match(commandBar, /aria-activedescendant=\{filtered\[cursor\] \? commandOptionId\(filtered\[cursor\]\.id\) : undefined\}/);
    assert.doesNotMatch(commandBar, /id=\{command\.id\}/);
  });
});

describe("narrow-screen density", () => {
  it("uses a complete two-by-two overview metric grid on phones", () => {
    assert.match(
      css,
      /@media \(max-width:\s*620px\)[\s\S]*?\.overview-hero \.page-heading__insights\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
  });
});
