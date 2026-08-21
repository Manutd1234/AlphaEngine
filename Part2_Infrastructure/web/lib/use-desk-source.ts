"use client";

/**
 * `DeskSourceMachine` for React.
 *
 * The machine is deliberately not a hook (see `lib/desk-source.ts`) so it can
 * be driven by a scripted sequence of probe outcomes with no DOM. This is the
 * thin part, and it is thin on purpose: keep one machine for the component's
 * life, publish a snapshot after anything that mutates it, and hand back the
 * four verbs. Same shape as `usePolling` over `PollingController` and
 * `useThrottledValue` over `ValueThrottle`.
 *
 * It exists as a module rather than as eight lines repeated in `useBook` and
 * `useCockpitFeed` because those two hooks disagreeing about the desk's source
 * is the whole defect the machine was written to end — and two copies of the
 * wiring is how they would drift apart again.
 *
 * The snapshot is a fresh object per publish, which is what re-renders the
 * consumer. `DeskSourceMachine` is mutable by design: React reads `state`,
 * never the machine.
 */

import { useCallback, useRef, useState } from "react";

import {
  DeskSourceMachine,
  type DeskSource,
  type DeskSourceOptions,
  type DeskSourceState,
  type ProbeOutcome,
} from "@/lib/desk-source";

export interface UseDeskSource<T> {
  state: DeskSourceState<T>;
  /** Record a settled probe. Never call with a superseded or cancelled one. */
  observe: (outcome: ProbeOutcome<T>) => void;
  /** A click on either side of the Live/Sandbox control. */
  choose: (source: DeskSource) => void;
  /** A choice made earlier this session, read back from storage. */
  restore: (source: DeskSource) => void;
  /** Drop the choice and let probes decide again. */
  release: () => void;
}

export function useDeskSource<T>(options?: DeskSourceOptions): UseDeskSource<T> {
  const machine = useRef<DeskSourceMachine<T> | null>(null);
  if (machine.current === null) machine.current = new DeskSourceMachine<T>(options);

  const [state, setState] = useState<DeskSourceState<T>>(() => machine.current!.state);
  const publish = useCallback(() => setState(machine.current!.state), []);

  const observe = useCallback((outcome: ProbeOutcome<T>) => {
    machine.current!.observe(outcome);
    publish();
  }, [publish]);

  const choose = useCallback((source: DeskSource) => {
    machine.current!.choose(source);
    publish();
  }, [publish]);

  const restore = useCallback((source: DeskSource) => {
    machine.current!.restore(source);
    publish();
  }, [publish]);

  const release = useCallback(() => {
    machine.current!.release();
    publish();
  }, [publish]);

  return { state, observe, choose, restore, release };
}
