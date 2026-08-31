import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCoherenceShell, isCoherenceSurface } from "../lib/coherence/types-lab";
import { coherenceFallbackFor } from "./helpers/coherence-fallback-data";

describe("coherence runtime guards", () => {
  it("accepts the complete surface sandbox payload", () => {
    const payload = coherenceFallbackFor(
      "/api/gateway/coherence/surface?event_ticker=KXFEDDECISION-28JAN",
    );
    assert.equal(isCoherenceSurface(payload), true);
  });

  it("rejects malformed surface members before fixed-point parsing", () => {
    const payload = structuredClone(coherenceFallbackFor(
      "/api/gateway/coherence/surface?event_ticker=KXFEDDECISION-28JAN",
    )) as Record<string, unknown>;
    const probes = payload.probes as Array<Record<string, unknown>>;
    probes[0] = { ...probes[0], strike: 25 };
    assert.equal(isCoherenceSurface(payload), false);
  });

  it("accepts shell listings and rejects unsafe paths or entry kinds", () => {
    const payload = coherenceFallbackFor("/api/gateway/coherence/shell?path=%2F&command=ls");
    assert.equal(isCoherenceShell(payload), true);

    assert.equal(isCoherenceShell({ ...(payload as object), path: undefined }), false);
    assert.equal(isCoherenceShell({
      ...(payload as object),
      entries: [{ name: "implied_pmf", kind: "link", detail: "not navigable" }],
    }), false);
  });
});
