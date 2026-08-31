import { useSyncExternalStore } from "react";

type Listener = () => void;

export interface SecondHandDrivers {
  now: () => number;
  start: (publish: () => void) => unknown;
  stop: (handle: unknown) => void;
}

/**
 * A demand-driven one-second store. The factory is exported so its timer
 * ownership can be proved without a renderer; the workspace uses the single
 * module instance below.
 */
export function createSecondHand(drivers: SecondHandDrivers) {
  const listeners = new Set<Listener>();
  let handle: unknown = null;
  let snapshot = 0;

  const publish = () => {
    snapshot = drivers.now();
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      snapshot = drivers.now();
      handle = drivers.start(publish);
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
      if (listeners.size === 0 && handle !== null) {
        drivers.stop(handle);
        handle = null;
        snapshot = 0;
      }
    };
  };

  return {
    subscribe,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => 0,
  };
}

const sharedSecondHand = createSecondHand({
  now: () => Date.now(),
  start: (publish) => globalThis.setInterval(publish, 1_000),
  stop: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
});

export function useSharedSecondHand() {
  return useSyncExternalStore(
    sharedSecondHand.subscribe,
    sharedSecondHand.getSnapshot,
    sharedSecondHand.getServerSnapshot,
  );
}
