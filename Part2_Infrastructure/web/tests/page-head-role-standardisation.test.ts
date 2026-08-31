import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const head = read("components/workspace/PageHead.tsx");
const intro = read("components/WorkspaceIntro.tsx");
const consoleChrome = read("components/systems/ConsoleChrome.tsx");
const data = read("components/DataConsole.tsx");
const developer = read("components/DeveloperConsole.tsx");

describe("role headers use one prominent static identity band", () => {
  it("shares one role-only switch across adapters and direct console callers", () => {
    assert.match(intro, /showTitle=\{false\}/);
    assert.match(consoleChrome, /showTitle=\{false\}/);
    assert.match(data, /showTitle=\{false\}/);
    assert.match(developer, /showTitle=\{false\}/);
  });

  it("renders the role itself as the single heading when the route title is redundant", () => {
    assert.match(head, /showTitle \? \([\s\S]*?<span className="page-kicker">\{kicker\}<\/span>[\s\S]*?<h1>\{title\}<\/h1>[\s\S]*?\) : \(\s*<h1 className="page-role-title">\{kicker\}<\/h1>/);
  });

  it("keeps the role baseline and shared copy flush with its context strip", () => {
    assert.match(globalsCss, /\.page-heading__copy\s*\{[^}]*min-height:\s*48px;[^}]*padding:\s*8px 0;[^}]*justify-content:\s*center;/s);
    assert.match(globalsCss, /\.page-heading__copy\.is-role-only\s*\{[^}]*align-self:\s*flex-start;[^}]*flex-direction:\s*column;[^}]*align-items:\s*flex-start;/s);
    assert.match(globalsCss, /\.page-heading h1\.page-role-title\s*\{[^}]*font-size:\s*var\(--fs-hero-sub\);[^}]*font-weight:\s*700;/s);
    assert.match(globalsCss, /\.page-heading h1\s*\{[^}]*font-size:\s*var\(--fs-hero-line\);[^}]*font-weight:\s*700;/s);
    assert.match(globalsCss, /\.page-heading__copy\.is-role-only p\s*\{[^}]*font-size:\s*var\(--fs-xl\);/s);
  });

  it("has no interactive page-kicker wrapper or arrow glyph", () => {
    assert.doesNotMatch(head, /<details className="page-heading__brief"|<summary className="page-kicker"|▶|▼/);
  });
});
