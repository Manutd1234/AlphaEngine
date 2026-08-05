"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import { INTERVALS } from "@/lib/types";

export type WorkspaceView =
  | "overview"
  | "research"
  | "live"
  | "portfolio"
  | "risk"
  | "data"
  | "reliability"
  | "developer";

/**
 * One tab per desk role, in the order work moves through them: an idea is
 * researched, executed, held in a book, and constrained by risk — then the three
 * roles that keep that possible. `live` and `data` keep their original ids so
 * links and bookmarks already in circulation still resolve.
 */
export const NAV_ITEMS: { id: WorkspaceView; label: string; role: string; accessibleLabel?: string }[] = [
  { id: "overview", label: "Overview", role: "Every desk role" },
  { id: "research", label: "Research", role: "Quant researcher" },
  { id: "live", label: "Execution", role: "Quant trader", accessibleLabel: "Execution" },
  { id: "portfolio", label: "Portfolio", role: "Portfolio manager" },
  { id: "risk", label: "Risk", role: "Risk manager" },
  { id: "data", label: "Data", role: "Data engineer", accessibleLabel: "Data operations" },
  { id: "reliability", label: "Reliability", role: "DevOps / SRE" },
  { id: "developer", label: "Developer", role: "Quant developer" },
];

const COMMON_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "LTCUSDT",
  "TRXUSDT",
  "AAPL",
  "NVDA",
  "MSFT",
];

interface WorkspaceHeaderProps {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  interval: string;
  onIntervalChange: (interval: string) => void;
  providerSummary: { configured: number; total: number; degraded: number } | null;
  contextNote?: string;
}

export default function WorkspaceHeader({
  view,
  onViewChange,
  symbol,
  onSymbolChange,
  interval,
  onIntervalChange,
  providerSummary,
  contextNote,
}: WorkspaceHeaderProps) {
  const [draftSymbol, setDraftSymbol] = useState(symbol);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => setDraftSymbol(symbol), [symbol]);

  const submitSymbol = (event: FormEvent) => {
    event.preventDefault();
    const next = draftSymbol.trim().toUpperCase();
    if (/^[A-Z0-9.\-]{1,20}$/.test(next)) onSymbolChange(next);
    else setDraftSymbol(symbol);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % NAV_ITEMS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = NAV_ITEMS.length - 1;
    onViewChange(NAV_ITEMS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  const healthLabel = providerSummary
    ? providerSummary.degraded
      ? `${providerSummary.degraded} provider${providerSummary.degraded === 1 ? "" : "s"} degraded`
      : `${providerSummary.configured}/${providerSummary.total} providers ready`
    : "Checking data plane";
  const healthNeedsAttention = Boolean(
    providerSummary
      && (providerSummary.degraded > 0 || providerSummary.configured < providerSummary.total),
  );

  return (
    <header className="workspace-header">
      <div className="workspace-header__utility workspace-header__primary">
        <button className="brand-lockup" onClick={() => onViewChange("overview")} aria-label="Open AlphaEngine overview">
          <span className="brand-mark" aria-hidden>
            <span className="brand-mark__alpha">α</span>
            <span className="brand-mark__rails"><i /><i /></span>
          </span>
          <span className="brand-copy">
            <strong>AlphaEngine</strong>
            <small>Quant operating system</small>
          </span>
        </button>

        <nav
          className="workspace-tabs"
          role="tablist"
          aria-label="AlphaEngine workspace"
          aria-orientation="horizontal"
        >
          {NAV_ITEMS.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              aria-label={item.accessibleLabel}
              aria-selected={view === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={view === item.id ? 0 : -1}
              onClick={() => onViewChange(item.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              title={item.role}
            >
              <span>{item.label}</span>
              {/* The role each tab belongs to. Eight tabs only read as a map of
                  the desk if the audience is on the tab itself. */}
              <small className="workspace-tabs__role">{item.role}</small>
            </button>
          ))}
        </nav>

        <div className="header-spacer" />

        <button
          type="button"
          className={`system-health system-health-action ${healthNeedsAttention ? "is-warn" : ""}`}
          aria-label={`Open reliability. ${healthLabel}`}
          onClick={() => onViewChange("reliability")}
        >
          <i aria-hidden />
          {healthLabel}
        </button>
        <ThemeToggle />
      </div>

      <div className="context-strip">
        <div className="context-strip__inner">
          <span className="context-strip__label">Desk context</span>
          <span className="context-divider" aria-hidden />
          <form className="context-control context-symbol" onSubmit={submitSymbol}>
            <label className="sr-only" htmlFor="workspace-symbol">Instrument</label>
            <input
              id="workspace-symbol"
              value={draftSymbol}
              list="workspace-symbols"
              onChange={(event) => setDraftSymbol(event.target.value.toUpperCase())}
              onBlur={() => {
                if (draftSymbol !== symbol) {
                  const next = draftSymbol.trim().toUpperCase();
                  if (/^[A-Z0-9.\-]{1,20}$/.test(next)) onSymbolChange(next);
                  else setDraftSymbol(symbol);
                }
              }}
              aria-label="Active workspace instrument"
              spellCheck={false}
            />
            <datalist id="workspace-symbols">
              {COMMON_SYMBOLS.map((item) => <option value={item} key={item} />)}
            </datalist>
          </form>

          <div className="context-control">
            <label className="sr-only" htmlFor="workspace-interval">Horizon</label>
            <select
              id="workspace-interval"
              value={interval}
              onChange={(event) => onIntervalChange(event.target.value)}
              aria-label="Active workspace horizon"
            >
              {INTERVALS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <button
            type="button"
            className="context-summary context-status"
            onClick={() => onViewChange("research")}
            aria-label={`Open research. ${contextNote ?? "No validated candidate yet"}`}
          >
            <span className="context-status__label">Research</span>
            <strong>{contextNote ?? "No validated candidate yet"}</strong>
          </button>
        </div>
      </div>
    </header>
  );
}
