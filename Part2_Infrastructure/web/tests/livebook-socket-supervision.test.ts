import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { connect } from "../lib/livebook-socket";
import type { SocketHandle } from "../lib/socket-registry";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000 } as CloseEvent);
  }
}

const originalWebSocket = globalThis.WebSocket;
let handles: SocketHandle[] = [];

function supervised(
  statuses: string[],
  reconnects: { count: number },
  books: unknown[] = [],
): SocketHandle {
  const handle = connect("BINANCE", "BTCUSDT", {
    onBook: (book) => books.push(book),
    onStatus: (status) => statuses.push(status),
    onReconnect: () => { reconnects.count += 1; },
  }, { handshakeDeadlineMs: 10, silenceDeadlineMs: 20 });
  handles.push(handle);
  return handle;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  handles = [];
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  for (const handle of handles) handle.stop();
  globalThis.WebSocket = originalWebSocket;
  mock.timers.reset();
  mock.restoreAll();
});

describe("venue websocket supervision", () => {
  it("recycles a connection whose websocket upgrade never finishes", () => {
    const statuses: string[] = [];
    const reconnects = { count: 0 };
    supervised(statuses, reconnects);

    assert.deepEqual(statuses, ["connecting"]);
    mock.timers.tick(10);

    assert.equal(reconnects.count, 1);
    assert.equal(statuses.at(-1), "error");
    assert.equal(FakeWebSocket.instances[0].readyState, FakeWebSocket.CLOSED);
    mock.timers.tick(1_300);
    assert.equal(FakeWebSocket.instances.length, 2);
  });

  it("does not call an open socket live until it has delivered a usable book", () => {
    const statuses: string[] = [];
    const reconnects = { count: 0 };
    supervised(statuses, reconnects);
    FakeWebSocket.instances[0].open();

    assert.deepEqual(statuses, ["connecting"]);
    mock.timers.tick(20);

    assert.equal(reconnects.count, 1);
    assert.equal(statuses.at(-1), "error");
  });

  it("does not reset backoff after one book followed by silence", () => {
    mock.method(Math, "random", () => 0);
    const statuses: string[] = [];
    const reconnects = { count: 0 };
    supervised(statuses, reconnects);
    const first = FakeWebSocket.instances[0];
    first.open();
    first.message({ bids: [["100", "2"]], asks: [["101", "3"]] });

    mock.timers.tick(20);
    assert.equal(reconnects.count, 1);
    mock.timers.tick(1_000);
    const second = FakeWebSocket.instances[1];
    second.open();
    second.message({ bids: [["100", "2"]], asks: [["101", "3"]] });

    mock.timers.tick(20);
    assert.equal(reconnects.count, 2);
    mock.timers.tick(1_000);
    assert.equal(FakeWebSocket.instances.length, 2, "the second retry must retain 2s backoff");
    mock.timers.tick(1_000);
    assert.equal(FakeWebSocket.instances.length, 3);
  });

  it("rearms the silence watchdog only after valid order books", () => {
    const statuses: string[] = [];
    const reconnects = { count: 0 };
    const books: unknown[] = [];
    supervised(statuses, reconnects, books);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.message({ bids: [["100", "2"]], asks: [["101", "3"]] });

    assert.equal(statuses.at(-1), "live");
    assert.equal(books.length, 1);
    mock.timers.tick(19);
    socket.message({ bids: [["100", "2"]], asks: [["101", "3"]] });
    mock.timers.tick(19);
    assert.equal(reconnects.count, 0);
    mock.timers.tick(1);
    assert.equal(reconnects.count, 1);
  });

  it("ignores a queued close from the socket that an operator replaced", () => {
    const statuses: string[] = [];
    const reconnects = { count: 0 };
    const handle = supervised(statuses, reconnects);
    const first = FakeWebSocket.instances[0];
    const queuedOldClose = first.onclose;

    handle.restart();
    assert.equal(FakeWebSocket.instances.length, 2);
    queuedOldClose?.({ code: 1006 } as CloseEvent);

    assert.equal(FakeWebSocket.instances.length, 2);
    assert.equal(reconnects.count, 0);
  });
});
