/**
 * The rails, as `lib/sections` defines them.
 *
 * `readLocation` resets a hash naming a section that is not on its workspace's
 * rail back to that workspace's default, so a cross-link pointing at an id
 * `lib/sections` does not define still navigates, still animates and still
 * renders a full panel — just not the one it named. That is the house's own
 * failure mode: green, plausible, and wrong.
 *
 * So every destination measured anywhere in the desk-interconnect suites is
 * checked against this map, which is built from the single source the rails,
 * the palette and the hash whitelist all read.
 */

import {
  DATA_SECTION_IDS,
  COHERENCE_SECTION_IDS,
  MARKETS_SECTION_IDS,
  DEVELOPER_SECTION_IDS,
  DIFFUSION_SECTION_IDS,
  EXECUTION_SECTION_IDS,
  OVERVIEW_SECTION_IDS,
  PORTFOLIO_SECTION_IDS,
  RELIABILITY_SECTION_IDS,
  RESEARCH_SECTION_IDS,
  RISK_SECTION_IDS,
} from "../../lib/sections";

/** Every section id the desk ships, by workspace — the rails themselves. */
export const RAILS: Record<string, readonly string[]> = {
  overview: OVERVIEW_SECTION_IDS,
  research: RESEARCH_SECTION_IDS,
  live: EXECUTION_SECTION_IDS,
  portfolio: PORTFOLIO_SECTION_IDS,
  risk: RISK_SECTION_IDS,
  data: DATA_SECTION_IDS,
  reliability: RELIABILITY_SECTION_IDS,
  developer: DEVELOPER_SECTION_IDS,
  markets: MARKETS_SECTION_IDS,
  coherence: COHERENCE_SECTION_IDS,
  diffusion: DIFFUSION_SECTION_IDS,
};

export function isRealLocation(view: string, section: string): boolean {
  return RAILS[view]?.includes(section) ?? false;
}
