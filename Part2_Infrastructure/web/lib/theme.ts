export type ThemeMode = "light" | "dark";

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
