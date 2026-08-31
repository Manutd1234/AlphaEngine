import type { WorkspaceView } from "@/components/WorkspaceHeader";
import type { SystemHealth } from "@/components/systems/types";
import type { ExperimentRecord } from "@/lib/experiments";
import type { ResearchSection } from "@/lib/sections";
import type {
  ParamResult,
  Strategy,
  SweepRequest,
  SweepResponse,
} from "@/lib/types";
import type { RunSweep } from "@/lib/use-sweep-run";

export interface ResearchWorkspaceProps {
  req: SweepRequest;
  data: SweepResponse | null;
  displayedResult: SweepResponse | null;
  activeResult: SweepResponse | null;
  inspect: ParamResult | null;
  running: boolean;
  researchDirty: boolean;
  researchStale: boolean;
  sweepIncoming: boolean;
  error: string | null;
  errorFix: string | null;
  autoRun: boolean;
  autoSuspended: string | null;
  experiments: ExperimentRecord[];
  setExperiments: (next: ExperimentRecord[] | ((current: ExperimentRecord[]) => ExperimentRecord[])) => void;
  currentPinned: boolean;
  triedStrategies: Set<Strategy>;
  resultAnnouncement: { key: string; text: string } | null;
  showMcBands: boolean;
  onShowMcBandsChange: (next: boolean) => void;
  systemsHealth: SystemHealth | null;
  systemsHealthError: string | null;
  run: RunSweep;
  updateRequest: (next: SweepRequest) => void;
  updateStrategy: (strategy: Strategy) => void;
  commitRequest: () => void;
  pinRun: () => void;
  inspectCombo: (result: ParamResult) => void;
  cloneExperiment: (request: SweepRequest) => void;
  dropExperiment: (id: string) => void;
  onAutoRunChange: (next: boolean) => void;
  onResumeAuto: () => void;
  onStageSleeve: (strategy: Strategy) => void;
  onOpenSection: (view: WorkspaceView, section?: string) => void;
  section: ResearchSection;
  onSectionChange: (section: ResearchSection) => void;
  summaryView: string;
  summaryViews: ReadonlyArray<readonly [string, string]>;
  setupViews: ReadonlyArray<readonly [string, string]>;
  onSummaryViewChange: (next: string) => void;
}
