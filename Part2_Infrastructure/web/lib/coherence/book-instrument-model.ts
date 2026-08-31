import { DOLLAR_CC, toCenticents } from "./fixed-point";

export interface NativeBookLevel {
  price: string;
  size: string;
}

export interface MirrorBookLevel {
  key: string;
  side: "yes" | "no";
  nativePrice: number;
  yesPrice: number;
  size: number;
  depth: number;
}

export interface ScenarioBookLevel extends MirrorBookLevel {
  originSide: "yes" | "no";
  originNativePrice: number;
}

export interface BookSweep {
  requested: number;
  filled: number;
  unfilled: number;
  levelsReached: number;
  consumedKeys: string[];
  vwap: number | null;
  worstPrice: number | null;
}

export type IdentityShockSide = "yes" | "no";
export type IdentityScenarioState = "incomplete" | "matched" | "above" | "below";

export interface BookIdentityScenario {
  yesAsk: number | null;
  noAsk: number | null;
  quoteTotal: number | null;
  referenceTotal: number | null;
  difference: number | null;
  appliedShock: number;
  state: IdentityScenarioState;
}

function parsed(levels: NativeBookLevel[], side: "yes" | "no"): MirrorBookLevel[] {
  return levels.flatMap((level) => {
    const nativePrice = toCenticents(level.price);
    const size = Number(level.size);
    if (nativePrice == null || !Number.isFinite(size) || size < 0) return [];
    const yesPrice = side === "yes" ? nativePrice : DOLLAR_CC - nativePrice;
    return [{
      key: `${side}:${nativePrice}`,
      side,
      nativePrice,
      yesPrice,
      size,
      depth: 0,
    }];
  });
}

function withDepth<T extends MirrorBookLevel>(
  levels: T[],
  direction: "from-high" | "from-low",
): T[] {
  const sorted = [...levels].sort((a, b) => a.yesPrice - b.yesPrice);
  const queued = direction === "from-high" ? [...sorted].reverse() : sorted;
  let running = 0;
  const depth = new Map<string, number>();
  for (const level of queued) {
    running += level.size;
    depth.set(level.key, running);
  }
  return sorted.map((level) => ({ ...level, depth: depth.get(level.key) ?? level.size }));
}

/** Native YES bids fill high-to-low; mirrored NO bids fill low-to-high. */
export function mirrorBookLevels(
  yesBids: NativeBookLevel[],
  noBids: NativeBookLevel[],
): { yes: MirrorBookLevel[]; no: MirrorBookLevel[]; ordered: MirrorBookLevel[] } {
  const yes = withDepth(parsed(yesBids, "yes"), "from-high").reverse();
  const no = withDepth(parsed(noBids, "no"), "from-low");
  return { yes, no, ordered: [...yes, ...no] };
}

/** Re-price locally flipped levels while preserving their YES-axis exposure. */
export function scenarioBookLevels(
  base: MirrorBookLevel[],
  sideByKey: Readonly<Record<string, "yes" | "no" | undefined>>,
): { yes: ScenarioBookLevel[]; no: ScenarioBookLevel[]; ordered: ScenarioBookLevel[] } {
  const staged: ScenarioBookLevel[] = base.map((level) => {
    const side = sideByKey[level.key] ?? level.side;
    return {
      ...level,
      side,
      nativePrice: side === "yes" ? level.yesPrice : DOLLAR_CC - level.yesPrice,
      depth: 0,
      originSide: level.side,
      originNativePrice: level.nativePrice,
    };
  });
  const yes = withDepth(staged.filter((level) => level.side === "yes"), "from-high").reverse();
  const no = withDepth(staged.filter((level) => level.side === "no"), "from-low");
  return { yes, no, ordered: [...yes, ...no] };
}

/** Walk an already queue-ordered rail and measure a marketable order on the YES axis. */
export function sweepBook(
  levels: readonly Pick<MirrorBookLevel, "key" | "yesPrice" | "size">[],
  quantity: number,
): BookSweep {
  const requested = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  let remaining = requested;
  let filled = 0;
  let notional = 0;
  let worstPrice: number | null = null;
  const consumedKeys: string[] = [];

  for (const level of levels) {
    if (remaining <= 0) break;
    const available = Number.isFinite(level.size) ? Math.max(0, level.size) : 0;
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    filled += take;
    remaining -= take;
    notional += take * level.yesPrice;
    worstPrice = level.yesPrice;
    consumedKeys.push(level.key);
  }

  return {
    requested,
    filled,
    unfilled: Math.max(0, requested - filled),
    levelsReached: consumedKeys.length,
    consumedKeys,
    // A calculated VWAP can land between venue ticks. The surrounding Markets
    // readout promises that displayed precision is truncated, never rounded,
    // so keep the same direction when reducing it to the four-decimal axis.
    vwap: filled > 0 ? Math.trunc(notional / filled) : null,
    worstPrice,
  };
}

/**
 * Move one observed ask locally and compare the resulting pair with the
 * gateway's independently reported `1 + spread` total.
 *
 * The shock is expressed in the same integer centicents as every book price.
 * It is clamped to the contract domain instead of allowing a visual control to
 * manufacture a negative quote or one above the certain payout.
 */
export function bookIdentityScenario(
  yesAskRaw: string | null,
  noAskRaw: string | null,
  referenceRaw: string | null,
  side: IdentityShockSide,
  requestedShock: number,
): BookIdentityScenario {
  const observedYes = toCenticents(yesAskRaw);
  const observedNo = toCenticents(noAskRaw);
  const referenceTotal = toCenticents(referenceRaw);
  const base = side === "yes" ? observedYes : observedNo;
  const finiteShock = Number.isFinite(requestedShock) ? Math.trunc(requestedShock) : 0;
  const appliedShock = base == null
    ? 0
    : Math.max(-base, Math.min(DOLLAR_CC - base, finiteShock));
  const yesAsk = observedYes == null ? null : observedYes + (side === "yes" ? appliedShock : 0);
  const noAsk = observedNo == null ? null : observedNo + (side === "no" ? appliedShock : 0);
  const quoteTotal = yesAsk == null || noAsk == null ? null : yesAsk + noAsk;
  const difference = quoteTotal == null || referenceTotal == null ? null : quoteTotal - referenceTotal;
  const state: IdentityScenarioState = difference == null
    ? "incomplete"
    : difference === 0
      ? "matched"
      : difference > 0 ? "above" : "below";
  return { yesAsk, noAsk, quoteTotal, referenceTotal, difference, appliedShock, state };
}

export function contractsLabel(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function percentOf(value: number, ceiling: number): string {
  if (!Number.isFinite(value) || ceiling <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / ceiling) * 100))}%`;
}

export function priceWindow(values: Array<number | null>): { low: number; high: number } {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!finite.length) return { low: 0, high: DOLLAR_CC };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const pad = Math.max(100, Math.round((max - min) * 0.18));
  return { low: Math.max(0, min - pad), high: Math.min(DOLLAR_CC, max + pad) };
}

export function verticalPosition(value: number | null, low: number, high: number): string {
  if (value == null || high <= low) return "50%";
  return `${Math.max(0, Math.min(100, ((high - value) / (high - low)) * 100))}%`;
}
