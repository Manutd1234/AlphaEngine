/**
 * The workspace is one tab per desk role. Two things have to stay true for that
 * to keep working, and neither is visible to a type checker.
 *
 * First, every tab in the nav must have a panel behind it. A tab whose panel id
 * was never added renders an empty shell — the header highlights it, the URL
 * updates, and the page goes blank. That is a routing table and a render tree
 * agreeing by convention, which is exactly the kind of agreement that rots.
 *
 * Second — and this is the one that already bit — no React hook may follow an
 * early return. The previous portfolio component returned a skeleton while
 * loading and called `useMemo` two hundred lines further down, so the first
 * render that had a book called one more hook than the render before it and
 * React threw "rendered more hooks than during the previous render". It was
 * reachable from the deployed site by clicking into the sandbox from the
 * unconfigured state, and no test or type could see it.
 *
 * These are source-level assertions on purpose. There is no DOM in this suite,
 * and the property worth pinning is structural: a future edit has to break it
 * deliberately.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const header = read("../components/WorkspaceHeader.tsx");
const page = read("../app/page.tsx");
const subtabs = read("../components/WorkspaceSubtabs.tsx");
const riskWorkspace = read("../components/RiskWorkspace.tsx");
const dataConsole = read("../components/DataConsole.tsx");
const reliabilityConsole = read("../components/ReliabilityConsole.tsx");
const developerConsole = read("../components/DeveloperConsole.tsx");
const dataWorkBoard = read("../components/data/DataWorkBoard.tsx");
const developerWorkQueue = read("../components/developer/DeveloperWorkQueue.tsx");
const pipelineInspector = read("../components/systems/PipelineInspector.tsx");
const traceConsole = read("../components/systems/TraceConsole.tsx");
const repositoryManifest = JSON.parse(read("../lib/repository-manifest.generated.json")) as {
  version: number;
  files: string[];
};

/** Nav ids, in declaration order, from the single NAV_ITEMS literal. */
function navIds(source: string): string[] {
  const block = source.slice(source.indexOf("NAV_ITEMS"), source.indexOf("const COMMON_SYMBOLS"));
  return [...block.matchAll(/\{\s*id:\s*"([a-z]+)"/g)].map((match) => match[1]);
}

// --------------------------------------------------------------------------
// Every tab has a panel
// --------------------------------------------------------------------------

describe("the nav and the render tree describe the same workspace", () => {
  const ids = navIds(header);

  it("declares the overview plus one tab per desk role", () => {
    assert.deepEqual(ids, [
      "overview",
      "research",
      "live",
      "portfolio",
      "risk",
      "data",
      "reliability",
      "developer",
    ]);
  });

  it("every nav id renders a panel with the matching id", () => {
    for (const id of ids) {
      assert.ok(
        page.includes(`id="panel-${id}"`) || id === "overview",
        `nav has a "${id}" tab with no panel-${id} behind it`,
      );
      assert.ok(
        page.includes(`view === "${id}"`),
        `nav has a "${id}" tab that no branch in page.tsx renders`,
      );
    }
  });

  it("every panel is reachable from the nav rather than only by hash", () => {
    for (const match of page.matchAll(/id="panel-([a-z]+)"/g)) {
      assert.ok(ids.includes(match[1]), `panel-${match[1]} has no tab in the nav`);
    }
  });

  it("the retired systems hash still lands somewhere real", () => {
    const legacy = [...page.matchAll(/^\s*([a-z]+):\s*"([a-z]+)",$/gm)]
      .filter(([, , target]) => ids.includes(target));
    assert.ok(legacy.length > 0, "no legacy hash redirects survive");
    for (const [, from, to] of legacy) {
      assert.ok(!ids.includes(from), `"${from}" is a live tab and should not be redirected`);
      assert.ok(ids.includes(to), `legacy hash "${from}" points at "${to}", which is not a tab`);
    }
  });
});

describe("dense role workspaces expose accessible feature sections", () => {
  it("uses one roving tab pattern for every nested workspace", () => {
    assert.match(subtabs, /role="tablist"/);
    assert.match(subtabs, /role="tab"/);
    assert.match(subtabs, /role="tabpanel"/);
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      assert.ok(subtabs.includes(key), `nested tabs do not handle ${key}`);
    }
  });

  it("splits every dense role workspace into focused feature groups", () => {
    for (const section of ["trade", "liquidity", "routing", "activity", "summary", "parameters", "walkforward", "attribution", "decision", "runs"]) {
      assert.ok(page.includes(`id: "${section}"`), `page is missing the ${section} subtab`);
    }
    for (const section of ["limits", "model", "scenarios", "controls"]) {
      assert.ok(riskWorkspace.includes(`id: "${section}"`), `risk is missing the ${section} subtab`);
    }
    for (const section of ["queue", "routing", "pipeline", "quality", "capacity"]) {
      assert.ok(dataConsole.includes(`id: "${section}"`), `data is missing the ${section} subtab`);
      assert.ok(dataConsole.includes(`tabId="${section}"`), `data is missing the ${section} panel`);
    }
    for (const section of ["overview", "services", "events", "controls"]) {
      assert.ok(
        reliabilityConsole.includes(`id: "${section}"`),
        `reliability is missing the ${section} subtab`,
      );
      assert.ok(
        reliabilityConsole.includes(`tabId="${section}"`),
        `reliability is missing the ${section} panel`,
      );
    }
    for (const section of ["overview", "codebase", "work", "apis", "quality"]) {
      assert.ok(
        developerConsole.includes(`id: "${section}"`),
        `developer is missing the ${section} subtab`,
      );
      assert.ok(
        developerConsole.includes(`tabId="${section}"`),
        `developer is missing the ${section} panel`,
      );
    }

    // The board has a native keyboard alternative to dragging and announces
    // moves without stealing focus. Hidden pipeline panels remain mounted, so
    // their poll and venue sockets must also be explicitly gated by `active`.
    assert.match(dataWorkBoard, /aria-label=\{`Status for \$\{item\.id\}`\}/);
    assert.match(dataWorkBoard, /aria-live="polite"/);
    assert.ok(!dataWorkBoard.includes("draggable="), "the board must not rely on drag-only movement");
    assert.match(developerWorkQueue, /aria-label=\{`Status for \$\{item\.id\}:/);
    assert.match(developerWorkQueue, /aria-live="polite"/);
    assert.ok(!developerWorkQueue.includes("draggable="), "developer work must not rely on drag-only movement");

    assert.equal(repositoryManifest.version, 1);
    assert.ok(repositoryManifest.files.length >= 221, "repository catalog lost committed paths");
    assert.equal(new Set(repositoryManifest.files).size, repositoryManifest.files.length, "repository catalog has duplicate paths");
    for (const path of [
      "README.md",
      "Part1_Data_Handling/README.md",
      "Part2_Infrastructure/main.py",
      "Part2_Infrastructure/OpenBB_Service/app.py",
      "Part2_Infrastructure/web/app/page.tsx",
      "Part2_Infrastructure/web/components/DeveloperConsole.tsx",
    ]) {
      assert.ok(repositoryManifest.files.includes(path), `repository catalog is missing ${path}`);
    }
    assert.ok(pipelineInspector.includes('if (!active || tab !== "rest"'), "hidden pipeline keeps polling");
    assert.ok(
      pipelineInspector.includes('active && tab === "socket" && socketSupported'),
      "hidden pipeline keeps venue sockets open",
    );
    assert.equal(
      reliabilityConsole.match(/<TraceConsole/g)?.length,
      1,
      "reliability must have one correlated event stream",
    );
    assert.ok(
      reliabilityConsole.includes('active={section === "events"}'),
      "hidden reliability events are not deactivated",
    );
    assert.ok(
      traceConsole.includes("if (!active || paused) return;"),
      "hidden or paused trace performs its initial pull",
    );
    assert.ok(
      traceConsole.includes("if (!active || paused || !pollMs) return;"),
      "hidden trace keeps its polling interval",
    );
  });
});

// --------------------------------------------------------------------------
// Hook order
// --------------------------------------------------------------------------

/**
 * Strips comments and string literals so a `return` inside prose or a hook name
 * inside a comment cannot register as code.
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

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
  "../components/PortfolioWorkspace.tsx",
  "../components/RiskWorkspace.tsx",
  "../components/DataConsole.tsx",
  "../components/ReliabilityConsole.tsx",
  "../components/DeveloperConsole.tsx",
  "../components/portfolio/BookChrome.tsx",
  "../lib/use-book.ts",
  "../lib/use-system-health.ts",
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

// --------------------------------------------------------------------------
// The shared snapshot
// --------------------------------------------------------------------------

describe("tabs that read the same snapshot share one fetch", () => {
  it("only the hooks own the gateway polls", () => {
    const bookHook = read("../lib/use-book.ts");
    assert.ok(bookHook.includes("/api/gateway/portfolio"), "the book hook no longer fetches the book");

    // A tab fetching the book itself would be a second source of truth: two
    // tabs quoting different equity is worse than one tab holding both.
    for (const relative of ["../components/PortfolioWorkspace.tsx", "../components/RiskWorkspace.tsx"]) {
      const code = stripNonCode(read(relative));
      assert.ok(
        !code.includes("/api/gateway/portfolio"),
        `${relative} fetches the book directly instead of reading the shared hook`,
      );
    }
  });

  it("the console tabs share one health poll", () => {
    const healthHook = read("../lib/use-system-health.ts");
    assert.ok(healthHook.includes("/api/system/health"), "the health hook no longer fetches health");
    assert.ok(
      healthHook.includes('quiet ? "background" : "interactive"'),
      "unattended health polls spend interactive provider reserve",
    );

    for (const relative of [
      "../components/DataConsole.tsx",
      "../components/ReliabilityConsole.tsx",
      "../components/DeveloperConsole.tsx",
    ]) {
      const code = stripNonCode(read(relative));
      assert.ok(
        !code.includes("/api/system/health"),
        `${relative} polls health directly instead of reading the shared hook`,
      );
    }
  });
});
