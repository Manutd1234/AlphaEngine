/**
 * The five posture words, and the tile tone each of them earns.
 *
 * Both of these existed twice, verbatim: once in `ReliabilityConsole` for the
 * chrome tiles and once in `ReliabilityPlatform` for the three plane tiles. Two
 * copies of a five-entry map is the cheapest possible drift — rename "Trading
 * halted" in one and the same posture reads two different ways one card apart,
 * with nothing failing anywhere. They were lifted here when the Remediation
 * rail grew its fifth pane and the console needed the lines back; the
 * de-duplication is the part worth keeping.
 *
 * `unknown` is a WORD here and never a blank. A posture that has not been read
 * is a finding, and the tile that shows it is toned `warn` rather than
 * `neutral` for the same reason: not knowing whether the trading path is up is
 * not the same as knowing it is fine.
 */

import type { ConsoleTile } from "@/components/systems/ConsoleChrome";
import type { ReliabilityStatus } from "@/lib/reliability";

export const POSTURE_LABEL: Record<ReliabilityStatus, string> = {
  nominal: "Nominal",
  degraded: "Degraded",
  critical: "Critical",
  halted: "Trading halted",
  unknown: "Unknown",
};

export function postureTone(status: ReliabilityStatus | undefined): ConsoleTile["tone"] {
  if (status === "critical" || status === "halted") return "bad";
  if (status === "degraded" || status === "unknown") return "warn";
  if (status === "nominal") return "good";
  return "neutral";
}
