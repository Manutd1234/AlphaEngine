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
  /**
   * Fired when a reader looks like they are about to open a section — a
   * pointer crossing its tab, or focus landing on it.
   *
   * The mirror of `WorkspaceHeader`'s `onViewIntent`, and needed for the same
   * reason one level down: the Kalshi engine's sections each open a live
   * exchange read that takes seconds, gated on the section being on screen, so
   * every first visit met a loading line. A hover is several hundred
   * milliseconds of warning. Optional — a rail whose sections read nothing
   * passes nothing, and no other rail on the desk has anything to warm.
   */
  onIntent?: (id: T) => void;
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
  onIntent,
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
   *
   * Two guards make the write safe to do from a resize observation at all,
   * and WorkspaceHeader carries both for `--header-h`. First, it publishes
   * only when the rounded height actually CHANGED: a custom property on the
   * root element is inherited by every node in the document, so an identical
   * rewrite still invalidates the whole tree's style. Measured over a scripted
   * session of tab and section switches, the two publishers between them wrote
   * 176 times, in runs of three to seven consecutive identical values.
   *
   * Second, the write is deferred to the next animation frame rather than made
   * inside the callback. `--rail-h` already feeds a LAYOUT property — the
   * research sidebar's `max-height` (globals.css) — so a write made during
   * delivery dirties layout in the frame that is delivering, which is the
   * definition of a ResizeObserver loop. No rule feeds the rail's own height
   * back today, but the loop is one stylesheet edit away, and a runaway loop
   * on the desk's only scroller presents as the whole page freezing. The
   * `frame` latch also collapses a burst of observations into one write.
   */
  useEffect(() => {
    if (!active) return;
    const node = railRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    let frame = 0;
    const publish = () => {
      frame = 0;
      const next = `${Math.round(node.getBoundingClientRect().height)}px`;
      // Against what is on the element, not a local memo: eight rails share
      // this one property, so a memo would let each of them rewrite a value
      // one of the others had already put there.
      if (root.style.getPropertyValue("--rail-h") === next) return;
      root.style.setProperty("--rail-h", next);
    };
    publish();
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(publish);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active]);

  /**
   * Slides the rail sideways until the selected tab is on it. Nothing else.
   *
   * Below 820px the rail is a horizontal scroll container, and only the arrow
   * keys used to reveal what they had just activated. Every other way a
   * section changes — a tap on a half-visible tab, a cross-link from another
   * workspace, a deep link, Back — could leave the selected tab parked out of
   * view: a tablist apparently with no selection.
   *
   * This moves the rail's own `scrollLeft` rather than calling
   * `scrollIntoView`, which cannot be aimed at one axis or one box: it walks
   * EVERY scrollable ancestor, so it also moved the workspace shell. That is
   * not a hypothetical. The shell carries `scroll-padding-top: calc(var(
   * --rail-h) + var(--space-3))` and this rail is `position: sticky`, so the
   * selected tab is permanently parked INSIDE the shell's scroll-padding band
   * — a region `nearest` is defined to scroll out of, and a sticky element can
   * never leave. Driven from a page scrolled to 400px, one call on a tab that
   * was already fully visible moved the shell to 316px. Every section change
   * therefore dragged the reader 84px up the page, before the panel
   * realignment below had said anything.
   *
   * The reveal is instant like every other navigation move, so there is no
   * duration for reduced motion to shorten, and it no-ops entirely at desk
   * width, where the rail does not overflow.
   */
  const revealTab = (index: number) => {
    const node = refs.current[index];
    const track = node?.parentElement;
    if (!node || !track || track.scrollWidth <= track.clientWidth) return;
    const tab = node.getBoundingClientRect();
    const box = track.getBoundingClientRect();
    if (tab.left < box.left) track.scrollLeft -= box.left - tab.left;
    else if (tab.right > box.right) track.scrollLeft += tab.right - box.right;
  };

  /** Gated on `active` for the reason the publisher is: a hidden rail has no
   *  boxes to scroll. */
  useEffect(() => {
    if (!active) return;
    revealTab(tabs.findIndex((tab) => tab.id === activeId));
    // `revealTab` reads refs only, so it is stable in everything that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeId, tabs]);
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;

    onChange(tabs[nextIndex].id);
    // `preventScroll`, then the rail's own reveal: a bare `.focus()` asks the
    // browser to scroll the button clear of the shell's scroll-padding, which
    // it can never do for a sticky rail — see `revealTab` above. The rail is
    // pinned under the header, so the tab taking focus is on screen already.
    refs.current[nextIndex]?.focus({ preventScroll: true });
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
                  onPointerEnter={onIntent ? () => onIntent(tab.id) : undefined}
                  onFocus={onIntent ? () => onIntent(tab.id) : undefined}
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
 * that were not active, which meant arriving on Research built all nine of its
 * sections at once — the tear sheet, the walk-forward timeline, the forty-six
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
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (active) setOpened(true);
  }, [active]);

  /**
   * A section opens at its own beginning.
   *
   * Panels persist behind `hidden` and share one scroller, so the depth a
   * reader had reached in one section carried straight into the next: switch
   * subtabs 2,000px into a blotter and the incoming panel appeared already
   * scrolled to wherever the clamp left it, its heading somewhere above the
   * sticky rail. When this panel becomes the visible one and its start sits
   * above the chrome, one instant realignment brings it back — the panel's
   * own `scroll-margin-top` (globals.css) supplies the offset, so the CSS
   * stays the single authority on what the chrome measures and the landing
   * spot is just below the header and rail. Already on screen — a deep link
   * arriving at the shell's top, a switch made before scrolling anywhere —
   * and nothing moves at all: the reader is never scrolled to somewhere they
   * already are. Instant rather than smooth on purpose: a section change is a
   * cut, and a cut leaves `prefers-reduced-motion` nothing to reduce.
   *
   * The scroller is found by walking, not named: research sections scroll
   * inside `.research-content` at desk width while every other panel scrolls
   * in the workspace shell. `scrollBy` on that one box, rather than
   * `scrollIntoView`, because the latter aligns EVERY scrollable ancestor to
   * the target — it would drag the shell down past the page heading on a
   * switch made from the top, which is movement in the wrong direction.
   *
   * `opened` is in the dependency list, not just `active`. The latch above
   * flips it in a LATER commit than the one that reveals the panel, so on a
   * section's first open this ran against a `<section>` whose children had
   * not rendered yet — an empty box, measured, and realigned to the wrong
   * place. Re-running once the children exist is what makes the first visit
   * behave like every later one.
   *
   * SUPERSEDED on a routed subtab change, and deliberately kept. The shell
   * reset in `lib/use-workspace-routing.ts` is a LAYOUT effect keyed on the
   * active section, so it lands the shell at 0 before this passive one runs;
   * `drift` then computes at or above zero and this no-ops. Removing it was
   * rejected: it is the only code that resolves the right box by walking, and
   * it still fires for the scrollers routing cannot reach — `.research-content`
   * at desk width, and the in-panel `.seg` switchers that never enter the URL.
   */
  useEffect(() => {
    if (!active) return;
    const node = panelRef.current;
    if (!node) return;
    let scroller = node.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const clearance = parseFloat(getComputedStyle(node).scrollMarginTop) || 0;
    const drift = node.getBoundingClientRect().top
      - (scroller.getBoundingClientRect().top + clearance);
    if (drift < 0) scroller.scrollBy({ top: drift, behavior: "auto" });
  }, [active, opened]);

  return (
    <section
      ref={panelRef}
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
