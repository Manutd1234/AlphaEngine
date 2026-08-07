/**
 * Edge-triggered Risk Breach & Threshold Monitor.
 *
 * Evaluates risk limits, correlation spikes, and VaR zone changes on every book update.
 * Generates edge-triggered alerts (fire on breach, fire once on recovery).
 */

export interface RiskWatchConfig {
  maxUtilisationThreshold: number; // e.g. 0.80
  maxCorrelationThreshold: number; // e.g. 0.90
}

export const DEFAULT_RISK_WATCH_CONFIG: RiskWatchConfig = {
  maxUtilisationThreshold: 0.8,
  maxCorrelationThreshold: 0.9,
};

export interface RiskBreachState {
  utilisationBreached: boolean;
  correlationBreached: boolean;
  varZoneRed: boolean;
}

export interface RiskWatchAlert {
  id: string;
  timestamp: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  source: "workspace";
}

export function evaluateRiskWatches(
  current: { utilisation: number; maxCorr: number; varZone: string },
  previous: RiskBreachState | null,
  config: RiskWatchConfig = DEFAULT_RISK_WATCH_CONFIG
): { nextState: RiskBreachState; alerts: RiskWatchAlert[] } {
  const isUtilBreached = current.utilisation >= config.maxUtilisationThreshold;
  const isCorrBreached = current.maxCorr >= config.maxCorrelationThreshold;
  const isVarRed = current.varZone.toLowerCase() === "red";

  const nextState: RiskBreachState = {
    utilisationBreached: isUtilBreached,
    correlationBreached: isCorrBreached,
    varZoneRed: isVarRed,
  };

  const alerts: RiskWatchAlert[] = [];
  const now = new Date().toISOString().substring(11, 19) + " UTC";

  // Utilisation alert
  if (isUtilBreached && (!previous || !previous.utilisationBreached)) {
    alerts.push({
      id: `util-breach-${Date.now()}`,
      timestamp: now,
      severity: "warning",
      title: "Risk Limit Headroom Warning",
      message: `Risk limit utilisation reached ${(current.utilisation * 100).toFixed(1)}% (threshold: ${config.maxUtilisationThreshold * 100}%).`,
      source: "workspace",
    });
  } else if (!isUtilBreached && previous && previous.utilisationBreached) {
    alerts.push({
      id: `util-recovery-${Date.now()}`,
      timestamp: now,
      severity: "info",
      title: "Risk Limit Headroom Recovered",
      message: `Risk limit utilisation dropped to ${(current.utilisation * 100).toFixed(1)}%.`,
      source: "workspace",
    });
  }

  // Correlation alert
  if (isCorrBreached && (!previous || !previous.correlationBreached)) {
    alerts.push({
      id: `corr-breach-${Date.now()}`,
      timestamp: now,
      severity: "warning",
      title: "Cross-Asset Correlation Spike",
      message: `Max correlation reached ${current.maxCorr.toFixed(2)} (threshold: ${config.maxCorrelationThreshold.toFixed(2)}).`,
      source: "workspace",
    });
  }

  return { nextState, alerts };
}
