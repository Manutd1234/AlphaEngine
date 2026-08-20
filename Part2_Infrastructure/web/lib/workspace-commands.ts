/**
 * Every ⌘K entry the workspace offers, built from the same lists the rails use.
 *
 * Lifted out of `page.tsx`, where it was a 190-line `useMemo` inside a
 * 2,200-line component — the single largest block in the file and the one with
 * the least to do with rendering. Round J of the plan names this extraction
 * explicitly.
 *
 * ── The rule this file exists to keep ──────────────────────────────────────
 * The palette knows nothing the rails do not. Every tab, section, strategy and
 * symbol is read from `lib/sections.ts` and `lib/types.ts` rather than listed
 * here, so a renamed section cannot leave a stale command behind. A palette
 * with its own copy of the routing table is a second routing table.
 *
 * ── Why the dependencies arrive as one object ──────────────────────────────
 * Twenty-six of them, because the palette drives the whole workspace. They are
 * destructured on the first line so the body below is byte-identical to what
 * it was inside the component — a move that also rewrote every reference would
 * be two changes wearing one commit, and the diff could not be read.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 * Nothing that submits, cancels or routes an order. The kill switch is a
 * NAVIGATION entry, not an action, precisely so a fuzzy match cannot fire it —
 * that is a decision, not an omission.
 */

import { NAV_ITEMS, type WorkspaceView } from "@/components/WorkspaceHeader";
import type { Command } from "@/components/header/CommandBar";
import { usd } from "@/lib/format";
import { RESEARCH_SYMBOLS } from "@/lib/research-symbols";
import {
  DATA_SECTIONS,
  DEVELOPER_SECTIONS,
  EXECUTION_SECTIONS,
  OVERVIEW_SECTIONS,
  PORTFOLIO_SECTIONS,
  RELIABILITY_SECTIONS,
  RESEARCH_SECTIONS,
  RISK_SECTIONS,
  type DataSection,
  type DeveloperSection,
  type ExecutionSection,
  type OverviewSection,
  type PortfolioSection,
  type ReliabilitySection,
  type ResearchSection,
  type RiskSection,
} from "@/lib/sections";
import { STRATEGY_FAMILY, STRATEGY_LABELS, type Strategy } from "@/lib/types";
import type { Side } from "@/lib/venues";
import { toggleDocumentThemeMode } from "@/lib/theme";
import { APP_COMMIT } from "@/lib/version";

type Setter<T> = (value: T | ((previous: T) => T)) => void;

/** What the palette needs from the page to drive the whole workspace. */
export interface CommandDeps {
  // `apply` and `hash` are required TOGETHER when the detail is given: a
  // navigation that applies a section without writing the hash leaves the URL
  // describing the wrong pane, which is the bug `readLocation` exists to make
  // impossible. The page's own signature says so and this matches it exactly.
  navigate: (
    view: WorkspaceView,
    replace?: boolean,
    detail?: { apply: () => void; hash: string },
  ) => void;
  setOverviewSection: Setter<OverviewSection>;
  setResearchSection: Setter<ResearchSection>;
  setExecutionSection: Setter<ExecutionSection>;
  setPortfolioSection: Setter<PortfolioSection>;
  setRiskSection: Setter<RiskSection>;
  setDataSection: Setter<DataSection>;
  setReliabilitySection: Setter<ReliabilitySection>;
  setDeveloperSection: Setter<DeveloperSection>;
  updateStrategy: (strategy: Strategy) => void;
  updateSymbol: (symbol: string) => void;
  run: () => void | Promise<unknown>;
  pinRun: () => void;
  running: boolean;
  currentPinned: boolean;
  /** The completed sweep, or null. Only its presence is read here. */
  data: unknown;
  showMcBands: boolean;
  setShowMcBands: Setter<boolean>;
  setMcRunNonce: Setter<number>;
  side: Side;
  setSide: Setter<Side>;
  setNotional: Setter<number>;
  copyLinkToView: () => void;
  setShortcutsOpen: Setter<boolean>;
  view: WorkspaceView;
  researchSection: ResearchSection;
  /** The symbol the whole workspace is currently about. */
  symbol: string;
  /** `useSystemHealth().refresh` — re-reads every provider, venue and gateway. */
  refreshHealth: (quiet: boolean) => void | Promise<void>;
  /** `useSystemHealth().onReconnectSockets` — drops and redials the live feeds. */
  reconnectSockets: () => void;
  /** Carries the held symbol out of the book to wherever it can be examined. */
  focusPortfolioSymbol: (symbol: string, destination: "research" | "live" | "data") => void;
}

export function buildCommands(d: CommandDeps): Command[] {
  const {
    navigate, setOverviewSection, setResearchSection, setExecutionSection,
    setPortfolioSection, setRiskSection, setDataSection, setReliabilitySection,
    setDeveloperSection, updateStrategy, updateSymbol, run, pinRun, running,
    currentPinned, data, showMcBands, setShowMcBands, setMcRunNonce, side,
    setSide, setNotional, copyLinkToView, setShortcutsOpen, view,
    researchSection, symbol, refreshHealth, reconnectSockets,
    focusPortfolioSymbol,
  } = d;

  const list: Command[] = NAV_ITEMS.map((item, index) => ({
    id: `tab-${item.id}`,
    label: `${item.accessibleLabel ?? item.label} — ${item.role}`,
    category: "Workspace",
    hotkey: `Alt+${index + 1}`,
    action: () => navigate(item.id),
  }));

  const section = (
    view: WorkspaceView,
    tab: string,
    id: string,
    label: string,
    apply: () => void,
  ) => {
    list.push({
      id: `sec-${view}-${id}`,
      label: `${tab} → ${label}`,
      category: "Section",
      action: () => navigate(view, false, { apply, hash: `${view}/${id}` }),
    });
  };
  // One pattern for all workspaces, read from lib/sections — the palette can
  // no longer drift from the rails in label or order.
  for (const s of OVERVIEW_SECTIONS) {
    section("overview", "Overview", s.id, `${s.label} — ${s.description}`, () => setOverviewSection(s.id));
  }
  for (const s of RESEARCH_SECTIONS) {
    section("research", "Research", s.id, `${s.label} — ${s.description}`, () => setResearchSection(s.id));
  }
  for (const s of EXECUTION_SECTIONS) {
    section("live", "Execution", s.id, `${s.label} — ${s.description}`, () => setExecutionSection(s.id));
  }
  for (const s of PORTFOLIO_SECTIONS) {
    section("portfolio", "Portfolio", s.id, `${s.label} — ${s.description}`, () => setPortfolioSection(s.id));
  }
  for (const s of RISK_SECTIONS) {
    section("risk", "Risk", s.id, `${s.label} — ${s.description}`, () => setRiskSection(s.id));
  }
  for (const s of DATA_SECTIONS) {
    section("data", "Data", s.id, `${s.label} — ${s.description}`, () => setDataSection(s.id));
  }
  for (const s of RELIABILITY_SECTIONS) {
    section("reliability", "Reliability", s.id, `${s.label} — ${s.description}`, () => setReliabilitySection(s.id));
  }
  for (const s of DEVELOPER_SECTIONS) {
    section("developer", "Developer", s.id, `${s.label} — ${s.description}`, () => setDeveloperSection(s.id));
  }

  for (const strategy of Object.keys(STRATEGY_LABELS) as Strategy[]) {
    list.push({
      id: `model-${strategy}`,
      label: `Model: ${STRATEGY_LABELS[strategy]} — ${STRATEGY_FAMILY[strategy]}`,
      category: "Model",
      action: () => {
        updateStrategy(strategy);
        navigate("research", false, { apply: () => setResearchSection("summary"), hash: "research/summary" });
      },
    });
  }
  for (const s of RESEARCH_SYMBOLS) {
    list.push({
      id: `sym-${s.symbol}`,
      label: `${s.symbol} — ${s.name}, ${s.sector}`,
      category: "Symbol",
      action: () => { updateSymbol(s.symbol); navigate("live"); },
    });
  }
  list.push({
    id: "act-kill",
    label: "Kill switch — halt and flatten",
    category: "Risk control",
    action: () => navigate("risk", false, { apply: () => setRiskSection("controls"), hash: "risk/controls" }),
  });
  // Navigation stays the empty-query index. Unused verbs sit after it; once
  // used, CommandBar's existing recents projection promotes them above it.
  list.push(
    {
      id: "action-run-sweep",
      label: "Run sweep",
      category: "Action",
      hotkey: "⌘↵",
      action: () => {
        if (view !== "research" || researchSection !== "summary") {
          navigate("research", false, {
            apply: () => setResearchSection("summary"),
            hash: "research/summary",
          });
        }
        void run();
      },
    },
    {
      id: "action-pin-run",
      label: running
        ? "Pin run — sweep in progress"
        : currentPinned
          ? "Pin run — already pinned"
          : data
            ? "Pin run"
            : "Pin run — no completed result",
      category: "Action",
      action: () => {
        if (data && !currentPinned && !running) pinRun();
      },
    },
    {
      id: "action-toggle-mc-band",
      label: `${showMcBands ? "Hide" : "Show"} Monte Carlo band`,
      category: "Action",
      action: () => setShowMcBands((visible) => !visible),
    },
    {
      id: "action-run-mc-dist",
      label: "Run Monte Carlo distribution",
      category: "Action",
      action: () => {
        setMcRunNonce((nonce) => nonce + 1);
        navigate("risk", false, {
          apply: () => setRiskSection("montecarlo"),
          hash: "risk/montecarlo",
        });
      },
    },
    /* Execution verbs. The palette could already reach every section of
       this tab and change nothing once it arrived — navigation without
       verbs. These four set the two inputs the whole Routing & TCA surface
       is a function of, and land the reader where the answer redraws.
       Nothing here submits, cancels or routes: the ticket keeps those, and
       the kill switch stays a navigation entry precisely so a fuzzy match
       cannot fire it. */
    {
      id: "action-flip-side",
      label: `Execution: flip the intent to ${side === "BUY" ? "SELL" : "BUY"}`,
      category: "Action",
      action: () => {
        setSide(side === "BUY" ? "SELL" : "BUY");
        navigate("live", false, { apply: () => setExecutionSection("routing"), hash: "live/routing" });
      },
    },
    ...([10_000, 100_000, 1_000_000] as const).map((preset) => ({
      id: `action-probe-${preset}`,
      label: `Execution: probe ${usd(preset, 0)}`,
      category: "Action" as const,
      action: () => {
        setNotional(preset);
        navigate("live", false, { apply: () => setExecutionSection("routing"), hash: "live/routing" });
      },
    })),
    /* One ACTION verb per tab, which is what items 49-51 were about. Every
       tab could already be REACHED from the palette and, on arriving, do
       nothing — navigation without verbs.

       What is absent is a decision, not a gap. Data's real actions — queue a
       backfill, purge a cache, release a quarantine — are operator-gated and
       destructive, and they stay out for the same reason the kill switch is a
       navigation entry: a fuzzy match must not be able to fire them. Research,
       Risk and Execution already have theirs above. */
    {
      id: "action-refresh-health",
      label: "Overview: re-read every provider, venue and gateway",
      category: "Action",
      action: () => { void refreshHealth(false); },
    },
    {
      id: "action-reconnect-sockets",
      // The only way to reach this today is to find the button on the
      // Reliability console, which is the tab you go to when the sockets are
      // the thing that is wrong.
      label: "Reliability: drop and redial the live sockets",
      category: "Action",
      action: () => {
        reconnectSockets();
        navigate("reliability", false, {
          apply: () => setReliabilitySection("overview"),
          hash: "reliability/overview",
        });
      },
    },
    {
      id: "action-focus-portfolio-symbol",
      // `focusPortfolioSymbol` carries a HELD symbol out of the book to where
      // it can be examined — its destination type is research | live | data,
      // never "portfolio". A first draft of this verb read "show it in the
      // book", which is the opposite of what the handler does.
      label: `Portfolio: take ${symbol} to the execution desk`,
      category: "Action",
      action: () => focusPortfolioSymbol(symbol, "live"),
    },
    {
      id: "action-copy-commit",
      // The build a reader is actually looking at. Every bug report that says
      // "on the deployed site" needs it and nothing else puts it on a
      // clipboard.
      label: `Developer: copy the build commit (${APP_COMMIT.slice(0, 7)})`,
      category: "Action",
      action: () => {
        void navigator.clipboard?.writeText(APP_COMMIT);
        navigate("developer", false, {
          apply: () => setDeveloperSection("overview"),
          hash: "developer/overview",
        });
      },
    },
    {
      id: "action-toggle-theme",
      // Names what it does now that Theme has three states. This verb flips
      // the palette and sets it explicitly, so from System it lands on light
      // or dark and stops following the machine — "Toggle theme" would not
      // have said that, and the setting it silently replaced is in the gear.
      label: "Switch to the light or dark palette",
      category: "Action",
      action: toggleDocumentThemeMode,
    },
    {
      id: "action-copy-link",
      label: "Copy link to this view",
      category: "Action",
      action: copyLinkToView,
    },
    {
      id: "action-shortcuts",
      label: "Shortcuts & reviewer tour — the five-minute walkthrough",
      category: "Action",
      hotkey: "?",
      action: () => setShortcutsOpen(true),
    },
  );
  return list;
}
