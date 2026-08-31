/**
 * Keep the canonical workspace type without making this tiny URL helper pull
 * the rendered header into source-closure audits. An import type is erased at
 * runtime, but the repository's static-copy inventory deliberately follows
 * import declarations; an import-type query preserves that same source type
 * without pretending the header contributes copy to every linked row.
 */
export type WorkspaceEntityView = import("@/lib/workspace-nav").WorkspaceView;

/** The records a reader can hand from one desk surface to another. */
export type WorkspaceEntityKind = "ticker" | "order" | "breach" | "trace" | "provider";

export interface WorkspaceEntityTarget {
  kind: WorkspaceEntityKind;
  value: string;
  view: WorkspaceEntityView;
  section: string;
}

/**
 * One honest default destination per entity. Callers may override the
 * destination when their context names a more specific owner, but never need
 * to hand-author the URL vocabulary.
 */
export const WORKSPACE_ENTITY_DESTINATIONS = {
  ticker: { view: "research", section: "summary" },
  order: { view: "live", section: "activity" },
  breach: { view: "risk", section: "limits" },
  trace: { view: "reliability", section: "events" },
  provider: { view: "reliability", section: "services" },
} as const satisfies Record<WorkspaceEntityKind, { view: WorkspaceEntityView; section: string }>;

const KIND_PARAM = "entity";
const VALUE_PARAM = "entityId";

export function entityDomToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

export function workspaceEntityTarget(
  kind: WorkspaceEntityKind,
  value: string,
  destination: { view: WorkspaceEntityView; section: string } = WORKSPACE_ENTITY_DESTINATIONS[kind],
): WorkspaceEntityTarget {
  return { kind, value, ...destination };
}

/** Add one selected record to a canonical workspace URL. */
export function writeWorkspaceEntity(url: URL, target: WorkspaceEntityTarget): URL {
  url.searchParams.set(KIND_PARAM, target.kind);
  url.searchParams.set(VALUE_PARAM, target.value);
  url.hash = `${target.view}/${target.section}`;
  return url;
}

/** Normal tab/section navigation deliberately leaves record-inspection mode. */
export function clearWorkspaceEntity(url: URL): URL {
  url.searchParams.delete(KIND_PARAM);
  url.searchParams.delete(VALUE_PARAM);
  return url;
}

export function readWorkspaceEntity(url: URL): WorkspaceEntityTarget | null {
  const kind = url.searchParams.get(KIND_PARAM);
  const value = url.searchParams.get(VALUE_PARAM)?.trim();
  if (!value || !kind || !(kind in WORKSPACE_ENTITY_DESTINATIONS)) return null;
  const fallback = WORKSPACE_ENTITY_DESTINATIONS[kind as WorkspaceEntityKind];
  const [hashView, hashSection] = url.hash.slice(1).split("/");
  /**
   * `writeWorkspaceEntity` permits a caller to name a more specific owner than
   * the kind-wide default. Preserve that owner on reload, Back and Forward.
   * The workspace hash router remains the authority that validates whether the
   * pair exists; this reader only restores the same pair the URL already asks
   * that router to open, so it cannot create a second navigation registry.
   */
  const destination = hashView && hashSection
    ? { view: hashView as WorkspaceEntityView, section: hashSection }
    : fallback;
  return workspaceEntityTarget(kind as WorkspaceEntityKind, value, destination);
}

/** Exact record first, then the panel that owns it. */
export function workspaceEntityFocusIds(target: WorkspaceEntityTarget): string[] {
  const token = entityDomToken(target.value);
  const exact: Record<WorkspaceEntityKind, string> = {
    ticker: `entity-ticker-${token}`,
    order: `blotter-row-${token}`,
    breach: `risk-constraint-${token}`,
    trace: `trace-event-${token}`,
    provider: `provider-row-${token}`,
  };
  return [exact[target.kind], `${target.view}-subpanel-${target.section}`];
}
