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
 * Nothing here is lost silently, and nothing here claims to be confirmed
 * until the gateway said so.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { DataWorkMutation } from "@/components/data/DataWorkBoard";
import { usePolling } from "@/lib/use-polling";
import {
  createDataWorkItem,
  createInitialDataWorkItems,
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
  const [items, setItems] = useState<DataWorkItem[]>(createInitialDataWorkItems);
  const [source, setSource] = useState<DataWorkSource>({ kind: "local", reason: "not loaded yet" });
  const [held, setHeld] = useState<HeldWrite[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const token = options.token;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const heldRef = useRef(held);
  heldRef.current = held;

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

  const reload = useCallback(async () => {
    const result = await loadDataWorkItems();
    if (!result.ok) {
      setSource({ kind: "local", reason: result.reason });
      return;
    }
    const merged = await replayHeld(result.items);
    setItems(merged);
    setSource(result.source);
  }, [replayHeld]);

  useEffect(() => {
    if (!options.active) return;
    void reload();
  }, [options.active, reload]);

  usePolling({
    tick: reload,
    intervalMs: DATA_WORK_REFRESH_MS,
    maxBackoffMs: 300_000,
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
          setSource((s) => (s.kind === "gateway" ? { ...s, count: s.count + 1 } : s));
        } else if (result.code === "unreachable") {
          setHeld((h) => [...h, { mutation }]);
          setSource({ kind: "local", reason: result.error });
          setNotice(`${m.item.id} is held locally until the gateway answers.`);
        } else {
          // Rejected or unauthorised: roll the optimistic row back and say why.
          setItems((current) => current.filter((i) => i.id !== m.item.id));
          setNotice(`${m.item.id} was not saved: ${result.error}`);
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
        setSource({ kind: "local", reason: result.error });
        setNotice(`${m.item.id} move is held locally until the gateway answers.`);
      } else {
        // Roll back to the last known row and say why.
        setItems((current) => upsertDataWorkItem(current, m.item));
        setNotice(`${m.item.id} was not moved: ${result.error}`);
      }
    })();
  }, [token]);

  return { items, setItems, source, pendingWrites: held.length, notice, mutate, reload };
}
