/**
 * The engineering queue's storage contract.
 *
 * Seed BUG-201 — "Session work is lost when the dashboard reloads" — is marked
 * done, and a done row must be genuinely done (the BUG-204 precedent). So this
 * file binds the seed's claim to the mechanism's presence: the queue must
 * persist to localStorage, hydrate after mount, reject foreign shapes, and say
 * "stored in this browser" where it used to say "session-only". Reverting the
 * persistence without reopening the seed goes red here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEVELOPER_WORK_STORAGE_KEY,
  createInitialDeveloperWorkItems,
  loadDeveloperWorkItems,
  saveDeveloperWorkItems,
  type DeveloperWorkItem,
} from "../lib/developer-work";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

/** Minimal in-memory localStorage; the lib reads `window` at call time. */
function stubWindow(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
  return store;
}

describe("the queue round-trips through localStorage", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = stubWindow();
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("saves and loads the same items", () => {
    const items = createInitialDeveloperWorkItems(1_700_000_000_000);
    saveDeveloperWorkItems(items);
    assert.deepEqual(loadDeveloperWorkItems(), items);
  });

  it("an emptied queue survives as an emptied queue", () => {
    // An empty stored array is a state the reader chose, not an error — it
    // must not resurrect the seeds.
    saveDeveloperWorkItems([]);
    assert.deepEqual(loadDeveloperWorkItems(), []);
  });

  it("absent storage yields null so the caller keeps the seeds", () => {
    assert.equal(loadDeveloperWorkItems(), null);
  });

  it("corrupt JSON collapses to null, never a throw", () => {
    store.set(DEVELOPER_WORK_STORAGE_KEY, "{not json");
    assert.equal(loadDeveloperWorkItems(), null);
  });

  it("a foreign shape is rejected wholesale", () => {
    const impostor = [{ id: "BUG-1", status: "shipped-it" }];
    store.set(DEVELOPER_WORK_STORAGE_KEY, JSON.stringify(impostor));
    assert.equal(loadDeveloperWorkItems(), null);
    const item: DeveloperWorkItem = { ...createInitialDeveloperWorkItems()[0], openedAt: Number.NaN };
    store.set(DEVELOPER_WORK_STORAGE_KEY, JSON.stringify([item]));
    assert.equal(loadDeveloperWorkItems(), null, "a non-finite openedAt is a foreign shape");
  });
});

describe("the dashboard wires hydration correctly", () => {
  const page = read("app/dashboard/page.tsx");

  it("hydrates inside an effect, not the initializer", () => {
    // Reading localStorage during render throws on the server and
    // desynchronises the first paint — the experiments log's rule.
    assert.match(page, /useEffect\(\(\) => \{\s*const stored = loadDeveloperWorkItems\(\);/);
    assert.doesNotMatch(page, /useState[^;]*loadDeveloperWorkItems/);
  });

  it("the persist effect skips its mount pass", () => {
    // The persist effect fires in the same commit as hydration, while state
    // still holds the seeds; an unguarded save would clobber a stored queue.
    assert.match(
      page,
      /if \(!developerWorkPersistReady\.current\) \{\s*developerWorkPersistReady\.current = true;\s*return;\s*\}\s*saveDeveloperWorkItems\(developerWorkItems\);/,
    );
  });
});

describe("the labels say what is now true", () => {
  const queue = read("components/developer/DeveloperWorkQueue.tsx");
  const console_ = read("components/DeveloperConsole.tsx");
  const dataBoard = read("components/data/DataWorkBoard.tsx");

  it("the developer queue claims browser storage, not session state", () => {
    assert.ok(!queue.includes("session-only"), "the session-only claim is no longer true");
    assert.match(queue, /stored in this browser/);
    assert.match(console_, /stored in this browser/);
  });

  it("the data board still claims session-only, because it still is", () => {
    // The two queues now deliberately differ; both claims are pinned.
    assert.match(dataBoard, /Mocked · session-only/);
  });
});

describe("seed honesty", () => {
  const seeds = read("lib/developer-work.ts");
  const page = read("app/dashboard/page.tsx");

  it("BUG-201 is done if and only if the dashboard wires persistence", () => {
    const wired = page.includes("loadDeveloperWorkItems");
    const seedDone = /id: "BUG-201",[\s\S]{0,200}status: "done",[\s\S]{0,200}summary: "Fixed:/.test(seeds);
    assert.equal(seedDone, wired, "the seed's claim and the mechanism must move together");
  });

  it("the un-fixed scope survives as open work", () => {
    assert.match(
      seeds,
      /id: "TKT-413",[\s\S]{0,300}title: "Connect an authenticated issue backend"/,
    );
    assert.doesNotMatch(
      seeds.slice(seeds.indexOf('id: "TKT-413"'), seeds.indexOf('id: "TKT-413"') + 400),
      /status: "done"/,
    );
  });
});
