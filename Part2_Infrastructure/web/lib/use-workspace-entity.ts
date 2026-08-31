"use client";

import { useEffect, useState } from "react";

import {
  readWorkspaceEntity,
  type WorkspaceEntityKind,
  type WorkspaceEntityTarget,
} from "@/lib/workspace-entities";

/** Read the selected record on direct load, enhanced link, Back, and Forward. */
export function useWorkspaceEntity(kind?: WorkspaceEntityKind): WorkspaceEntityTarget | null {
  const [target, setTarget] = useState<WorkspaceEntityTarget | null>(null);

  useEffect(() => {
    const read = () => {
      const next = readWorkspaceEntity(new URL(window.location.href));
      setTarget(!kind || next?.kind === kind ? next : null);
    };
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("hashchange", read);
    };
  }, [kind]);

  return target;
}
