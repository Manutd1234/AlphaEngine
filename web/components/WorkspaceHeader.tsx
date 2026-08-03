"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import { INTERVALS } from "@/lib/types";

export type WorkspaceView = "overview" | "portfolio" | "research" | "live" | "data";

const NAV_ITEMS: { id: WorkspaceView; label: string; accessibleLabel?: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "portfolio", label: "Portfolio" },
  { id: "research", label: "Research" },
  { id: "live", label: "Execution" },
  { id: "data", label: "Systems", accessibleLabel: "Data and systems" },
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
  const healthNeedsAttention = Boolean(
    providerSummary
      && (providerSummary.degraded > 0 || providerSummary.configured < providerSummary.total),
  );

  return (
    <header className="workspace-header">
      <div className="workspace-header__utility workspace-header__primary">
        <button className="brand-lockup" onClick={() => onViewChange("overview")} aria-label="Open AlphaEngine overview">
          <span className="brand-mark" aria-hidden>AE</span>
          <strong>AlphaEngine</strong>
        </button>

        <nav className="workspace-tabs" role="tablist" aria-label="AlphaEngine workspace">
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
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="header-spacer" />

        <button
          type="button"
          className={`system-health system-health-action ${healthNeedsAttention ? "is-warn" : ""}`}
          aria-label={`Open data and systems. ${healthLabel}`}
          onClick={() => onViewChange("data")}
        >
          <i aria-hidden />
          {healthLabel}
        </button>
        <ThemeToggle />
      </div>

      <div className="context-strip">
        <div className="context-strip__inner">
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
