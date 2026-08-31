import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isExpectedApiUnavailable,
  isExpectedExternalStreamShutdown,
} from "../scripts/engine-layout-audit.mjs";

describe("the rendered audit keeps honest transport unavailability distinct from UI errors", () => {
  it("records only an API's explicit 503 resource message as an unavailable read", () => {
    const message = "Failed to load resource: the server responded with a status of 503 (Service Unavailable)";
    assert.equal(isExpectedApiUnavailable(message, { url: "http://localhost:3101/api/gateway/coherence/books" }), true);
    assert.equal(isExpectedApiUnavailable(message, { url: "http://localhost:3101/api/oracle/var" }), true);
    assert.equal(isExpectedApiUnavailable(message, { url: "http://localhost:3101/app.css" }), false);
    assert.equal(isExpectedApiUnavailable(
      "TypeError: Cannot read properties of undefined",
      { url: "http://localhost:3101/api/gateway/coherence/books" },
    ), false);
  });

  it("records only the known socket-close race as audit teardown", () => {
    assert.equal(isExpectedExternalStreamShutdown(
      "WebSocket connection to 'wss://stream.binance.com:9443/stream?streams=btcusdt@depth20@100ms' failed: Ping received after close",
    ), true);
    assert.equal(isExpectedExternalStreamShutdown(
      "WebSocket connection to 'wss://stream.binance.com/' failed: connection refused",
    ), false);
  });
});
