/**
 * The compact technical contract above every addressable Markets and Proofs
 * view. It does not interpret a dataset: each pane still owns populated and
 * empty truth. This strip names the lead readout, unit, method and source, and
 * reports transport separately so a successful poll cannot imply observations.
 */

import type { ReactNode } from "react";
import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { CoherenceStatus } from "@/lib/coherence/types";
import { marketsViewContract } from "@/lib/markets/view-contracts";

import { StateChip } from "./figure-chips";

export type EvidenceTab = "markets" | "coherence";

export interface ViewEvidence {
  readout: string;
  unit: string;
  method: string;
  source: string;
}

type EvidenceInventory = Record<EvidenceTab, Record<string, ViewEvidence>>;

export const ENGINE_VIEW_EVIDENCE = {
  markets: {
    "universe/baskets": { readout: "Executable family total", unit: "cents per $1 payoff", method: "Σ best YES asks", source: "Kalshi family books" },
    "universe/positions": { readout: "Open-interest concentration", unit: "contracts and family share", method: "group by executable YES-ask band", source: "Kalshi universe read" },
    "universe/families": { readout: "Outcome price vector", unit: "cents per contract", method: "best executable quote", source: "Kalshi universe read" },
    "settlement/reading": { readout: "Published settlement input", unit: "index points", method: "window mean per rule", source: "Kalshi settlement rules" },
    "settlement/formation": { readout: "Fixing formation path", unit: "UTC stage time", method: "rule-defined stages", source: "published index method" },
    "settlement/pending": { readout: "Unfixed window exposure", unit: "seconds and points", method: "clock-to-fixing", source: "settlement schedule" },
    "books/ladder": { readout: "Executable bid ladder", unit: "cents × contracts", method: "ask = 100 − opposite bid", source: "Kalshi orderbook" },
    "books/identity": { readout: "Two-sided book identity", unit: "cents per contract", method: "bid + ask = 100", source: "opposing bid ladders" },
    "books/history": { readout: "Recorded best quote", unit: "cents over UTC", method: "time-ordered snapshots", source: "local book recorder" },
    "dispersion/quotes": { readout: "Maker quote dispersion", unit: "cents and count", method: "usable quote spread", source: "signed RFQ channel" },
    "dispersion/channel": { readout: "Private-channel state", unit: "requests and replies", method: "request-state machine", source: "Kalshi RFQ gateway" },
    "lattice/survival": { readout: "Implied survival curve", unit: "probability by strike", method: "S(k) from executable asks", source: "family strike ladder" },
    "lattice/mass": { readout: "Adjacent-strike mass", unit: "probability mass", method: "S(kᵢ) − S(kᵢ₊₁)", source: "implied survival curve" },
    "lattice/moments": { readout: "Implied distribution moments", unit: "strike units", method: "moments of discrete PMF", source: "adjacent-strike mass" },
    "lattice/support": { readout: "Moment support", unit: "bounded and open-tail mass", method: "partition quoted PMF support", source: "adjacent-strike mass" },
    "stake/plan": { readout: "Constrained stake plan", unit: "contracts and dollars", method: "gateway stake solve", source: "quoted family + bankroll" },
    "stake/capital": { readout: "Capital deployment", unit: "dollars and percent", method: "stake / bankroll", source: "stake solver output" },
    "stake/method": { readout: "Binding solve constraints", unit: "unitless limits", method: "feasible-set audit", source: "stake solver output" },
    "stake/family": { readout: "All-outcome allocation", unit: "dollars by outcome", method: "joint constrained solve", source: "family quote vector" },
    "fees/example": { readout: "Interactive execution cost", unit: "dollars and cents", method: "venue fee kernel", source: "Kalshi fee schedule" },
    "fees/shape": { readout: "Fee curve", unit: "cents per contract", method: "fee(p, contracts)", source: "fixed-point fee kernel" },
    "fees/comparison": { readout: "Net-vs-gross edge", unit: "dollars per replay", method: "four-model ablation", source: "recorded tape replay" },
    "fees/table": { readout: "Replay audit rows", unit: "contracts and dollars", method: "row-level fee recompute", source: "recorded tape replay" },
    "shell/layout": { readout: "Live namespace map", unit: "paths and root entries", method: "root read + command graph", source: "coherence shell gateway" },
    "shell/route": { readout: "Collateral route decision", unit: "shards and order groups", method: "UML activity path", source: "coherence shell root" },
    "shell/tree": { readout: "Addressable engine record", unit: "paths and rows", method: "read-only tree walk", source: "coherence shell gateway" },
  },
  coherence: {
    "certificate/verdict": { readout: "Feasibility margin", unit: "dollars per $1 payoff", method: "LP feasibility certificate", source: "certify + universe reads" },
    "certificate/proof": { readout: "Constraint derivation path", unit: "dollars by inequality", method: "derived constraint chain", source: "certify + universe reads" },
    "certificate/checks": { readout: "Constraint slack witness", unit: "dollars by inequality", method: "ranked fixed-point checks", source: "universe + certify reads" },
    "certificate/prices": { readout: "Tested price vector", unit: "cents per contract", method: "executable quote identity", source: "Kalshi universe read" },
    "certificate/sizes": { readout: "Outcome market size", unit: "contracts and dollars", method: "per-measure normalisation", source: "Kalshi universe read" },
    "portfolio/cover": { readout: "Cover cost simulation", unit: "dollars per $1 payoff", method: "sum of paper YES asks", source: "family books + local scenario" },
    "portfolio/basket": { readout: "Live and paper basket", unit: "cumulative dollars", method: "quote vector + dual result", source: "universe + certify reads" },
    "portfolio/size": { readout: "Certificate leg footprint", unit: "contracts and venue activity", method: "leg requirement / reported activity", source: "certificate + universe" },
    "combos/bands": { readout: "Joint-probability band", unit: "probability", method: "Fréchet–Hoeffding bounds", source: "parlay leg books" },
    "combos/parlays": { readout: "Parlay quote position", unit: "probability", method: "local quote simulation", source: "Kalshi parlay books" },
    "combos/inputs": { readout: "Leg-implied probabilities", unit: "probability by leg", method: "opposite-bid conversion", source: "Kalshi parlay books" },
    "combos/legs": { readout: "Selected parlay legs", unit: "probability and cents", method: "leg-level quote audit", source: "Kalshi parlay books" },
    "combos/bounds": { readout: "Quoted-band displacement", unit: "probability points", method: "quote vs feasible interval", source: "combo gateway read" },
    "index/series": { readout: "Coherence distance", unit: "L1 probability distance", method: "min ‖p − q‖₁", source: "recorded quote polls" },
    "index/families": { readout: "Distance by family", unit: "L1 probability distance", method: "nearest coherent vector", source: "coherence index read" },
    "calibration/score": { readout: "Settled forecast score", unit: "Brier score and skill", method: "mean squared probability error", source: "settled calibration corpus" },
    "calibration/decomposition": { readout: "Brier equation", unit: "score components", method: "Murphy identity", source: "settled calibration corpus" },
    "calibration/components": { readout: "Component magnitude", unit: "relative score scale", method: "term-scale comparison", source: "settled calibration corpus" },
    "calibration/measures": { readout: "Exact scorecard measures", unit: "score, count and horizon", method: "settled-corpus summary", source: "settled calibration corpus" },
    "calibration/reliability": { readout: "Reliability surface", unit: "forecast and observed probability", method: "binned residual plot", source: "settled calibration corpus" },
    "calibration/bands": { readout: "Reliability by price band", unit: "probability and frequency", method: "binned calibration", source: "settled calibration corpus" },
    "corpus/composition": { readout: "Scored sample mixture", unit: "episodes and share", method: "settled-corpus grouping", source: "calibration ledger" },
    "corpus/trend": { readout: "Score accrual", unit: "Brier skill over UTC", method: "recorded-run history", source: "calibration history" },
    "lessons/prices": { readout: "Quote invariants", unit: "cents and exact decimals", method: "claim-to-test mapping", source: "kernel + pinned tests" },
    "lessons/structure": { readout: "Structural invariants", unit: "states and constraints", method: "claim-to-test mapping", source: "kernel + pinned tests" },
    "lessons/bounds": { readout: "Bound invariants", unit: "probability intervals", method: "claim-to-test mapping", source: "kernel + pinned tests" },
    "lessons/record": { readout: "Historical invariants", unit: "polls and episodes", method: "claim-to-test mapping", source: "recorders + pinned tests" },
    "lessons/coverage": { readout: "Curriculum coverage", unit: "claims by section", method: "guard graph", source: "lesson registry" },
    "lessons/states": { readout: "Episode state machine", unit: "discrete states", method: "transition contract", source: "lesson registry" },
  },
} as const satisfies EvidenceInventory;

export function evidenceFor(tab: EvidenceTab, section: string, view: string): ViewEvidence | null {
  return ENGINE_VIEW_EVIDENCE[tab][`${section}/${view}` as keyof (typeof ENGINE_VIEW_EVIDENCE)[typeof tab]] ?? null;
}

export type TransportState = "loading" | "unavailable" | "stale" | "degraded" | "current";

export interface TransportReading {
  state: TransportState;
  mark: "◌" | "✕" | "▲" | "●";
  label: string;
}

export function transportReading(
  status: Pick<CoherenceStatus, "state"> | null,
  error: string | null,
): TransportReading {
  if (error && status) return { state: "stale", mark: "▲", label: "Last good response retained" };
  if (error) return { state: "unavailable", mark: "✕", label: "Transport unavailable" };
  if (!status) return { state: "loading", mark: "◌", label: "Loading transport" };
  if (status.state !== "ok") return { state: "degraded", mark: "▲", label: `Transport ${status.state}` };
  return { state: "current", mark: "●", label: "Transport current" };
}

const TONE: Record<TransportState, "good" | "warn" | "critical" | "muted"> = {
  loading: "muted",
  unavailable: "critical",
  stale: "warn",
  degraded: "warn",
  current: "good",
};

const DETAILS_LABEL = {
  true: ["hide", "figure", "explanations"].join(" "),
  false: ["show", "figure", "explanations"].join(" "),
} as const;

export default function EngineViewEvidence({
  tab,
  section,
  view,
  status,
  error,
  updatedAt,
  showTransport = true,
  contextAction,
  deskContext,
  detailsVisible,
  onDetailsVisibleChange,
}: {
  tab: EvidenceTab;
  section: string;
  view: string;
  status: CoherenceStatus | null;
  error: string | null;
  updatedAt: Date | null;
  /** Static views keep their evidence without pretending transport is loading. */
  showTransport?: boolean;
  /** Optional view-level disclosure, kept inside the evidence band. */
  contextAction?: ReactNode;
  /** Exact desk premise, disclosed once instead of repeated on every route. */
  deskContext?: string;
  /** Diagram-first at rest; the complete authored explanation remains one press away. */
  detailsVisible?: boolean;
  onDetailsVisibleChange?: (next: boolean) => void;
}) {
  const evidence = evidenceFor(tab, section, view);
  if (!evidence) return null;
  const marketContract = tab === "markets" ? marketsViewContract(section, view) : null;

  const transport = transportReading(status, error);
  const timestamp = updatedAt ? `${updatedAt.toISOString().slice(11, 19)}Z` : null;

  return (
    <aside
      className="coh-evidence"
      data-tab={tab}
      data-section={section}
      data-view={view}
      aria-label={`${tab === "markets" ? "Markets" : "Proofs"} ${section} ${view} evidence`}
    >
      <dl className="coh-evidence__grid">
        <div className="coh-evidence__lead">
          <dt>Lead readout</dt>
          <dd>{evidence.readout}</dd>
        </div>
        <div>
          <dt>Unit</dt>
          <dd>{evidence.unit}</dd>
        </div>
        {showTransport && (
          <div className="coh-evidence__transport" data-state={transport.state}>
            <dt>Transport</dt>
            <dd>
              <StateChip
                mark={transport.mark}
                word={transport.label}
                value={timestamp}
                tone={TONE[transport.state]}
              />
            </dd>
          </div>
        )}
      </dl>
      <div className="coh-evidence__tools">
        {contextAction ? (
          <div className="coh-evidence__context-action">
            {contextAction}
          </div>
        ) : null}
        <div className="coh-evidence__actions">
          {onDetailsVisibleChange ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="coh-evidence__details-toggle"
              aria-pressed={detailsVisible}
              aria-label={DETAILS_LABEL[String(Boolean(detailsVisible)) as keyof typeof DETAILS_LABEL]}
              onClick={() => onDetailsVisibleChange(!detailsVisible)}
            >
              <FileText aria-hidden="true" />
              <span>{detailsVisible ? "Hide notes" : "Show notes"}</span>
            </Button>
          ) : null}
          <Sheet>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="coh-evidence__open">
                Evidence
              </Button>
            </SheetTrigger>
            <SheetContent className="coh-evidence-sheet w-[min(38rem,calc(100vw-1rem))] overflow-y-auto min-[521px]:max-w-none">
              <SheetHeader>
                <SheetTitle>{evidence.readout}</SheetTitle>
                <SheetDescription>
                  Technical provenance for the active {tab === "markets" ? "Markets" : "Proofs"} view.
                </SheetDescription>
              </SheetHeader>
              <div className="coh-evidence-sheet__body">
                {deskContext ? <p className="coh-evidence__desk-context">{deskContext}</p> : null}
                <Table className="coh-evidence__detail-table" scrollLabel="Active view evidence fields">
                  <TableHeader>
                    <TableRow><TableHead>Field</TableHead><TableHead>Reading</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {marketContract ? (
                      <>
                        <TableRow><TableCell>Decision question</TableCell><TableCell>{marketContract.question}</TableCell></TableRow>
                        <TableRow><TableCell>Lead surface</TableCell><TableCell>{marketContract.leadSurface}</TableCell></TableRow>
                        <TableRow><TableCell>Exact values</TableCell><TableCell>{marketContract.exactAlternative}</TableCell></TableRow>
                        <TableRow><TableCell>Interpretation</TableCell><TableCell>{marketContract.guardrail}</TableCell></TableRow>
                        <TableRow><TableCell>Deep link</TableCell><TableCell><code>#{marketContract.deepLink}</code></TableCell></TableRow>
                        <TableRow><TableCell>Route position</TableCell><TableCell>{marketContract.ordinal} of {marketContract.total}</TableCell></TableRow>
                      </>
                    ) : null}
                    <TableRow><TableCell>Method</TableCell><TableCell>{evidence.method}</TableCell></TableRow>
                    <TableRow><TableCell>Source</TableCell><TableCell>{evidence.source}</TableCell></TableRow>
                    <TableRow><TableCell>Unit</TableCell><TableCell>{evidence.unit}</TableCell></TableRow>
                  </TableBody>
                </Table>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </aside>
  );
}
