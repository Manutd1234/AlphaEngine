import { emitPrefChange } from "./pref-sync-bus";

/**
 * Two concepts, deliberately separate.
 *
 * `ThemeMode` is a palette: what the document is actually painted with, and
 * there are exactly two of them in `globals.css`. `ThemePreference` is what a
 * person chose, and "system" is not a palette — it is a standing instruction to
 * keep asking the OS. Collapsing the two is the whole class of bug this split
 * exists to prevent: a preference resolved once, at mount, and written back as
 * an explicit value stops following anything.
 */
export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

/** Segment order for the control. Also the cycle order for `nextThemePreference`. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

/**
 * An unset key has always meant "follow the OS" — `resolveThemeMode` fell
 * through to `prefers-color-scheme` before this type existed. Naming that
 * default changes no behaviour; it only makes the state selectable.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/** Exported so the preference sync engine names the same key rather than a copy. */
export const THEME_STORAGE_KEY = "alphaengine-theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Resolve the explicit palette stamped on the document before hydration. */
export function resolveThemeMode(
  stamped: string | undefined,
  saved: string | null,
  prefersDark: boolean,
): ThemeMode {
  if (stamped === "light" || stamped === "dark") return stamped;
  if (saved === "light" || saved === "dark") return saved;
  return prefersDark ? "dark" : "light";
}

/** The stored choice, which is not the palette. Anything else means System. */
export function resolveThemePreference(saved: string | null): ThemePreference {
  return isThemePreference(saved) ? saved : DEFAULT_THEME_PREFERENCE;
}

/**
 * The palette a preference resolves to right now.
 *
 * "Right now" is load-bearing for System: the answer changes when the OS
 * changes, which is why nothing may cache it back into storage.
 */
export function paletteForPreference(preference: ThemePreference, prefersDark: boolean): ThemeMode {
  if (preference === "light" || preference === "dark") return preference;
  return prefersDark ? "dark" : "light";
}

/**
 * The palette flip. Two states, because it answers "what am I looking at" —
 * the command palette's verb uses this and sets an explicit value on purpose.
 */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === "dark" ? "light" : "dark";
}

/** The preference cycle. Three states, because System is one of the choices. */
export function nextThemePreference(preference: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(preference);
  // An unrecognised value lands on the first segment rather than throwing.
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length];
}

function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // A blocked storage API should not make the visible control unusable.
    return null;
  }
}

/** Resolve the browser's live palette without making storage availability fatal. */
export function resolveDocumentThemeMode(): ThemeMode {
  return resolveThemeMode(
    document.documentElement.dataset.theme,
    readStoredTheme(),
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

/** Read the stored preference. A read, and only a read — see the note below. */
export function resolveDocumentThemePreference(): ThemePreference {
  return resolveThemePreference(readStoredTheme());
}

/**
 * Stamp and persist one preference. The document always changes first.
 *
 * System **removes** `data-theme` rather than stamping anything. Two reasons,
 * and the second is why no JavaScript is needed to follow the OS at all:
 *
 *  - `data-theme="system"` matches neither palette block. It is not a no-op, it
 *    is light — the failure would look like the setting doing nothing on a
 *    dark-mode machine.
 *  - With the attribute absent, `@media (prefers-color-scheme: dark)` answers,
 *    and keeps answering when the OS flips while the tab is open. The dark
 *    block is written `:root:where(:not([data-theme="light"]))` precisely so an
 *    explicit light choice still wins over a dark OS.
 *
 * The two heatmaps read `dataset.theme` for their canvas fills and already
 * carry their own `matchMedia` change listeners, so they follow a live OS
 * change too.
 */
export function applyDocumentThemePreference(preference: ThemePreference): ThemePreference {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The document palette still changes for this session.
  }
  emitPrefChange(THEME_STORAGE_KEY);
  return preference;
}

/** Choose an explicit palette. A `ThemeMode` is a `ThemePreference` that names one. */
export function applyDocumentThemeMode(mode: ThemeMode): ThemeMode {
  applyDocumentThemePreference(mode);
  return mode;
}

/**
 * The command palette's verb.
 *
 * It sets an explicit palette, so from System it lands on light or dark and
 * stops following the OS. That is deliberate and the label says so — a verb
 * that flipped the palette while claiming to preserve System would be lying
 * about which of the three states you ended up in.
 */
export function toggleDocumentThemeMode(): ThemeMode {
  return applyDocumentThemeMode(nextThemeMode(resolveDocumentThemeMode()));
}
