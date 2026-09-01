/**
 * Deployment contract for the three retrieval RPCs recreated by the tenant
 * scope and image-vector migrations.
 *
 * PostgreSQL grants EXECUTE on a new function to PUBLIC. Dropping and
 * recreating a function also drops its old ACL, so these migrations must state
 * the complete replacement ACL themselves: revoke the implicit/public and
 * Supabase browser roles, then grant only the gateway's service role.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRepoFile } from "./helpers/deployment-files";

const stripComments = (source: string) => source.replace(/--[^\n]*/g, "");
const normalize = (source: string) => stripComments(source).replace(/\s+/g, " ").trim().toLowerCase();

const tenantScope = normalize(
  readRepoFile("supabase/migrations/20260822090000_research_tenant_scope.sql"),
);
const imageEmbedding = normalize(
  readRepoFile("supabase/migrations/20260822100000_research_image_embedding.sql"),
);

const retrievalRpcs = [
  {
    name: "match_research_documents",
    signature: "extensions.vector, integer, double precision, public.research_doc_kind, uuid, uuid",
    migration: tenantScope,
  },
  {
    name: "match_research_documents_hybrid",
    signature: "extensions.vector, text, integer, public.research_doc_kind, integer, uuid, uuid",
    migration: tenantScope,
  },
  {
    name: "match_research_document_images",
    signature: "extensions.vector, integer, public.research_doc_kind, uuid, uuid, double precision",
    migration: imageEmbedding,
  },
] as const;

describe("research retrieval RPC ACLs", () => {
  for (const rpc of retrievalRpcs) {
    it(`${rpc.name} revokes every browser/public path before granting service_role`, () => {
      const identity = `public.${rpc.name}( ${rpc.signature} )`;
      const revoke = `revoke execute on function ${identity} from public, anon, authenticated;`;
      const grant = `grant execute on function ${identity} to service_role;`;

      assert.ok(rpc.migration.includes(revoke), `${rpc.name} does not revoke PUBLIC, anon, and authenticated`);
      assert.ok(rpc.migration.includes(grant), `${rpc.name} is not explicitly granted to service_role`);
      assert.ok(
        rpc.migration.indexOf(revoke) < rpc.migration.indexOf(grant),
        `${rpc.name} must close the default ACL before granting the gateway role`,
      );
    });
  }

  it("contains no execute grant to a role other than service_role", () => {
    for (const migration of [tenantScope, imageEmbedding]) {
      const grants = [...migration.matchAll(/grant execute on function public\.match_research_[^;]+;/g)]
        .map((match) => match[0]);

      assert.ok(grants.length > 0, "the ACL scan found no retrieval grants");
      for (const grant of grants) {
        assert.match(grant, /\) to service_role;$/);
      }
    }
  });
});
