"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { nextThemeMode, resolveThemeMode, type ThemeMode } from "@/lib/theme";

/**
 * Dark mode uses its own selected palette steps, not an inverted light mode, so
 * the toggle stamps `data-theme` on the root and the CSS picks the right set.
 */
export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode | null>(null);

  useEffect(() => {
    const stamped = document.documentElement.dataset.theme;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("alphaengine-theme");
    } catch {
      // A blocked storage API should not make the visible control unusable.
    }
    const resolved = resolveThemeMode(
      stamped,
      saved,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
    document.documentElement.dataset.theme = resolved;
    try {
      localStorage.setItem("alphaengine-theme", resolved);
    } catch {
      // The document palette still changes for this session.
    }
    setMode(resolved);
  }, []);

  const toggle = () => {
    const root = document.documentElement;
    const current = resolveThemeMode(
      root.dataset.theme,
      mode,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
    const next = nextThemeMode(current);
    root.dataset.theme = next;
    try {
      localStorage.setItem("alphaengine-theme", next);
    } catch {
      // Keep the control functional even when persistence is unavailable.
    }
    setMode(next);
  };

  const label = mode === null ? "Theme" : mode === "dark" ? "Dark mode" : "Light mode";
  const nextLabel = mode === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="icon theme-toggle"
      onClick={toggle}
      title={mode === null ? "Choose light or dark mode" : `${label} — switch to ${nextLabel} mode`}
      aria-label={mode === null ? "Choose light or dark mode." : `${label} active. Switch to ${nextLabel} mode.`}
    >
      {mode === "dark" ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />}
      <span>{label}</span>
    </button>
  );
}
