/**
 * The two per-workspace tables inside `NextStepFooter`, measured apart from the
 * prose a tab actually renders.
 *
 * Both tables hold one entry per workspace and the footer renders exactly ONE
 * of them — the entry for the tab the reader is standing on. Counted as flat
 * source prose, every workspace's entry lands on every tab's word count, so a
 * change to a workspace nobody is looking at moves a different tab's measured
 * total. `summarised-overview.test.ts` records finding this the first time,
 * when splitting the Risk rail moved the Overview count by nine words with
 * nothing on that tab changed; adding the ninth tab moved it by thirteen more.
 *
 * Extracted here rather than repeated because there are now two of these tables
 * and a third would otherwise be found the same expensive way.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function footerSource(): string {
  return readFileSync(join(root, "..", "components/common/NextStepFooter.tsx"), "utf8");
}

/** The `why:` line of every contextual next-step entry. */
export function routingReasons(): string[] {
  return [...footerSource().matchAll(/^\s*why:\s*"([^"]+)",$/gm)].map((match) => match[1]);
}

/** The kicker, title and hint of every role-ring entry. */
export function ringProse(): string[] {
  return [...footerSource().matchAll(/^\s*(?:kicker|title|hint):\s*"([^"]+)",$/gm)].map((match) => match[1]);
}

/**
 * How many words a per-tab count must subtract, given that tab's word counter.
 *
 * The counter is passed in rather than reimplemented: a helper that counted
 * words its own way would subtract a different number from the one the caller
 * added, and the two would drift silently.
 */
export function perWorkspaceTableWords(wordsIn: (text: string) => string[]): number {
  const words = (lines: string[]) => lines.reduce((sum, line) => sum + wordsIn(line).length, 0);
  return words(routingReasons()) + words(ringProse());
}
