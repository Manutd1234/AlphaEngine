"use client";

import { useState } from "react";

interface DAGNode {
  id: string;
  name: string;
  category: "data" | "alpha" | "optimizer" | "risk" | "fix";
  status: "active" | "passing" | "verified";
  latency: string;
  details: string;
}

export default function SignalDAGViewer() {
  const [selectedNode, setSelectedNode] = useState<DAGNode | null>(null);

  const nodes: DAGNode[] = [
    { id: "node-1", name: "Binance & Bybit L2 Depth Stream", category: "data", status: "active", latency: "0.2ms", details: "Consolidated L2 websocket depth stack streaming 100ms snapshots across 12 symbol pairs." },
    { id: "node-2", name: "Trend & Mean Reversion Alpha Signals", category: "alpha", status: "passing", latency: "0.5ms", details: "DSR-validated momentum signals generating real-time buy/sell allocation weights." },
    { id: "node-3", name: "Euler Variance Portfolio Optimizer", category: "optimizer", status: "verified", latency: "0.8ms", details: "Risk-budget constrained Mean-Variance optimizer targeting max Sharpe ratio under leverage cap." },
    { id: "node-4", name: "Pre-Trade Risk Gateway (15 Gates)", category: "risk", status: "verified", latency: "0.2ms", details: "15 hard limit checks (drawdown, max gross, price collar, fat finger, rate limit) evaluated in 0.2ms." },
    { id: "node-5", name: "FIX Protocol Execution Engine", category: "fix", status: "active", latency: "1.1ms", details: "FIX 4.2 / 4.4 order execution engine dispatching 35=D orders and auditing 35=8 execution reports." },
  ];

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Data Lineage &amp; Pipeline</span>
          <h2>Signal DAG Execution Graph</h2>
        </div>
        <span className="pill is-good">🟢 5/5 Pipeline Nodes Active</span>
      </div>

      <p className="sub">
        Visual representation of quantitative signal lineage from raw L2 depth stream to pre-trade risk validation and FIX order routing.
      </p>

      {/* DAG Node Flow Pipeline */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          margin: "16px 0",
          overflowX: "auto",
          padding: "12px",
          background: "#090d12",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        {nodes.map((node, index) => (
          <div key={node.id} style={{ display: "flex", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setSelectedNode(node)}
              style={{
                background: selectedNode?.id === node.id ? "rgba(56, 189, 248, 0.2)" : "#111827",
                border: selectedNode?.id === node.id ? "1px solid #38bdf8" : "1px solid #1e293b",
                borderRadius: "6px",
                padding: "10px 12px",
                color: "#f8fafc",
                cursor: "pointer",
                textAlign: "left",
                minWidth: "160px",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ fontSize: "9px", textTransform: "uppercase", tracking: "0.08em", color: "#38bdf8", fontWeight: 700, marginBottom: "2px" }}>
                Step {index + 1} · {node.category}
              </div>
              <div style={{ fontSize: "11.5px", fontWeight: 700, marginBottom: "4px" }}>{node.name}</div>
              <div style={{ fontSize: "10px", color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
                <span>Latency: {node.latency}</span>
                <span style={{ color: "#00e676" }}>✓ {node.status}</span>
              </div>
            </button>
            {index < nodes.length - 1 && (
              <span style={{ margin: "0 8px", color: "#475569", fontWeight: 700, fontSize: "14px" }}>➔</span>
            )}
          </div>
        ))}
      </div>

      {selectedNode && (
        <div style={{ background: "#1e293b", padding: "12px", borderRadius: "6px", borderLeft: "4px solid #38bdf8", fontSize: "11.5px", color: "#f8fafc" }}>
          <strong>Node Inspection: {selectedNode.name}</strong>
          <p style={{ margin: "4px 0 0 0", color: "#cbd5e1" }}>{selectedNode.details}</p>
        </div>
      )}
    </div>
  );
}
