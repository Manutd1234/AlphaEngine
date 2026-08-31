"use client";

/**
 * An inspectable proof woven from the certificate's structured solver evidence.
 *
 * This component deliberately does not rebuild a proof from the quote table. A
 * quote-side inequality and a HiGHS state row are different objects; presenting
 * one as the other was the reason the old four-card walkthrough could disagree
 * with the certificate while still looking authoritative.
 */

import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";

import { countLabel, decimalLabel, statValue } from "@/lib/coherence/decimals";
import type {
  CoherenceCertificate,
  CoherenceEventView,
  CoherenceProofConstraintRow,
  CoherenceProofEvidence,
} from "@/lib/coherence/types";

import Figure, { FigureEmpty } from "./Figure";

type StageState = "holds" | "flagged" | "partial";

interface ProofMetric {
  label: string;
  value: string;
}

interface ProofStage {
  key: "observation" | "system" | "boundary" | "verdict";
  title: string;
  value: string;
  note: string;
  detail: string;
  metrics: ProofMetric[];
  state: StageState;
}

const money = (raw: string | null | undefined): string => decimalLabel(raw, 6);

function verdictState(verdict: string): StageState {
  if (verdict === "incoherent") return "flagged";
  if (verdict === "untestable") return "partial";
  return "holds";
}

function comparisonWord(optimum: string | null, boundary: string): string {
  const optimumValue = statValue(optimum);
  const boundaryValue = statValue(boundary);
  if (optimumValue == null || boundaryValue == null) return "not comparable";
  if (optimumValue > boundaryValue) return "above boundary";
  if (optimumValue < boundaryValue) return "below boundary";
  return "on boundary";
}

function tightestNamedRow(rows: CoherenceProofConstraintRow[]): CoherenceProofConstraintRow | null {
  let tightest: CoherenceProofConstraintRow | null = null;
  let tightestSlack = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!row.testable) continue;
    const slack = statValue(row.slack);
    if (slack == null || slack >= tightestSlack) continue;
    tightest = row;
    tightestSlack = slack;
  }
  return tightest;
}

function proofStages(
  evidence: CoherenceProofEvidence,
  certificate: CoherenceCertificate,
): ProofStage[] {
  const { observation, solver, constraints } = evidence;
  const namedTightest = tightestNamedRow(constraints.rows);
  const readableSides = observation.executable_buy_sides == null || observation.executable_sell_sides == null
    ? null
    : observation.executable_buy_sides + observation.executable_sell_sides;
  const quotedState: StageState = readableSides != null && readableSides > 0 ? "holds" : "partial";
  const solverState: StageState = solver.optimum == null && solver.verdict !== "untestable"
    ? "partial"
    : verdictState(solver.verdict);

  return [
    {
      key: "observation",
      title: "Observed vector",
      value: `${countLabel(observation.markets_observed)} markets`,
      note: `${countLabel(observation.executable_buy_sides)} buy and ${countLabel(observation.executable_sell_sides)} sell sides`,
      detail: "The proof begins with the market books attached to this exact certificate. Missing quote sides remain missing; the loom never substitutes a sample quote.",
      metrics: [
        { label: "Markets in read", value: countLabel(observation.markets_observed) },
        { label: "Markets in event", value: countLabel(observation.markets_in_event) },
        { label: "Component outcomes", value: countLabel(observation.outcomes_in_component) },
        { label: "Executable sides", value: countLabel(readableSides) },
      ],
      state: quotedState,
    },
    {
      key: "system",
      title: "Solver system",
      value: `${countLabel(solver.variables)} variables`,
      note: `${countLabel(solver.state_rows)} payoff states, ${solver.engine}`,
      detail: "The engine turns executable quote sides into decision variables, then tests their combined payoff across the states generated for this component.",
      metrics: [
        { label: "Engine", value: solver.engine },
        { label: "Decision variables", value: countLabel(solver.variables) },
        { label: "State rows", value: countLabel(solver.state_rows) },
        { label: "Named checks", value: countLabel(constraints.tested) },
      ],
      state: solverState,
    },
    {
      key: "boundary",
      title: "Decision boundary",
      value: money(solver.optimum),
      note: `${comparisonWord(solver.optimum, solver.decision_boundary)}; boundary ${money(solver.decision_boundary)}`,
      detail: solver.optimum == null
        ? "This engine returned no optimum, so the proof preserves the gap instead of drawing a synthetic mark at zero."
        : "The signed optimum is the solver statistic the verdict is read from. The nearby named constraint is separate explanatory evidence, not a substitute LP row.",
      metrics: [
        { label: solver.optimum_kind || "Solver optimum", value: money(solver.optimum) },
        { label: "Decision boundary", value: money(solver.decision_boundary) },
        { label: "Tightest named check", value: namedTightest ? money(namedTightest.slack) : "—" },
        { label: "Untestable named checks", value: countLabel(constraints.untestable) },
      ],
      state: solverState,
    },
    {
      key: "verdict",
      title: "Solver verdict",
      value: solver.verdict,
      note: certificate.worth_doing ? "executable after fees" : "no fee-surviving trade",
      detail: certificate.because
        ? `${certificate.because}.`
        : "The certificate carries the verdict but returned no explanatory sentence; the structured measurements above remain the auditable proof path.",
      metrics: [
        { label: "Verdict", value: solver.verdict },
        { label: "Scope", value: certificate.scope },
        { label: "Legs returned", value: countLabel(certificate.legs.length) },
        { label: "Worth doing", value: certificate.worth_doing ? "yes" : "no" },
      ],
      state: verdictState(solver.verdict),
    },
  ];
}

function threadPath(index: number, count: number, selectedStage: number): string {
  const spread = Math.min(78, Math.max(30, count * 6));
  const offset = count === 1 ? 0 : -spread / 2 + (spread * index) / (count - 1);
  const selectionLift = (selectedStage - 1.5) * 3;
  return [
    `M 36 ${112 + offset}`,
    `C 150 ${112 + offset}, 170 ${94 - offset * 0.2}, 286 ${100 - offset * 0.34}`,
    `S 438 ${126 + offset * 0.32}, 548 ${112 + selectionLift}`,
    `S 720 ${88 - offset * 0.26}, 824 ${104 + offset * 0.2}`,
    `S 918 ${112 + offset * 0.08}, 970 ${112}`,
  ].join(" ");
}

function BoundaryAxis({ evidence }: { evidence: CoherenceProofEvidence }) {
  const optimum = statValue(evidence.solver.optimum);
  const boundary = statValue(evidence.solver.decision_boundary);
  const optimumMagnitude = optimum == null ? 0 : Math.abs(optimum);
  const boundaryMagnitude = boundary == null ? 0 : Math.abs(boundary);
  const magnitude = Math.max(optimumMagnitude, boundaryMagnitude, Number.EPSILON);
  const marker = optimum == null ? null : 50 + (optimum / magnitude) * 42;
  const boundaryMarker = boundary == null ? null : 50 + (boundary / magnitude) * 42;

  return (
    <div className="coh-proof-boundary" aria-label="Solver optimum against its decision boundary">
      <div className="coh-proof-boundary__track" aria-hidden="true">
        <span className="coh-proof-boundary__zero" />
        {boundaryMarker == null ? null : (
          <span className="coh-proof-boundary__threshold" style={{ "--proof-axis-x": `${boundaryMarker}%` } as CSSProperties} />
        )}
        {marker == null ? null : (
          <span className="coh-proof-boundary__mark" style={{ "--proof-axis-x": `${marker}%` } as CSSProperties} />
        )}
      </div>
      <div className="coh-proof-boundary__labels">
        <span>negative</span>
        <strong className="num">{`optimum ${money(evidence.solver.optimum)}`}</strong>
        <span>positive</span>
      </div>
    </div>
  );
}

function NamedConstraint({ row }: { row: CoherenceProofConstraintRow | null }) {
  if (!row) return null;
  return (
    <aside className="coh-proof-named-row" data-state={row.violated ? "flagged" : "holds"}>
      <span className="eyebrow">Closest named check</span>
      <strong>{row.family}</strong>
      <span>{row.because}</span>
      <span className="num">{`room ${money(row.slack)}, ${row.legs.length} legs`}</span>
    </aside>
  );
}

export default function SolverProofLoom({ certificate, event }: {
  certificate: CoherenceCertificate;
  event: CoherenceEventView | null;
}) {
  const [selectedStage, setSelectedStage] = useState(0);
  const gradientId = useId().replaceAll(":", "");
  const evidence = certificate.proof_evidence;

  if (!evidence) {
    return (
      <Figure
        caption="Observation → solver system → decision boundary → verdict"
        ariaLabel={`No structured solver proof was returned for ${certificate.family || event?.event_ticker || "this family"}`}
        missing="The certificate endpoint returned no structured proof evidence. This view will not manufacture one from frontend quote checks."
        reserveInteractionRow={false}
      >
        <FigureEmpty reason="The solver evidence needed to draw this proof is unavailable." />
      </Figure>
    );
  }

  const stages = proofStages(evidence, certificate);
  const stageXs = stages.map((_, index) => 84 + index * (832 / (stages.length - 1)));
  const visualThreadCount = Math.max(1, Math.min(13, evidence.observation.outcomes_in_component));
  const selected = stages[selectedStage];
  const tightest = tightestNamedRow(evidence.constraints.rows);
  const missingObservations = evidence.observation.markets_in_event == null
    ? "The observation did not report how many markets belonged to the event."
    : null;
  const unavailableSolverDimensions = evidence.solver.variables == null || evidence.solver.state_rows == null
    ? "This engine did not expose a complete matrix shape; unavailable dimensions stay blank."
    : null;

  const selectFromKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = stages.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: Math.min(last, index + 1),
      ArrowDown: Math.min(last, index + 1),
      ArrowLeft: Math.max(0, index - 1),
      ArrowUp: Math.max(0, index - 1),
      Home: 0,
      End: last,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = moves[event.key];
    setSelectedStage(next);
    event.currentTarget.closest("ol")
      ?.querySelectorAll<HTMLButtonElement>("button")[next]
      ?.focus();
  };

  return (
    <Figure
      caption="Observation → solver system → decision boundary → verdict"
      ariaLabel={
        `${certificate.family || event?.event_ticker || "Selected family"}: ${countLabel(evidence.solver.variables)} solver variables, `
        + `${countLabel(evidence.solver.state_rows)} state rows, optimum ${money(evidence.solver.optimum)}, verdict ${evidence.solver.verdict}`
      }
      reading={
        `The ${evidence.solver.engine} run placed its ${evidence.solver.optimum_kind || "optimum"} at ${money(evidence.solver.optimum)}, `
        + `${comparisonWord(evidence.solver.optimum, evidence.solver.decision_boundary)} ${money(evidence.solver.decision_boundary)}, and returned ${evidence.solver.verdict}.`
      }
      missing={missingObservations}
      notes={[
        unavailableSolverDimensions,
        `${evidence.constraints.tested} named closed-form checks accompany the proof; they explain quote arithmetic but are not relabelled as the LP's ${countLabel(evidence.solver.state_rows)} state rows.`,
      ].filter((note): note is string => Boolean(note))}
      readout={
        <span className="num">
          {`${evidence.solver.engine}, ${countLabel(evidence.solver.variables)}×${countLabel(evidence.solver.state_rows)}, ${money(evidence.solver.optimum)}`}
        </span>
      }
      reserveInteractionRow={false}
    >
      <div className="coh-proof-flow">
        <div className="coh-proof-loom">
          <svg viewBox="0 0 1000 224" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--series-2)" stopOpacity=".35" />
                <stop offset=".52" stopColor="var(--series-1)" stopOpacity=".82" />
                <stop offset="1" stopColor="var(--status-good)" stopOpacity=".5" />
              </linearGradient>
            </defs>
            <path className="coh-proof-loom__spine" d="M 34 112 C 260 112, 308 92, 500 112 S 760 132, 972 112" />
            {Array.from({ length: visualThreadCount }, (_, index) => (
              <path
                className="coh-proof-loom__thread"
                data-active={index % stages.length === selectedStage ? "true" : "false"}
                d={threadPath(index, visualThreadCount, selectedStage)}
                key={index}
                stroke={`url(#${gradientId})`}
                style={{ "--proof-delay": `${index * -90}ms` } as CSSProperties}
              />
            ))}
            {stageXs.map((x, index) => (
              <g className="coh-proof-loom__gate" data-state={stages[index].state} data-active={selectedStage === index ? "true" : "false"} key={stages[index].key}>
                <circle className="coh-proof-loom__orbit" cx={x} cy="112" r={selectedStage === index ? 35 : 27} />
                <circle className="coh-proof-loom__core" cx={x} cy="112" r="8" />
                <text x={x} y="116" textAnchor="middle">{index + 1}</text>
              </g>
            ))}
          </svg>

          <ol className="coh-proof-loom__stages" aria-label="Live solver proof stages">
            {stages.map((stage, index) => (
              <li style={{ "--proof-node-x": `${stageXs[index] / 10}%` } as CSSProperties} key={stage.key}>
                <button
                  type="button"
                  aria-pressed={selectedStage === index}
                  onPointerEnter={() => setSelectedStage(index)}
                  onFocus={() => setSelectedStage(index)}
                  onClick={() => setSelectedStage(index)}
                  onKeyDown={(event) => selectFromKey(event, index)}
                >
                  <span>{stage.title}</span>
                  <strong className="num">{stage.value}</strong>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <output className="coh-proof-path__inspector" aria-live="polite" aria-atomic="true">
          <div className="coh-proof-path__inspector-head">
            <div>
              <span className="eyebrow">{`Live stage ${selectedStage + 1} of ${stages.length}`}</span>
              <h4>{selected.title}</h4>
            </div>
            <strong className="num">{selected.value}</strong>
          </div>
          <p>{selected.detail}</p>
          <dl className="coh-proof-path__metrics">
            {selected.metrics.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd className="num">{metric.value}</dd>
              </div>
            ))}
          </dl>
          {selected.key === "boundary" ? <BoundaryAxis evidence={evidence} /> : null}
          {selected.key === "boundary" ? <NamedConstraint row={tightest} /> : null}
          <small>{selected.note}. Hover, focus, or use arrow keys to move through the run.</small>
        </output>

        {evidence.constraints.rows.length ? (
          <details className="disclosure coh-proof-constraints">
            <summary>{`All ${evidence.constraints.rows.length} solver-attached named checks`}</summary>
            <div
              className="table-wrap"
              role="region"
              aria-label={`All ${evidence.constraints.rows.length} solver-attached named checks`}
              tabIndex={0}
            >
              <table className="coh-table">
                <caption className="coh-table__caption">
                  Exact quote arithmetic returned beside the solver run; these rows explain it without being relabelled as LP states.
                </caption>
                <thead>
                  <tr><th scope="col">Check</th><th scope="col">Reason</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Bound</th><th scope="col" className="num">Room</th><th scope="col">Result</th></tr>
                </thead>
                <tbody>
                  {evidence.constraints.rows.map((row, index) => (
                    <tr key={`${row.family}-${row.scope}-${index}`}>
                      <th scope="row">{row.family}</th>
                      <td>{row.because}</td>
                      <td className="num">{money(row.cost)}</td>
                      <td className="num">{money(row.bound)}</td>
                      <td className="num">{money(row.slack)}</td>
                      <td>{row.testable ? row.violated ? "Violated" : "Holds" : row.untestable_reason || "Untestable"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </div>
    </Figure>
  );
}
