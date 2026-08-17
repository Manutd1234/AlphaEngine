"use client";

/**
 * The Text size control — three segments over the whole content ladder.
 *
 * Reads on mount and on every preference-bus event, like ThemeToggle, so the
 * ⌘K verb and a value synced from the account repaint the segments; never
 * writes on mount, so opening the panel cannot pin the default. The hint
 * names the one thing the setting does not touch — the header — because a
 * reader who sets Large and sees the toolbar unchanged should be told that is
 * the design, not a defect.
 */

import { useEffect, useState } from "react";

import { onPrefChange } from "@/lib/pref-sync-bus";
import {
  TEXT_SIZE_STORAGE_KEY,
  TEXT_SIZES,
  applyDocumentTextSize,
  resolveDocumentTextSize,
  type TextSize,
} from "@/lib/text-size";

const LABELS: Record<TextSize, { label: string; title: string; description: string }> = {
  compact: {
    label: "Compact",
    title: "Text size: compact — the ladder before the 2026-08-17 lift, for a dense desk.",
    description: "Every workspace rung at fifteen sixteenths — the ladder the desk had before it stepped up.",
  },
  comfortable: {
    label: "Comfortable",
    title: "Text size: comfortable — the default ladder, fluid between a laptop and a wide desk.",
    description: "The default: 12–17px reading rungs on a laptop, a step more on a wide monitor.",
  },
  large: {
    label: "Large",
    title: "Text size: large — every workspace rung at nine eighths.",
    description: "Every workspace rung at nine eighths, for a far monitor or a long day.",
  },
};

export default function TextSizeToggle() {
  const [size, setSize] = useState<TextSize | null>(null);

  useEffect(() => {
    const sync = () => setSize(resolveDocumentTextSize());
    sync();
    return onPrefChange((key) => {
      if (key === TEXT_SIZE_STORAGE_KEY) sync();
    });
  }, []);

  return (
    <div>
      <div className="seg" role="group" aria-label="Text size">
        {TEXT_SIZES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={size === candidate}
            onClick={() => setSize(applyDocumentTextSize(candidate))}
            title={LABELS[candidate].title}
            className="font-semibold"
          >
            {LABELS[candidate].label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-fs-xs leading-snug text-text-muted">
        {LABELS[size ?? "comfortable"].description} Applies to the workspace; the header and the bottom bar keep one size so their controls always fit.
      </p>
    </div>
  );
}
