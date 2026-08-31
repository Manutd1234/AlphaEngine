"use client";

/**
 * The Data tab's work queue, persisted on the gateway — the workspace's half.
 *
 * The board renders `items` and calls back with each edit; this hook owns the
 * network: it loads the persisted list on mount and on a slow interval,
 * pushes every edit as a versioned PATCH or a POST, and reconciles what the
 * gateway says. Three outcomes are first-class rather than swallowed:
 *
 *   conflict     someone else changed the row first. The gateway's current
 *                row replaces the optimistic edit and the board is told so.
 *   unreachable  the gateway did not answer. The edit is held here, the
 *                source flips to "local", and the hold is replayed on the
 *                next successful load — a held create is re-posted, a held
 *                move re-patched against the fresh version.
 *   unauthorised this deployment wants an operator credential for writes.
 *                The optimistic edit is rolled back and the reason shown.
 *
 * A delete follows the same three outcomes, with one fewer: there is no
 * conflict case, because a delete quotes no version. A held delete is
 * replayed like a held move; a 404 on replay means someone else already
 * removed it, which is the outcome that was asked for.
 *
 * Nothing here is lost silently, and nothing here claims to be confirmed
 * until the gateway said so.
 */

import { useCallback, useRef, useState } from "react";

import type { DataWorkMutation } from "@/components/data/DataWorkBoard";
import { deleteDataWorkItem, removeDataWorkItem } from "@/lib/data-work-delete";
import { pollingFailure, type PollingTickResult } from "@/lib/polling";
import { useDeskSource } from "@/lib/use-desk-source";
import { usePolling } from "@/lib/use-polling";
import {
  createDataWorkItem,
  loadDataWorkItems,
  patchDataWorkItem,
  upsertDataWorkItem,
  type DataWorkItem,
  type DataWorkSource,
} from "@/lib/data-work-queue";

export const DATA_WORK_REFRESH_MS = 60_000;

interface HeldWrite {
  mutation: DataWorkMutation;
}

export interface DataWorkQueueView {
  items: DataWorkItem[];
  setItems: (items: DataWorkItem[]) => void;
  source: DataWorkSource;
  pendingWrites: number;
  /** The last thing the gateway said about a write, for the board's live region. */
  notice: string | null;
  mutate: (mutation: DataWorkMutation) => void;
  reload: () => Promise<void>;
}

export function useDataWorkQueue(options: { token: string | null; active: boolean }): DataWorkQueueView {
  // Empty until the gateway returns rows. The gateway may itself return
  // explicitly marked seed rows, but a failed browser read must not invent the
  // same queue locally and make an unavailable backend look populated.
  const [items, setItems] = useState<DataWorkItem[]>([]);
  const [gatewaySource, setGatewaySource] = useState<Extract<DataWorkSource, { kind: "gateway" }> | null>(null);
  const [held, setHeld] = useState<HeldWrite[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const { state: sourceState, observe: observeSource } = useDeskSource<DataWorkItem[]>();
  const localReason = useRef("not loaded yet");
  const token = options.token;
  const heldRef = useRef(held);
  heldRef.current = held;

  // One failed probe demotes persistence immediately. Promotion back to a live
  // gateway needs the shared two-success streak, so an alternating endpoint
  // cannot flip the source pill and Persistence tile once per poll.
  const source: DataWorkSource = sourceState.tier === "live" && gatewaySource
    ? gatewaySource
    : { kind: "local", reason: sourceState.failure?.message ?? localReason.current };

  const markUnavailable = useCallback((reason: string) => {
    localReason.current = reason;
    observeSource({ ok: false, failure: { code: "gateway_unreachable", message: reason } });
  }, [observeSource]);

  const replayHeld = useCallback(async (fresh: DataWorkItem[]) => {
    const pending = heldRef.current;
    if (!pending.length) return fresh;
    let list = fresh;
    const stillHeld: HeldWrite[] = [];
    let replayed = 0;
    for (const write of pending) {
      const m = write.mutation;
      if (m.type === "create") {
        const result = await createDataWorkItem(
          { kind: m.item.kind, priority: m.item.priority, title: m.item.title, summary: m.item.summary, owner: m.item.owner, area: m.item.area },
          token,
        );
        if (result.ok) {
          // The gateway minted the id; the local placeholder goes.
          list = upsertDataWorkItem(list.filter((i) => i.id !== m.item.id), result.item);
          replayed += 1;
        } else if (result.code === "unreachable") {
          stillHeld.push(write);
        }
      } else if (m.type === "delete") {
        const result = await deleteDataWorkItem(m.item.id, token);
        if (result.ok || result.code === "not_found") {
          list = removeDataWorkItem(list, m.item.id);
          replayed += 1;
        } else if (result.code === "unreachable") {
          stillHeld.push(write);
        }
      } else {
        const current = list.find((i) => i.id === m.item.id);
        if (!current) continue;
        const result = await patchDataWorkItem(m.item.id, current.version, { status: m.status }, token);
        if (result.ok) {
          list = upsertDataWorkItem(list, result.item);
          replayed += 1;
        } else if (result.code === "unreachable") {
          stillHeld.push(write);
        } else if (result.code === "conflict" && result.current) {
          list = upsertDataWorkItem(list, result.current);
        }
      }
    }
    setHeld(stillHeld);
    if (replayed) setNotice(`${replayed} held ${replayed === 1 ? "edit" : "edits"} reached the gateway.`);
    return list;
  }, [token]);

  const loadOnce = useCallback(async (): Promise<PollingTickResult> => {
    const result = await loadDataWorkItems();
    if (!result.ok) {
      markUnavailable(result.reason);
      return pollingFailure(result.reason);
    }
    const merged = await replayHeld(result.items);
    setItems(merged);
    setGatewaySource(result.source);
    observeSource({ ok: true, payload: merged });
  }, [markUnavailable, observeSource, replayHeld]);

  // Manual refresh stays a quiet Promise<void>. The polling loop consumes the
  // typed failure result from `loadOnce`, which is what makes backoff reachable.
  const reload = useCallback(async () => {
    await loadOnce();
  }, [loadOnce]);

  usePolling({
    tick: loadOnce,
    intervalMs: DATA_WORK_REFRESH_MS,
    maxBackoffMs: 300_000,
    immediate: true,
    enabled: options.active,
  });

  const mutate = useCallback((mutation: DataWorkMutation) => {
    void (async () => {
      if (mutation.type === "create") {
        const m = mutation;
        const result = await createDataWorkItem(
          { kind: m.item.kind, priority: m.item.priority, title: m.item.title, summary: m.item.summary, owner: m.item.owner, area: m.item.area },
          token,
        );
        if (result.ok) {
          setItems((current) => upsertDataWorkItem(current.filter((i) => i.id !== m.item.id), result.item));
          setNotice(`${result.item.id} saved on the gateway.`);
          setGatewaySource((s) => (s ? { ...s, count: s.count + 1 } : s));
        } else if (result.code === "unreachable") {
          setHeld((h) => [...h, { mutation }]);
          markUnavailable(result.error);
          setNotice(`${m.item.id} is held locally until the gateway answers.`);
        } else {
          // Rejected or unauthorised: roll the optimistic row back and say why.
          setItems((current) => current.filter((i) => i.id !== m.item.id));
          setNotice(`${m.item.id} was not saved: ${result.error}`);
        }
        return;
      }
      if (mutation.type === "delete") {
        const m = mutation;
        const result = await deleteDataWorkItem(m.item.id, token);
        if (result.ok || result.code === "not_found") {
          // Gone, or already gone: either way the row the reader removed is not there.
          setNotice(`${m.item.id} deleted${result.ok ? " on the gateway" : ""}.`);
          setGatewaySource((s) => (s && result.ok ? { ...s, count: Math.max(0, s.count - 1) } : s));
        } else if (result.code === "unreachable") {
          setHeld((h) => [...h, { mutation }]);
          markUnavailable(result.error);
          setNotice(`${m.item.id} delete is held locally until the gateway answers.`);
        } else {
          // Rejected or unauthorised: the row comes back, and the reason with it.
          setItems((current) => upsertDataWorkItem(current, m.item));
          setNotice(`${m.item.id} was not deleted: ${result.error}`);
        }
        return;
      }
      const m = mutation;
      const result = await patchDataWorkItem(m.item.id, m.item.version, { status: m.status }, token);
      if (result.ok) {
        setItems((current) => upsertDataWorkItem(current, result.item));
      } else if (result.code === "conflict") {
        if (result.current) setItems((current) => upsertDataWorkItem(current, result.current!));
        setNotice(`${m.item.id} was changed elsewhere; showing the current version.`);
      } else if (result.code === "unreachable") {
        setHeld((h) => [...h, { mutation }]);
        markUnavailable(result.error);
        setNotice(`${m.item.id} move is held locally until the gateway answers.`);
      } else {
        // Roll back to the last known row and say why.
        setItems((current) => upsertDataWorkItem(current, m.item));
        setNotice(`${m.item.id} was not moved: ${result.error}`);
      }
    })();
  }, [markUnavailable, token]);

  return { items, setItems, source, pendingWrites: held.length, notice, mutate, reload };
}
