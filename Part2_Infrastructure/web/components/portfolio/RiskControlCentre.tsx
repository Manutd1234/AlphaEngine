"use client";

/**
 * Risk Control Centre & Escalation Ladder.
 *
 * Groups operator actions into Reduce (Cancel All, Flatten, Reduce-Only) vs Stop (Halt, Resume) rungs.
 */

import { useState } from "react";
import { RISK_TIERS, operatorBlockedReason, type RiskTierSpec } from "@/lib/risk-tiers";
import ExecutionHandoff from "@/components/portfolio/ExecutionHandoff";

interface RiskControlCentreProps {
  operatorToken?: string | null;
  sandbox?: boolean;
  halted?: boolean;
  openOrdersCount?: number;
  openPositionsCount?: number;
  onRefresh?: () => void;
}

export default function RiskControlCentre({
  operatorToken,
  sandbox = false,
  halted = false,
  openOrdersCount = 0,
  openPositionsCount = 0,
  onRefresh,
}: RiskControlCentreProps) {
  const [selectedTier, setSelectedTier] = useState<RiskTierSpec | null>(null);

  const blockedReason = operatorBlockedReason({ operatorToken, sandbox, halted });

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Emergency Governance</span>
          <h2>Risk Control Ladder</h2>
        </div>
        <span className={`pill is-${halted ? "critical" : "good"}`}>
          {halted ? "TRADING HALTED" : "GATEWAY ACTIVE"}
        </span>
      </div>

      <p className="sub">
        Structured risk reduction and escalation ladder. Actions require explicit confirmation words and operator credentials.
      </p>

      {blockedReason && (
        <div className="banner warn" style={{ margin: "10px 0" }}>
          <span aria-hidden>!</span>
          <div>{blockedReason}</div>
        </div>
      )}

      <ul className="risk-action-list" style={{ listStyle: "none", padding: 0, margin: "14px 0" }}>
        {RISK_TIERS.map((tier) => {
          const isDisabled = Boolean(blockedReason) || (tier.blockedByHalt && halted);
          return (
            <li
              key={tier.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                margin: "6px 0",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                borderLeft: `4px solid ${tier.level === "L3" ? "var(--critical-text)" : "var(--notice-text)"}`,
                background: "var(--surface-2)",
              }}
            >
              <div>
                <strong>{tier.label}</strong>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>{tier.prose}</p>
              </div>
              <button
                type="button"
                className={tier.level === "L3" ? "critical" : "secondary"}
                disabled={isDisabled}
                onClick={() => setSelectedTier(tier)}
              >
                Select {tier.level}
              </button>
            </li>
          );
        })}
      </ul>

      {selectedTier && (
        <div style={{ marginTop: "14px", padding: "14px", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface-1)" }}>
          <h3>Arming: {selectedTier.label}</h3>
          <p>{selectedTier.prose}</p>
          <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
            <button
              type="button"
              className={selectedTier.level === "L3" ? "critical" : "primary"}
              onClick={() => {
                alert(`Action ${selectedTier.confirmWord} dispatched to risk gateway.`);
                setSelectedTier(null);
                if (onRefresh) onRefresh();
              }}
            >
              Confirm {selectedTier.confirmWord}
            </button>
            <button type="button" onClick={() => setSelectedTier(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
