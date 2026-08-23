/**
 * The eight-stop reviewer tour — one stop per workspace, in decision-loop
 * order, each landing on a full `#view/section` deep link with the one moment
 * worth showing named. Rendered by the "?" overlay.
 *
 * Built here for the same reason `buildCommands` is: it is a list, not a
 * render, and `tests/tour-truth.test.ts` checks every stop's label against the
 * rail in `lib/sections.ts` — a claim about the app that has to be measurable
 * without mounting it.
 */

import type { TourStop } from "@/components/header/ShortcutsOverlay";
import type { WorkspaceView } from "@/components/WorkspaceHeader";
import type {
  CoherenceSection, DataSection, DeveloperSection, ExecutionSection, OverviewSection,
  PortfolioSection, ReliabilitySection, ResearchSection, RiskSection,
} from "@/lib/sections";

/** What a stop needs from the shell: the tab switch, and the nine rail setters. */
export interface TourDeps {
  navigate: (
    next: WorkspaceView,
    replace?: boolean,
    detail?: { apply: () => void; hash: string },
  ) => void;
  setOverviewSection: (section: OverviewSection) => void;
  setResearchSection: (section: ResearchSection) => void;
  setExecutionSection: (section: ExecutionSection) => void;
  setPortfolioSection: (section: PortfolioSection) => void;
  setRiskSection: (section: RiskSection) => void;
  setDataSection: (section: DataSection) => void;
  setReliabilitySection: (section: ReliabilitySection) => void;
  setDeveloperSection: (section: DeveloperSection) => void;
  setCoherenceSection: (section: CoherenceSection) => void;
}

export function buildTourStops(deps: TourDeps): TourStop[] {
  const stop = (
    where: string,
    moment: string,
    viewId: WorkspaceView,
    sectionId: string,
    apply: () => void,
  ): TourStop => ({
    where,
    moment,
    visit: () => deps.navigate(viewId, false, { apply, hash: `${viewId}/${sectionId}` }),
  });
  return [
    stop("Overview → Decision loop", "Every pipeline stage links into its tab; research reaches execution only through the risk gate.", "overview", "loop", () => deps.setOverviewSection("loop")),
    stop("Research → Summary", "The reproducibility capsule and the PASS/MARGINAL/FAIL verdict; drag a slider and the six-veto promotion gate re-clears.", "research", "summary", () => deps.setResearchSection("summary")),
    stop("Execution → Trade", "Fire the Fat finger $500k preset; the gate vector names the check that refused it, decided in ~0.2 ms.", "live", "trade", () => deps.setExecutionSection("trade")),
    stop("Portfolio → Overview", "The same book Risk reads; the covariance card says “Measured, N aligned bars”, never an assumption.", "portfolio", "overview", () => deps.setPortfolioSection("overview")),
    stop("Risk → Monte Carlo", "10,000 bootstrap paths against the live drawdown budget; the P95 loss verdict, in dollars.", "risk", "montecarlo", () => deps.setRiskSection("montecarlo")),
    stop("Data → Incidents", "Simulate a provider outage; the incident row, failover graph and consensus react, then self-restore.", "data", "incidents", () => deps.setDataSection("incidents")),
    stop("Reliability → Attention & SLIs", "Fleet-truth p99 and provider circuits; the latency chip in every header resolves here.", "reliability", "overview", () => deps.setReliabilitySection("overview")),
    stop("Developer → API & Schema", "OpenAPI drift against the committed digest, and the Monte Carlo parity check you can run in this browser.", "developer", "apis", () => deps.setDeveloperSection("apis")),
    stop("Coherence → Universe", "Kalshi families priced against the dollar they pay: what buying every outcome costs, read live from the exchange.", "coherence", "universe", () => deps.setCoherenceSection("universe")),
  ];
}
