/**
 * Preferences that follow the account, and the three ways that goes wrong.
 *
 * Whole-blob last-writer-wins silently loses a field: a laptop open since
 * yesterday has a "newer" blob than the phone where you changed the theme an
 * hour ago. A shared browser can hand one person's leftover local state to the
 * next account that signs in. And a sync list that quietly grows can start
 * mirroring a credential or a sixty-record run log into a preferences row.
 *
 * The merge is pure and tested directly; the rest is asserted from source,
 * because "which keys does this sync" is a decision, not an implementation
 * detail.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUTO_RUN_KEY,
  PUSH_DEBOUNCE_MS,
  SYNCED_PREF_KEYS,
  WORKSPACE_LOCATION_KEY,
  isPrefPayload,
  mergePrefEntries,
  type PrefEntry,
} from "../lib/user-prefs";
import { COMPLEXITY_STORAGE_KEY } from "../lib/complexity";
import { THEME_STORAGE_KEY } from "../lib/theme";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
const sqlCode = (source: string) => source.replace(/--[^\n]*/g, "");

const engine = read("../lib/user-prefs.ts");
const bus = read("../lib/pref-sync-bus.ts");
const page = read("../app/page.tsx");

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));
const migration = readdirSync(MIGRATIONS_DIR).find((name) => name.endsWith("_user_preferences.sql"));

const at = (value: string, updatedAt: number): PrefEntry => ({ value, updatedAt });

/** Asserted as a literal rather than imported: pulling the value out of a .tsx
 *  would drag React and lucide into a node test to learn one string. The
 *  matching assertion below keeps the two spellings honest. */
const RECENTS = "alphaengine.commandbar.recents";

describe("the merge compares fields, not blobs", () => {
  it("keeps the newer local value", () => {
    const result = mergePrefEntries(
      { [THEME_STORAGE_KEY]: at("dark", 2000) },
      { [THEME_STORAGE_KEY]: at("light", 1000) },
      { userChanged: false },
    );
    assert.deepEqual(result.apply, {});
    assert.equal(result.merged[THEME_STORAGE_KEY].value, "dark");
  });

  it("takes the newer remote value", () => {
    const result = mergePrefEntries(
      { [THEME_STORAGE_KEY]: at("dark", 1000) },
      { [THEME_STORAGE_KEY]: at("light", 2000) },
      { userChanged: false },
    );
    assert.equal(result.apply[THEME_STORAGE_KEY], "light");
    assert.equal(result.merged[THEME_STORAGE_KEY].value, "light");
  });

  it("resolves each key independently", () => {
    // The failure this prevents: one device's stale blob overwriting a field
    // it never touched, because some other field on it was newer.
    const result = mergePrefEntries(
      { [THEME_STORAGE_KEY]: at("dark", 5000), [COMPLEXITY_STORAGE_KEY]: at("guided", 1000) },
      { [THEME_STORAGE_KEY]: at("light", 1000), [COMPLEXITY_STORAGE_KEY]: at("full", 5000) },
      { userChanged: false },
    );
    assert.equal(result.merged[THEME_STORAGE_KEY].value, "dark");
    assert.equal(result.merged[COMPLEXITY_STORAGE_KEY].value, "full");
    assert.deepEqual(Object.keys(result.apply), [COMPLEXITY_STORAGE_KEY]);
  });

  it("breaks a tie towards the account", () => {
    // Same millisecond is far likelier to be clock granularity than a real
    // race, and preferring remote keeps two devices converging.
    const result = mergePrefEntries(
      { [THEME_STORAGE_KEY]: at("dark", 1000) },
      { [THEME_STORAGE_KEY]: at("light", 1000) },
      { userChanged: false },
    );
    assert.equal(result.apply[THEME_STORAGE_KEY], "light");
  });

  it("adopts a remote key this browser has never seen", () => {
    const result = mergePrefEntries({}, { [THEME_STORAGE_KEY]: at("dark", 1) }, { userChanged: false });
    assert.equal(result.apply[THEME_STORAGE_KEY], "dark");
  });

  it("keeps a local key the account does not carry yet", () => {
    // First sign-in seeds the row rather than wiping the browser.
    const result = mergePrefEntries({ [THEME_STORAGE_KEY]: at("dark", 1) }, {}, { userChanged: false });
    assert.deepEqual(result.apply, {});
    assert.equal(result.merged[THEME_STORAGE_KEY].value, "dark");
  });

  it("hands a shared browser to the arriving account wholesale", () => {
    // Signed in as someone else on this machine: their newer local values must
    // not become this account's preferences.
    const result = mergePrefEntries(
      { [THEME_STORAGE_KEY]: at("dark", 9999) },
      { [THEME_STORAGE_KEY]: at("light", 1) },
      { userChanged: true },
    );
    assert.equal(result.apply[THEME_STORAGE_KEY], "light");
  });

  it("ignores remote keys that are no longer synced", () => {
    // A key retired here must not be resurrected forever by an old client.
    const result = mergePrefEntries({}, { "alphaengine.retired": at("x", 9999) }, { userChanged: false });
    assert.deepEqual(result.apply, {});
    assert.deepEqual(result.merged, {});
  });

  it("rejects a payload from a different shape", () => {
    assert.ok(isPrefPayload({ v: 1, entries: {} }));
    assert.ok(!isPrefPayload({ v: 2, entries: {} }));
    assert.ok(!isPrefPayload(null));
    assert.ok(!isPrefPayload({ entries: {} }));
  });
});

describe("what syncs is a decision, not an accident", () => {
  it("is exactly the five viewing preferences", () => {
    assert.deepEqual([...SYNCED_PREF_KEYS].sort(), [
      AUTO_RUN_KEY,
      RECENTS,
      WORKSPACE_LOCATION_KEY,
      COMPLEXITY_STORAGE_KEY,
      THEME_STORAGE_KEY,
    ].sort());
  });

  it("never carries the operator token", () => {
    // A credential, and per-tab by design: sessionStorage dies with the tab,
    // which is the whole point of putting it there.
    assert.ok(!SYNCED_PREF_KEYS.includes("alphaengine-operator-token"));
    assert.doesNotMatch(code(engine), /operator-token/);
  });

  it("never carries per-tab or row-shaped state", () => {
    // book-source lets two tabs watch different books; the experiment log is
    // sixty records of history and would breach the row's size check.
    assert.ok(!SYNCED_PREF_KEYS.includes("alphaengine-book-source"));
    assert.ok(!SYNCED_PREF_KEYS.includes("alphaengine-experiments"));
  });

  it("touches no session storage at all", () => {
    assert.doesNotMatch(code(engine), /sessionStorage/);
  });

  it("names each key from its owning module rather than a copy", () => {
    // Two spellings of the same key is a sync that silently mirrors nothing.
    assert.match(code(engine), /import \{ THEME_STORAGE_KEY/s);
    assert.match(code(engine), /COMPLEXITY_STORAGE_KEY/);
    assert.match(code(engine), /RECENTS_KEY/);
    // And the literal this file asserts against is the one CommandBar exports.
    assert.match(
      code(read("../components/header/CommandBar.tsx")),
      new RegExp(`export const RECENTS_KEY = "${RECENTS}"`),
    );
  });
});

describe("the stores announce, and never import the engine", () => {
  it("the bus depends on nothing", () => {
    // theme.ts is reachable from the pre-paint bootstrap; a Supabase import
    // there would be a network client in the critical path of first paint.
    assert.doesNotMatch(code(bus), /^import /m);
  });

  it("each store emits at its existing write site", () => {
    for (const [file, key] of [
      ["../lib/theme.ts", "THEME_STORAGE_KEY"],
      ["../lib/use-complexity.ts", "COMPLEXITY_STORAGE_KEY"],
      ["../components/header/CommandBar.tsx", "RECENTS_KEY"],
    ] as const) {
      assert.match(code(read(file)), new RegExp(`emitPrefChange\\(${key}\\)`), file);
    }
    assert.match(code(page), /emitPrefChange\(AUTO_RUN_KEY\)/);
  });

  it("no store imports the sync engine", () => {
    for (const file of ["../lib/theme.ts", "../lib/use-complexity.ts", "../components/header/CommandBar.tsx"]) {
      assert.doesNotMatch(code(read(file)), /user-prefs/, file);
    }
  });

  it("the complexity store keeps its deferred read and its throw-proof setter", () => {
    // The emit must not have moved either: a storage read during render
    // desynchronises hydration, and a throwing setter breaks the control.
    const complexity = read("../lib/use-complexity.ts");
    assert.match(complexity, /useEffect\(\(\) => \{[\s\S]*readStored\(\)/);
    assert.match(complexity, /setComplexity[\s\S]*catch/);
  });
});

describe("the workspace remembers where you were, and yields to a link", () => {
  it("restores only when the URL asks for nothing", () => {
    // A deep link is explicit. A shared URL that resolved differently per
    // visitor would be worse than not remembering at all.
    assert.match(code(page), /if \(!window\.location\.hash\.slice\(1\)\)/);
  });

  it("replaces rather than pushes, so Back still leaves the app", () => {
    const restore = code(page).slice(code(page).indexOf("if (!window.location.hash.slice(1))"));
    assert.match(restore.slice(0, 700), /replaceState/);
  });

  it("validates the remembered view before trusting it", () => {
    assert.match(code(page), /VIEWS\.includes\(remembered as WorkspaceView\)/);
  });
});

describe("syncing is a mirror, never a dependency", () => {
  it("writes only for a signed-in account", () => {
    assert.match(code(engine), /info\.status === "signed-in" \? info\.userId : null/);
  });

  it("keeps local values on sign-out", () => {
    // Signing out is leaving an account, not asking the browser to forget how
    // you like the desk.
    const signOut = code(engine).slice(code(engine).indexOf("if (!next) {"));
    assert.doesNotMatch(signOut.slice(0, 400), /removeItem|clear\(\)/);
  });

  it("degrades to local-only when the table is not migrated yet", () => {
    assert.match(code(engine), /if \(error\) \{[\s\S]{0,200}return;/);
  });

  it("retries by staying dirty rather than surfacing a failure", () => {
    assert.match(code(engine), /dirty = Boolean\(error\)/);
    assert.match(code(engine), /addEventListener\("online"/);
  });

  it("debounces writes instead of one request per keystroke", () => {
    assert.ok(PUSH_DEBOUNCE_MS >= 500 && PUSH_DEBOUNCE_MS <= 5000);
    assert.match(code(engine), /clearTimeout\(pushTimer\)/);
  });

  it("does not apply another tab's change over what this tab is doing", () => {
    const storage = code(engine).slice(code(engine).indexOf('addEventListener("storage"'));
    assert.match(storage.slice(0, 260), /schedulePush\(\)/);
    assert.doesNotMatch(storage.slice(0, 260), /applyRemoteValue/);
  });
});

describe("the preferences table is closed by default", () => {
  it("exists", () => {
    assert.ok(migration, "the user_preferences migration is missing");
  });

  it("enables RLS and scopes every policy to the owner", () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${migration}`, "utf8");
    assert.match(sql, /enable row level security/);
    assert.equal((sql.match(/\(select auth\.uid\(\)\) = user_id/g) ?? []).length, 4);
    assert.match(sql, /revoke all on public\.user_preferences from anon/);
  });

  it("grants anon nothing, unlike the demo blotter", () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${migration}`, "utf8");
    assert.doesNotMatch(sqlCode(sql), /to anon/);
  });

  it("bounds the blob so a preference row cannot become a data store", () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${migration}`, "utf8");
    assert.match(sql, /pg_column_size\(prefs\) < \d+/);
  });

  it("drops the row with the account", () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${migration}`, "utf8");
    assert.match(sql, /references auth\.users \(id\) on delete cascade/);
  });
});
