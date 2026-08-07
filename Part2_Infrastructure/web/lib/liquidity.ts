/**
 * Time-to-Liquidate (TTL) and position exit analysis.
 *
 * Formula:
 *   daysToLiquidate = |signedNotional| / (participation * ADV)
 *
 * ADV is derived from averageDailyVolume(bars, "1d") on the OHLCV already fetched,
 * matching the provenance of every other risk number.
 */

export const DEFAULT_PARTICIPATION = 0.1;
export const MIN_ADV_OBSERVATIONS = 20;

export interface LiquidityInput {
  symbol: string;
  notional: number;
  quantity: number;
  adv: number | null;
  observations: number;
}

export interface LiquidityRow {
  symbol: string;
  notional: number;
  quantity: number;
  adv: number | null;
  advObservations: number;
  daysToLiquidate: number | null;
  sessionsToExit: number | null;
  clearableInOneSession: boolean;
  band: "liquid" | "moderate" | "illiquid" | "unmeasurable";
}

export interface LiquidityReport {
  rows: LiquidityRow[];
  bookDaysToLiquidate: number | null;
  slowestLeg: string | null;
  shareClearableInOneSession: number;
  unmeasurableCount: number;
  participation: number;
}

export function timeToLiquidate(
  positions: LiquidityInput[],
  participation: number = DEFAULT_PARTICIPATION
): LiquidityReport {
  const safePart = Math.max(0.01, Math.min(1.0, participation));
  const rows: LiquidityRow[] = [];
  let maxDays: number | null = null;
  let slowest: string | null = null;
  let clearableCount = 0;
  let unmeasurableCount = 0;

  for (const pos of positions) {
    const absNotional = Math.abs(pos.notional);
    if (!pos.adv || pos.adv <= 0 || pos.observations < MIN_ADV_OBSERVATIONS) {
      unmeasurableCount++;
      rows.push({
        symbol: pos.symbol,
        notional: pos.notional,
        quantity: pos.quantity,
        adv: pos.adv,
        advObservations: pos.observations,
        daysToLiquidate: null,
        sessionsToExit: null,
        clearableInOneSession: false,
        band: "unmeasurable",
      });
      continue;
    }

    const dailyCapacity = pos.adv * safePart;
    const rawDays = absNotional / dailyCapacity;
    const sessions = Math.ceil(rawDays);
    const clearable = rawDays <= 1.0;
    if (clearable) clearableCount++;

    let band: LiquidityRow["band"] = "liquid";
    if (rawDays > 3.0) band = "illiquid";
    else if (rawDays > 1.0) band = "moderate";

    if (maxDays === null || rawDays > maxDays) {
      maxDays = rawDays;
      slowest = pos.symbol;
    }

    rows.push({
      symbol: pos.symbol,
      notional: pos.notional,
      quantity: pos.quantity,
      adv: pos.adv,
      advObservations: pos.observations,
      daysToLiquidate: rawDays,
      sessionsToExit: sessions,
      clearableInOneSession: clearable,
      band,
    });
  }

  const validRows = rows.filter((r) => r.daysToLiquidate !== null);
  const shareClearable = validRows.length > 0 ? clearableCount / validRows.length : 0;

  return {
    rows,
    bookDaysToLiquidate: maxDays,
    slowestLeg: slowest,
    shareClearableInOneSession: shareClearable,
    unmeasurableCount,
    participation: safePart,
  };
}

export function liquidityConcentration(
  report: LiquidityReport
): { hhi: number; bottleneck: string | null } | null {
  const valid = report.rows.filter((r) => r.daysToLiquidate !== null && r.daysToLiquidate > 0);
  if (valid.length === 0) return null;
  const totalDays = valid.reduce((acc, r) => acc + (r.daysToLiquidate ?? 0), 0);
  if (totalDays === 0) return null;
  const hhi = valid.reduce((acc, r) => {
    const share = (r.daysToLiquidate ?? 0) / totalDays;
    return acc + share * share;
  }, 0);
  return { hhi, bottleneck: report.slowestLeg };
}
