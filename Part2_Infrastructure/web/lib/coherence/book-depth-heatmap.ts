export interface BookDepthQuote {
  size: number;
  depth: number;
}

export interface BookDepthLevel {
  /** YES-axis price in centicents; NO bids are mirrored onto this same axis. */
  cc: number;
  yes: BookDepthQuote | null;
  no: BookDepthQuote | null;
}

export interface HeatQuote extends BookDepthQuote {
  wash: number;
}

export interface BookDepthHeatmapModel {
  maxDepth: number;
  quotedCells: number;
  columns: ReadonlyArray<{
    cc: number;
    yes: HeatQuote | null;
    no: HeatQuote | null;
  }>;
}

/** A bounded token percentage; the printed depth remains the exact reading. */
export function depthWash(depth: number, maxDepth: number): number {
  if (!Number.isFinite(depth) || depth <= 0 || !Number.isFinite(maxDepth) || maxDepth <= 0) return 8;
  return Math.round(8 + Math.min(1, depth / maxDepth) * 36);
}

/**
 * Adds presentation intensity to the ladder's existing columns, and nothing
 * else. No bins, interpolation, time axis, or synthetic empty prices enter.
 */
export function buildBookDepthHeatmap(levels: readonly BookDepthLevel[]): BookDepthHeatmapModel {
  const depths = levels.flatMap((level) => [level.yes?.depth, level.no?.depth])
    .filter((depth): depth is number => depth != null && Number.isFinite(depth) && depth > 0);
  const maxDepth = Math.max(1, ...depths);
  let quotedCells = 0;
  const columns = levels.map((level) => {
    const decorate = (quote: BookDepthQuote | null): HeatQuote | null => {
      if (!quote) return null;
      quotedCells += 1;
      return { ...quote, wash: depthWash(quote.depth, maxDepth) };
    };
    return { cc: level.cc, yes: decorate(level.yes), no: decorate(level.no) };
  });
  return { maxDepth, quotedCells, columns };
}
