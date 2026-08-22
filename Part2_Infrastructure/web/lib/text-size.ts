import { emitPrefChange } from "./pref-sync-bus";

/**
 * The reader's Text size — one of three steps the whole content ladder is
 * multiplied by (`--type-step` in globals.css). The three land the reading
 * rung --fs-body on 12px, 14px and 17px: compact 6/7, comfortable 1 (the
 * ladder exactly as the stylesheet writes it), large 17/14. The steps were
 * 0.9375 and 1.125 until 2026-08-22, which left compact and comfortable
 * 0.88px apart — a control whose states a reader could not tell apart.
 *
 * Applies to the workspace, not to the header: the header, the tab switcher
 * and the bottom bar use the fixed chrome tokens, because their priority
 * ladder is a px measurement that a preference must not move under it (see
 * "The header's priority ladder"). The control's hint says so.
 *
 * Same shape as `lib/theme.ts`, for the same reasons: the document changes
 * first; comfortable — the default — REMOVES the attribute rather than
 * stamping "comfortable", so an unset preference and the default are one
 * state and the stylesheet's `:root` value answers; every write goes through
 * the preference bus so the control, the ⌘K verb and a value arriving from
 * the account all repaint the segments.
 */
export type TextSize = "compact" | "comfortable" | "large";

/** Segment order for the control. */
export const TEXT_SIZES: readonly TextSize[] = ["compact", "comfortable", "large"];

export const DEFAULT_TEXT_SIZE: TextSize = "comfortable";

/** Exported so the preference sync engine names the same key rather than a copy. */
export const TEXT_SIZE_STORAGE_KEY = "alphaengine-text-size";

export function isTextSize(value: unknown): value is TextSize {
  return value === "compact" || value === "comfortable" || value === "large";
}

/** The stored choice; anything else is the default. */
export function resolveTextSize(saved: string | null): TextSize {
  return isTextSize(saved) ? saved : DEFAULT_TEXT_SIZE;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
  } catch {
    // A blocked storage API should not make the visible control unusable.
    return null;
  }
}

/** A read, and only a read: opening the panel must not write the default back. */
export function resolveDocumentTextSize(): TextSize {
  const stamped = document.documentElement.dataset.textSize;
  if (isTextSize(stamped)) return stamped;
  return resolveTextSize(readStored());
}

/**
 * Stamp and persist one size. Comfortable deletes the attribute — it is the
 * `:root` value, and a stamped "comfortable" would be a state that matches
 * no rule while looking like a choice.
 */
export function applyDocumentTextSize(size: TextSize): TextSize {
  const root = document.documentElement;
  if (size === DEFAULT_TEXT_SIZE) delete root.dataset.textSize;
  else root.dataset.textSize = size;
  try {
    window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size);
  } catch {
    // The document still changes for this session.
  }
  emitPrefChange(TEXT_SIZE_STORAGE_KEY);
  return size;
}
