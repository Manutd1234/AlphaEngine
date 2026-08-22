/**
 * A section that is not on screen does not repaint on the book's cadence.
 *
 * `useLiveBook` publishes a fresh snapshot every 300ms while a supported pair
 * is selected, and `LiveMarket` hands that snapshot to every section it
 * composes — the Liquidity ladder, the Routing probe — whether or not the
 * section is the visible one. `WorkspaceSubtabPanel` keeps a visited section
 * mounted behind `hidden` on purpose (its scroll position and its inputs
 * survive a switch), which means a hidden ladder was rebuilding twenty-four
 * level buttons and a hidden probe was walking both venues' books three times
 * a second for a reader looking at the order ticket.
 *
 * This is the comparator for `React.memo` that ends that. While a panel is
 * hidden, its last render stands; the moment it is shown again it re-renders
 * with whatever props are current, so nothing it shows is ever older than the
 * tick it became visible on. While it is visible, the comparison is the
 * ordinary shallow one — a new snapshot is a new paint, which is the point of
 * a live book.
 *
 * A comparator rather than a frozen prop. Holding the snapshot in a ref and
 * handing the stale one down would reach the same render count, but it would
 * do so by writing a ref during render — and by putting a value on the panel's
 * props that disagrees with the one every sibling is showing.
 */

export interface HideablePanelProps {
  /** Whether the owning section is the visible one. */
  active: boolean;
}

export function shallowEqualProps<P extends object>(prev: P, next: P): boolean {
  const prevKeys = Object.keys(prev) as Array<keyof P>;
  const nextKeys = Object.keys(next) as Array<keyof P>;
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of prevKeys) {
    if (!Object.is(prev[key], next[key])) return false;
  }
  return true;
}

/**
 * `true` tells React to keep the last render.
 *
 * Both hidden: keep it, whatever changed. Either visible: keep it only when
 * nothing changed, which is `React.memo`'s default rule restated — so the
 * transition from hidden to visible is always a render, because `active`
 * itself differs.
 */
export function skipWhileHidden<P extends HideablePanelProps>(prev: P, next: P): boolean {
  if (!prev.active && !next.active) return true;
  return shallowEqualProps(prev, next);
}
