/**
 * Deleting a work item — the call, and the list arithmetic that follows it.
 *
 * Kept beside `data-work-queue.ts` rather than in it because that file is at
 * the length ceiling. Same transport, same outcome vocabulary: a delete is
 * `DataWorkWrite` minus the conflict case, because there is no version for a
 * delete to be stale against.
 */

import {
  authHeaders,
  fromWire,
  isDataWorkItemWire,
  withDeadline,
  type DataWorkItem,
} from "@/lib/data-work-queue";

export type DataWorkDelete =
  | { ok: true; item: DataWorkItem }
  | { ok: false; code: "not_found" | "rejected" | "unreachable" | "unauthorised"; error: string };

export async function deleteDataWorkItem(id: string, token: string | null = null): Promise<DataWorkDelete> {
  try {
    const response = await withDeadline(`/api/gateway/data/work-items/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.status === 404) return { ok: false, code: "not_found", error: `no work item ${id} on the gateway` };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "unauthorised", error: String(body?.error ?? "an operator credential is required to delete items") };
    }
    if (!response.ok || !isDataWorkItemWire(body)) {
      return { ok: false, code: response.status >= 500 || response.status === 0 ? "unreachable" : "rejected", error: String(body?.error ?? `HTTP ${response.status}`) };
    }
    return { ok: true, item: fromWire(body) };
  } catch {
    return { ok: false, code: "unreachable", error: "the work queue is unreachable" };
  }
}

/** The list without one id, order kept. */
export function removeDataWorkItem(items: readonly DataWorkItem[], id: string): DataWorkItem[] {
  return items.filter((item) => item.id !== id);
}
