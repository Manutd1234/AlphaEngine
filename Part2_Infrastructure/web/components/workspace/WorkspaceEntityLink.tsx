"use client";

import type { MouseEvent, ReactNode } from "react";

import {
  type WorkspaceEntityKind,
  type WorkspaceEntityView,
  workspaceEntityTarget,
  writeWorkspaceEntity,
} from "@/lib/workspace-entities";

interface WorkspaceEntityLinkProps {
  kind: WorkspaceEntityKind;
  value: string;
  children?: ReactNode;
  destination?: { view: WorkspaceEntityView; section: string };
  className?: string;
}

/**
 * A real link for copy/open-in-new-tab, enhanced to keep the mounted desk warm.
 * The synthetic popstate is the same signal the shell already follows for
 * Back/Forward, so there is still one location reader.
 */
export default function WorkspaceEntityLink({
  kind,
  value,
  children = value,
  destination,
  className = "text-action",
}: WorkspaceEntityLinkProps) {
  const target = workspaceEntityTarget(kind, value, destination);
  const relativeHref = `?entity=${encodeURIComponent(kind)}&entityId=${encodeURIComponent(value)}#${target.view}/${target.section}`;

  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const url = writeWorkspaceEntity(new URL(window.location.href), target);
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <a className={className} href={relativeHref} onClick={follow}>
      {children}
    </a>
  );
}
