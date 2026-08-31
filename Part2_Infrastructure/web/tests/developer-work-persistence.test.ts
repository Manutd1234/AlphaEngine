/**
 * The Developer queue is user-authored browser state, never a bundled ticket
 * fixture. These tests pin both halves: valid localStorage survives reloads,
 * and a first visit renders an empty queue rather than production-looking work.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEVELOPER_WORK_STORAGE_KEY,
  loadDeveloperWorkItems,
  saveDeveloperWorkItems,
  type DeveloperWorkItem,
} from "../lib/developer-work";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

function userWork(overrides: Partial<DeveloperWorkItem> = {}): DeveloperWorkItem {
  return {
    id: "BUG-001",
    kind: "bug",
    priority: "P2",
    status: "triage",
    title: "User-created work",
    summary: "A record entered through the engineering queue.",
    owner: "Unassigned",
    area: "Developer portal",
    openedAt: 1_700_000_000_000,
    ...overrides,
  };
}

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

describe("the user queue round-trips through localStorage", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = stubWindow();
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("saves and loads the same user-created items", () => {
    const items = [userWork()];
    saveDeveloperWorkItems(items);
    assert.deepEqual(loadDeveloperWorkItems(), items);
  });

  it("an emptied queue survives as an emptied queue", () => {
    saveDeveloperWorkItems([]);
    assert.deepEqual(loadDeveloperWorkItems(), []);
  });

  it("absent storage yields null so the caller keeps its empty initial state", () => {
    assert.equal(loadDeveloperWorkItems(), null);
  });

  it("corrupt JSON collapses to null, never a throw", () => {
    store.set(DEVELOPER_WORK_STORAGE_KEY, "{not json");
    assert.equal(loadDeveloperWorkItems(), null);
  });

  it("a foreign shape is rejected wholesale", () => {
    store.set(DEVELOPER_WORK_STORAGE_KEY, JSON.stringify([{ id: "BUG-1", status: "shipped-it" }]));
    assert.equal(loadDeveloperWorkItems(), null);
    store.set(DEVELOPER_WORK_STORAGE_KEY, JSON.stringify([userWork({ openedAt: Number.NaN })]));
    assert.equal(loadDeveloperWorkItems(), null, "a non-finite openedAt is a foreign shape");
  });
});

describe("the dashboard restores user state without seeding production claims", () => {
  const page = read("app/dashboard/page.tsx");
  const library = read("lib/developer-work.ts");

  it("starts empty and hydrates localStorage only after mount", () => {
    assert.match(page, /useState<DeveloperWorkItem\[\]>\(\[\]\)/);
    assert.match(page, /useEffect\(\(\) => \{\s*const stored = loadDeveloperWorkItems\(\);/);
    assert.match(page, /setDeveloperWorkHydrated\(true\)/);
    assert.doesNotMatch(page, /useState[^;]*loadDeveloperWorkItems/);
  });

  it("persistence waits for hydration, including under Strict Mode replay", () => {
    assert.match(
      page,
      /if \(!developerWorkHydrated\) return;\s*saveDeveloperWorkItems\(developerWorkItems\);/,
    );
    assert.match(page, /\[developerWorkHydrated, developerWorkItems\]/);
    assert.doesNotMatch(page, /developerWorkPersistReady/);
  });

  it("ships no built-in ticket rows or sample initializer", () => {
    assert.doesNotMatch(library, /DEVELOPER_WORK_SEEDS|createInitialDeveloperWorkItems|ageHours/);
    assert.doesNotMatch(library, /BUG-204|FEAT-074|TKT-413|Representative engineering work/);
    assert.doesNotMatch(page, /createInitialDeveloperWorkItems/);
  });
});

describe("the labels state the queue's actual custody", () => {
  const queue = read("components/developer/DeveloperWorkQueue.tsx");
  const console_ = read("components/DeveloperConsole.tsx");
  const dataBoard = read("components/data/DataWorkBoard.tsx");

  it("names an empty first visit and browser persistence", () => {
    assert.match(queue, /No engineering work yet/);
    assert.match(queue, /stored in this browser/);
    assert.match(queue, /Closed in this browser/);
    assert.doesNotMatch(queue, /Sample data|sample queue|seeds return/);
    assert.match(console_, /stored in this browser/);
  });

  it("the Data board names its different gateway custody", () => {
    assert.match(dataBoard, /Persisted on the gateway/);
    assert.doesNotMatch(dataBoard, /session-only/);
  });
});
