"use client";

import { useState, useEffect, useRef } from "react";
import type { WorkspaceView } from "@/components/WorkspaceHeader";

interface CommandBarProps {
  open: boolean;
  onClose: () => void;
  onSelectTab: (tabId: WorkspaceView) => void;
  onSymbolSelect: (symbol: string) => void;
  onToggleKillSwitch: () => void;
}

export default function CommandBar({
  open,
  onClose,
  onSelectTab,
  onSymbolSelect,
  onToggleKillSwitch,
}: CommandBarProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const commands = [
    { id: "tab-overview", label: "Overview (All Roles)", category: "Workspace", action: () => onSelectTab("overview"), hotkey: "Alt+1" },
    { id: "tab-research", label: "Research (Quant Researcher)", category: "Workspace", action: () => onSelectTab("research"), hotkey: "Alt+2" },
    { id: "tab-execution", label: "Execution (Quant Trader)", category: "Workspace", action: () => onSelectTab("live"), hotkey: "Alt+3" },
    { id: "tab-portfolio", label: "Portfolio (Portfolio Manager)", category: "Workspace", action: () => onSelectTab("portfolio"), hotkey: "Alt+4" },
    { id: "tab-risk", label: "Risk (Risk Manager)", category: "Workspace", action: () => onSelectTab("risk"), hotkey: "Alt+5" },
    { id: "tab-data", label: "Data (Data Engineer)", category: "Workspace", action: () => onSelectTab("data"), hotkey: "Alt+6" },
    { id: "tab-reliability", label: "Reliability (DevOps / SRE)", category: "Workspace", action: () => onSelectTab("reliability"), hotkey: "Alt+7" },
    { id: "tab-developer", label: "Developer (Quant Developer)", category: "Workspace", action: () => onSelectTab("developer"), hotkey: "Alt+8" },
    
    { id: "sym-btc", label: "BTCUSDT — Bitcoin / USDT Spot", category: "Market Symbol", action: () => onSymbolSelect("BTCUSDT"), hotkey: "" },
    { id: "sym-eth", label: "ETHUSDT — Ethereum / USDT Spot", category: "Market Symbol", action: () => onSymbolSelect("ETHUSDT"), hotkey: "" },
    { id: "sym-sol", label: "SOLUSDT — Solana / USDT Spot", category: "Market Symbol", action: () => onSymbolSelect("SOLUSDT"), hotkey: "" },

    { id: "act-kill", label: "🚨 EMERGENCY KILL SWITCH / FLATTEN", category: "Risk Controls", action: () => onToggleKillSwitch(), hotkey: "Ctrl+Shift+K" },
  ];

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      className="command-bar-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(9, 13, 18, 0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "120px",
      }}
      onClick={onClose}
    >
      <div
        className="command-bar-modal"
        style={{
          width: "600px",
          maxWidth: "92vw",
          background: "#111827",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "12px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.75)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
          <span style={{ fontSize: "16px", marginRight: "10px" }}>⚡</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, ticker (BTCUSDT), or workspace (Alt+1-8)..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#f8fafc",
              fontSize: "14px",
              fontFamily: "var(--font-mono, monospace)",
            }}
          />
          <kbd style={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "4px", padding: "2px 6px", fontSize: "10px", color: "#9ca3af" }}>
            ESC
          </kbd>
        </div>

        <div style={{ maxHeight: "360px", overflowY: "auto", padding: "8px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: "#9ca3af", fontSize: "12px" }}>
              No matching commands or tickers found.
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  item.action();
                  onClose();
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderRadius: "6px",
                  background: "transparent",
                  border: "none",
                  color: "#f8fafc",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: "13px",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div>
                  <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", color: "#38bdf8", marginRight: "8px", fontWeight: 600 }}>
                    [{item.category}]
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.hotkey && (
                  <kbd style={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "4px", padding: "2px 6px", fontSize: "10px", color: "#9ca3af" }}>
                    {item.hotkey}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
        <div style={{ padding: "8px 16px", background: "#090d12", borderTop: "1px solid rgba(255, 255, 255, 0.05)", fontSize: "10.5px", color: "#64748b", display: "flex", justifyContent: "space-between" }}>
          <span>Navigation: <code style={{ color: "#38bdf8" }}>Alt+1-8</code> · Kill Switch: <code style={{ color: "#ef4444" }}>Ctrl+Shift+K</code></span>
          <span>AlphaEngine Command Launcher</span>
        </div>
      </div>
    </div>
  );
}
