/**
 * What each leg's basis IS, and where it came from.
 *
 * One copy, read by the waterfall and by the table beside it. They were one
 * file until the chart moved through `Figure`/`Plot`; two copies of a
 * vocabulary is how the two readings start disagreeing about the same leg.
 */

import type { PnlLeg } from "@/lib/pnl-attribution";

export const BASIS_WORD: Record<PnlLeg["basis"], string> = {
  measured: "measured",
  audited: "audited",
  derived: "derived",
  generated: "generated",
  withheld: "not measurable",
};

export const BASIS_SOURCE: Record<PnlLeg["basis"], string> = {
  measured: "Daily bars + measured beta",
  audited: "Audit log, this session only",
  derived: "Arithmetic on the legs above",
  generated: "Sandbox fixture",
  withheld: "—",
};
