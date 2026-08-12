/**
 * The two migrations behind the profile page, and the four ways they fail quietly.
 *
 * Migrations here are forward-only — there are no down-migrations anywhere in
 * this repository and `schema.yml` has no rollback path — so a mistake in one is
 * corrected by writing another. That makes the cheap checks worth having *before*
 * the push rather than after it, and every rule below is one that produces a
 * working-looking system when it is broken:
 *
 *  1. `grant execute` without a matching `revoke ... from public, anon`.
 *     Postgres grants EXECUTE to PUBLIC on every new function and `anon` is a
 *     member of PUBLIC, so a SECURITY DEFINER function reading an auth table
 *     would be callable by anonymous visitors. It returns nothing today only
 *     because `auth.uid()` is NULL inside it — a property of the filter, not a
 *     permission boundary, and one line of refactoring away from being untrue.
 *
 *  2. A public avatars bucket. `/storage/v1/object/public/<bucket>/<path>` is
 *     served with no policy evaluated, and *nothing in this repository probes
 *     `/storage/v1/*`* — so the exposure is invisible to every check that runs.
 *
 *  3. A missing `notify pgrst, 'reload schema'`. PostgREST caches the schema, so
 *     the function exists and works in SQL while returning 404 over HTTP. It
 *     reads as "the migration did not apply" and sends you to the wrong place.
 *
 *  4. A storage failure taking the whole push with it. `supabase db push` aborts
 *     the job on the first failing statement, which would strand the sessions
 *     migration, both Edge Function deploys and the anonymous probe — for a
 *     bucket. Hence the DO blocks, and hence the requirement that they warn
 *     rather than pass silently.
 *
 * These live in the web suite deliberately. `Part2_Infrastructure/**` minus
 * `web/**` is the gateway deploy trigger, so putting them beside the Python
 * schema tests would restart the desk to add an assertion.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));
const names = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort();
const read = (name: string) => readFileSync(join(MIGRATIONS_DIR, name), "utf8");

/** Comments stripped: both files document the hazards by naming them. */
const sqlCode = (source: string) => source.replace(/--[^\n]*/g, "");

const find = (suffix: string) => {
  const hits = names.filter((n) => n.endsWith(suffix));
  assert.equal(hits.length, 1, `expected exactly one migration ending ${suffix}, found ${hits.length}`);
  return hits[0];
};

const sessionsFile = find("_account_session_listing.sql");
const bucketFile = find("_avatar_bucket.sql");
const sessions = sqlCode(read(sessionsFile));
const bucket = sqlCode(read(bucketFile));

describe("the corpus stays addressable by the tests that read it", () => {
  it("still holds exactly one file each test locates by suffix", () => {
    // `tests/user-prefs.test.ts` finds its migration with an unsorted
    // `readdir().find()`. A second file ending the same way would make which
    // one it reads depend on filesystem order.
    for (const suffix of ["_user_preferences.sql", "_account_session_listing.sql", "_avatar_bucket.sql"]) {
      assert.equal(names.filter((n) => n.endsWith(suffix)).length, 1, suffix);
    }
  });

  it("applies the storage bucket after the sessions function", () => {
    // Filename order is apply order. The bucket touches tables this role may
    // not own, so it must never sit in front of something that must land.
    assert.ok(sessionsFile < bucketFile, `${sessionsFile} must sort before ${bucketFile}`);
  });
});

describe("the sessions function cannot be reached by an anonymous caller", () => {
  it("revokes from public and from anon, and grants only to authenticated", () => {
    assert.match(sessions, /revoke execute on function public\.list_my_sessions\(\) from public;/);
    assert.match(sessions, /revoke execute on function public\.list_my_sessions\(\) from anon;/);
    assert.match(sessions, /grant execute on function public\.list_my_sessions\(\) to authenticated;/);
  });

  it("revokes before it grants", () => {
    // Order is not cosmetic: `revoke ... from public` after the grant would
    // strip nothing from `authenticated`, but a grant landing first leaves a
    // window in the same transaction — and reads as if the revoke were the
    // operative line when it is not.
    assert.ok(
      sessions.indexOf("revoke execute") < sessions.indexOf("grant execute"),
      "the revokes must precede the grant",
    );
  });

  it("is SECURITY DEFINER with an empty search_path", () => {
    assert.match(sessions, /security definer/);
    // `= ''` rather than `= auth, public`: every name in the body is written
    // out, so nothing resolves through a schema someone else can create into.
    assert.match(sessions, /set search_path = ''/);
    assert.match(sessions, /create or replace function/);
  });

  it("never reads the auth table without filtering to the caller", () => {
    const body = sessions.slice(sessions.indexOf("from auth.sessions"));
    assert.match(body, /where s\.user_id = v_user_id/);
    assert.match(sessions, /v_user_id uuid := \(select auth\.uid\(\)\)/);
    // And bails outright when there is no caller.
    assert.match(sessions, /if v_user_id is null then\s+return;/);
  });

  it("says where its rows came from, so a short list is not read as a fact", () => {
    // The privilege this needs is not provable from the repository. If the
    // table cannot be read the function answers from the caller's own JWT and
    // stamps it — a one-row list labelled 'sessions' would otherwise assert
    // "you are signed in nowhere else" on no evidence.
    assert.match(sessions, /'sessions'::text/);
    assert.match(sessions, /'jwt'::text/);
    assert.match(sessions, /when insufficient_privilege/);
  });

  it("reloads the PostgREST schema cache", () => {
    assert.match(sessions, /notify pgrst, 'reload schema';/);
  });
});

describe("the avatars bucket is private and owner-scoped", () => {
  it("is created with public false and never set true", () => {
    assert.match(bucket, /insert into storage\.buckets/);
    assert.doesNotMatch(bucket, /public\s*=\s*true/);
    assert.doesNotMatch(bucket, /'avatars',\s*true/);
    // Re-applying must not be a way to flip it open.
    assert.match(bucket, /on conflict \(id\) do update[\s\S]*?set public\s+= false/);
  });

  it("scopes all four verbs to the caller's own folder", () => {
    for (const verb of ["select", "insert", "update", "delete"]) {
      assert.match(bucket, new RegExp(`for ${verb}\\b`), `no policy for ${verb}`);
    }
    const scoped = [...bucket.matchAll(/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g)];
    // select + insert + delete take one each; update needs both `using` and
    // `with check`, or a row could be moved into someone else's folder.
    assert.equal(scoped.length, 5, "every policy clause must be owner-scoped");
    assert.match(bucket, /for update[\s\S]*?using \([\s\S]*?with check \(/);
  });

  it("grants nothing to anon", () => {
    assert.doesNotMatch(bucket, /to anon/);
  });

  it("cannot abort the push, and cannot fail quietly either", () => {
    // Both halves are wrapped, because `create policy` needs ownership of
    // storage.objects and that is a property of the project rather than
    // something this repository can prove.
    assert.equal((bucket.match(/^do \$\$/gm) ?? []).length, 2);
    assert.equal((bucket.match(/when insufficient_privilege/g) ?? []).length, 2);
    // `raise warning`, not `notice`: a migration that quietly does nothing is
    // indistinguishable from one that worked.
    assert.equal((bucket.match(/raise warning/g) ?? []).length, 2);
    assert.doesNotMatch(bucket, /raise notice/);
  });

  it("names the manual fallback in the warning itself", () => {
    // The person reading the failed run is the person who has to fix it, and
    // they are not going to be holding this file.
    for (const phrase of ["Storage", "avatars"]) {
      assert.ok(bucket.includes(phrase), `the warning should mention ${phrase}`);
    }
  });
});
