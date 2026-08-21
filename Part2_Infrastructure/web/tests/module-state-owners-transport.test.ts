/**
 * The transport stores: which host to try first, and which sockets are open.
 *
 * `HostPreference` and `SocketRegistry` are the two ownerless stores that sat
 * on the wire rather than in the telemetry. Both were module-scope `Map`s that
 * more than one caller wrote, and both had a failure mode that a plain
 * variable makes easy and an owner makes unsayable:
 *
 *  - The host memo was a `Map` keyed by a string with the host array passed in
 *    separately, so an index learned for one venue could be applied to another,
 *    and a miss resolved to "prefer the primary" rather than "no change".
 *    Three modules had each grown their own copy of it.
 *  - The socket registry was keyed by venue+symbol, which StrictMode breaks by
 *    construction: it mounts, unmounts and remounts every effect, so two
 *    sockets for the same pair exist briefly and the first one's cleanup
 *    deletes the second.
 *
 * So the tests below are behavioural — a store that keeps two lists apart,
 * hands out a distinct id per socket, publishes on every change and keeps its
 * snapshot referentially stable cannot express either bug. The stability one is
 * a correctness property rather than an optimisation: `useSyncExternalStore`
 * re-renders forever if `getSnapshot` returns a fresh array on every read.
 *
 * The structural guard on exported mutable bindings lives in
 * `module-state-owners-exported-bindings`; the telemetry stores that answer the
 * singleton-swap hazard live in `module-state-owners-observability`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HostPreference } from "../lib/host-preference";
import { SocketRegistry, type SocketHandle } from "../lib/socket-registry";

// --------------------------------------------------------------------------
// HostPreference — the memo three modules had each grown their own copy of
// --------------------------------------------------------------------------

describe("HostPreference remembers a host without pinning to it", () => {
  const HOSTS = ["https://primary", "https://mirror", "https://third"];

  it("starts on the declared order", () => {
    assert.deepEqual([...new HostPreference(HOSTS).ordered()], HOSTS);
  });

  it("moves the remembered host to the front and keeps the rest", () => {
    const pref = new HostPreference(HOSTS);
    pref.remember("https://mirror");
    assert.deepEqual(
      [...pref.ordered()],
      ["https://mirror", "https://primary", "https://third"],
      "the non-preferred hosts must still be walked; a preference that returns one host is a pin, "
        + "and one bad answer would strand the venue",
    );
  });

  it("ignores a host that is not in the list", () => {
    // The old write sites read `preferredHost = Math.max(0, HOSTS.indexOf(host))`,
    // which turned a miss into "prefer the primary" rather than "no change".
    const pref = new HostPreference(HOSTS);
    pref.remember("https://mirror");
    pref.remember("https://not-a-host");
    assert.equal(pref.preferred(), "https://mirror");
  });

  it("forgets on reset", () => {
    const pref = new HostPreference(HOSTS);
    pref.remember("https://third");
    pref.reset();
    assert.deepEqual([...pref.ordered()], HOSTS);
  });

  it("keeps two lists apart", () => {
    // The Map this replaces was keyed by a string with the host array passed in
    // separately, so an index learned for one venue could be applied to another.
    const a = new HostPreference(["https://a1", "https://a2"]);
    const b = new HostPreference(["https://b1", "https://b2"]);
    a.remember("https://a2");
    assert.equal(a.preferred(), "https://a2");
    assert.equal(b.preferred(), "https://b1");
  });
});

// --------------------------------------------------------------------------
// SocketRegistry
// --------------------------------------------------------------------------

function handle(registry: SocketRegistry, symbol: string): SocketHandle & { restarts: number } {
  const h = {
    id: registry.nextId(),
    venue: "BINANCE" as const,
    symbol,
    openedAt: 0,
    restarts: 0,
    restart() { h.restarts += 1; },
    stop() { registry.remove(h.id); },
  };
  return h;
}

describe("SocketRegistry publishes whenever it changes", () => {
  it("hands out a distinct id per socket", () => {
    // StrictMode mounts, unmounts and remounts every effect, so two sockets for
    // the same venue and symbol exist briefly. Keying on venue+symbol would have
    // the second overwrite the first, and the first's cleanup delete the second.
    const registry = new SocketRegistry();
    const a = handle(registry, "BTCUSDT");
    const b = handle(registry, "BTCUSDT");
    registry.add(a);
    registry.add(b);
    assert.notEqual(a.id, b.id);
    assert.equal(registry.size(), 2);
  });

  it("notifies subscribers on add and on remove", () => {
    const registry = new SocketRegistry();
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => { notifications += 1; });
    const a = handle(registry, "BTCUSDT");
    registry.add(a);
    registry.remove(a.id);
    assert.equal(notifications, 2);
    unsubscribe();
    registry.add(handle(registry, "ETHUSDT"));
    assert.equal(notifications, 2, "an unsubscribed listener must stop being called");
  });

  it("keeps the snapshot referentially stable between changes", () => {
    // `useSyncExternalStore` re-renders forever if `getSnapshot` returns a fresh
    // array on every read, so this is a correctness property, not an
    // optimisation.
    const registry = new SocketRegistry();
    registry.add(handle(registry, "BTCUSDT"));
    assert.equal(registry.read(), registry.read());
    const before = registry.read();
    registry.add(handle(registry, "ETHUSDT"));
    assert.notEqual(registry.read(), before);
  });

  it("summarises without exposing the handles", () => {
    const registry = new SocketRegistry();
    registry.add(handle(registry, "BTCUSDT"));
    const [summary] = registry.read();
    assert.deepEqual(Object.keys(summary).sort(), ["id", "openedAt", "symbol", "venue"]);
  });

  it("restarts every live socket and reports how many cycled", () => {
    const registry = new SocketRegistry();
    const a = handle(registry, "BTCUSDT");
    const b = handle(registry, "ETHUSDT");
    registry.add(a);
    registry.add(b);
    assert.equal(registry.restartAll(), 2);
    assert.equal(a.restarts, 1);
    assert.equal(b.restarts, 1);
    assert.equal(registry.size(), 2, "a restart is a re-handshake, not a close");
  });

  it("reports an empty registry as empty rather than as loading", () => {
    assert.deepEqual(new SocketRegistry().read(), []);
  });
});
