"use client";

/** Apply a dashboard deep link before paint, then reveal only its committed panel. */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { WorkspaceView } from "@/components/WorkspaceHeader";
import { followLocation, type SectionApplier } from "@/lib/workspace-hash";

interface WorkspaceBootstrapOptions {
  view: WorkspaceView;
  activeSection: string;
  applier: Record<WorkspaceView, SectionApplier>;
  setView: Dispatch<SetStateAction<WorkspaceView>>;
  sectionByViewRef: MutableRefObject<Record<WorkspaceView, string>>;
  viewRef: MutableRefObject<WorkspaceView>;
}

export function useWorkspaceBootstrap({
  view,
  activeSection,
  applier,
  setView,
  sectionByViewRef,
  viewRef,
}: WorkspaceBootstrapOptions): void {
  const [locationReady, setLocationReady] = useState(false);
  const targetRef = useRef<{ view: WorkspaceView; section: string } | null>(null);

  useLayoutEffect(() => {
    targetRef.current = null;
    const stopFollowing = followLocation(applier, setView, (nextView, nextSection) => {
      targetRef.current = { view: nextView, section: nextSection };
    });
    if (!targetRef.current) {
      const currentView = viewRef.current;
      targetRef.current = {
        view: currentView,
        section: sectionByViewRef.current[currentView],
      };
    }
    setLocationReady(true);
    return stopFollowing;
  }, [applier, sectionByViewRef, setView, viewRef]);

  useLayoutEffect(() => {
    if (!locationReady || typeof document === "undefined") return;
    const target = targetRef.current;
    if (target && (view !== target.view || activeSection !== target.section)) return;
    const root = document.documentElement;
    if (!root.dataset.workspaceBoot) return;

    let frame = 0;
    let committedFrames = 0;
    const revealCommittedPanel = () => {
      if (root.dataset.workspaceBoot === "fallback") {
        delete root.dataset.workspaceBoot;
        frame = 0;
        return;
      }
      if (!root.dataset.workspaceBoot || !target) {
        frame = 0;
        return;
      }
      // A lazy console can leave the preceding commit in the DOM after state
      // names the destination. Reveal only when both the destination workspace
      // and its nested section are visible; otherwise a deep link can expose
      // that workspace's default section for one frame.
      const panel = document.getElementById(`panel-${target.view}`);
      const workspaceId = target.view === "live" ? "execution" : target.view;
      const subpanel = document.getElementById(`${workspaceId}-subpanel-${target.section}`);
      if (
        !panel
        || panel.hidden
        || window.getComputedStyle(panel).display === "none"
        || !subpanel
        || subpanel.hidden
        || window.getComputedStyle(subpanel).display === "none"
      ) {
        committedFrames = 0;
        frame = window.requestAnimationFrame(revealCommittedPanel);
        return;
      }

      // Keep the pending veil through one complete frame of committed target
      // geometry. This gives lazy content and both measured chrome rows a
      // paint boundary to settle before anything can become visible.
      if (committedFrames === 0) {
        committedFrames = 1;
        frame = window.requestAnimationFrame(revealCommittedPanel);
        return;
      }
      root.dataset.workspaceBoot = "revealing";
      frame = window.requestAnimationFrame(() => {
        delete root.dataset.workspaceBoot;
        frame = 0;
      });
    };

    frame = window.requestAnimationFrame(revealCommittedPanel);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeSection, locationReady, view]);
}
