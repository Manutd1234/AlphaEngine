/**
 * The login's sources, read once for every auth suite that asserts on them.
 *
 * `auth-clients.test.ts` became eight files on 2026-08-21. Most of what it guards is
 * structural — hazards that do not fail loudly and are only assertable from
 * source — so nearly every successor reads the same handful of modules. A
 * private copy of the reader in each file is how one suite ends up scanning a
 * path that moved while its neighbours follow the file, so the paths are stated
 * once here and every reader follows.
 *
 * Reading goes through `readSource`, which resolves from `web/` rather than
 * from the caller and refuses an empty result: a scan of an empty string is
 * green for ever and indistinguishable from a guard that works.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readSource } from "./source-files";

/**
 * Comment bodies removed before keyword scans — these files document the very
 * hazards they avoid, so raw text finds the explanation and reports the
 * safeguard as the violation.
 *
 * Deliberately not `stripCode` from the shared reader: that one also removes
 * `{/* … *\/}` JSX comments, and these suites assert over what is left. The
 * pair of rules must not be quietly swapped for one another.
 */
export const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

export const tapeClient = readSource("lib/supabaseClient.ts");
export const authClientSource = readSource("lib/auth-client.ts");
export const storage = readSource("lib/auth-storage.ts");
export const screen = readSource("components/auth/LoginScreen.tsx");
/**
 * `LoginScreen` became three files on 2026-08-21: the card's markup is
 * `components/auth/LoginCard.tsx`, and what "submit" means in each of the four
 * modes is `lib/auth-submit.ts`. Each assertion reads the file its subject
 * lives in — a scan for `aria-pressed={showPassword}` left on the screen would
 * find nothing and, being a `match`, would at least fail loudly; the
 * `doesNotMatch` beside it would have passed in silence.
 */
export const card = readSource("components/auth/LoginCard.tsx");
export const submitSource = readSource("lib/auth-submit.ts");
export const session = readSource("lib/use-session.ts");

/** `supabase/migrations/`, three levels above `web/` and anchored on this file. */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../supabase/migrations", import.meta.url));

export const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8") }));

// An empty directory would make every loop below it iterate over nothing and
// report success. The migrations are the half of the login that lives outside
// this app, so the count is asserted at import rather than assumed per suite.
if (migrations.length === 0) {
  throw new Error(`no .sql files under ${MIGRATIONS_DIR} — every migration assertion would scan nothing`);
}
