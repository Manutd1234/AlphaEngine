"use client";

import { useEffect, useRef, useState } from "react";

type TabId = "overview" | "pipelines" | "interfaces" | "changes" | "tasks";
type Tone = "positive" | "warning" | "danger" | "info" | "neutral";

type PipelineRun = {
  id: string;
  branch: string;
  // Deliberately not named `sha`: no commit hash is available to this app, so
  // the field carries an obvious placeholder rather than a plausible digest.
  ref: string;
  title: string;
  // `duration` is absent for the same reason `actor` and `timestamp` are: a
  // wall-clock figure is a measurement, nothing here measures one, and a field
  // that can hold "4m 12s" will eventually be filled with it. Removed from the
  // type rather than blanked, so the shape cannot carry an invented number.
  status: "Passing" | "Failed" | "Running" | "Queued";
};

type Endpoint = {
  method: "GET" | "POST" | "WS";
  path: string;
  group: string;
  summary: string;
  latency: string;
  drift: string;
};

type WorkItem = {
  id: string;
  severity: "Critical" | "High" | "Medium";
  status: "Open" | "In review" | "Blocked";
  title: string;
  source: string;
  owner: string;
  age: string;
  context: string;
};

const tabs: Array<{ id: TabId; label: string; count?: number }> = [
  { id: "overview", label: "Overview" },
  { id: "pipelines", label: "CI / CD", count: 1 },
  { id: "interfaces", label: "API & Schema", count: 2 },
  { id: "changes", label: "Code & Diffs", count: 8 },
  { id: "tasks", label: "Task Queue", count: 5 },
];

// No CI provider is connected, so there is no run history to render. These rows
// exist only to show the shape of the run viewer: they carry no author, no
// commit hash, no wall-clock time and no duration, because inventing any of
// those would put audit-shaped fiction on screen. The panel labels them as
// illustrative in the rendered UI, not just here.
const pipelines: PipelineRun[] = [
  {
    id: "Example 1",
    branch: "main",
    ref: "example-ref-1",
    title: "Reproducibility preflight blocks promotion",
    status: "Failed",
  },
  {
    id: "Example 2",
    branch: "example-branch",
    ref: "example-ref-2",
    title: "Unit and integration suites pass",
    status: "Passing",
  },
  {
    id: "Example 3",
    branch: "main",
    ref: "example-ref-3",
    title: "Lint and type checks pass",
    status: "Passing",
  },
  {
    id: "Example 4",
    branch: "example-branch",
    ref: "example-ref-4",
    title: "Scheduled run waiting for a runner",
    status: "Queued",
  },
];

const endpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/api/quote",
    group: "Market data",
    summary: "Latest normalized quote and freshness metadata",
    latency: "84 µs",
    drift: "Compatible",
  },
  {
    method: "POST",
    path: "/api/gateway/orders",
    group: "Execution",
    summary: "Submit a certified, policy-approved order batch",
    latency: "1.8 ms",
    drift: "Breaking",
  },
  {
    method: "GET",
    path: "/api/runtime/health",
    group: "Controls",
    summary: "Route-time runtime health and blocking reasons",
    latency: "410 µs",
    drift: "Unchanged",
  },
  {
    method: "GET",
    path: "/api/artifacts/{digest}",
    group: "Artifacts",
    summary: "Resolve immutable strategy artifact metadata",
    latency: "2.4 ms",
    drift: "Compatible",
  },
  {
    method: "WS",
    path: "/ws/market",
    group: "Market data",
    summary: "Normalized quote, contract and heartbeat stream",
    latency: "92 µs",
    drift: "Review",
  },
];

// Derived from the fixtures above so the summary counts can never claim more
// routes or services than the list actually renders.
const endpointServiceCount = new Set(endpoints.map((endpoint) => endpoint.group)).size;
const endpointChangeCount = endpoints.filter((endpoint) => endpoint.drift === "Breaking" || endpoint.drift === "Review").length;

const workItems: WorkItem[] = [
  {
    id: "DATA-01",
    severity: "Critical",
    status: "Blocked",
    title: "Commission tradeable serial market-data boundary",
    source: "Readiness gates",
    owner: "Unassigned",
    age: "Snapshot",
    context: "5 gates · serial data, timestamps, specifications, margin and universe",
  },
  {
    id: "EXEC-01",
    severity: "Critical",
    status: "Blocked",
    title: "Calibrate execution costs from representative evidence",
    source: "Readiness gates",
    owner: "Unassigned",
    age: "Snapshot",
    context: "1 gate · timestamped quote and fill calibration",
  },
  {
    id: "TREASURY-01",
    severity: "Critical",
    status: "Blocked",
    title: "Validate cash, collateral, margin and funding controls",
    source: "Readiness",
    owner: "Unassigned",
    age: "Snapshot",
    context: "1 gate · externally supplied treasury evidence required",
  },
  {
    id: "OPS-01",
    severity: "Critical",
    status: "Blocked",
    title: "Commission the operational execution boundary",
    source: "Readiness gates",
    owner: "Unassigned",
    age: "Snapshot",
    context: "5 gates · adapter, reconciliation, monitoring, DR and kill switch",
  },
  {
    id: "GOV-01",
    severity: "Critical",
    status: "Blocked",
    title: "Complete independent launch governance",
    source: "Readiness gates",
    owner: "Unassigned",
    age: "Snapshot",
    context: "5 gates · change control, holdout, paper record and approvals",
  },
];

const driftFiles = [
  { name: "research/inference.py", detail: "Differs from Git HEAD", kind: "Changed" },
  { name: "research/validation.py", detail: "Untracked at Git HEAD", kind: "Added" },
  { name: "research/benchmarks.py", detail: "Untracked at Git HEAD", kind: "Added" },
  { name: "research/bounds.py", detail: "Untracked at Git HEAD", kind: "Added" },
  { name: "research/attribution.py", detail: "Untracked at Git HEAD", kind: "Added" },
  { name: "research/allocation.py", detail: "Untracked at Git HEAD", kind: "Added" },
  { name: "research/regimes.py", detail: "Untracked at Git HEAD", kind: "Added" },
  { name: "marketdata/etfs.py", detail: "Untracked at Git HEAD", kind: "Added" },
];

function toneForStatus(status: string): Tone {
  if (["Passing", "PASS", "Healthy", "Compatible", "Unchanged"].includes(status)) return "positive";
  if (["Failed", "BLOCKED", "Blocked", "Critical", "Breaking", "FAIL"].includes(status)) return "danger";
  if (["Running", "In review", "Review"].includes(status)) return "info";
  if (["High", "Queued", "Open", "INFORMATIONAL"].includes(status)) return "warning";
  return "neutral";
}

function StatusPill({ label, tone = toneForStatus(label), dot = true }: { label: string; tone?: Tone; dot?: boolean }) {
  return (
    <span className={`status-pill status-${tone}`}>
      {dot ? <span className="status-dot" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button className="icon-button" type="button" onClick={copy} aria-label={`${label} ${value}`} title={`${label} ${value}`}>
      <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: Tone }) {
  return (
    <div className="metric-row">
      <div>
        <span className="metric-label">{label}</span>
        <strong className={tone ? `text-${tone}` : ""}>{value}</strong>
      </div>
      <span className="metric-note">{note}</span>
    </div>
  );
}

function Overview({ onOpenDrift, onOpenPipelines }: { onOpenDrift: () => void; onOpenPipelines: () => void }) {
  return (
    <section className="tab-panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Operational posture</span>
          <h1>What can ship, and what is blocking it?</h1>
        </div>
        <div className="heading-meta">
          <span className="live-indicator"><span aria-hidden="true" />Local snapshot</span>
          <span>Captured 16:14 SGT</span>
        </div>
      </div>

      <div className="critical-banner" role="status">
        <div className="banner-icon" aria-hidden="true">!</div>
        <div>
          <strong>Production is blocked</strong>
          <p>The hardened strategy is approved for research review only. Paper/shadow is the next eligible environment.</p>
        </div>
        <button className="button button-quiet" type="button" onClick={onOpenDrift}>View 17 blockers <span aria-hidden="true">→</span></button>
      </div>

      <div className="overview-grid">
        <article className="panel topology-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Delivery path</span>
              <h2>Deployment topology</h2>
            </div>
            <button className="text-button" type="button" onClick={onOpenPipelines}>Open pipeline <span aria-hidden="true">↗</span></button>
          </div>
          <div className="topology" aria-label="Research bundle passes CI, but shadow and production are blocked">
            <div className="topology-node is-positive">
              <span className="node-index">01</span>
              <div><strong>Research bundle</strong><span>v3.2.1 · 20 outputs</span></div>
              <StatusPill label="Built" tone="positive" />
            </div>
            <div className="topology-connector is-positive"><span>CI checks</span></div>
            <div className="topology-node is-warning">
              <span className="node-index">02</span>
              <div><strong>Release candidate</strong><span>Local hashes pass · Git unbound</span></div>
              <StatusPill label="Unbound" tone="warning" />
            </div>
            <div className="topology-connector is-blocked"><span>evidence gates</span></div>
            <div className="topology-node is-blocked">
              <span className="node-index">03</span>
              <div><strong>Paper / shadow</strong><span>No active deployment</span></div>
              <StatusPill label="Blocked" tone="danger" />
            </div>
            <div className="topology-connector is-blocked"><span>launch approval</span></div>
            <div className="topology-node is-muted">
              <span className="node-index">04</span>
              <div><strong>Production</strong><span>Live capital unavailable</span></div>
              <StatusPill label="Off" tone="neutral" />
            </div>
          </div>
          <div className="panel-footer">
            <span>Source: run manifest + readiness report</span>
            <span>Data through 31 Dec 2014</span>
          </div>
        </article>

        <article className="panel readiness-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Conjunctive gates</span>
              <h2>Launch readiness</h2>
            </div>
            <StatusPill label="BLOCKED" tone="danger" />
          </div>
          <div className="readiness-visual">
            <div className="readiness-ring" aria-label="10 of 29 gates pass">
              <div><strong>10</strong><span>of 29 pass</span></div>
            </div>
            <div className="readiness-legend">
              <div><span className="legend-mark positive" /> <strong>10</strong> Passing</div>
              <div><span className="legend-mark warning" /> <strong>2</strong> Informational</div>
              <div><span className="legend-mark danger" /> <strong>17</strong> Blocked</div>
            </div>
          </div>
          <div className="readiness-list">
            <Metric label="Historical risk controls" value="PASS" note="10 / 10" tone="positive" />
            <Metric label="External evidence" value="BLOCKED" note="0 / 17" tone="danger" />
            <Metric label="Independent validation" value="Missing" note="required" tone="warning" />
          </div>
        </article>

        <article className="panel integrity-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Release custody</span>
              <h2>Git reproducibility</h2>
            </div>
            <StatusPill label="BLOCKED" tone="danger" />
          </div>
          <div className="integrity-summary">
            <div className="integrity-score"><strong>8</strong><span>HEAD divergences</span></div>
            <div className="integrity-copy">
              <p>The local bundle matches its manifest, but Git HEAD cannot recreate the signed-off implementation.</p>
              <div className="mini-stats"><span><b>49/49</b> local hashes verified</span><span><b>1</b> tracked source changed</span><span><b>7</b> modules untracked</span></div>
            </div>
          </div>
          <button className="button button-secondary full-width" type="button" onClick={onOpenDrift}>Inspect Git divergence <span aria-hidden="true">→</span></button>
        </article>

        <article className="panel health-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Runtime boundary</span>
              <h2>Environment health</h2>
            </div>
            <span className="muted-label">No live adapter</span>
          </div>
          <div className="health-table" role="table" aria-label="Environment health">
            <div className="health-row health-head" role="row"><span>Environment</span><span>Artifact</span><span>Freshness</span><span>Status</span></div>
            <div className="health-row" role="row"><span><i className="env-dot local" />Local research</span><code>—</code><span>16:14</span><StatusPill label="Unbound" tone="warning" /></div>
            <div className="health-row" role="row"><span><i className="env-dot shadow" />Paper / shadow</span><code>—</code><span>Never</span><StatusPill label="Not deployed" tone="neutral" /></div>
            <div className="health-row" role="row"><span><i className="env-dot prod" />Production</span><code>—</code><span>Never</span><StatusPill label="Blocked" tone="danger" /></div>
          </div>
          <div className="runtime-limits">
            <span>Data SLO <b>300s</b></span><span>Recon SLO <b>30s</b></span><span>Margin cap <b>35%</b></span><span>Gross cap <b>6.0×</b></span>
          </div>
        </article>

        <article className="panel events-panel">
          <div className="panel-header">
            <div><span className="panel-kicker">Evidence trail</span><h2>Recent events</h2></div>
            <button className="text-button" type="button" title="No audit log service is connected" disabled>Full audit log <span aria-hidden="true">↗</span></button>
          </div>
          <ol className="event-list">
            <li><span className="event-time">16:14</span><span className="event-marker positive" /><div><strong>Local bundle verified</strong><p>29 implementation and 20 output hashes match the manifest.</p></div></li>
            <li><span className="event-time">Study</span><span className="event-marker positive" /><div><strong>Benchmark family completed</strong><p>13 benchmarks · 0 errors · seam deviation 0.</p></div></li>
            <li><span className="event-time">HEAD</span><span className="event-marker danger" /><div><strong>Git provenance is unbound</strong><p>One tracked source and seven new modules diverge from HEAD.</p></div></li>
          </ol>
        </article>

        <article className="panel telemetry-panel">
          <div className="panel-header">
            <div><span className="panel-kicker">Execution telemetry</span><h2>Latency profile</h2></div>
            <StatusPill label="Unavailable" tone="neutral" />
          </div>
          <div className="telemetry-empty">
            <div className="signal-bars" aria-hidden="true"><i /><i /><i /><i /></div>
            <div><strong>No trace source connected</strong><p>Instrument market data → signal → risk → outbox → broker ACK before reporting microsecond percentiles.</p></div>
          </div>
          <div className="telemetry-stages"><span>Market ingest <b>—</b></span><span>Risk gate <b>—</b></span><span>Broker ACK <b>—</b></span></div>
        </article>

        <article className="panel safety-panel">
          <div className="panel-header">
            <div><span className="panel-kicker">Privileged operations</span><h2>Execution safety</h2></div>
            <StatusPill label="Not commissioned" tone="warning" />
          </div>
          <div className="safety-action"><div><strong>Halt new risk</strong><span>Independent, latched control required</span></div><button className="button button-secondary" type="button" disabled>Unavailable</button></div>
          <div className="safety-action"><div><strong>Reset / unhalt</strong><span>Dual approval + recovery evidence</span></div><button className="button button-secondary" type="button" disabled>Unavailable</button></div>
        </article>
      </div>
    </section>
  );
}

function Pipelines() {
  const [selectedRun, setSelectedRun] = useState(pipelines[0]);
  const [filter, setFilter] = useState<"All" | "Failed" | "Passing">("All");
  const [showLogs, setShowLogs] = useState(true);
  const [actionOpen, setActionOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  const visibleRuns = pipelines.filter((run) => filter === "All" || run.status === filter);

  const queuePreview = () => {
    setActionOpen(false);
    setQueued(true);
    window.setTimeout(() => setQueued(false), 4200);
  };

  return (
    <section className="tab-panel" id="panel-pipelines" role="tabpanel" aria-labelledby="tab-pipelines">
      <div className="section-heading compact-heading">
        <div><span className="eyebrow">Delivery workflow</span><h1>Pipeline execution</h1></div>
        <div className="heading-actions">
          <span className="source-chip"><i /> Illustrative · no CI connector</span>
          <button className="button button-primary" type="button" onClick={() => setActionOpen(true)}>Run sanity backtest</button>
        </div>
      </div>
      <div className="notice-bar"><span aria-hidden="true">i</span><p>No CI provider is connected in this workspace, so no run history exists to display. The runs below are illustrative: they show the shape of the configured unit, integration and lint workflow, and carry no author, commit or timestamp.</p></div>
      <div className="pipeline-layout">
        <aside className="panel run-list-panel" aria-label="Pipeline runs">
          <div className="run-list-header">
            <div><h2>Run viewer preview</h2><span>{pipelines.length} illustrative executions · not real history</span></div>
            <div className="segmented-control" aria-label="Filter runs">
              {(["All", "Failed", "Passing"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} type="button" onClick={() => setFilter(item)}>{item}</button>)}
            </div>
          </div>
          <div className="run-list">
            {visibleRuns.length ? visibleRuns.map((run) => (
              <button key={run.id} className={`run-item ${selectedRun.id === run.id ? "selected" : ""}`} type="button" onClick={() => setSelectedRun(run)}>
                <span className={`run-status-mark ${toneForStatus(run.status)}`} aria-hidden="true">{run.status === "Passing" ? "✓" : run.status === "Failed" ? "×" : "·"}</span>
                <span className="run-main"><strong>{run.title}</strong><span><code>{run.ref}</code> on {run.branch}</span></span>
                <span className="run-meta"><StatusPill label={run.status} dot={false} /></span>
              </button>
            )) : <div className="empty-state"><strong>No matching runs</strong><span>Clear the filter to see every illustrative run.</span></div>}
          </div>
        </aside>

        <article className="panel run-detail-panel">
          <div className="run-detail-header">
            <div>
              <div className="run-title-line"><StatusPill label={selectedRun.status} /><span>{selectedRun.id}</span></div>
              <h2>{selectedRun.title}</h2>
              <p>Illustrative run on <code>{selectedRun.branch}</code> · author, commit and timestamp stay blank until a CI provider is connected.</p>
            </div>
            <div className="run-detail-actions"><CopyButton value={selectedRun.ref} label="Copy example reference" /><button className="icon-button" type="button" aria-label="Open run in provider (unavailable)" title="No CI provider is connected" disabled>↗</button></div>
          </div>
          <div className="run-facts">
            <div><span>Reference</span><strong><code>{selectedRun.ref}</code></strong></div>
            <div><span>Duration</span><strong>Not recorded</strong></div>
            <div><span>Triggered by</span><strong>Not recorded</strong></div>
            <div><span>Environment</span><strong>Illustrative</strong></div>
          </div>
          <div className="jobs-section">
            <div className="subsection-title"><h3>Jobs</h3><span>4 checks · 1 attention item</span></div>
            <div className="job-list">
              {/* Job subtitles name what a job covers, never how much or how long.
                  Both unit rows carried "661 tests discovered" and every row a
                  duration; nothing in this app discovers a test or times a job, so
                  the counts and the clocks are gone rather than refreshed. */}
              <div className="job-row"><span className="job-icon pass">✓</span><div><strong>Unit tests · Python 3.11</strong><span>Test count not available — no CI provider connected</span></div><span className="job-duration">—</span></div>
              <div className="job-row"><span className="job-icon pass">✓</span><div><strong>Unit tests · Python 3.12</strong><span>Test count not available — no CI provider connected</span></div><span className="job-duration">—</span></div>
              <div className="job-row selected"><span className="job-icon fail">×</span><div><strong>Git reproducibility preflight</strong><span>Bundle cannot be recreated from HEAD</span></div><span className="job-duration">—</span></div>
              <div className="job-row"><span className="job-icon pass">✓</span><div><strong>Ruff lint</strong><span>src · tests · scripts</span></div><span className="job-duration">—</span></div>
            </div>
          </div>
          <div className="log-section">
            <div className="log-toolbar">
              <div><h3>Git reproducibility preflight</h3><span>Illustrative step</span></div>
              <div><button type="button" className={showLogs ? "active" : ""} onClick={() => setShowLogs(!showLogs)}>{showLogs ? "Hide logs" : "Show logs"}</button><button type="button" title="Log export needs a connected CI provider" disabled>Download</button></div>
            </div>
            {/* The log carried wall-clock timestamps and two commit-shaped digests
                (`ec5ffb7a…850c83`, `1855aea9…4ff`) plus counts of verified and
                untracked modules. None of it was measured, and a digest is the
                most audit-shaped fiction on the page. What is left is the SHAPE
                of the step — which checks run, in what order, and which one fails
                the promotion — with every figure removed rather than replaced. */}
            {showLogs ? (
              <pre className="log-viewer" aria-label="Illustrative pipeline log output"><code>verify local bundle against run_manifest.json{"\n"}<span className="log-ok">✓</span> implementation and output digests verified{"\n"}<span className="log-error">×</span> Git HEAD cannot reproduce the local bundle{"\n"}<span className="log-muted">  HEAD digest</span> not available — no repository provider connected{"\n"}<span className="log-muted">  manifest digest</span> not available — no artifact registry connected{"\n"}<span className="log-warn">!</span> manifest-bound modules are untracked at HEAD{"\n"}<span className="log-error">error</span> freeze a clean commit before promotion</code></pre>
            ) : null}
          </div>
        </article>
      </div>

      <article className="panel registry-panel">
        <div className="panel-header">
          <div><span className="panel-kicker">Content-addressed local outputs</span><h2>Strategy artifact registry</h2></div>
          <div className="registry-header-meta"><StatusPill label="Local snapshot" tone="warning" /><span>103 files · 22.1 MB</span></div>
        </div>
        <div className="registry-scroll">
          <div className="registry-table" role="table" aria-label="Strategy artifacts">
            <div className="registry-row registry-head" role="row"><span>Artifact</span><span>Evidence window</span><span>Lineage</span><span>Custody</span><span>Status</span></div>
            {/* The lineage cell held `570bd247…a22`, invented hex in a column
                whose own footer says the Git SHA is unavailable. */}
            <div className="registry-row" role="row"><span className="artifact-name"><i>CR</i><span><strong>Core research bundle</strong><small>v3.2.1 · 20 manifest-bound outputs</small></span></span><span>1977–2014</span><code>not available</code><span>Local · unsigned</span><StatusPill label="Blocked" tone="danger" /></div>
            <div className="registry-row" role="row"><span className="artifact-name"><i>VS</i><span><strong>Validation suite</strong><small>17 / 17 family · 10k bootstraps</small></span></span><span>1990–2014</span><code>seed 20260805</code><span>Research only</span><StatusPill label="Complete" tone="positive" /></div>
            <div className="registry-row" role="row"><span className="artifact-name"><i>BC</i><span><strong>Benchmark comparison</strong><small>13 complete · 0 errored</small></span></span><span>1990–2014</span><code>1k permutations</code><span>Descriptive only</span><StatusPill label="Complete" tone="positive" /></div>
            <div className="registry-row" role="row"><span className="artifact-name"><i>ETF</i><span><strong>ETF regime allocation</strong><small>11 symbols · sealed block</small></span></span><span>2006–2018</span><code>etf_regime_v1</code><span>Local · unbound</span><StatusPill label="Review" tone="warning" /></div>
            <div className="registry-row" role="row"><span className="artifact-name"><i>HO</i><span><strong>Holdout evaluation</strong><small>522 sessions · local custodian</small></span></span><span>2 years</span><code>12 / 59 roots</code><span>Does not clear gate</span><StatusPill label="Limited" tone="warning" /></div>
          </div>
        </div>
        <div className="registry-footer"><span>Creation time, Git SHA, signer, release URL and environment are unavailable.</span><button className="text-button" type="button" title="No artifact registry is connected" disabled>View fingerprints <span aria-hidden="true">→</span></button></div>
      </article>

      {actionOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActionOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sanity-title">
            <div className="modal-header"><div><span className="panel-kicker">Safe action preview</span><h2 id="sanity-title">Run synthetic sanity backtest</h2></div><button className="icon-button" type="button" onClick={() => setActionOpen(false)} aria-label="Close dialog">×</button></div>
            <div className="modal-alert">This workspace has no workflow dispatch endpoint. Confirming records a preview request only; it will not execute code.</div>
            <div className="form-grid">
              <label>Immutable commit<input readOnly value="Unavailable — no repository connected" /></label>
              <label>Dataset<input readOnly value="Synthetic vendor layout" /></label>
              <label>Bootstrap samples<input readOnly value="200" /></label>
              <label>Target environment<input readOnly value="CI sandbox" /></label>
            </div>
            <label className="reason-field">Reason<textarea defaultValue="Verify causality and canonical replay before bundle regeneration." /></label>
            <div className="modal-footer"><button className="button button-quiet" type="button" onClick={() => setActionOpen(false)}>Cancel</button><button className="button button-primary" type="button" onClick={queuePreview}>Record preview request</button></div>
          </div>
        </div>
      ) : null}
      {queued ? <div className="toast" role="status"><span>✓</span><div><strong>Preview request recorded</strong><p>Connect a CI command plane to execute this workflow.</p></div></div> : null}
    </section>
  );
}

function Interfaces() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(endpoints[1]);
  const [detailTab, setDetailTab] = useState<"Request" | "Response" | "Changes">("Changes");
  const filtered = endpoints.filter((endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.group}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="tab-panel" id="panel-interfaces" role="tabpanel" aria-labelledby="tab-interfaces">
      <div className="section-heading compact-heading">
        <div><span className="eyebrow">Contract intelligence</span><h1>API & Schema</h1></div>
        <div className="heading-actions"><StatusPill label="2 changes" tone="warning" /><button className="button button-secondary" type="button" disabled>Try in staging</button></div>
      </div>
      <div className="notice-bar"><span aria-hidden="true">i</span><p>Gateway contracts are preview fixtures. Connect an OpenAPI or AsyncAPI source to enable live discovery and request execution.</p></div>
      <div className="api-layout">
        <aside className="panel endpoint-panel">
          <div className="search-field"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search routes or services" aria-label="Search routes or services" /><kbd>⌘K</kbd></div>
          <div className="endpoint-summary"><span><strong>{endpoints.length}</strong> routes</span><span><strong>{endpointServiceCount}</strong> services</span><span><strong className="text-warning">{endpointChangeCount}</strong> changes</span></div>
          <div className="endpoint-list">
            {filtered.map((endpoint) => (
              <button type="button" key={`${endpoint.method}-${endpoint.path}`} className={`endpoint-item ${selected.path === endpoint.path ? "selected" : ""}`} onClick={() => setSelected(endpoint)}>
                <span className={`method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
                <span><strong>{endpoint.path}</strong><small>{endpoint.group}</small></span>
                {endpoint.drift !== "Unchanged" ? <i className={`drift-dot ${toneForStatus(endpoint.drift)}`} aria-label={`${endpoint.drift} schema`} /> : null}
              </button>
            ))}
          </div>
        </aside>
        <article className="panel schema-panel">
          <div className="schema-header">
            <div><div className="schema-path"><span className={`method method-${selected.method.toLowerCase()}`}>{selected.method}</span><code>{selected.path}</code><CopyButton value={selected.path} label="Copy endpoint" /></div><p>{selected.summary}</p></div>
            <div className="schema-health"><span>p95 latency</span><strong>{selected.latency}</strong><small>illustrative · not measured</small></div>
          </div>
          <div className="schema-meta"><span>Service <strong>{selected.group}</strong></span><span>Auth <strong>service token</strong></span><span>Baseline <strong>production@3.2.1</strong></span></div>
          <div className="inner-tabs" role="tablist" aria-label="Schema detail">
            {(["Request", "Response", "Changes"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={detailTab === item} onClick={() => setDetailTab(item)} className={detailTab === item ? "active" : ""}>{item}{item === "Changes" ? <span>2</span> : null}</button>)}
          </div>
          {detailTab === "Changes" ? (
            <div className="schema-change-content">
              <div className="change-banner"><div className="banner-icon small" aria-hidden="true">!</div><div><strong>Consumer-breaking change detected</strong><p>Compared with the last verified production schema.</p></div><StatusPill label="Breaking" tone="danger" /></div>
              <div className="contract-diff">
                <div className="diff-head"><span>Field</span><span>Production</span><span>Candidate</span><span>Impact</span></div>
                <div><code>orders[].limit_price</code><span>number | null</span><span>number</span><StatusPill label="Required" tone="danger" dot={false} /></div>
                <div><code>policy_digest</code><span>—</span><span>sha256</span><StatusPill label="Added" tone="positive" dot={false} /></div>
              </div>
              <div className="consumer-section"><div className="subsection-title"><h3>Affected consumers</h3><span>3 require acknowledgement</span></div><div className="consumer-grid"><div><span className="service-mark">PY</span><strong>execution-router</strong><small>Owner · Execution</small></div><div><span className="service-mark">TS</span><strong>order-console</strong><small>Owner · Trading tools</small></div><div><span className="service-mark">RS</span><strong>risk-probe</strong><small>Owner · Risk platform</small></div></div></div>
            </div>
          ) : (
            <div className="schema-code"><div className="code-head"><span>{detailTab === "Request" ? "application/json · request" : "200 · application/json"}</span><CopyButton value={detailTab === "Request" ? "{\n  \"orders\": [],\n  \"policy_digest\": \"sha256…\"\n}" : "{\n  \"status\": \"accepted\",\n  \"batch_id\": \"d1-…\"\n}"} label="Copy payload" /></div><pre><code>{detailTab === "Request" ? `{
  "orders": [
    {
      "symbol": "ESZ6",
      "quantity": 2,
      "limit_price": 6832.25
    }
  ],
  "policy_digest": "sha256:4f29…"
}` : `{
  "status": "accepted",
  "batch_id": "d1-7ac9c8…",
  "submitted_at": "2026-08-06T08:05:13Z"
}`}</code></pre></div>
          )}
        </article>
      </div>
    </section>
  );
}

function Changes() {
  const [selectedFile, setSelectedFile] = useState(driftFiles[0]);
  const [view, setView] = useState<"Unified" | "Side by side">("Unified");
  return (
    <section className="tab-panel" id="panel-changes" role="tabpanel" aria-labelledby="tab-changes">
      <div className="section-heading compact-heading">
        <div><span className="eyebrow">Repository evidence</span><h1>Code & Diffs</h1></div>
        <div className="heading-actions"><span className="source-chip"><i className="danger" /> Git reproducibility blocked</span><button className="button button-secondary" type="button" title="No repository provider is connected" disabled>Open repository ↗</button></div>
      </div>
      <div className="notice-bar"><span aria-hidden="true">i</span><p>No repository provider is connected, so the hunks below are illustrative rather than fetched. The file list reflects the drift recorded in the local readiness snapshot; the line-level content does not.</p></div>
      <div className="code-layout">
        <aside className="panel file-panel">
          <div className="file-panel-header"><div><h2>HEAD divergence</h2><span>8 manifest-bound files differ from Git</span></div><StatusPill label="8" tone="danger" dot={false} /></div>
          <div className="tree-path"><span>delta1_strategy</span><span>/</span><span>src</span></div>
          <div className="file-list">
            {driftFiles.map((file) => <button type="button" key={file.name} className={selectedFile.name === file.name ? "selected" : ""} onClick={() => setSelectedFile(file)}><span className={`file-change ${file.kind.toLowerCase()}`}>{file.kind === "Changed" ? "M" : "A"}</span><span><strong>{file.name}</strong><small>{file.detail}</small></span><span aria-hidden="true">›</span></button>)}
          </div>
        </aside>
        <article className="panel diff-panel">
          <div className="diff-toolbar">
            <div><div className="diff-title"><span className={`file-change ${selectedFile.kind.toLowerCase()}`}>{selectedFile.kind === "Changed" ? "M" : "A"}</span><code>src/delta1_strategy/{selectedFile.name}</code><CopyButton value={`src/delta1_strategy/${selectedFile.name}`} label="Copy file path" /></div><p>{selectedFile.detail} · release bundle 3.2.1</p></div>
            <div className="segmented-control">{(["Unified", "Side by side"] as const).map((item) => <button type="button" key={item} onClick={() => setView(item)} className={view === item ? "active" : ""}>{item}</button>)}</div>
          </div>
          <div className={`diff-view ${view === "Side by side" ? "side-by-side" : ""}`} role="table" aria-label={`Code difference for ${selectedFile.name}`}>
            {selectedFile.kind === "Changed" ? (
              <>
                <div className="diff-context"><span>@@</span><code>bootstrap_confidence_interval(values, samples, seed)</code></div>
                <div className="diff-line removed"><span className="line-num">142</span><span className="change-sign">−</span><code>rng = np.random.default_rng(seed)</code><span className="sr-only">Removed line 142</span></div>
                <div className="diff-line added"><span className="line-num">142</span><span className="change-sign">+</span><code>{'rng = _stable_generator(seed, stream="bootstrap")'}</code><span className="sr-only">Added line 142</span></div>
                <div className="diff-line"><span className="line-num">143</span><span className="change-sign"> </span><code>draws = rng.choice(values, size=(samples, len(values)))</code></div>
                <div className="diff-line"><span className="line-num">144</span><span className="change-sign"> </span><code>return np.quantile(draws.mean(axis=1), [0.025, 0.975])</code></div>
                <div className="diff-context"><span>@@</span><code>selection_adjusted_p_value(statistic, trials)</code></div>
                <div className="diff-line added"><span className="line-num">238</span><span className="change-sign">+</span><code>if declared_family_size is None:</code></div>
                <div className="diff-line added"><span className="line-num">239</span><span className="change-sign">+</span><code>{'    return NotEstimable("unrecoverable trial count")'}</code></div>
              </>
            ) : (
              <>
                <div className="diff-context"><span>@@</span><code>manifest-bound file · untracked at Git HEAD</code></div>
                <div className="diff-line added"><span className="line-num">1</span><span className="change-sign">+</span><code>{'"""Post-audit research module with fail-closed outputs."""'}</code></div>
                <div className="diff-line added"><span className="line-num">2</span><span className="change-sign">+</span><code>from __future__ import annotations</code></div>
                <div className="diff-line added"><span className="line-num">3</span><span className="change-sign">+</span><code>from dataclasses import dataclass</code></div>
                <div className="diff-line added"><span className="line-num">4</span><span className="change-sign">+</span><code>import pandas as pd</code></div>
                <div className="diff-line added"><span className="line-num">5</span><span className="change-sign">+</span><code>{'PASS = "PASS"'}</code></div>
              </>
            )}
          </div>
          {/* Both digests were invented hex. The README promises the diffs carry no
              commit hash; these were the two that made that promise false. */}
          <div className="diff-footer"><div><span>Git HEAD digest</span><code>{selectedFile.kind === "Changed" ? "not available" : "not tracked"}</code></div><div><span>Manifest digest</span><code>{selectedFile.kind === "Changed" ? "not available" : "verified locally"}</code></div><button className="button button-primary" type="button" disabled>Freeze clean commit</button></div>
        </article>
      </div>
    </section>
  );
}

function Tasks({ onOpenChanges }: { onOpenChanges: () => void }) {
  const [severity, setSeverity] = useState<"All" | "Critical" | "High" | "Medium">("All");
  const [selectedTask, setSelectedTask] = useState<WorkItem | null>(null);
  const visibleTasks = workItems.filter((task) => severity === "All" || task.severity === severity);
  return (
    <section className="tab-panel" id="panel-tasks" role="tabpanel" aria-labelledby="tab-tasks">
      <div className="section-heading compact-heading">
        <div><span className="eyebrow">Engineering impact</span><h1>Task Queue</h1></div>
        <div className="heading-actions"><div className="segmented-control">{(["All", "Critical", "High", "Medium"] as const).map((item) => <button type="button" key={item} className={severity === item ? "active" : ""} onClick={() => setSeverity(item)}>{item}</button>)}</div></div>
      </div>
      <div className="queue-summary">
        <div><span className="summary-icon danger">!</span><span><strong>5 critical workstreams</strong><small>Prevent launch authorization</small></span></div>
        <div><span className="summary-icon warning">↗</span><span><strong>17 evidence gates</strong><small>All require external verification</small></span></div>
        <div><span className="summary-icon neutral">○</span><span><strong>5 unassigned groups</strong><small>No issue tracker connected</small></span></div>
      </div>
      <div className="panel task-table-panel">
        <div className="task-table-head"><span>Work item</span><span>Source</span><span>Owner</span><span>Status</span><span>Age</span><span /></div>
        <div className="task-rows">
          {visibleTasks.map((task) => (
            <button type="button" key={task.id} className="task-row" onClick={() => setSelectedTask(task)}>
              <span className="task-title"><StatusPill label={task.severity} dot={false} /><span><strong>{task.title}</strong><small>{task.id} · {task.context}</small></span></span>
              <span>{task.source}</span><span>{task.owner}</span><span><StatusPill label={task.status} /></span><span>{task.age}</span><span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
      <div className="queue-footer"><span>Showing {visibleTasks.length} derived engineering-impact groups</span><span>Local readiness snapshot · 06 Aug 2026, 16:14 SGT</span></div>
      {selectedTask ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTask(null); }}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="task-title">
            <div className="drawer-header"><div><span className="panel-kicker">{selectedTask.id}</span><h2 id="task-title">{selectedTask.title}</h2></div><button className="icon-button" type="button" aria-label="Close task details" onClick={() => setSelectedTask(null)}>×</button></div>
            <div className="drawer-status"><StatusPill label={selectedTask.severity} dot={false} /><StatusPill label={selectedTask.status} /></div>
            <div className="drawer-section"><h3>Why this matters</h3><p>{selectedTask.context}. This item is linked directly to its originating operational evidence so ownership and resolution remain traceable.</p></div>
            <div className="drawer-facts"><div><span>Source</span><strong>{selectedTask.source}</strong></div><div><span>Owner</span><strong>{selectedTask.owner}</strong></div><div><span>Environment</span><strong>Repository / CI</strong></div><div><span>Last verified</span><strong>06 Aug · 16:14 SGT</strong></div></div>
            <div className="drawer-section"><h3>Linked evidence</h3><button className="linked-evidence" type="button" onClick={() => { setSelectedTask(null); onOpenChanges(); }}><span className="service-mark">DI</span><span><strong>Implementation drift report</strong><small>8 files · bundle 3.2.1</small></span><span aria-hidden="true">↗</span></button></div>
            <div className="drawer-footer"><button type="button" className="button button-secondary" title="No issue tracker is connected" disabled>Open in tracker ↗</button><button type="button" className="button button-primary" disabled>Mark resolved</button></div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const syncFromHash = () => {
      const value = window.location.hash.replace("#", "") as TabId;
      if (tabs.some((tab) => tab.id === value)) setActiveTab(value);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const openTab = (tab: TabId) => {
    setActiveTab(tab);
    window.history.pushState(null, "", `#${tab}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      openTab(tabs[nextIndex].id);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  let content;
  if (activeTab === "pipelines") content = <Pipelines />;
  else if (activeTab === "interfaces") content = <Interfaces />;
  else if (activeTab === "changes") content = <Changes />;
  else if (activeTab === "tasks") content = <Tasks onOpenChanges={() => openTab("changes")} />;
  else content = <Overview onOpenDrift={() => openTab("changes")} onOpenPipelines={() => openTab("pipelines")} />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className={`global-sidebar ${sidebarOpen ? "open" : ""}`} aria-label="AlphaEngine navigation">
        <div className="brand-mark" aria-label="AlphaEngine"><span>α</span></div>
        <nav className="global-nav">
          <button type="button"><span aria-hidden="true">⌂</span><small>Home</small></button>
          <button type="button"><span aria-hidden="true">⌁</span><small>Research</small></button>
          <button type="button"><span aria-hidden="true">⇄</span><small>Execution</small></button>
          <button type="button"><span aria-hidden="true">◇</span><small>Risk</small></button>
          <button className="active" type="button" aria-current="page"><span aria-hidden="true">⌘</span><small>Developer</small></button>
        </nav>
        <div className="sidebar-bottom"><button type="button" aria-label="Notifications"><span aria-hidden="true">◌</span><i /></button><div className="avatar" title="Ian">ID</div></div>
      </aside>

      <div className="workspace">
        <header className="workspace-header">
          <div className="title-group"><button className="mobile-menu" type="button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle application menu">☰</button><div><span className="product-name">AlphaEngine</span><strong>Developer</strong></div></div>
          <div className="global-context" aria-label="Current developer context">
            <div><span>Repository</span><strong>delta1_strategy</strong></div><i />
            <div><span>Revision</span><strong><code>unbound</code></strong></div><i />
            <div><span>Environment</span><strong>Local research</strong></div><i />
            <div><span>Artifact</span><strong>engine 3.2.1</strong></div>
          </div>
          <div className="header-actions"><span className="data-mode"><i /> Snapshot</span><button className="command-button" type="button"><span aria-hidden="true">⌕</span><span>Search</span><kbd>⌘ K</kbd></button><button className="icon-button" type="button" aria-label="Open settings">•••</button></div>
        </header>

        <div className="context-alert">
          <div><span className="context-status danger">Production blocked</span><span>External evidence 0/17</span><span>Git provenance unbound</span></div>
          <div><span>Source: local snapshot</span><time dateTime="2026-08-06T16:14:00+08:00">06 Aug 2026 · 16:14 SGT</time></div>
        </div>

        <div className="subtab-nav" role="tablist" aria-label="Developer sections">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => openTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              ref={(element) => { tabRefs.current[index] = element; }}
            >
              {tab.label}{tab.count ? <span>{tab.count}</span> : null}
            </button>
          ))}
        </div>

        <main id="main-content" className="main-content">{content}</main>
      </div>
    </div>
  );
}
