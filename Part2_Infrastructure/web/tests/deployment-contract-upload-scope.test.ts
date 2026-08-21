/**
 * The upload drop-list, and the one pattern shape that can silently delete the
 * project it is meant to protect.
 *
 * The root .vercelignore is an upload drop-list shared by BOTH Vercel projects
 * (its own header documents the incident where excluding one project's files
 * starved the other's build). The container/compose/supabase trees are read by
 * neither project, so they must be listed — otherwise every CLI deploy uploads
 * a Docker context and a SQL migration history into two Next.js builds.
 *
 * That is the easy half, and it is the half a literal-string test can check.
 * The hard half is below it: a gitignore pattern without a leading `/` matches
 * at ANY depth, so the entry that drops a top-level `oracle/` SQL directory
 * also drops `web/lib/oracle/` and `web/app/api/oracle/` from every build — and
 * the dangerous line reads exactly like a correct one. Only evaluating the
 * pattern set as gitignore syntax against the real tree catches it, which is
 * what the collision test does.
 *
 * The configuration surfaces those deploys carry are in
 * `deployment-contract-config-surfaces.test.ts`; the container deploy pipeline
 * in `deployment-contract-deploy-pipeline.test.ts`.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { readRepoFile, repoRootPath as rootPath } from "./helpers/deployment-files";

const vercelignore = readRepoFile(".vercelignore");
const compose = readRepoFile("docker-compose.yml");

describe("vercel upload scope excludes the non-web deployment trees", () => {
  // Root-anchored (`/oracle`, not `oracle`) is the point of this list, not
  // incidental — see the collision test below for why.
  for (const entry of ["Part2_Infrastructure/docker", "/docker-compose.yml", "/supabase"]) {
    it(`drops ${entry}`, () => {
      assert.ok(
        vercelignore.split("\n").some((line) => line.trim() === entry),
        `${entry} missing from the root .vercelignore drop-list`,
      );
    });
  }
});

describe("no .vercelignore pattern can ever drop a path the web project needs", () => {
  /**
   * This is the test the actual incident needed and nothing before it caught.
   * `oracle` (no leading slash) was gitignore-legal, present, and reviewed —
   * it just matches at ANY depth, so it silently deleted `web/lib/oracle/`
   * and `web/app/api/oracle/` from every Vercel build alongside the intended
   * top-level `oracle/` SQL directory. A literal-string test on the drop-list
   * (above) cannot catch this, because the dangerous line reads exactly like
   * a correct one; it has to actually be evaluated as gitignore syntax
   * against the real tree, which is what this does.
   *
   * `git check-ignore` only ever consults a real `.gitignore` in a real
   * working tree — there is no way to hand it an arbitrary file and ask "does
   * this match that". So the check runs the pattern set in a throwaway repo,
   * against every path this project actually ships.
   */
  it("every tracked path under Part2_Infrastructure/web/ survives the drop-list", () => {
    const tracked = execFileSync("git", ["ls-files", "Part2_Infrastructure/web"], {
      cwd: rootPath,
      encoding: "utf8",
    }).trim().split("\n").filter(Boolean);
    assert.ok(tracked.length > 100, "git ls-files returned suspiciously few web paths — is this running from the repo?");

    const scratch = mkdtempSync(path.join(tmpdir(), "vercelignore-collision-"));
    try {
      execFileSync("git", ["init", "-q", scratch]);
      writeFileSync(path.join(scratch, ".gitignore"), vercelignore);
      for (const rel of tracked) {
        const full = path.join(scratch, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, "");
      }

      // Exit 1 with empty stdout means nothing matched — the passing case.
      // Exit 0 means at least one path was dropped; its name is on stdout.
      let matched = "";
      try {
        matched = execFileSync("git", ["check-ignore", "--stdin"], {
          cwd: scratch,
          input: tracked.join("\n"),
          encoding: "utf8",
        });
      } catch (error) {
        const failure = error as { status?: number; stdout?: string };
        if (failure.status !== 1) {
          matched = failure.stdout ?? "";
          if (!matched) throw error;
        }
      }

      const dropped = matched.split("\n").map((line) => line.trim()).filter(Boolean);
      assert.deepEqual(
        dropped,
        [],
        `.vercelignore silently drops path(s) the web project ships: ${dropped.join(", ")} — `
          + "add a leading `/` to whichever pattern matched, so it only fires at the repo root",
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("the compose file and the web proxy agree on the gateway port", () => {
  it("compose publishes host port 8000, the dev fallback lib/gateway.ts uses", () => {
    assert.match(compose, /"8000:8000"/);
  });
});
