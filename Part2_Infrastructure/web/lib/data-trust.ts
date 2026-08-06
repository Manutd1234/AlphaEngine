import type {
  HealthSourceFreshness,
  InspectResponse,
  SystemHealth,
  ValidationTelemetry,
} from "@/components/systems/types";

export type DataTrustTone = "good" | "warn" | "bad" | "unknown";
export type DataTrustDestination = "quality" | "lineage" | "providers";

export interface DataTrustVerdict {
  label: string;
  detail: string;
  tone: DataTrustTone;
}

export interface DataTrustEvidence {
  id: "freshness" | "contracts" | "provenance" | "supply";
  label: string;
  value: string;
  detail: string;
  tone: DataTrustTone;
}

export interface DataTrustAction {
  destination: DataTrustDestination;
  label: string;
  detail: string;
  priority: "now" | "review" | "inspect";
}

export interface DataTrustModel {
  verdict: DataTrustVerdict;
  evidence: DataTrustEvidence[];
  actions: DataTrustAction[];
  feedCounts: { up: number; total: number; stale: number; synthetic: number; covering: number };
  validation: ValidationTelemetry | null;
  providerSource: HealthSourceFreshness | null;
  gatewaySource: HealthSourceFreshness | null;
}

interface DataTrustOptions {
  symbol?: string;
  healthError?: string | null;
  /** Exact quote inspection for the active symbol, when the client has run it. */
  probe?: InspectResponse | null;
  probeError?: string | null;
  probeLoading?: boolean;
}

function sourceNeedsReview(source: HealthSourceFreshness | undefined): boolean {
  return Boolean(source && source.state !== "fresh" && source.state !== "not_configured");
}

function evidenceToneForSource(source: HealthSourceFreshness | undefined): DataTrustTone {
  if (!source || source.state === "not_configured") return "unknown";
  return source.state === "fresh" ? "good" : source.state === "stale" ? "warn" : "bad";
}

function sourceDetail(source: HealthSourceFreshness | undefined): string {
  if (!source) return "not exposed by this deployment";
  if (source.state === "not_configured") return source.detail ?? "source not configured";
  if (source.ageMs !== null) return `${source.state} · observed ${Math.max(0, Math.round(source.ageMs / 1000))}s ago`;
  return source.detail ?? source.state.replace("_", " ");
}

/**
 * One conservative interpretation of the health wire contract.
 *
 * Missing data never becomes green. A good verdict means only that the
 * currently implemented and observed scope has evidence; it is not a claim
 * about every symbol, raw vendor schema, function instance or historical bar.
 */
export function deriveDataTrust(
  health: SystemHealth | null,
  options: DataTrustOptions = {},
): DataTrustModel {
  const validation = health?.validation ?? null;
  const quarantine = health?.quarantine?.size ?? 0;
  const rejected = health?.quarantine?.byProvider.reduce((sum, row) => sum + row.rejected, 0) ?? 0;
  const feeds = health?.platform?.market_data.feeds ?? [];
  const activeFeedRows = options.symbol
    ? feeds.map((feed) => feed.symbols.find((row) => row.symbol === options.symbol))
    : [];
  const feedCounts = {
    up: feeds.filter((feed) => feed.connected && feed.status === "up").length,
    total: feeds.length,
    stale: feeds.filter((feed, index) => feed.status === "stale" || Boolean(activeFeedRows[index]?.stale)).length,
    synthetic: feeds.filter((feed) => feed.synthetic).length,
    covering: options.symbol ? activeFeedRows.filter(Boolean).length : feeds.length,
  };
  const providerSource = health?.sources?.providers;
  const gatewaySource = health?.sources?.gateway;
  const hasExactProbe = options.probe !== undefined
    || options.probeError !== undefined
    || options.probeLoading !== undefined;
  const exactContract = options.probe?.provenance?.contract;
  const exactContractFallback = options.probe?.attempts.some(
    (attempt) => attempt.reason === "failed" && attempt.detail?.startsWith("contract:"),
  ) ?? false;
  const transportRisk = sourceNeedsReview(providerSource)
    || sourceNeedsReview(gatewaySource)
    || (health?.platform?.market_data.status !== undefined
      && health.platform.market_data.status !== "nominal"
      && health.platform.market_data.status !== "disabled");
  const providerRisk = Boolean(
    health
    && (health.summary.degraded.length > 0
      || health.summary.exhausted.length > 0
      || (health.summary.configured > 0 && health.summary.ready < health.summary.configured)),
  );
  const coverageRisk = Boolean(options.symbol && feedCounts.total > 0 && feedCounts.covering === 0);
  const aggregateFatalRisk = Boolean((validation?.fatal ?? 0) > 0 || rejected > 0);
  const aggregateFlaggedRisk = Boolean(
    quarantine > 0
    || (validation?.warn ?? 0) > 0
    || (validation?.drift ?? 0) > 0
    || (validation?.notEvaluated ?? 0) > 0,
  );
  const exactFatalRisk = Boolean(
    exactContract
    && (!exactContract.passed
      || exactContract.violations.some((finding) => finding.severity === "fatal")),
  );
  const exactFlaggedRisk = Boolean(
    exactContractFallback
    || exactContract?.violations.length
    || exactContract?.notEvaluated.length,
  );
  const fatalRisk = hasExactProbe ? exactFatalRisk : aggregateFatalRisk;
  const flaggedRisk = hasExactProbe ? exactFlaggedRisk : aggregateFlaggedRisk;

  let verdict: DataTrustVerdict;
  if (options.healthError) {
    verdict = {
      label: "Evidence unreachable",
      detail: `The last trust snapshot cannot be refreshed: ${options.healthError}`,
      tone: "bad",
    };
  } else if (!health) {
    verdict = {
      label: "Collecting evidence",
      detail: "No health snapshot has arrived, so the data posture is unknown.",
      tone: "unknown",
    };
  } else if (hasExactProbe && options.probeLoading) {
    verdict = {
      label: "Checking active quote",
      detail: `Tracing the provider and contract result for ${options.symbol ?? "the active instrument"}.`,
      tone: "unknown",
    };
  } else if (hasExactProbe && options.probeError) {
    verdict = {
      label: "Active quote unproven",
      detail: `The exact-payload trust probe failed: ${options.probeError}`,
      tone: "bad",
    };
  } else if (hasExactProbe && !exactContract) {
    verdict = {
      label: "Active quote unproven",
      detail: "A payload may have been served, but this response carries no contract result for that exact payload.",
      tone: "unknown",
    };
  } else if (fatalRisk) {
    verdict = {
      label: "Block unchecked data",
      detail: hasExactProbe
        ? `The active ${options.symbol ?? "instrument"} quote carries a fatal contract finding.`
        : `${validation?.fatal ?? 0} fatal contract finding${validation?.fatal === 1 ? "" : "s"} and ${rejected} rejected payload${rejected === 1 ? "" : "s"} are retained in this health-route instance.`,
      tone: "bad",
    };
  } else if (transportRisk || providerRisk || flaggedRisk || coverageRisk || feedCounts.stale > 0) {
    verdict = {
      label: "Review before use",
      detail: "The observed scope contains stale, incomplete, degraded or flagged evidence that needs an operator decision.",
      tone: "warn",
    };
  } else if (!validation || validation.evaluated === 0) {
    verdict = hasExactProbe && exactContract
      ? {
          label: "Active quote checked",
          detail: `${options.symbol ?? "The active instrument"} was checked on the exact ${options.probe?.cache.state ?? "served"} payload from ${options.probe?.provenance?.provider ?? "the selected provider"}; aggregate health-route evidence remains empty.`,
          tone: "good",
        }
      : {
          label: "Not yet proven",
          detail: "No quote or bar payload has been evaluated in this function instance. Zero evidence is not a clean bill of health.",
          tone: "unknown",
        };
  } else {
    verdict = hasExactProbe && exactContract
      ? {
          label: "Active quote checked",
          detail: `${options.symbol ?? "The active instrument"} was checked on the exact ${options.probe?.cache.state ?? "served"} payload from ${options.probe?.provenance?.provider ?? "the selected provider"}.`,
          tone: "good",
        }
      : {
          label: "Instance scope checked",
          detail: `${validation.passed}/${validation.evaluated} evaluated payloads had no fatal finding; this aggregate is not tied to the active symbol.`,
          tone: "good",
        };
  }

  const freshnessTone: DataTrustTone = feedCounts.total === 0
    ? evidenceToneForSource(gatewaySource)
    : feedCounts.stale > 0 || feedCounts.up < feedCounts.total || coverageRisk
      ? "warn"
      : "good";
  const contractTone: DataTrustTone = hasExactProbe
    ? options.probeLoading
      ? "unknown"
      : options.probeError
      ? "bad"
      : !exactContract
        ? "unknown"
        : exactFatalRisk
          ? "bad"
          : exactFlaggedRisk
            ? "warn"
            : "good"
    : !validation || validation.evaluated === 0
      ? "unknown"
      : validation.fatal > 0
        ? "bad"
        : validation.warn + validation.drift + validation.notEvaluated > 0
          ? "warn"
          : "good";
  const supplyTone: DataTrustTone = !health
    ? "unknown"
    : health.summary.ready === 0 && health.summary.configured > 0
      ? "bad"
      : providerRisk
        ? "warn"
        : health.summary.configured > 0
          ? "good"
          : "unknown";

  const evidence: DataTrustEvidence[] = [
    {
      id: "freshness",
      label: "Feed freshness",
      value: feedCounts.total ? `${feedCounts.up}/${feedCounts.total} up` : gatewaySource?.state ?? "not observed",
      detail: feedCounts.total
        ? `${feedCounts.covering} cover ${options.symbol ?? "active scope"} · ${feedCounts.stale} stale · ${feedCounts.synthetic} synthetic · ${sourceDetail(gatewaySource)}`
        : sourceDetail(gatewaySource),
      tone: freshnessTone,
    },
    {
      id: "contracts",
      label: "Contract evidence",
      value: hasExactProbe
        ? options.probeLoading
          ? "checking active quote"
          : exactContract
            ? `${options.probe?.provenance?.provider ?? "provider"}: checked`
            : "no exact-payload proof"
        : validation?.evaluated
          ? `${validation.passed}/${validation.evaluated}`
          : "no denominator",
      detail: hasExactProbe && exactContract
        ? `${exactContract.violations.length} findings · ${exactContract.notEvaluated.length} checks not evaluated${exactContractFallback ? " · a higher-ranked provider failed contract checks" : ""}`
        : hasExactProbe
          ? options.probeError ?? "waiting for a contract result tied to this payload"
          : validation
            ? `${validation.fatal} fatal · ${validation.warn} warn · ${validation.drift} drift · ${validation.notEvaluated} checks not evaluated`
            : "validation telemetry is absent on this deployment",
      tone: contractTone,
    },
    {
      id: "provenance",
      label: "Lineage evidence",
      value: health ? `${health.events.retained} events` : "not observed",
      detail: health
        ? `${health.cache.entries} cache entries · trace ${options.symbol ?? "the active instrument"} on demand`
        : "waiting for the instance event ring",
      tone: health ? "good" : "unknown",
    },
    {
      id: "supply",
      label: "Provider supply",
      value: health ? `${health.summary.ready}/${health.summary.total} ready` : "not observed",
      detail: health
        ? `${health.summary.configured} configured · ${health.summary.degraded.length} degraded · ${health.summary.exhausted.length} exhausted`
        : sourceDetail(providerSource),
      tone: supplyTone,
    },
  ];

  const actions: DataTrustAction[] = [
    {
      destination: "quality",
      label: fatalRisk || flaggedRisk ? "Inspect quality findings" : "Reconcile independent sources",
      detail: fatalRisk || flaggedRisk
        ? hasExactProbe
          ? "The exact active-payload result is flagged; use reconciliation and the instance buffer to diagnose it."
          : `${quarantine} payload excerpt${quarantine === 1 ? " is" : "s are"} retained for contract diagnosis.`
        : "Run the quota-aware, on-demand median comparison before relying on a suspicious print.",
      priority: fatalRisk ? "now" : flaggedRisk ? "review" : "inspect",
    },
    {
      destination: "lineage",
      label: exactContract || validation?.evaluated ? `Trace ${options.symbol ?? "active instrument"}` : "Create validation evidence",
      detail: exactContract || validation?.evaluated
        ? "Follow provider selection, cache identity, raw evidence and normalised output for the current interval."
        : "Trace a quote or bar request to exercise the real registry and contract path.",
      priority: validation?.evaluated ? "inspect" : "now",
    },
    {
      destination: "providers",
      label: providerRisk || transportRisk ? "Review route capacity" : "Inspect supply chain",
      detail: providerRisk || transportRisk
        ? "A source, route or quota state can affect which provider answers next."
        : "Verify fallback rank, reserve and cache behavior before a failure drill.",
      priority: providerRisk || transportRisk ? "review" : "inspect",
    },
  ];

  return {
    verdict,
    evidence,
    actions,
    feedCounts,
    validation,
    providerSource: providerSource ?? null,
    gatewaySource: gatewaySource ?? null,
  };
}
