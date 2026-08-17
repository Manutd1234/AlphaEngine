"use client";

/**
 * Light, Dark, or follow the machine.
 *
 * Three segments rather than the two-state button this used to be, and the
 * third one is the reason the file changed shape. A cycling button can only
 * express where you are going next, so "follows my system" had nowhere to live:
 * the control resolved the OS preference once and wrote the answer back, which
 * meant a person on a machine that switches at sunset got whatever their laptop
 * happened to be at the moment they last opened this panel.
 *
 * Dark mode uses its own selected palette steps, not an inverted light mode, so
 * an explicit choice stamps `data-theme` on the root and the CSS picks the right
 * set. System removes the attribute instead and lets the stylesheet's
 * `prefers-color-scheme` block answer — see `applyDocumentThemePreference`.
 */

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { onPrefChange } from "@/lib/pref-sync-bus";
import {
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  applyDocumentThemePreference,
  resolveDocumentThemePreference,
  type ThemePreference,
} from "@/lib/theme";

const LABELS: Record<ThemePreference, { label: string; title: string }> = {
  light: { label: "Light", title: "Always the light palette, whatever this machine is set to" },
  dark: { label: "Dark", title: "Always the dark palette, whatever this machine is set to" },
  system: { label: "System", title: "Follow this machine, including when it changes during the day" },
};

const ICONS: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const DESCRIPTIONS: Record<ThemePreference, string> = {
  light: "Light palette, held regardless of what this machine prefers.",
  dark: "Dark palette, held regardless of what this machine prefers.",
  system: "Follows this machine's appearance setting, and changes with it.",
};

export default function ThemeToggle() {
  /**
   * Null until the effect runs. The stored preference is never read during
   * render: this panel is client-only today, but a storage read in a render
   * body is the kind of thing that stays correct right up until the component
   * is used somewhere that server-renders, and then desynchronises hydration
   * silently.
   */
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    // A read. This used to be `applyDocumentThemeMode(resolveDocumentThemeMode())`,
    // which *wrote* on mount — so merely opening the panel resolved System to an
    // explicit palette and pushed it to the account. The preference destroyed
    // itself by being looked at.
    const sync = () => setPreference(resolveDocumentThemePreference());
    sync();

    // The preference bus rather than a MutationObserver on `data-theme`. The
    // attribute only carries explicit choices, so switching Dark → System on a
    // dark machine changes no attribute and an observer would never fire — the
    // segments would keep showing Dark. Every write path (this control, the ⌘K
    // verb, a value arriving from the account) goes through the bus.
    return onPrefChange((key) => {
      if (key === THEME_STORAGE_KEY) sync();
    });
  }, []);

  return (
    <div>
      <div className="seg" role="group" aria-label="Theme">
        {THEME_PREFERENCES.map((candidate) => {
          const Icon = ICONS[candidate];
          return (
            <button
              key={candidate}
              type="button"
              aria-pressed={preference === candidate}
              onClick={() => setPreference(applyDocumentThemePreference(candidate))}
              title={LABELS[candidate].title}
              className="inline-flex items-center justify-center gap-1 text-[12px] font-semibold"
            >
              <Icon size={12} aria-hidden />
              <span>{LABELS[candidate].label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-text-muted">
        {preference === null ? DESCRIPTIONS.system : DESCRIPTIONS[preference]}
      </p>
    </div>
  );
}
