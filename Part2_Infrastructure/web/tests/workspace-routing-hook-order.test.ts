/**
 * No React hook may follow an early return.
 *
 * This is the one that already bit. The previous portfolio component returned a
 * skeleton while loading and called `useMemo` two hundred lines further down, so
 * the first render that had a book called one more hook than the render before it
 * and React threw "rendered more hooks than during the previous render". It was
 * reachable from the deployed site by clicking into the sandbox from the
 * unconfigured state, and no test or type could see it.
 *
 * These are source-level assertions on purpose. There is no DOM in this suite,
 * and the property worth pinning is structural: a future edit has to break it
 * deliberately. The scanner below is doing real parsing rather than grepping,
 * which is why the last case in the file re-runs it against the exact code that
 * shipped the bug — a check of this shape is worthless the moment it stops
 * catching what it was written for, and it would still pass everything else.
 *
 * Split from `tests/workspace-routing-nav.test.ts` on 2026-08-21, which also guarded
 * the nav-to-panel table (`workspace-routing-nav`), the section rails
 * (`workspace-routing-sections`), the shared polls (`workspace-routing-shared-fetch`)
 * and the page-head grammar (`workspace-routing-page-head`).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

/**
 * Every top-level function in a module, as {name, body}.
 *
 * The check runs per function, not per file: a helper defined above a component
 * returns at the same indentation a bail-out would, and scanning the file as one
 * string reads that helper's `return` as the component's.
 */
function topLevelFunctions(code: string): { name: string; body: string }[] {
  const starts = [...code.matchAll(/^(?:export\s+)?(?:default\s+)?function\s+(\w+)/gm)];
  return starts.map((match, index) => ({
    name: match[1],
    body: code.slice(match.index, starts[index + 1]?.index ?? code.length),
  }));
}

/**
 * Offset of the `{` opening a function's body — the first one after the
 * parameter list closes, not the first in the text. Destructured props put a
 * brace in the signature, and starting there tracks the wrong nesting entirely.
 */
function bodyStart(body: string): number {
  const lp = body.indexOf("(");
  if (lp === -1) return -1;
  let depth = 0;
  for (let i = lp; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")") {
      depth--;
      if (depth === 0) return body.indexOf("{", i);
    }
  }
  return -1;
}

/**
 * Returns and hook calls belonging to the function itself, found by tracking
 * which open braces start a nested function rather than a mere block.
 *
 * Indentation cannot do this job: a bail-out inside `if (…) { return … }` sits
 * at the same depth as a `return () => {}` cleanup inside `useEffect`, and one
 * of those is a bail-out while the other is not.
 */
function scan(body: string): { bailouts: number[]; hooks: { name: string; at: number }[] } {
  const open = bodyStart(body);
  if (open === -1) return { bailouts: [], hooks: [] };

  const stack: boolean[] = [];
  let fnDepth = 0;
  const hooks: { name: string; at: number }[] = [];
  const returns: number[] = [];

  for (let i = open; i < body.length; i++) {
    const ch = body[i];

    if (ch === "{") {
      const before = body.slice(Math.max(0, i - 220), i);
      const isFn = i === open || /=>\s*$/.test(before) || /\bfunction\s*\w*\s*\([^()]*\)\s*$/.test(before);
      stack.push(isFn);
      if (isFn) fnDepth++;
      continue;
    }
    if (ch === "}") {
      if (stack.pop()) fnDepth--;
      if (stack.length === 0) break;
      continue;
    }
    if (fnDepth !== 1) continue;

    // `return:` is a property name in a type literal, not a statement — the
    // portfolio payload has one, and counting it moves the bail-out hundreds of
    // lines earlier than it really is.
    if (
      body.startsWith("return", i)
      && /\W/.test(body[i - 1] ?? " ")
      && /\W/.test(body[i + 6] ?? " ")
      && body[i + 6] !== ":"
    ) {
      returns.push(i);
      i += 5;
      continue;
    }

    // Generic calls count: `useState<Foo | null>(null)` is a hook.
    const call = /^(use[A-Z]\w*)\s*(?:<[^;{}()]*>)?\s*\(/.exec(body.slice(i, i + 90));
    if (call && /\W/.test(body[i - 1] ?? " ")) {
      hooks.push({ name: call[1], at: i });
      i += call[1].length;
    }
  }

  // The last function-level return is the render; anything before it is a
  // bail-out that some renders will take and others will not.
  return { bailouts: returns.slice(0, -1), hooks };
}

const COMPONENTS = [
  // Opted in explicitly: this check iterates a hard-coded list, so a new
  // surface is invisible to it until someone adds the file. ProfileScreen is
  // exactly the shape the check exists for — three independent async loads
  // behind three early returns.
  "../components/profile/ProfileScreen.tsx",
  "../components/PortfolioWorkspace.tsx",
  // The four Portfolio sections, opted in when PortfolioWorkspace was split.
  // The book bail-out stayed in the workspace and the pane selectors went with
  // their sections, so the hazard did not disappear — it moved into four files
  // that this list would otherwise not look at.
  "../components/portfolio/OverviewSection.tsx",
  "../components/portfolio/PositionsSection.tsx",
  "../components/portfolio/AllocationSection.tsx",
  "../components/portfolio/PerformanceSection.tsx",
  "../components/RiskWorkspace.tsx",
  "../components/risk/LimitsPanel.tsx",
  "../components/DataConsole.tsx",
  "../components/ReliabilityConsole.tsx",
  "../components/DeveloperConsole.tsx",
  "../components/portfolio/BookChrome.tsx",
  "../components/portfolio/WorkingOrders.tsx",
  // Two pane states above a loading bail-out — the exact shape the check was
  // written for, opted in when the Activity split added the second one. The
  // feed hook beside it has no bail-out today, so the check passes it without
  // finding anything; it is listed so that the day someone adds an early
  // return to it — the natural way to make a hook "not run when unconfigured"
  // — the rule is already watching the file rather than being remembered.
  "../components/execution/ExecutionCockpit.tsx",
  "../components/execution/use-cockpit-feed.ts",
  "../lib/use-book.ts",
  // The eleven derived risk memos `use-book` used to hold inline. They were
  // the reason this rule exists for that file — the component they came from
  // returned early while loading and called `useMemo` further down — so the
  // list follows them into the hook that owns them now.
  "../lib/use-book-risk.ts",
  "../lib/use-system-health.ts",
  // The five surfaces the 2,000-line Page component was split into. Page
  // itself has no bail-out and is checked by desk-interconnect; these do the
  // hook work it used to, so they are opted in here where the rule lives.
  "../lib/use-workspace-routing.ts",
  "../lib/use-workspace-shortcuts.ts",
  "../lib/use-sweep-run.ts",
  "../components/ResearchWorkspace.tsx",
  "../components/research/AttributionSection.tsx",
  "../components/research/ResearchSummary.tsx",
];

describe("no component calls a hook after it might have returned", () => {
  for (const relative of COMPONENTS) {
    const name = relative.split("/").pop();

    it(`${name} keeps every hook above its first bail-out`, () => {
      assert.deepEqual(
        hookOffenders(read(relative)),
        [],
        `${name} calls a hook after an early return — React throws "rendered more `
          + 'hooks than during the previous render" on the first render that gets past it',
      );
    });
  }

  it("the check itself still catches the bug it was written for", () => {
    // The shape that shipped: bail out while loading, then call useMemo further
    // down. If this stops being detected, every assertion above is vacuous.
    const regressed = `
export default function Widget({ symbol }: { symbol: string }) {
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void load(); }, []);

  if (loading && !book) {
    return (
      <div className="skeleton" />
    );
  }

  const limits = useMemo(() => ({ max: book.cap }), [book]);
  return <Panel limits={limits} />;
}`;
    assert.deepEqual(hookOffenders(regressed), ["Widget calls useMemo"]);
  });
});

function hookOffenders(source: string): string[] {
  const code = stripNonCode(source);
  const offenders: string[] = [];
  for (const fn of topLevelFunctions(code)) {
    const { bailouts, hooks } = scan(fn.body);
    if (!bailouts.length) continue;
    const late = hooks.filter((hook) => hook.at > bailouts[0]).map((hook) => hook.name);
    if (late.length) offenders.push(`${fn.name} calls ${[...new Set(late)].join(", ")}`);
  }
  return offenders;
}
