export interface StageLifecycleGeometry {
  left: number;
  right: number;
  positions: number[];
  radius: number;
}

/**
 * Keep a short stage rail inside its measured SVG at every practical width.
 * The node radius contracts before adjacent stages can overlap; the full stage
 * copy lives in the responsive fact grid rather than being squeezed into SVG.
 */
export function stageLifecycleGeometry(width: number, count: number): StageLifecycleGeometry {
  const safeWidth = Math.max(1, width);
  const safeCount = Math.max(0, Math.floor(count));
  const inset = Math.min(58, Math.max(12, safeWidth * 0.12), safeWidth / 4);
  const left = inset;
  const right = Math.max(left, safeWidth - inset);
  const spacing = safeCount > 1 ? (right - left) / (safeCount - 1) : safeWidth / 2;
  const radius = Math.min(11, Math.max(1, spacing * 0.28), safeWidth / 4);
  const positions = Array.from({ length: safeCount }, (_unused, index) => (
    safeCount <= 1 ? safeWidth / 2 : left + spacing * index
  ));

  return { left, right, positions, radius };
}
