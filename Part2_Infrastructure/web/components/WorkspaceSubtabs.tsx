"use client";

import { KeyboardEvent, ReactNode, useRef } from "react";

export interface WorkspaceSubtab<T extends string> {
  id: T;
  label: string;
  description: string;
}

interface WorkspaceSubtabsProps<T extends string> {
  workspaceId: string;
  label: string;
  tabs: readonly WorkspaceSubtab<T>[];
  activeId: T;
  onChange: (id: T) => void;
}

/**
 * A compact second level of navigation for the dense role workspaces.
 *
 * Arrow keys activate the adjacent section, matching the automatic-activation
 * pattern used by the primary workspace tabs. The controlled API lets the
 * parent keep every feature panel mounted, so chart selections, draft orders,
 * and scenario inputs survive a section switch.
 */
export default function WorkspaceSubtabs<T extends string>({
  workspaceId,
  label,
  tabs,
  activeId,
  onChange,
}: WorkspaceSubtabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;

    onChange(tabs[nextIndex].id);
    refs.current[nextIndex]?.focus();
  };

  return (
    <nav className="workspace-subtabs" aria-label={label}>
      <div
        className="workspace-subtabs__rail"
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(node) => { refs.current[index] = node; }}
              id={`${workspaceId}-subtab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${workspaceId}-subpanel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              /* Not rendered on the rail: two stacked lines forced a 58px
                 button and made the second level of navigation taller and
                 louder than the first. Same trade the role tabs already make at
                 900px (globals.css:3080) — the title attribute carries it, and
                 the tab's accessible NAME improves by losing it, going from
                 "Limits Headroom & concentration" to "Limits". */
              title={tab.description}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <strong>{tab.label}</strong>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface WorkspaceSubtabPanelProps<T extends string> {
  workspaceId: string;
  tabId: T;
  activeId: T;
  className?: string;
  children: ReactNode;
}

export function WorkspaceSubtabPanel<T extends string>({
  workspaceId,
  tabId,
  activeId,
  className,
  children,
}: WorkspaceSubtabPanelProps<T>) {
  return (
    <section
      id={`${workspaceId}-subpanel-${tabId}`}
      className={["workspace-subtab-panel", className].filter(Boolean).join(" ")}
      role="tabpanel"
      aria-labelledby={`${workspaceId}-subtab-${tabId}`}
      hidden={activeId !== tabId}
      tabIndex={0}
    >
      {children}
    </section>
  );
}
