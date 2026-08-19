"use client";

import { KeyboardEvent, ReactNode, useEffect, useRef, useState } from "react";

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
  /**
   * Whether the owning workspace is the visible tab. Persistent panels keep
   * their rail mounted behind `hidden`, where it measures 0 — only the active
   * rail may publish `--rail-h`. Defaults to true for rails that unmount on
   * leave (Research, Live).
   */
  active?: boolean;
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
  active = true,
}: WorkspaceSubtabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const railRef = useRef<HTMLElement | null>(null);

  /**
   * Publishes the rail's measured height as `--rail-h`.
   *
   * The mirror of what WorkspaceHeader does for `--header-h`, and for the same
   * reason: `--chrome-rail` is a 40px desk-width constant, but below 620px the
   * rail becomes a native picker with its own actions row and stands around
   * 130px. Every sticky offset and every `scroll-margin-top` read the constant,
   * so a deep link scrolled its target to a position the chrome then covered.
   * Exactly one rail is VISIBLE at a time, but visited panels persist behind
   * `hidden` (globals.css forces `display: none`), and a rail's observer fires
   * a 0-size observation the instant its panel hides — so only the active rail
   * publishes, the same "hidden tabs stay quiet" gate the persistent-panel
   * change threads into every poller. Deactivation disconnects the observer,
   * which also discards any pending zero-height delivery.
   */
  useEffect(() => {
    if (!active) return;
    const node = railRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      document.documentElement.style.setProperty(
        "--rail-h",
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);
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
    <nav className="workspace-subtabs" aria-label={`${label} navigation`} ref={railRef}>
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
          {/* The description row is gone from the phone picker: it cost a line
              of a chrome budget already eating 40% of a small screen, and the
              same text is one tap away in the palette and present on every
              desk-width rail button. */}
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

/**
 * A section mounts the first time it is opened, and stays mounted after.
 *
 * Every panel used to render its children immediately and merely hide the ones
 * that were not active, which meant arriving on Research built all eight of its
 * sections at once — the tear sheet, the walk-forward timeline, the fourteen
 * strategy cards, the lineage DAG, the run history — to show one. Measured at
 * 4x CPU throttle that was a 69 ms long task, the only switch on the desk that
 * produced one at all.
 *
 * Deferring is not the same as unmounting. Once a section has been opened it
 * stays mounted for the life of the workspace, so its scroll position, its
 * expanded disclosures and any run it is holding survive switching away and
 * back — which is the property the always-render version was protecting, and
 * the reason this is a latch rather than `activeId === tabId`.
 *
 * The <section> itself always renders. It carries the tabpanel role and the
 * aria-labelledby that the rail's buttons point at, and a tab control whose
 * aria-controls names an element that does not exist is broken for a screen
 * reader whether or not anyone can see it.
 */
export function WorkspaceSubtabPanel<T extends string>({
  workspaceId,
  tabId,
  activeId,
  className,
  children,
}: WorkspaceSubtabPanelProps<T>) {
  const active = activeId === tabId;
  const [opened, setOpened] = useState(active);
  useEffect(() => {
    if (active) setOpened(true);
  }, [active]);

  return (
    <section
      id={`${workspaceId}-subpanel-${tabId}`}
      className={["workspace-subtab-panel", className].filter(Boolean).join(" ")}
      data-workspace-id={workspaceId}
      role="tabpanel"
      aria-labelledby={`${workspaceId}-subtab-${tabId}`}
      hidden={!active}
      tabIndex={0}
    >
      {opened ? children : null}
    </section>
  );
}
