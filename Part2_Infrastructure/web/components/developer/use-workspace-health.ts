"use client";

/**
 * `WorkspaceHealthSettle` for React — the thin wrapper, in the
 * `useDeskSource`-over-`DeskSourceMachine` shape.
 *
 * Called once, by `DeveloperConsole`, and the settled `ControlState` is
 * passed down to every section that renders the workspace's health. One
 * machine at the shell is the point: the console stays mounted across
 * section switches while the panes inside CI / CD remount on every switch,
 * so a per-section machine would remount into forgetting the demotion and
 * read Healthy beside an Overview still holding Degraded.
 *
 * `note` runs during render and is idempotent by construction — it observes
 * only transitions of `updatedAt` and `healthError`, so a re-render with an
 * unchanged view (StrictMode's double render included) moves nothing.
 */

import { useRef } from "react";

import type { SystemHealthView } from "@/lib/use-system-health";

import { workspaceState, type ControlState } from "./DeveloperStatus";
import { settledWorkspaceState, WorkspaceHealthSettle } from "./workspace-health";

export function useWorkspaceHealth(view: SystemHealthView): ControlState {
  const settle = useRef<WorkspaceHealthSettle | null>(null);
  if (settle.current === null) settle.current = new WorkspaceHealthSettle();
  settle.current.note(view.updatedAt, view.healthError);
  return settledWorkspaceState(workspaceState(view), settle.current.demoted, view.healthError);
}
