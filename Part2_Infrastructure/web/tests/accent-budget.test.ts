/**
 * What the saturated accent is allowed to mean.
 *
 * `--series-1` filled is the desk's loudest statement. It belongs to controls
 * that commit something: Send order, Sign in, Promote strategy, Retry
 * connection. It had also been given to `.seg button[aria-pressed="true"]` —
 * the *selected* state of a segmented control — and twenty-two components
 * render a `.seg`. So choosing a log level, a chart's colouring or a blotter
 * filter shouted in exactly the voice reserved for submitting an order, on
 * every one of the eight tabs.
 *
 * Emphasis that is everywhere carries nothing. These tests hold the budget.
 *
 * One exception is deliberate and is asserted as hard as the rule: the order
 * ticket's BUY/SELL picker had no styling of its own and inherited that base
 * rule entirely. Quieting the base alone would have made the control deciding
 * WHICH DIRECTION AN ORDER GOES exactly as loud as a filter, on the one screen
 * where misreading it sends a wrong-way trade.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/** Comment bodies blanked, newlines kept, so prose is not read as a rule. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

const css = strip(globalsCss);

/** The body of the last rule for a selector — the one that wins. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`\\n${escaped} \\{([^}]*)\\}`, "g"))];
  assert.ok(matches.length > 0, `${selector} has no rule`);
  return matches[matches.length - 1][1];
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("a selected segment is not a call to action", () => {
  it("the base pressed state is a raised surface, not the accent fill", () => {
    const body = ruleBody('.seg button[aria-pressed="true"]');
    assert.doesNotMatch(
      body,
      /background:\s*var\(--series-1\)/,
      "every segmented control in the app is shouting in the Send-order voice again",
    );
    assert.match(body, /background:\s*var\(--surface-1\)/);
    assert.match(body, /color:\s*var\(--text-primary\)/);
  });

  it("selection is still readable without colour", () => {
    // The house rule, and what survives forced-colors: the raised surface and
    // the shadow say "chosen" as well as the hue does, and `aria-pressed` says
    // it to a screen reader.
    assert.match(ruleBody('.seg button[aria-pressed="true"]'), /box-shadow:/);
  });

  it("the order side keeps a saturated fill, and takes it from the side", () => {
    assert.match(ruleBody('.seg--side button[value="BUY"][aria-pressed="true"]'), /var\(--diverging-pos\)/);
    assert.match(ruleBody('.seg--side button[value="SELL"][aria-pressed="true"]'), /var\(--diverging-neg\)/);
    // And direction is never carried by hue alone — the label is the word.
    // The side seg moved into `OrderTicketForm.tsx` when the ticket was split.
    const ticket = read("components/execution/OrderTicketForm.tsx");
    assert.match(ticket, /className="seg seg--side"/);
    assert.match(ticket, /\["BUY", "SELL"\] as const/);
    assert.match(ticket, /value=\{option\}/);
  });

  it("only the order ticket claims the exception", () => {
    // `seg--side` exists to keep ONE control loud. A second user would be the
    // budget leaking back out through the exception rather than the rule.
    const claimants = sourceFiles(join(root, "components"))
      .filter((file) => strip(readFileSync(file, "utf8")).includes("seg--side"))
      .map((file) => file.slice(root.length));
    assert.deepEqual(claimants, ["components/execution/OrderTicketForm.tsx"]);
  });
});

describe("the accent fill stays with controls that commit something", () => {
  it("no link that leaves the application wears it", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, "components"))) {
      const source = strip(readFileSync(file, "utf8"));
      // An <a> carrying primary-action and opening a new tab is, by
      // construction, navigation away from the desk.
      for (const tag of source.match(/<a[^>]*>/g) ?? []) {
        if (tag.includes("primary-action") && tag.includes('target="_blank"')) {
          offenders.push(file.slice(root.length));
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `external links wearing the Send-order treatment:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("every remaining claimant does something, and the list is explicit", () => {
    // Not a count — a roll call, scoped to `components/`. A new
    // `primary-action` has to be argued for here, which is the only thing that
    // stops the budget drifting back one reasonable-looking button at a time.
    //
    // The test each of these passes is "clicking it makes something happen",
    // not merely "it is the most important thing on the card". The six removed
    // in this pass all failed it: they navigated, and four of them navigated
    // out of the application entirely.
    const claimants = new Set<string>();
    for (const file of sourceFiles(join(root, "components"))) {
      if (strip(readFileSync(file, "utf8")).includes("primary-action")) {
        claimants.add(file.slice(root.length));
      }
    }
    assert.deepEqual([...claimants].sort(), [
      // Was `components/DeveloperConsole.tsx`. The button did not change and
      // neither did its argument — it is still the one that runs the parity
      // check in this browser, one click for one result — but the console was
      // split along its section rail and the Interfaces section took it.
      "components/developer/DeveloperInterfaces.tsx", // run the parity check here
      // New to this roll call only because the Research tab moved out of
      // app/dashboard/page.tsx, which this scan never covered. The button is
      // the sweep's "Run now": one click, one request, a new result — the
      // commit test, not the importance test.
      "components/ResearchWorkspace.tsx",            // run the sweep
      "components/auth/AuthCallback.tsx",            // sign in
      // The login form's own submit button, which moved with the card when
      // LoginScreen was split. The screen keeps the one on its unconfigured
      // branch — "Open the workspace" — so both files claim the fill and both
      // still pass the commit test.
      "components/auth/LoginCard.tsx",               // sign in / create account
      "components/auth/LoginScreen.tsx",             // open the workspace as a guest
      "components/data/DataWorkBoard.tsx",           // add to intake — the commit that creates an item
      "components/developer/DeveloperWorkQueue.tsx", // add to triage
      "components/execution/OrderTicketForm.tsx",    // send order
      "components/execution/PnlStrip.tsx",           // enter sandbox
      "components/portfolio/BookChrome.tsx",         // retry connection, enter sandbox
      "components/profile/ProfileScreen.tsx",        // sign in
      "components/research/FavouritesPanel.tsx",     // re-run and combine
      "components/research/PromotionPanel.tsx",      // promote strategy
      "components/research/StaleGate.tsx",           // re-run the sweep
    ].sort());
  });
});

describe("primary has one spelling and navigators stay quiet", () => {
  it("button.primary stays retired", () => {
    // A second accent-fill variant with its own geometry, invisible to the
    // roll call above because that greps for 'primary-action' — accent
    // discipline enforced for one name and not the other. Its three users
    // were reclassed (the commit to primary-action, the togglers to the
    // default voice) and the rule deleted.
    assert.doesNotMatch(css, /button\.primary \{/);
    for (const file of sourceFiles(join(root, "components"))) {
      assert.ok(
        !strip(readFileSync(file, "utf8")).includes('className="primary"'),
        `${file.slice(root.length)} resurrects the retired button.primary variant`,
      );
    }
  });

  it("the flow footer's door does not wear the fill", () => {
    // A navigator to another workspace, under a class name the roll call
    // cannot see. By the tested rule that stripped the fill from the
    // developer console's cross-tab links, a door is not a commit.
    const start = css.indexOf(".next-step-footer__action {");
    assert.ok(start >= 0, "the footer action rule is gone");
    const block = css.slice(start, css.indexOf("}", start));
    assert.doesNotMatch(block, /var\(--series-1\)/);
    assert.doesNotMatch(block, /#fff/i);
  });
});

describe("the radius ladder has one name per step", () => {
  it("no bare --radius token survives alongside --radius-lg", () => {
    // Both were 14px. Two names for one value is how a ladder stops being one:
    // half the sheet reaches for each, and neither can be retuned alone.
    assert.doesNotMatch(css, /^\s*--radius:\s/m);
    assert.match(css, /--radius-sm:/);
    assert.match(css, /--radius-md:/);
    assert.match(css, /--radius-lg:/);
    assert.match(css, /--radius-pill:/);
  });

  it("the pill radius is written as a token, not as 999px", () => {
    assert.doesNotMatch(css, /border-radius:\s*999px/);
  });
});
