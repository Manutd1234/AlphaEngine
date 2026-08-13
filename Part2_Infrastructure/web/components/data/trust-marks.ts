/**
 * The marks the data-trust panels share.
 *
 * Typographic glyphs, never emoji: they inherit the surrounding text colour and
 * render in the app's own font, so they survive a theme switch and a greyscale
 * print. Split out of `DataTrustOverview` so the panels beside it can use the
 * same vocabulary without importing their own parent.
 */

import type { RouteState } from "@/components/systems/types";
import type { DataTrustTone } from "@/lib/data-trust";

export const TONE_GLYPH: Record<DataTrustTone, string> = {
  good: "●",
  warn: "▲",
  bad: "✕",
  unknown: "◌",
};

/**
 * Fills for the six route states.
 *
 * `--status-*` carries every state that IS a verdict — routable, quota spent,
 * circuit open — and grey carries "never configured", which is an absence
 * rather than a fault. The two remaining states borrow series colours because
 * there are only three status roles and these two are not faults either: a
 * reserved quota is the reserve doing its job, and a simulated outage is an
 * operator drill. `--series-3` is deliberately unused here: it is an aqua a
 * shade off `--status-good`, and the one thing this chart must never do is blur
 * "routable" into "held back".
 */
export const ROUTE_STATE_FILL: Record<RouteState, string> = {
  ready: "var(--status-good)",
  quota_reserved: "var(--series-1)",
  quota_exhausted: "var(--status-warning)",
  circuit_open: "var(--status-critical)",
  simulated_outage: "var(--series-2)",
  not_configured: "var(--axis)",
};

/** Short enough to stack several into one row note without wrapping. */
export const ROUTE_STATE_WORD: Record<RouteState, string> = {
  ready: "ready",
  quota_reserved: "reserved",
  quota_exhausted: "quota spent",
  circuit_open: "circuit open",
  simulated_outage: "drill",
  not_configured: "no key",
};
