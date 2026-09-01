"use client";

import Figure from "./Figure";
import styles from "./ChannelStates.module.css";

export interface ChannelStateRow {
  state: string;
  mark: string;
  word: string;
  means: string;
}

interface TraceStep {
  name: string;
  status: string;
  detail: string;
  tone: "verified" | "current" | "pending";
}

const COMPLETED = new Set(["empty", "requests_only", "available"]);
const ACCESS_STATES = new Set(["account_required", "membership_required"]);

function requestTrace(current: string, result: ChannelStateRow): TraceStep[] {
  const accessHeld = ACCESS_STATES.has(current);
  const signingHeld = current === "signing_unavailable";
  const transportHeld = current === "unavailable";
  const venueRefused = current === "refused";
  const completed = COMPLETED.has(current);

  return [
    {
      name: "Gateway route",
      status: "Verified",
      detail: "The same-origin RFQ route answered this browser request.",
      tone: "verified",
    },
    {
      name: "Account policy",
      status: accessHeld ? "Action required" : signingHeld ? "Not evaluated" : "Verified",
      detail: accessHeld
        ? result.means
        : signingHeld
          ? "A signer must be selected before account policy can be evaluated."
          : "The request passed the application access boundary.",
      tone: accessHeld ? "current" : signingHeld ? "pending" : "verified",
    },
    {
      name: "Signed transport",
      status: accessHeld || signingHeld ? "Not sent" : transportHeld ? "Interrupted" : "Verified",
      detail: accessHeld
        ? "No private venue request was dispatched; access stopped it safely."
        : signingHeld
          ? "No signed request was dispatched."
          : transportHeld
            ? "The bounded REST request did not complete on this poll."
            : "REST signing and transport completed.",
      tone: accessHeld || signingHeld || transportHeld ? (transportHeld ? "current" : "pending") : "verified",
    },
    {
      name: "Venue response",
      status: completed ? "Verified" : venueRefused ? "Response received" : "Not reached",
      detail: completed
        ? "The venue returned an account-visible RFQ response."
        : venueRefused
          ? "The venue answered and declined the supplied credentials."
          : "No venue response is claimed for a stage this read did not reach.",
      tone: completed ? "verified" : venueRefused ? "current" : "pending",
    },
    {
      name: "Maker result",
      status: completed ? result.word : "Pending",
      detail: completed ? result.means : "A maker count is shown only after a completed private read.",
      tone: completed ? "verified" : "pending",
    },
  ];
}

/** A readable request trace. Policy stops, network stops and empty results stay distinct. */
export default function ChannelStates({ states, current, openRequests }: {
  states: ReadonlyArray<ChannelStateRow>;
  current: string;
  openRequests: number | null;
}) {
  const result = states.find((row) => row.state === current) ?? {
    state: current,
    mark: "◌",
    word: `State ${current}`,
    means: "This gateway state is not yet described by the pane.",
  };
  const trace = requestTrace(current, result);
  const completed = COMPLETED.has(current);

  return (
    <Figure
      caption="Authenticated RFQ REST-poll outcome map"
      ariaLabel={`Five-stage RFQ request trace. This read ended at ${result.word}.`}
      readout={<span className="num">{result.word}</span>}
      reading={
        completed
          ? `The gateway, access policy, signed transport and venue response all completed. ${result.means}`
          : `${result.means} Later stages are marked not reached instead of being reported as failed connections.`
      }
    >
      <ol className={styles.trace} aria-label="RFQ request stages">
        {trace.map((step, index) => (
          <li key={step.name} className={styles.step} data-tone={step.tone}>
            <span className={styles.number} aria-hidden="true">{index + 1}</span>
            <div className={styles.stepBody}>
              <span className={styles.stage}>{step.name}</span>
              <strong>{step.status}</strong>
              <small>{step.detail}</small>
            </div>
          </li>
        ))}
      </ol>

      <dl className={styles.readout}>
        <div>
          <dt>Outcome</dt>
          <dd><span aria-hidden="true">{result.mark}</span> {result.word}</dd>
        </div>
        <div>
          <dt>Open requests</dt>
          <dd className={openRequests == null ? undefined : "num"}>
            {openRequests == null ? "Not measured" : openRequests}
          </dd>
        </div>
        <div>
          <dt>Connection claim</dt>
          <dd>{completed ? "Bounded REST read verified" : "Only completed stages are verified"}</dd>
        </div>
      </dl>
    </Figure>
  );
}
