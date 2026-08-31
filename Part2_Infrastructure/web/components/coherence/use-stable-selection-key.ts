"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

/**
 * Keep a controlled inspection on the same entity when a live payload reorders,
 * and move it to the first remaining entity when the selected one disappears.
 */
export function useStableSelectionKey(keys: readonly string[], initialKey?: string | null) {
  const first = keys[0] ?? null;
  const initial = initialKey != null && keys.includes(initialKey) ? initialKey : first;
  const [requested, setRequested] = useState<string | null>(initial);
  const selected = requested != null && keys.includes(requested) ? requested : first;

  useEffect(() => {
    if (requested !== selected) setRequested(selected);
  }, [requested, selected]);

  return [selected, setRequested] as const;
}

/**
 * The next option in a one-dimensional ARIA listbox.
 *
 * Both arrow axes are accepted because the Markets instruments switch between
 * horizontal rails, responsive grids and single columns at their breakpoints.
 * Clamping instead of wrapping keeps the spatial promise: an arrow at the
 * visible edge never jumps to the opposite edge of a large instrument.
 */
export function nextListboxIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, current - 1);
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(count - 1, current + 1);
  return null;
}

export interface RovingOptionProps {
  tabIndex: 0 | -1;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * Stable entity selection plus the complete keyboard contract for a listbox.
 *
 * One option is tabbable. Arrow keys move selection and focus, Home/End jump
 * to the edges, and a live reorder keeps the selected entity by key instead of
 * keeping its old numeric slot. Callers still own click selection because it
 * normally updates additional local state or analytics beside this contract.
 */
export function useRovingListbox(
  keys: readonly string[],
  initialKey?: string | null,
  controlledKey?: string | null,
  onSelectionChange?: (key: string) => void,
) {
  const [requested, setRequested] = useStableSelectionKey(keys, initialKey);
  const first = keys[0] ?? null;
  const selected = controlledKey != null && keys.includes(controlledKey) ? controlledKey : requested ?? first;
  const setSelected = (key: string | null) => {
    setRequested(key);
    if (key != null) onSelectionChange?.(key);
  };

  const optionProps = (key: string, index: number): RovingOptionProps => ({
    tabIndex: selected === key ? 0 : -1,
    onFocus: () => setSelected(key),
    onKeyDown: (event) => {
      const next = nextListboxIndex(index, event.key, keys.length);
      if (next == null) return;
      event.preventDefault();
      const nextKey = keys[next];
      if (nextKey == null) return;
      setSelected(nextKey);

      // Query the owning listbox rather than retaining one ref per live row.
      // The option order is the rendered key order supplied above, including
      // after a payload reorders, and focus never escapes into a sibling rail.
      const owner = event.currentTarget.closest<HTMLElement>('[role="listbox"]');
      owner?.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus();
    },
  });

  return [selected, setSelected, optionProps] as const;
}
