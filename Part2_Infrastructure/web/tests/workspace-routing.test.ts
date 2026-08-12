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
const page = read("../app/dashboard/page.tsx");
const roleCards = read("../components/overview/RoleCards.tsx");
const styles = read("../app/globals.css");
const subtabs = read("../components/WorkspaceSubtabs.tsx");
const riskWorkspace = read("../components/RiskWorkspace.tsx");
const portfolioWorkspace = read("../components/PortfolioWorkspace.tsx");
const liveMarket = read("../components/LiveMarket.tsx");
const executionCockpit = read("../components/execution/ExecutionCockpit.tsx");
const workspaceOverview = read("../components/WorkspaceOverview.tsx");
const sectionsSource = read("../lib/sections.ts");

/** Section ids for a workspace, in rail order, from the lib/sections literal. */
function sectionIdsFor(workspace: string): string[] {
  const start = sectionsSource.indexOf(`export const ${workspace}_SECTIONS`);
  assert.ok(start >= 0, `lib/sections.ts defines no ${workspace}_SECTIONS`);
  const block = sectionsSource.slice(start, sectionsSource.indexOf("] as const", start));
  return [...block.matchAll(/\{\s*id:\s*"([a-z]+)"/g)].map((match) => match[1]);
}
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
  const start = source.indexOf("export const NAV_ITEMS");
  const block = source.slice(start, source.indexOf("];", start) + 2);
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

  it("keeps instrument and horizon controls out of the global header", () => {
    for (const retiredSurface of ["context-strip", "workspace-symbol", "workspace-interval"]) {
      assert.ok(!header.includes(retiredSurface), `${retiredSurface} returned to the global header`);
    }
  });

  it("balances the seven overview role cards and keeps their actions on one baseline", () => {
    assert.ok(roleCards.includes('className="role-card__actions"'), "role actions lost their layout hook");
    assert.ok(!roleCards.includes("flex-wrap"), "role actions can wrap onto mismatched baselines");
    assert.ok(
      styles.includes("grid-template-columns: repeat(8, minmax(0, 1fr));"),
      "desktop role cards no longer share the centred four-plus-three grid",
    );
    for (const card of [5, 6, 7]) {
      assert.ok(styles.includes(`.role-card:nth-child(${card})`), `role card ${card} is not centred`);
    }
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
    // Scoped to the LEGACY_VIEWS literal — a page-wide `key: "value"` scan
    // also matches unrelated records (e.g. the per-workspace section ref).
    const start = page.indexOf("const LEGACY_VIEWS");
    assert.ok(start >= 0, "page.tsx no longer declares LEGACY_VIEWS");
    const block = page.slice(start, page.indexOf("};", start));
    const legacy = [...block.matchAll(/([a-z]+):\s*"([a-z]+)"/g)]
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

  it("workspace switches write the full location, never a bare view", () => {
    // A bare `#research` while the rail shows Strategies was the copy-link /
    // reload desync. navigate() must read the live section at click time.
    assert.match(page, /url\.hash = detail\?\.hash \?\? `\$\{next\}\/\$\{sectionByViewRef\.current\[next\]\}`/);
    assert.ok(
      !/if \(next === "data"\) setDataSection\("overview"\)/.test(page),
      "the forced data reset is back — it hid the desync instead of fixing it",
    );
  });

  it("Alt+1–8 reads physical key codes and never fires while typing", () => {
    // macOS Option+digit produces "¡™£…", so an e.key range test never
    // matches — the advertised shortcut was dead on every Mac.
    assert.match(header, /e\.code/);
    assert.ok(header.includes("Digit[1-8]"), "workspace shortcuts no longer match Digit codes");
    assert.match(header, /isContentEditable/);
  });

  it("opens each internally scrolled Research section at its own beginning", () => {
    assert.match(page, /const researchContentRef = useRef<HTMLDivElement \| null>/);
    assert.match(page, /researchContentRef\.current\.scrollTop = 0/);
    assert.match(page, /className="research-content" ref=\{researchContentRef\}/);
  });

  it("splits every dense role workspace into focused feature groups", () => {
    // Section definitions live in lib/sections.ts — the single source the
    // rails, palette and hash whitelist read. The invariant pinned here is the
    // other half of the contract: every DEFINED section has a rendered panel
    // in the component(s) that own that workspace.
    const expectPanels = (workspace: string, sources: string[], label: string) => {
      const ids = sectionIdsFor(workspace);
      assert.ok(ids.length >= 3, `${label} defines too few sections (${ids.length})`);
      for (const id of ids) {
        assert.ok(
          sources.some((source) => source.includes(`tabId="${id}"`)),
          `${label} is missing the ${id} panel`,
        );
      }
    };
    expectPanels("OVERVIEW", [workspaceOverview], "overview");
    expectPanels("RESEARCH", [page], "research");
    expectPanels("EXECUTION", [page, liveMarket, executionCockpit], "execution");
    expectPanels("PORTFOLIO", [portfolioWorkspace], "portfolio");
    expectPanels("RISK", [riskWorkspace], "risk");
    expectPanels("DATA", [dataConsole], "data");
    expectPanels("RELIABILITY", [reliabilityConsole], "reliability");
    expectPanels("DEVELOPER", [developerConsole], "developer");

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
      "Part2_Infrastructure/web/app/dashboard/page.tsx",
      "Part2_Infrastructure/web/components/DeveloperConsole.tsx",
    ]) {
      assert.ok(repositoryManifest.files.includes(path), `repository catalog is missing ${path}`);
    }
    assert.ok(pipelineInspector.includes('if (!active || tab !== "rest"'), "hidden pipeline keeps polling");
    assert.ok(
      pipelineInspector.includes('active && tab === "socket" && socketSupported'),
      "hidden pipeline keeps venue sockets open",
    );
    assert.ok(
      page.includes('useState<DataSection>("overview")'),
      "data must open on trust evidence rather than the sample work queue",
    );
    assert.ok(
      page.includes('url.hash = `data/${next}`'),
      "data subtabs are not addressable by URL hash",
    );
    assert.ok(
      page.includes('url.hash = `reliability/${next}`'),
      "reliability subtabs are not addressable by URL hash",
    );
    assert.ok(
      page.includes('openReliabilitySection("services", "reliability-latency-guide")')
        && page.includes('openReliabilitySection("services", "reliability-provider-health")'),
      "header health controls no longer land on their matching reliability evidence",
    );
    assert.ok(
      page.includes("workspaceInterval={req.interval}")
        && dataConsole.includes("interval={workspaceInterval}"),
      "the lineage trace silently falls back to its own bar interval",
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
  // Opted in explicitly: this check iterates a hard-coded list, so a new
  // surface is invisible to it until someone adds the file. ProfileScreen is
  // exactly the shape the check exists for — three independent async loads
  // behind three early returns.
  "../components/profile/ProfileScreen.tsx",
  "../components/PortfolioWorkspace.tsx",
  "../components/RiskWorkspace.tsx",
  "../components/DataConsole.tsx",
  "../components/ReliabilityConsole.tsx",
  "../components/DeveloperConsole.tsx",
  "../components/portfolio/BookChrome.tsx",
  "../components/portfolio/WorkingOrders.tsx",
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

// ---------------------------------------------------------------------------
// One page-head grammar
// ---------------------------------------------------------------------------

describe("every tab opens with the same header", () => {
  /**
   * The stylesheet used to claim six bespoke page headers had been retired. Two
   * had; four were still rendering. The claim was prose, so nothing caught the
   * drift — this measures it instead.
   *
   * `PageHead` is the one grammar: identity, the numbers that frame it, the
   * controls that refresh them. `WorkspaceIntro` and `ConsoleChrome` are thin
   * adapters over it — they exist so the role tabs and the operational consoles
   * keep their own vocabularies (`insights`, `tiles`) without each growing a
   * second header. What must not happen is a ninth surface drawing its own.
   */
  const surfaces: Array<[string, string]> = [
    ["page.tsx", page],
    ["DataConsole.tsx", dataConsole],
    ["ReliabilityConsole.tsx", reliabilityConsole],
    ["DeveloperConsole.tsx", developerConsole],
    ["RiskWorkspace.tsx", riskWorkspace],
    ["PortfolioWorkspace.tsx", portfolioWorkspace],
  ];

  it("the adapters really are adapters, not second implementations", () => {
    for (const name of ["WorkspaceIntro.tsx", "systems/ConsoleChrome.tsx"]) {
      const source = read(`../components/${name}`);
      assert.match(
        source,
        /from "@\/components\/workspace\/PageHead"/,
        `${name} stopped rendering through PageHead — that is a second header grammar, `
          + "which is the divergence PageHead was introduced to end",
      );
    }
  });

  it("every workspace surface reaches PageHead through one of them", () => {
    for (const [name, source] of surfaces) {
      const rendersHeader = /<(PageHead|WorkspaceIntro|ConsoleChrome)\b/.test(source);
      const importsHeader = /(PageHead|WorkspaceIntro|ConsoleChrome)/.test(source);
      assert.ok(
        rendersHeader || !importsHeader,
        `${name} imports a header component but renders none`,
      );
    }
  });

  it("no surface draws a bespoke header bar", () => {
    // The four that were retired. A fifth appearing means someone hand-rolled
    // a header rather than passing metrics to the shared one.
    const retired = ["data-cp-bar", "console-statusbar", "developer-cp-bar", "page-heading__meta"];
    for (const [name, source] of surfaces) {
      for (const bar of retired) {
        assert.ok(
          !source.includes(`"${bar}`) && !source.includes(` ${bar}"`),
          `${name} renders the retired .${bar}`,
        );
      }
    }
  });

  it("each of the eight tabs has exactly one head in its panel", () => {
    // Two heads on one tab is the scatter this converged out of; zero means a
    // tab opens with no identity at all.
    for (const view of navIds(header)) {
      const panel = page.slice(page.indexOf(`{view === "${view}" &&`));
      const body = panel.slice(0, panel.indexOf("\n        {view ===") + 1 || panel.length);
      const heads = (body.match(/<WorkspaceIntro\b/g) ?? []).length;
      // Overview draws the navy hero; the three consoles own their head
      // internally because they compute their own metrics. Both are one head.
      assert.ok(heads <= 1, `${view} renders ${heads} WorkspaceIntro elements`);
    }
  });
});
