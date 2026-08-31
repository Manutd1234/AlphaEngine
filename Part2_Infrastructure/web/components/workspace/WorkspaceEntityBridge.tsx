"use client";

import { useEffect } from "react";

import { workspaceEntityFocusIds } from "@/lib/workspace-entities";
import { useWorkspaceEntity } from "@/lib/use-workspace-entity";

/** Applies URL-selected records to shared desk state and restored focus. */
export default function WorkspaceEntityBridge({ onTicker }: { onTicker: (symbol: string) => void }) {
  const target = useWorkspaceEntity();

  useEffect(() => {
    if (target?.kind === "ticker") onTicker(target.value.toUpperCase());
  }, [onTicker, target]);

  useEffect(() => {
    if (!target) return;
    let frame = 0;
    let attempts = 0;
    const focus = () => {
      const node = workspaceEntityFocusIds(target)
        .map((id) => document.getElementById(id))
        .find(Boolean);
      if (node instanceof HTMLElement) {
        node.focus({ preventScroll: true });
        node.scrollIntoView({ block: "nearest", behavior: "auto" });
        return;
      }
      attempts += 1;
      if (attempts < 12) frame = window.requestAnimationFrame(focus);
    };
    frame = window.requestAnimationFrame(focus);
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  return null;
}
