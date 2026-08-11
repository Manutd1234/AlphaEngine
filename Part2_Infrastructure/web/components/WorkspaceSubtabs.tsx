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
  /** Surface-level controls that stay reachable while the rail is stuck. */
  actions?: ReactNode;
  /**
   * Sections that are reference material rather than a step in the workflow —
   * a run archive, a sample work queue. They keep their place on the rail with
   * a quieter treatment, so the operational sections remain visually primary.
   */
  secondary?: readonly T[];
}

/**
 * A compact second level of navigation for the dense role workspaces.
 *
 * Arrow keys activate the adjacent section, matching the automatic-activation
 * pattern used by the primary workspace tabs. The controlled API lets the
 * parent keep every feature panel mounted, so chart selections, draft orders,
 * and scenario inputs survive a section switch.
 *
 * The rail is sticky under the global tab bar. On narrow screens it becomes a
 * native section picker: every destination stays visible without a multi-row
 * tab grid or a hidden horizontal drag gesture.
 */
export default function WorkspaceSubtabs<T extends string>({
  workspaceId,
  label,
  tabs,
  activeId,
  onChange,
  actions,
  secondary,
}: WorkspaceSubtabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const revealTab = (index: number) => {
    const node = refs.current[index];
    node?.focus();
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;

    onChange(tabs[nextIndex].id);
    revealTab(nextIndex);
  };

  return (
    // Three distinct accessible names on purpose: the landmark, the tablist
    // and the mobile select used to share one string, so a screen-reader
    // rotor listed three identically-named controls.
    <nav className="workspace-subtabs" aria-label={`${label} navigation`}>
      <div className="workspace-subtabs__navigation">
        <div className="workspace-subtabs__rail-shell">
          <div
            className="workspace-subtabs__rail"
            data-scroll-affordance="horizontal"
            role="tablist"
            aria-label={label}
            aria-orientation="horizontal"
          >
            {tabs.map((tab, index) => {
              const selected = tab.id === activeId;
              const isSecondary = secondary?.includes(tab.id) ?? false;
              return (
                <button
                  key={tab.id}
                  ref={(node) => { refs.current[index] = node; }}
                  id={`${workspaceId}-subtab-${tab.id}`}
                  type="button"
                  role="tab"
                  className={isSecondary ? "is-secondary" : undefined}
                  aria-selected={selected}
                  aria-current={selected ? "page" : undefined}
                  aria-controls={`${workspaceId}-subpanel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  title={tab.description}
                  onClick={() => onChange(tab.id)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  <strong>{tab.label}</strong>
                </button>
              );
            })}
          </div>
        </div>

        <label className="workspace-subtabs__picker">
          <span>Section</span>
          <select
            value={activeId}
            aria-label={`${label} — section picker`}
            onChange={(event) => {
              const next = tabs.find((tab) => tab.id === event.target.value);
              if (next) onChange(next.id);
            }}
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>
          <small>{activeTab?.description}</small>
        </label>
      </div>
      {actions && (
        <div className="workspace-subtabs__actions">
          {actions}
        </div>
      )}
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
      data-workspace-id={workspaceId}
      role="tabpanel"
      aria-labelledby={`${workspaceId}-subtab-${tabId}`}
      hidden={activeId !== tabId}
      tabIndex={0}
    >
      {children}
    </section>
  );
}
