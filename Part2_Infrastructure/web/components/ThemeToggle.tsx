"use client";

import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

/**
 * Dark mode uses its own selected palette steps, not an inverted light mode, so
 * the toggle stamps `data-theme` on the root and the CSS picks the right set.
 */
export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    const saved = (localStorage.getItem("alphaengine-theme") as Mode | null) ?? "system";
    setMode(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") delete root.dataset.theme;
    else root.dataset.theme = mode;
    localStorage.setItem("alphaengine-theme", mode);
  }, [mode]);

  const next: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
  const icon = { system: "◐", light: "☀", dark: "☾" }[mode];

  return (
    <button
      className="icon"
      onClick={() => setMode(next[mode])}
      title={`Theme: ${mode} — click for ${next[mode]}`}
      aria-label={`Theme: ${mode}. Switch to ${next[mode]}.`}
    >
      <span aria-hidden>{icon}</span>{" "}
      <span style={{ fontSize: 11.5, textTransform: "capitalize" }}>{mode}</span>
    </button>
  );
}
