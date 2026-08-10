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
   * a run archive, a sample work queue. They keep their place on the rail but
   * drop out of the numbering and sit after a divider, so the numbered run
   * reads as the actual sequence of the desk's job.
   */
  secondary?: readonly T[];
  /**
   * Sections opened this session: their step number cross-fades to a ✓.
   * Deliberately per-session and never persisted — a marker that survives
   * reload claims memory of a session that no longer exists.
   */
  visited?: readonly T[];
}

/**
 * A compact second level of navigation for the dense role workspaces.
 *
 * Arrow keys activate the adjacent section, matching the automatic-activation
 * pattern used by the primary workspace tabs. The controlled API lets the
 * parent keep every feature panel mounted, so chart selections, draft orders,
 * and scenario inputs survive a section switch.
 *
 * The rail is sticky under the global tab bar. These workspaces are tall — the
 * lineage inspector and the blotter both run past a screen — and a rail that
 * scrolled away meant every section change started with a scroll back to the
 * top. Two fixed bars, 96px total, and section navigation is always one click.
 */
export default function WorkspaceSubtabs<T extends string>({
  workspaceId,
  label,
  tabs,
  activeId,
  onChange,
  actions,
  secondary,
  visited,
}: WorkspaceSubtabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // The numbered spine: every tab that is not reference material, in order.
  const steps = tabs.filter((tab) => !secondary?.includes(tab.id));
  const activeStep = steps.findIndex((tab) => tab.id === activeId);
  const nextStep = activeStep >= 0 ? steps[activeStep + 1] : undefined;

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
          const step = steps.indexOf(tab);
          const isSecondary = step === -1;
          const isVisited = !isSecondary && (visited?.includes(tab.id) ?? false);
          return (
            <button
              key={tab.id}
              ref={(node) => { refs.current[index] = node; }}
              id={`${workspaceId}-subtab-${tab.id}`}
              type="button"
              role="tab"
              className={isSecondary ? "is-secondary" : undefined}
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
              aria-label={isVisited ? `${tab.label}, visited` : undefined}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {!isSecondary && (
                /* Number and ✓ occupy the same grid cell; visiting cross-fades
                   between them. Glyph, never colour alone. */
                <span
                  className={`workspace-subtabs__step${isVisited ? " is-visited" : ""}`}
                  aria-hidden
                >
                  <span className="workspace-subtabs__step-num">{step + 1}</span>
                  <span className="workspace-subtabs__step-check">✓</span>
                </span>
              )}
              <strong>{tab.label}</strong>
            </button>
          );
        })}
      </div>
      {(actions || nextStep) && (
        <div className="workspace-subtabs__actions">
          {actions}
          {nextStep && (
            /* Walks the numbered spine without a trip back to the rail. Text,
               not a filled button: the surface's own primary action lives in
               this slot too, and two solids competing is what the last pass
               was spent undoing. */
            <button
              type="button"
              className="workspace-subtabs__advance"
              onClick={() => onChange(nextStep.id)}
              aria-label={`Next section: ${nextStep.label}`}
            >
              Next: {nextStep.label} <span aria-hidden>→</span>
            </button>
          )}
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
      role="tabpanel"
      aria-labelledby={`${workspaceId}-subtab-${tabId}`}
      hidden={activeId !== tabId}
      tabIndex={0}
    >
      {children}
    </section>
  );
}
