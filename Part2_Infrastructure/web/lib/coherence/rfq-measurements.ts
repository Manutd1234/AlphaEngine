import type { CoherenceRfqPanel } from "./types-lab";

/** Only a completed private read can turn zero open requests into a measurement. */
export function measuredOpenRequests(
  panel: Pick<CoherenceRfqPanel, "state" | "open_requests">,
): number | null {
  return panel.state === "empty" || panel.state === "available" ? panel.open_requests : null;
}
