import type {
  HealthSourceFreshness,
  InspectResponse,
  LatencyStats,
  RouteState,
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
  if (source.ageMs !== null) return `${source.state}, observed ${Math.max(0, Math.round(source.ageMs / 1000))} s ago`;
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
          detail: "No contract-checked payload has been evaluated in this function instance. Zero evidence is not a clean bill of health.",
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
        ? `${feedCounts.covering} cover ${options.symbol ?? "active scope"}, ${feedCounts.stale} stale, ${feedCounts.synthetic} synthetic; ${sourceDetail(gatewaySource)}`
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
        ? `${exactContract.violations.length} findings, ${exactContract.notEvaluated.length} checks not evaluated${exactContractFallback ? "; a higher-ranked provider failed contract checks" : ""}`
        : hasExactProbe
          ? options.probeError ?? "waiting for a contract result tied to this payload"
          : validation
            ? `${validation.fatal} fatal, ${validation.warn} warn, ${validation.drift} drift; ${validation.notEvaluated} checks not evaluated`
            : "validation telemetry is absent on this deployment",
      tone: contractTone,
    },
    {
      id: "provenance",
      label: "Lineage evidence",
      value: health ? `${health.events.retained} events` : "not observed",
      detail: health
        ? `${health.cache.entries} cache entries; trace ${options.symbol ?? "the active instrument"} on demand`
        : "waiting for the instance event ring",
      tone: health ? "good" : "unknown",
    },
    {
      id: "supply",
      label: "Provider supply",
      value: health ? `${health.summary.ready}/${health.summary.total} ready` : "not observed",
      detail: health
        ? `${health.summary.configured} configured, ${health.summary.degraded.length} degraded, ${health.summary.exhausted.length} exhausted`
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
        : "Trace a quote, bar, news or fundamentals request to exercise the real registry and contract path.",
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

// --------------------------------------------------------------------------
// Trust SLIs
//
// Four tiles, and three of them are NOT the metric that was asked for, because
// that metric does not exist in this system. Each says what it actually
// measures rather than borrowing a name it cannot support:
//
//   "Market feed SLA %"    no SLA target is defined anywhere in the tree — the
//                          only `SLA` in it is the data work board's own
//                          per-item due time. Ships as books within the
//                          freshness budget the gateway publishes.
//   "Missing packet rate"  no sequence-gap or expected-vs-received counter
//                          exists on any feed. Ships as reconnects, each of
//                          which IS an unmeasured gap — and says that nothing
//                          counts the messages lost inside one.
//   "Provider uptime"      only durations exist; a per-provider uptime is not
//                          measurable at all, because providers are observed
//                          only when they are called. Ships as the success rate
//                          of the attempts that were actually made.
//   "Last sync timestamp"  real, and the only one of the four that ships as
//                          asked.
// --------------------------------------------------------------------------

/** Below this a rate is the sample size talking, not the providers. */
export const TRUST_MIN_SAMPLES = 20;

export interface TrustSli {
  label: string;
  value: string;
  note: string;
  tone: DataTrustTone;
}

export function deriveTrustSlis(health: SystemHealth | null): TrustSli[] {
  const platform = health?.platform;
  const feeds = (platform?.market_data.feeds ?? []).filter((feed) => !feed.synthetic);
  const books = feeds.flatMap((feed) => feed.symbols);
  const stale = books.filter((book) => book.stale).length;
  const reconnects = feeds.reduce((sum, feed) => sum + (feed.reconnects ?? 0), 0);
  const budget = platform?.market_data.stale_after_seconds ?? null;

  /**
   * Absent, not zero. With no gateway snapshot these two are unobservable, and
   * "0/0 fresh" or "0 reconnects" would read as a clean bill of health rather
   * than as a missing instrument.
   */
  const noSnapshot = !platform;

  const latency = health?.summary.latency;
  const attempts = latency?.n ?? 0;
  const successRate = attempts ? 1 - latency!.errorRate : null;

  const gateway = health?.sources?.gateway;
  const providers = health?.sources?.providers;
  /**
   * The GATEWAY's observation time, never `fetchedAt`. Fetching the health
   * response does not make an old feed fresh, and `HealthSourceFreshness`
   * exists precisely to keep those two apart.
   */
  const observedAt = gateway?.observedAt ?? providers?.observedAt ?? null;
  const observedAgeMs = gateway?.ageMs ?? providers?.ageMs ?? null;

  return [
    {
      label: "Books within freshness budget",
      value: noSnapshot ? "—" : `${books.length - stale}/${books.length}`,
      note: noSnapshot
        ? "no gateway feed snapshot — the provider registry cannot prove stream freshness"
        : `${budget ?? "?"} s budget; one snapshot, no period SLA is measured anywhere`,
      tone: noSnapshot ? "unknown" : stale === 0 ? "good" : stale < books.length ? "warn" : "bad",
    },
    {
      label: "Feed reconnects",
      value: noSnapshot ? "—" : String(reconnects),
      note: noSnapshot
        ? "no gateway feed snapshot — reconnects are counted by the feed, not by this instance"
        : "each reconnect is an unmeasured gap in that venue's tape; nothing counts the messages lost inside one",
      tone: noSnapshot ? "unknown" : reconnects === 0 ? "good" : "warn",
    },
    {
      label: "Upstream attempt success",
      value: attempts < TRUST_MIN_SAMPLES
        ? "Collecting"
        : `${((successRate ?? 0) * 100).toFixed(1)}%`,
      note: attempts < TRUST_MIN_SAMPLES
        ? `${attempts}/${TRUST_MIN_SAMPLES} samples — a thin window, not a failure`
        : `provider and venue calls in the rolling 15-minute window; per-provider uptime is not measurable, they are observed only when called`,
      tone: attempts < TRUST_MIN_SAMPLES
        ? "unknown"
        : (successRate ?? 0) >= 0.99 ? "good" : (successRate ?? 0) >= 0.9 ? "warn" : "bad",
    },
    {
      label: "Last observation",
      value: observedAgeMs == null ? "—" : `${Math.round(observedAgeMs / 1000)}s ago`,
      note: observedAt
        ? `${gateway?.observedAt ? "gateway" : "provider registry"} observed ${observedAt}`
        : "nothing has reported an observation time",
      tone: observedAgeMs == null ? "unknown"
        : observedAgeMs < 60_000 ? "good" : observedAgeMs < 300_000 ? "warn" : "bad",
    },
  ];
}

// --------------------------------------------------------------------------
// Snapshot-backed analytics
//
// WHY these sources and not the obvious ones.
//
// `validation.*`, `cache.byCapability`, `events.*` and `quarantine.*` are only
// ever incremented inside `dispatch()` (lib/providers/runtime.ts), which runs
// in the `/api/quote`-family lambdas. `/api/system/health` is answered by
// `buildSystemHealthSnapshot` in a DIFFERENT serverless process with its own
// module scope, so those four read ~0 on a fully warm, heavily-trafficked
// deployment. That is not a cold start and no amount of traffic fixes it —
// drawing more charts over them just produces more empty charts.
//
// Everything below reads the half of the payload that is BUILT DURING the
// health request itself: the provider registry, the failover graph, the quota
// ledger and the gateway's own ops snapshot. Those are populated on every poll,
// on every instance, which is why the analytics moved onto them.
// --------------------------------------------------------------------------

/** A duration a person can read. `null` stays absent — never "0s". */
export function humanDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "n/a";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

export interface InstanceScopeFact {
  id: "scope" | "instances" | "uptime" | "observed";
  label: string;
  value: string;
  detail: string;
  tone: DataTrustTone;
}

/**
 * Whose numbers these are.
 *
 * `instance.scope`, `instance.shared` and `instance.uptimeMs` have been on the
 * wire and typed the whole time, and nothing rendered them. They are the single
 * highest-value thing on this tab and not a chart: `scope` states outright
 * whether the counters below were merged across the fleet through the gateway
 * ledger or measured by this one lambda, and `uptimeMs` states how long that
 * lambda has been alive. Together they turn "0 evaluated" from an alarm into an
 * explained boundary.
 */
export function deriveInstanceScope(health: SystemHealth | null): InstanceScopeFact[] {
  const instance = health?.instance ?? null;
  const shared = instance?.shared ?? null;
  const backed = shared?.backed ?? false;
  const reporting = shared?.instances.length ?? 0;
  const uptimeMs = instance ? instance.uptimeMs : null;

  return [
    {
      id: "scope",
      label: "Ledger scope",
      value: !instance ? "not observed" : backed ? "Gateway-shared" : "Per-instance",
      detail: instance?.scope
        ?? "No health snapshot has arrived, so the measurement boundary is unknown.",
      tone: !instance ? "unknown" : backed ? "good" : "warn",
    },
    {
      id: "instances",
      // Not "0" when the sync is down: an unmerged ledger is an unobserved
      // fleet, not a fleet of none.
      label: "Instances merged",
      value: backed && reporting > 0 ? String(reporting) : "n/a",
      detail: backed && reporting > 0
        ? `${shared!.instances.slice(0, 4).join(", ")}${reporting > 4 ? ` +${reporting - 4} more` : ""}`
          + `${shared!.windowSeconds ? `; ${shared!.windowSeconds} s merge window` : ""}`
        : instance
          ? "The gateway ledger sync is unavailable, so every counter on this tab was measured by this lambda alone."
          : "Waiting for the first health snapshot.",
      tone: backed && reporting > 0 ? "good" : "unknown",
    },
    {
      id: "uptime",
      label: "This instance uptime",
      value: humanDuration(uptimeMs),
      detail: instance
        ? `Instance ${instance.id}. Validation, cache, event and quarantine counters are incremented in the quote lambdas, not in this one, so they start empty here and stay empty.`
        : "No instance identity has been reported.",
      // A young instance is the honest explanation for a thin window, so it is
      // flagged rather than presented as a healthy reading.
      tone: uptimeMs == null ? "unknown" : uptimeMs < 300_000 ? "warn" : "good",
    },
    {
      id: "observed",
      label: "Ledger observed",
      value: shared?.ageMs == null ? "n/a" : `${Math.max(0, Math.round(shared.ageMs / 1000))}s ago`,
      detail: shared?.observedAt
        ? `Shared ops state last merged at ${shared.observedAt}.`
        : "No shared observation time — there is nothing to merge against.",
      tone: shared?.ageMs == null ? "unknown" : shared.ageMs < 60_000 ? "good" : "warn",
    },
  ];
}

export interface SupplyCounts {
  total: number;
  ready: number;
  circuitOpen: number;
  quotaExhausted: number;
  simulatedOutage: number;
  notConfigured: number;
  /** Configured, not blocked by circuit or quota, and still not routable. */
  blocked: number;
}

/**
 * Every provider counted EXACTLY ONCE.
 *
 * `summary.degraded`, `summary.exhausted` and `summary.simulated` are three
 * independent id lists and a provider can appear in more than one of them, so a
 * ring built from those three plus `ready` can sum past `total` — a composition
 * chart whose slices do not partition its own denominator. Classifying each
 * provider row by precedence is what makes the ring add up.
 */
export function deriveProviderSupply(health: SystemHealth | null): SupplyCounts {
  const counts: SupplyCounts = {
    total: 0,
    ready: 0,
    circuitOpen: 0,
    quotaExhausted: 0,
    simulatedOutage: 0,
    notConfigured: 0,
    blocked: 0,
  };
  for (const provider of health?.providers ?? []) {
    counts.total += 1;
    if (!provider.configured) counts.notConfigured += 1;
    else if (provider.simulatedOutage) counts.simulatedOutage += 1;
    else if (provider.circuitOpen || provider.breaker.state === "open") counts.circuitOpen += 1;
    else if (provider.quota && provider.quota.remaining <= 0) counts.quotaExhausted += 1;
    else if (provider.ready) counts.ready += 1;
    else counts.blocked += 1;
  }
  return counts;
}

export interface FailoverDepthRow {
  capability: string;
  asset: string;
  total: number;
  ready: number;
  byState: Record<RouteState, number>;
  activeProvider: string | null;
}

const ROUTE_STATES: RouteState[] = [
  "ready",
  "quota_reserved",
  "quota_exhausted",
  "circuit_open",
  "simulated_outage",
  "unlicensed",
  "not_configured",
];

/**
 * How deep each failover chain actually is right now.
 *
 * `routes` is the richest structure on the wire — one ranked chain per
 * capability × asset, each node carrying its own routing state — and the tab
 * reduced all of it to the single scalar "9 route graphs". The question a chain
 * answers is whether anything is behind the provider currently serving it, so
 * the thinnest chains sort first.
 */
export function deriveFailoverDepth(health: SystemHealth | null): FailoverDepthRow[] {
  return (health?.routes ?? [])
    .map((route) => {
      const byState = Object.fromEntries(ROUTE_STATES.map((state) => [state, 0])) as Record<RouteState, number>;
      for (const node of route.nodes) byState[node.state] = (byState[node.state] ?? 0) + 1;
      return {
        capability: route.capability,
        asset: route.asset,
        total: route.nodes.length,
        ready: byState.ready,
        byState,
        activeProvider: route.activeProvider,
      };
    })
    .sort((left, right) =>
      left.ready - right.ready
      || left.capability.localeCompare(right.capability)
      || left.asset.localeCompare(right.asset));
}

export interface QuotaHeadroomRow {
  id: string;
  label: string;
  used: number;
  limit: number;
  remaining: number;
  reserve: number;
  window: string;
  /** Shares of the window, summing to exactly 100 so rows stay comparable. */
  spentPct: number;
  freePct: number;
  reservedPct: number;
  tone: DataTrustTone;
}

/**
 * Quota as a proportion, tightest first.
 *
 * Deliberately NOT the per-provider meters in `QuotaMeters` (Providers section),
 * which are absolute counts with a window countdown: 5/5000 and 5/5 are the same
 * bar there and opposite facts here. The reserve is carved out of the top of the
 * window — background polling stops when `remaining <= reserve` — so it is drawn
 * as its own band rather than as part of the free space, because a desk reading
 * "245 left" is already being refused refreshes at 50 of them.
 */
export function deriveQuotaHeadroom(health: SystemHealth | null): QuotaHeadroomRow[] {
  const rows: QuotaHeadroomRow[] = [];
  for (const provider of health?.providers ?? []) {
    const quota = provider.quota;
    // A zero or missing limit is not a quota of nothing; it is no local ledger.
    // Unconfigured providers are excluded even though the registry still
    // reports their window: a budget that cannot be spent is not headroom, and
    // a full green bar for a provider with no key is the most flattering
    // possible way to draw a missing credential.
    if (!provider.configured || !quota || quota.limit <= 0) continue;
    const spent = Math.min(quota.limit, Math.max(0, quota.used));
    const reserved = Math.min(Math.max(0, quota.remaining), Math.max(0, quota.reserve));
    const spentPct = Math.round((spent / quota.limit) * 1000) / 10;
    const reservedPct = Math.round((reserved / quota.limit) * 1000) / 10;
    rows.push({
      id: provider.id,
      label: provider.label,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      reserve: quota.reserve,
      window: quota.window,
      spentPct,
      reservedPct,
      // The remainder, not a third rounding: the three shares must total 100 or
      // the bar overruns the track it is drawn in.
      freePct: Math.max(0, Math.round((100 - spentPct - reservedPct) * 10) / 10),
      tone: quota.remaining <= 0 ? "bad" : quota.remaining <= quota.reserve ? "warn" : "good",
    });
  }
  return rows.sort((left, right) =>
    (left.remaining - left.reserve) / left.limit - (right.remaining - right.reserve) / right.limit
    || left.label.localeCompare(right.label));
}

export interface FeedBookRow {
  symbol: string;
  updateRateHz: number;
  ageSeconds: number | null;
  updatesTotal: number;
  stale: boolean;
}

export interface FeedThroughputRow {
  venue: string;
  status: "up" | "degraded" | "stale" | "down";
  connected: boolean;
  synthetic: boolean;
  reconnects: number;
  uptimeSeconds: number;
  updatesTotal: number;
  /** Lifetime mean, or `null` when there is no uptime to divide by. */
  meanRateHz: number | null;
  books: FeedBookRow[];
}

/**
 * The richest live dataset reaching this tab, and the one it rendered as a
 * single decimal in a table cell.
 *
 * `update_rate_hz` and `uptime_seconds` are confirmed rendered nowhere else in
 * the tree. The mean rate is derived rather than published: it ASSUMES every
 * book was subscribed when the venue connected, which is why it is separated
 * from the instantaneous rate instead of being averaged with it, and why the
 * panel says so.
 */
export function deriveFeedThroughput(health: SystemHealth | null): FeedThroughputRow[] {
  return (health?.platform?.market_data.feeds ?? []).map((feed) => {
    const updatesTotal = feed.symbols.reduce((sum, book) => sum + (book.updates_total ?? 0), 0);
    return {
      venue: feed.venue,
      status: feed.status,
      connected: feed.connected,
      synthetic: feed.synthetic,
      reconnects: feed.reconnects,
      uptimeSeconds: feed.uptime_seconds,
      updatesTotal,
      meanRateHz: feed.uptime_seconds > 0 ? updatesTotal / feed.uptime_seconds : null,
      books: feed.symbols.map((book) => ({
        symbol: book.symbol,
        updateRateHz: book.update_rate_hz,
        ageSeconds: book.age_seconds,
        updatesTotal: book.updates_total,
        stale: book.stale,
      })),
    };
  });
}

export interface LatencySourceRef {
  key: string;
  label: string;
  kind: "provider" | "venue" | "plane" | "unknown";
  /** The published fifteen-minute aggregate, or `null` when none exists. */
  stats: LatencyStats | null;
  /** Why there is no aggregate, when there is none. */
  note: string | null;
}

/**
 * Resolve a latency-window series key to the source it measures.
 *
 * The bug this replaces: the panel matched `venue:*` and provider ids only, so
 * `plane:gateway` — recorded on EVERY health poll by the health route itself,
 * and therefore the densest line on the tab — fell through both branches and
 * showed a permanent "—" beside a fully drawn sparkline. A stat chip that is
 * blank no matter how much traffic a source gets reads as a broken source.
 *
 * `plane:*` keys genuinely have no published aggregate: only providers and
 * venues carry `LatencyStats` on the wire. So the p95 is withheld and named
 * `n/a`, and the sample count comes from the window's own per-bucket counts,
 * which describe the same sample pool.
 */
export function resolveLatencySource(health: SystemHealth | null, key: string): LatencySourceRef {
  if (key.startsWith("venue:")) {
    const id = key.slice("venue:".length);
    const venue = health?.venues.find((row) => row.id === id) ?? null;
    return { key, label: id, kind: "venue", stats: venue?.latency ?? null, note: venue ? null : "venue not in this snapshot" };
  }
  if (key.startsWith("plane:")) {
    const plane = key.slice("plane:".length);
    return {
      key,
      label: `${plane} probe`,
      kind: "plane",
      stats: null,
      note: "the health route's own call to the gateway; no fifteen-minute aggregate is published for it",
    };
  }
  const provider = health?.providers.find((row) => row.id === key) ?? null;
  return {
    key,
    label: provider?.label ?? key,
    kind: provider ? "provider" : "unknown",
    stats: provider?.latency ?? null,
    note: provider ? null : "no provider, venue or plane in this snapshot owns this key",
  };
}
