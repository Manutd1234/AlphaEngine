import { emitPrefChange } from "./pref-sync-bus";

export type ThemeMode = "light" | "dark";

/** Exported so the preference sync engine names the same key rather than a copy. */
export const THEME_STORAGE_KEY = "alphaengine-theme";

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

/** The control intentionally has two states: every click changes the palette. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === "dark" ? "light" : "dark";
}

/** Resolve the browser's live theme without making storage availability fatal. */
export function resolveDocumentThemeMode(): ThemeMode {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // A blocked storage API should not make the visible control unusable.
  }
  return resolveThemeMode(
    document.documentElement.dataset.theme,
    saved,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

/** Stamp and persist one resolved palette. The document always changes first. */
export function applyDocumentThemeMode(mode: ThemeMode): ThemeMode {
  document.documentElement.dataset.theme = mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // The document palette still changes for this session.
  }
  emitPrefChange(THEME_STORAGE_KEY);
  return mode;
}

/** Shared by the header control and the command palette. */
export function toggleDocumentThemeMode(): ThemeMode {
  return applyDocumentThemeMode(nextThemeMode(resolveDocumentThemeMode()));
}
