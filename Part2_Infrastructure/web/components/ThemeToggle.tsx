"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import {
  applyDocumentThemeMode,
  resolveDocumentThemeMode,
  toggleDocumentThemeMode,
  type ThemeMode,
} from "@/lib/theme";

/**
 * Dark mode uses its own selected palette steps, not an inverted light mode, so
 * the toggle stamps `data-theme` on the root and the CSS picks the right set.
 */
export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const syncMode = () => setMode(resolveDocumentThemeMode());
    const observer = new MutationObserver(syncMode);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    setMode(applyDocumentThemeMode(resolveDocumentThemeMode()));
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    setMode(toggleDocumentThemeMode());
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
