"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import { INTERVALS } from "@/lib/types";

export type WorkspaceView = "overview" | "portfolio" | "research" | "live" | "data";

const NAV_ITEMS: { id: WorkspaceView; label: string; description: string }[] = [
  { id: "overview", label: "Overview", description: "Decision cockpit" },
  { id: "portfolio", label: "Portfolio", description: "Exposure & risk" },
  { id: "research", label: "Research", description: "Test & validate" },
  { id: "live", label: "Execution", description: "Liquidity & routing" },
  { id: "data", label: "Data & systems", description: "Feeds & APIs" },
];

const COMMON_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
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

  return (
    <header className="workspace-header">
      <div className="workspace-header__utility">
        <button className="brand-lockup" onClick={() => onViewChange("overview")} aria-label="Open AlphaEngine overview">
          <span className="brand-mark" aria-hidden>AE</span>
          <span>
            <strong>AlphaEngine</strong>
            <small>Integrated investment infrastructure</small>
          </span>
        </button>

        <div className="workspace-name" aria-label="Current workspace">
          <span className="eyebrow">Workspace</span>
          <strong>Unified Investment Desk</strong>
        </div>

        <div className="header-spacer" />

        <span className={`system-health ${providerSummary?.degraded ? "is-warn" : ""}`}>
          <i aria-hidden />
          {healthLabel}
        </span>
        <ThemeToggle />
      </div>

      <div className="workspace-header__navrow">
        <nav className="workspace-tabs" role="tablist" aria-label="AlphaEngine workspace">
          {NAV_ITEMS.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={view === item.id ? 0 : -1}
              onClick={() => onViewChange(item.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              <span>{item.label}</span>
              <small>{item.description}</small>
            </button>
          ))}
        </nav>
      </div>

      <div className="context-strip">
        <div className="context-strip__inner">
          <span className="context-strip__label">Desk context</span>

          <form className="context-control context-symbol" onSubmit={submitSymbol}>
            <label htmlFor="workspace-symbol">Instrument</label>
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
            <label htmlFor="workspace-interval">Horizon</label>
            <select
              id="workspace-interval"
              value={interval}
              onChange={(event) => onIntervalChange(event.target.value)}
            >
              {INTERVALS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>

          <div className="context-divider" aria-hidden />

          <div className="context-summary">
            <span className="eyebrow">Shared across every module</span>
            <strong>{contextNote ?? "No validated candidate yet"}</strong>
          </div>
        </div>
      </div>
    </header>
  );
}
