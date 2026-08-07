/**
 * The deployment surfaces agree with each other.
 *
 * The root .vercelignore is an upload drop-list shared by BOTH Vercel projects
 * (its own header documents the incident where excluding one project's files
 * starved the other's build). The container/compose/supabase trees are read by
 * neither project, so they must be listed — otherwise every CLI deploy uploads
 * a Docker context and a SQL migration history into two Next.js builds.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const vercelignore = readFileSync(fileURLToPath(new URL(".vercelignore", root)), "utf8");
const compose = readFileSync(fileURLToPath(new URL("docker-compose.yml", root)), "utf8");

describe("vercel upload scope excludes the non-web deployment trees", () => {
  for (const entry of ["Part2_Infrastructure/docker", "docker-compose.yml", "supabase"]) {
    it(`drops ${entry}`, () => {
      assert.ok(
        vercelignore.split("\n").some((line) => line.trim() === entry),
        `${entry} missing from the root .vercelignore drop-list`,
      );
    });
  }
});

describe("the compose file and the web proxy agree on the gateway port", () => {
  it("compose publishes host port 8000, the dev fallback lib/gateway.ts uses", () => {
    assert.match(compose, /"8000:8000"/);
  });
});
