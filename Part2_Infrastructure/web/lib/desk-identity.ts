"use client";

/**
 * Who this browser is, for the purpose of seeding a generated desk.
 * ================================================================
 *
 * The brief asks that "every authenticated or guest user receives a standalone,
 * seeded mock state instance". The isolation half of that is already structural
 * and worth saying plainly: the sandbox is generated in the browser from a pure
 * function, so there is no server state for two visitors to share and no way for
 * one visitor's desk to reach another's. Nothing here is a security boundary and
 * nothing here should be mistaken for one.
 *
 * What the seed adds is that the instances are *distinguishable*. Two reviewers
 * comparing notes see two different order books rather than the same fiction
 * twice, which is what makes "your sandbox" a true statement.
 *
 * Precedence, and the reason for it:
 *   1. the Supabase user id — stable across this person's browsers and sessions,
 *      so their desk follows them the way their preferences already do
 *   2. a guest id in sessionStorage — stable for the tab, gone when it closes
 *   3. no identity at all, on the server render or with storage blocked
 *
 * Case 3 must return null rather than inventing something, and that is the whole
 * reason this file is careful: a random seed generated during render would
 * differ between the server pass and the hydration pass, and React would paint
 * one book and then silently replace it with another. The default seed is the
 * honest answer there — the worked example everyone has always seen.
 */

import { seedFromString } from "@/lib/random";

const GUEST_KEY = "alphaengine-desk-guest";

/**
 * A stable per-tab id, minted lazily.
 *
 * sessionStorage rather than localStorage: a guest is a visit, not an account,
 * and a guest id that outlived the tab would quietly become a durable
 * identifier for someone who chose not to have one.
 */
function guestId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = sessionStorage.getItem(GUEST_KEY);
    if (existing) return existing;
    // crypto.randomUUID is available in every browser this app targets; the
    // fallback exists because it is absent over plain http on some Android
    // builds, and a thrown error here would take the whole desk down.
    const minted = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `g-${Math.floor(Math.random() * 2 ** 32).toString(36)}`;
    sessionStorage.setItem(GUEST_KEY, minted);
    return minted;
  } catch {
    // Private mode, or storage disabled. The default desk is the right answer.
    return null;
  }
}

/**
 * The seed for this visitor's generated desk, or undefined for the shared
 * worked example.
 *
 * `undefined`, not 0: `sandboxBook`'s parameter defaults only when the argument
 * is absent, and 0 is a legitimate seed that mulberry32 remaps to 1.
 */
export function deskSeed(userId: string | null): number | undefined {
  if (userId) return seedFromString(userId);
  const guest = guestId();
  return guest ? seedFromString(guest) : undefined;
}
