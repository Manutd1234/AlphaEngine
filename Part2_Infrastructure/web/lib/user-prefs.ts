"use client";

/**
 * Workspace preferences that follow the account instead of the browser.
 *
 * Local-first, and that ordering is the whole design. Signed out, every store
 * behaves exactly as it did before this file existed: localStorage is the
 * record, and nothing waits on a network. Signing in adds a mirror — the local
 * values are still what the UI reads, and the remote row is reconciled with
 * them rather than treated as the truth.
 *
 * MERGE
 *
 * Per key, newest write wins, using timestamps this module keeps beside the
 * values. Whole-blob last-writer-wins would let a laptop that has been open
 * since yesterday overwrite a theme changed on a phone this morning, because
 * the laptop's blob is newer as a whole while being older in every field that
 * matters.
 *
 * The exception is a change of account. If the last user to sync in this
 * browser is not the one signing in now, remote wins outright for every key it
 * carries: on a shared machine, one person's leftover local state must not
 * become another person's account state simply by being more recent.
 *
 * WHAT IS NOT SYNCED
 *
 * The operator token (a credential, per-tab by design), the blotter's
 * sandbox/live source (per-tab by intent), the experiment log (sixty records of
 * run history — a row shape, not a preference, and large enough to breach the
 * row's size check), and favourites (already server-side for the same reason).
 * `SYNCED_PREF_KEYS` is asserted in the tests, so adding one is a decision
 * someone has to make on purpose.
 */

import { authClient } from "./auth-client";
import { onPrefChange } from "./pref-sync-bus";
import { subscribeSession, type SessionInfo } from "./use-session";

import { COMPLEXITY_STORAGE_KEY, isComplexity } from "./complexity";
import { setComplexity } from "./use-complexity";
import { THEME_STORAGE_KEY, applyDocumentThemePreference, isThemePreference } from "./theme";
import { applyDocumentTextSize, isTextSize, TEXT_SIZE_STORAGE_KEY } from "./text-size";
import { RECENTS_KEY } from "@/components/header/CommandBar";

/** The research auto-run switch. Mirrors the literal in `app/page.tsx`. */
export const AUTO_RUN_KEY = "alphaengine.research.autorun";
/** Which tab and section this account was last looking at. */
export const WORKSPACE_LOCATION_KEY = "alphaengine.workspace.location";

/** Write timestamps, so a merge can compare fields rather than whole blobs. */
export const PREF_META_KEY = "alphaengine.prefs.meta";
/** Whose preferences the local values currently represent. */
export const PREF_LAST_USER_KEY = "alphaengine.prefs.last-user";

export const SYNCED_PREF_KEYS: readonly string[] = [
  THEME_STORAGE_KEY,
  COMPLEXITY_STORAGE_KEY,
  TEXT_SIZE_STORAGE_KEY,
  AUTO_RUN_KEY,
  RECENTS_KEY,
  WORKSPACE_LOCATION_KEY,
];

/** Long enough that dragging a slider is one write, short enough to survive a close. */
export const PUSH_DEBOUNCE_MS = 1500;

const PREFS_VERSION = 1;

export interface PrefEntry {
  value: string;
  updatedAt: number;
}

export interface PrefPayload {
  v: number;
  entries: Record<string, PrefEntry>;
}

export interface MergeOptions {
  /** True when the account differs from the one these local values came from. */
  userChanged: boolean;
}

export interface MergeResult {
  /** Keys whose local value must be replaced, with the value to apply. */
  apply: Record<string, string>;
  /** The reconciled set to store remotely. */
  merged: Record<string, PrefEntry>;
}

/**
 * Pure, and the only place the conflict rule lives.
 *
 * Unknown remote keys are dropped rather than written back: a key retired here
 * must not be resurrected forever by an old client's row.
 */
export function mergePrefEntries(
  local: Record<string, PrefEntry>,
  remote: Record<string, PrefEntry>,
  options: MergeOptions,
): MergeResult {
  const apply: Record<string, string> = {};
  const merged: Record<string, PrefEntry> = {};

  for (const key of SYNCED_PREF_KEYS) {
    const mine = local[key];
    const theirs = remote[key];

    if (!theirs) {
      if (mine) merged[key] = mine;
      continue;
    }
    if (!mine) {
      merged[key] = theirs;
      apply[key] = theirs.value;
      continue;
    }

    // A tie goes to remote: two writes in the same millisecond are far more
    // likely to be one clock's rounding than a genuine race, and preferring the
    // account keeps two devices converging instead of alternating.
    const remoteWins = options.userChanged || theirs.updatedAt >= mine.updatedAt;
    if (remoteWins) {
      merged[key] = theirs;
      if (theirs.value !== mine.value) apply[key] = theirs.value;
    } else {
      merged[key] = mine;
    }
  }

  return { apply, merged };
}

export function isPrefPayload(value: unknown): value is PrefPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PrefPayload;
  return candidate.v === PREFS_VERSION && Boolean(candidate.entries) && typeof candidate.entries === "object";
}

function readMeta(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PREF_META_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeMeta(meta: Record<string, number>): void {
  try {
    localStorage.setItem(PREF_META_KEY, JSON.stringify(meta));
  } catch {
    // Losing the stamps costs merge precision, never the preference itself.
  }
}

/** Local values plus their write times, in the shape the merge expects. */
function readLocalEntries(): Record<string, PrefEntry> {
  const meta = readMeta();
  const entries: Record<string, PrefEntry> = {};
  for (const key of SYNCED_PREF_KEYS) {
    try {
      const value = localStorage.getItem(key);
      if (value == null) continue;
      // A value written before this module existed has no stamp. Treating it as
      // epoch-old lets the account's copy win, which is the safer default for
      // state the user has already curated somewhere else.
      entries[key] = { value, updatedAt: meta[key] ?? 0 };
    } catch {
      return entries;
    }
  }
  return entries;
}

function stampKey(key: string): void {
  const meta = readMeta();
  meta[key] = Date.now();
  writeMeta(meta);
}

/**
 * Writes a remote value into local state, using each store's own setter where
 * one exists so live subscribers repaint instead of waiting for a reload.
 */
function applyRemoteValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }

  // All three preferences, not just the two palettes. Narrowing this to
  // light/dark stored a synced "system" and never applied it: the row was
  // right, the merge was right, every test was green, and the screen kept the
  // palette the other device had left behind.
  if (key === THEME_STORAGE_KEY && isThemePreference(value)) {
    applyDocumentThemePreference(value);
    return;
  }
  if (key === COMPLEXITY_STORAGE_KEY && isComplexity(value)) {
    setComplexity(value);
    return;
  }
  if (key === TEXT_SIZE_STORAGE_KEY && isTextSize(value)) {
    applyDocumentTextSize(value);
  }
  // The palette re-reads its recents each time it opens, the research switch
  // has its own effect, and the stored location is read on next visit — none
  // of them need a nudge here.
}

let started = false;
let currentUser: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let pulling = false;
/**
 * Bumped on every session transition. A `pull()` started under one account must
 * not still be writing when that account is gone — it would apply the theme,
 * detail level and last-open tab of the person who just signed out, and stamp
 * their id as the last user.
 */
let generation = 0;

function schedulePush(): void {
  if (!currentUser) return;
  dirty = true;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void push();
  }, PUSH_DEBOUNCE_MS);
}

async function push(): Promise<void> {
  const supabase = authClient();
  const userId = currentUser;
  if (!supabase || !userId) return;

  const payload: PrefPayload = { v: PREFS_VERSION, entries: readLocalEntries() };
  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, prefs: payload, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  // Staying dirty is the retry: the next change, or coming back online,
  // schedules another attempt. A failed sync must never surface as an error —
  // the local value is already correct and is what the UI is reading.
  dirty = Boolean(error);
}

async function pull(userId: string): Promise<void> {
  const supabase = authClient();
  if (!supabase || pulling) return;
  const startedAt = generation;
  pulling = true;
  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("prefs")
      .eq("user_id", userId)
      .maybeSingle();

    let lastUser: string | null = null;
    try {
      lastUser = localStorage.getItem(PREF_LAST_USER_KEY);
    } catch {
      lastUser = null;
    }
    const userChanged = lastUser !== null && lastUser !== userId;

    if (error) {
      // The table may not be migrated yet on this project. Local-only is a
      // complete, working state, so this is a degradation and not a failure.
      return;
    }

    // The session changed while this round-trip was in flight. Everything
    // below writes to shared local state, so it must not run for an account
    // the browser has already left.
    if (startedAt !== generation) return;

    const remote = isPrefPayload(data?.prefs) ? data.prefs.entries : {};
    const { apply, merged } = mergePrefEntries(readLocalEntries(), remote, { userChanged });

    const meta = readMeta();
    for (const [key, value] of Object.entries(apply)) {
      applyRemoteValue(key, value);
      meta[key] = merged[key]?.updatedAt ?? Date.now();
    }
    writeMeta(meta);

    try {
      localStorage.setItem(PREF_LAST_USER_KEY, userId);
    } catch {
      // ignored
    }

    // Seed the row on first sign-in, and settle any key the merge resolved in
    // this browser's favour.
    void push();
  } finally {
    pulling = false;
  }
}

function onSession(info: SessionInfo): void {
  const next = info.status === "signed-in" ? info.userId : null;
  if (next === currentUser) return;
  currentUser = next;
  generation += 1;

  if (!next) {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;
    // Nothing is owed to an account we have left; a stale dirty flag would
    // make the next sign-in think it had a failed write to retry.
    dirty = false;
    // Local values stay exactly as they are. Signing out is leaving an
    // account, not asking the browser to forget how you like the desk.
    return;
  }
  void pull(next);
}

/**
 * Writes any preference still sitting behind the debounce, now.
 *
 * Sign-out drops the pending timer, so a change made in the last
 * PUSH_DEBOUNCE_MS would be kept locally and never reach the account — sync
 * that looks like it is working while quietly losing the last thing you did.
 * Call this *before* ending the session: afterwards the JWT is gone and the
 * write would be rejected.
 */
export async function flushPendingPrefs(): Promise<void> {
  if (!pushTimer) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  await push();
}

/**
 * Idempotent. Called from the workspace shell and the login screen, because
 * either can be the first thing a signed-in visitor renders.
 */
export function startUserPrefsSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  subscribeSession(onSession);

  onPrefChange((key) => {
    if (!SYNCED_PREF_KEYS.includes(key)) return;
    stampKey(key);
    schedulePush();
  });

  // Another tab wrote a preference. Applying it here would fight whatever that
  // tab is doing, so this only makes sure the account's copy catches up.
  window.addEventListener("storage", (event) => {
    if (!event.key || !SYNCED_PREF_KEYS.includes(event.key)) return;
    schedulePush();
  });

  window.addEventListener("online", () => {
    if (dirty) schedulePush();
  });
}

/** True when a signed-in account is mirroring this browser's preferences. */
export function prefsSyncActive(): boolean {
  return currentUser !== null;
}
