import { useEffect, useRef, useState } from "react";

import {
  BENCHMARK_ABSENT_HINT,
  BENCHMARK_COLLAPSED_HINT,
  BENCHMARK_CONTROL_ID,
} from "@/components/research/BenchmarkPanel";
import { RESEARCH_SECTIONS, type ResearchSection } from "@/lib/sections";

interface BenchmarkFocusOptions {
  section: ResearchSection;
  summaryView: string;
  summaryViews: ReadonlyArray<readonly [string, string]>;
  onSectionChange: (section: ResearchSection) => void;
  onSummaryViewChange: (next: string) => void;
}

function focusSelect(select: HTMLSelectElement): boolean {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  select.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  select.focus({ preventScroll: true });
  return document.activeElement === select;
}

/** Route to the one benchmark control, then focus/open it after it mounts. */
export function useBenchmarkFocus({
  section,
  summaryView,
  summaryViews,
  onSectionChange,
  onSummaryViewChange,
}: BenchmarkFocusOptions) {
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const pending = useRef(false);
  const [reachNote, setReachNote] = useState<string | null>(null);
  const targetSection = RESEARCH_SECTIONS[0].id;
  const targetView = summaryViews[1]?.[0] ?? summaryView;

  useEffect(() => {
    if (!pending.current) return;
    if (section !== targetSection || summaryView !== targetView) return;
    const select = selectRef.current;
    if (!select) {
      setReachNote(BENCHMARK_ABSENT_HINT);
      pending.current = false;
      return;
    }
    const landed = focusSelect(select);
    setReachNote(landed ? null : BENCHMARK_COLLAPSED_HINT);
    pending.current = false;
    if (!landed) return;
    try {
      select.showPicker?.();
    } catch {
      // Focus remains the accessible fallback when a browser blocks showPicker.
    }
    window.requestAnimationFrame(() => {
      if (document.activeElement !== select) select.focus({ preventScroll: true });
    });
  }, [section, summaryView, targetSection, targetView]);

  const chooseBenchmark = () => {
    pending.current = true;
    setReachNote(null);
    onSectionChange(RESEARCH_SECTIONS[0].id);
    onSummaryViewChange(summaryViews[1]?.[0] ?? summaryView);
    let attempts = 0;
    const focusMountedSelect = () => {
      const mounted = selectRef.current ?? document.getElementById(BENCHMARK_CONTROL_ID);
      if (!(mounted instanceof HTMLSelectElement)) {
        attempts += 1;
        if (attempts < 12) window.requestAnimationFrame(focusMountedSelect);
        return;
      }
      focusSelect(mounted);
    };
    window.requestAnimationFrame(focusMountedSelect);
  };

  return { selectRef, reachNote, chooseBenchmark };
}
