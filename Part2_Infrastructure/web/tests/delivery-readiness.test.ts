import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";

import committedGatewayOpenApi from "../../tools/openapi.json";
import {
  COMMITTED_GATEWAY_OPENAPI_SHA256,
  canonicalJson,
  canonicalJsonSha256,
  compareGatewayOpenApi,
  artifactAttestationPayload,
  evaluateArtifactCustody,
  evaluateBuildTraceability,
  gatewayOpenApiEvidence,
  isGatewayOpenApiDocument,
  resetGatewayOpenApiEvidenceCache,
} from "../lib/delivery-readiness";

describe("canonical gateway OpenAPI evidence", () => {
  it("sorts object keys recursively while retaining array order", () => {
    const left = { z: [3, 2, 1], a: { second: true, first: "value" } };
    const reordered = { a: { first: "value", second: true }, z: [3, 2, 1] };

    assert.equal(
      canonicalJson(left),
      '{"a":{"first":"value","second":true},"z":[3,2,1]}',
    );
    assert.equal(canonicalJsonSha256(left), canonicalJsonSha256(reordered));
    assert.notEqual(canonicalJsonSha256(left), canonicalJsonSha256({ ...reordered, z: [1, 2, 3] }));
  });

  it("matches the committed gateway contract without returning either document", () => {
    const evidence = compareGatewayOpenApi({ available: true, document: committedGatewayOpenApi });

    assert.equal(evidence.state, "match");
    assert.equal(evidence.passed, true);
    assert.equal(evidence.algorithm, "sha256");
    assert.equal(evidence.expectedDigest, COMMITTED_GATEWAY_OPENAPI_SHA256);
    assert.equal(evidence.observedDigest, COMMITTED_GATEWAY_OPENAPI_SHA256);
    assert.deepEqual(Object.keys(evidence).sort(), [
      "algorithm",
      "detail",
      "expectedDigest",
      "kind",
      "observedDigest",
      "passed",
      "state",
    ]);
  });

  it("reports a digest-only mismatch", () => {
    const changed = structuredClone(committedGatewayOpenApi);
    changed.info.version = "schema-body-marker-must-not-escape";
    const evidence = compareGatewayOpenApi({ available: true, document: changed });

    assert.equal(evidence.state, "mismatch");
    assert.equal(evidence.passed, false);
    assert.notEqual(evidence.observedDigest, evidence.expectedDigest);
    assert.doesNotMatch(JSON.stringify(evidence), /schema-body-marker-must-not-escape/);
  });

  it("classifies missing and invalid documents as unavailable", () => {
    const missing = compareGatewayOpenApi({ available: false, cause: "unreachable" });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const invalid = compareGatewayOpenApi({ available: true, document: cyclic });
    const sparse = compareGatewayOpenApi({ available: true, document: Array(1) });

    assert.equal(missing.state, "unavailable");
    assert.equal(missing.observedDigest, null);
    assert.equal(invalid.state, "unavailable");
    assert.equal(invalid.observedDigest, null);
    assert.equal(sparse.state, "unavailable");
    assert.equal(missing.expectedDigest, COMMITTED_GATEWAY_OPENAPI_SHA256);
    assert.equal(isGatewayOpenApiDocument(committedGatewayOpenApi), true);
    assert.equal(isGatewayOpenApiDocument(null), false);
    assert.equal(isGatewayOpenApiDocument({ openapi: "3.1.0", info: {}, paths: null }), false);
  });
});

describe("build traceability evidence", () => {
  it("is traceable only for a deployed build with an immutable commit identity", () => {
    const production = evaluateBuildTraceability("production", "a".repeat(40));
    const preview = evaluateBuildTraceability(" preview ", "0123456789abcdef".repeat(4));

    assert.equal(production.state, "traceable");
    assert.equal(production.passed, true);
    assert.equal(production.commitIdentity, "a".repeat(40));
    assert.equal(preview.state, "traceable");
  });

  it("keeps local builds and deployments without a commit unverified", () => {
    const local = evaluateBuildTraceability("local", "a".repeat(40));
    const unidentified = evaluateBuildTraceability("production", "dev");

    assert.equal(local.state, "unverified");
    assert.equal(local.passed, false);
    assert.equal(unidentified.state, "unverified");
    assert.equal(unidentified.commitIdentity, null);
  });
});

describe("artifact custody evidence", () => {
  const commit = "1".repeat(40);
  const environment = "production";
  const provenanceSha256 = "3".repeat(64);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = Buffer.from(
    artifactAttestationPayload(environment, commit, provenanceSha256),
    "utf8",
  );
  const attestation = payload.toString("base64");
  const signature = sign(null, payload, privateKey).toString("base64");
  const exportedPublicKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  const trustedPublicKeySha256 = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");

  it("passes only a signature bound to the deployed commit and environment", () => {
    const evidence = evaluateArtifactCustody({
      deploymentEnvironment: environment,
      commitIdentity: commit,
      attestation,
      signature,
      publicKey: exportedPublicKey,
      trustedPublicKeySha256,
      provenanceSha256,
    });

    assert.equal(evidence.state, "attested");
    assert.equal(evidence.passed, true);
    assert.equal(evidence.commitIdentity, commit);
  });

  it("keeps missing evidence unsigned and rejects a claim for another build", () => {
    const unsigned = evaluateArtifactCustody({
      deploymentEnvironment: environment,
      commitIdentity: commit,
      attestation: undefined,
      signature: undefined,
      publicKey: undefined,
      trustedPublicKeySha256,
      provenanceSha256,
    });
    const wrongPayload = Buffer.from(
      artifactAttestationPayload(environment, "2".repeat(40), provenanceSha256),
      "utf8",
    );
    const wrongBuild = evaluateArtifactCustody({
      deploymentEnvironment: environment,
      commitIdentity: commit,
      attestation: wrongPayload.toString("base64"),
      signature: sign(null, wrongPayload, privateKey).toString("base64"),
      publicKey: exportedPublicKey,
      trustedPublicKeySha256,
      provenanceSha256,
    });
    const untrusted = evaluateArtifactCustody({
      deploymentEnvironment: environment,
      commitIdentity: commit,
      attestation,
      signature,
      publicKey: exportedPublicKey,
      trustedPublicKeySha256: null,
      provenanceSha256,
    });

    assert.equal(unsigned.state, "unsigned");
    assert.equal(unsigned.passed, false);
    assert.equal(wrongBuild.state, "invalid");
    assert.equal(wrongBuild.passed, false);
    assert.equal(untrusted.state, "untrusted");
    assert.equal(untrusted.passed, false);
  });
});

/**
 * The five-minute cache, and the moment it stops being a measurement.
 *
 * The transfer argument for it is real — the live contract is 111 KB and the
 * public health route is polled every 30 seconds — but a cache hit is a
 * reading from an earlier poll, and a gateway can die inside the window. The
 * Developer readiness panel showed exactly that: "Gateway unavailable
 * (ECONNREFUSED)" beside "Schema compatibility — Drift detected", a finding
 * about a document that nothing had been able to read for a minute.
 *
 * Two properties hold the line. A failed fetch is classified `unavailable`
 * and never scored as drift, and a replayed verdict carries its own age.
 */
describe("a replayed OpenAPI verdict says how old it is", () => {
  const drifted = structuredClone(committedGatewayOpenApi);
  drifted.info.version = "drifted-for-this-test";

  const refused = () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  };

  /** Runs `body` with the gateway configured and `fetch` under our control. */
  async function withGateway(
    body: (serve: (respond: () => unknown) => void) => Promise<void>,
  ): Promise<void> {
    const realFetch = globalThis.fetch;
    const realUrl = process.env.ALPHAENGINE_GATEWAY_URL;
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.invalid";
    resetGatewayOpenApiEvidenceCache();
    try {
      await body((respond) => {
        globalThis.fetch = (async () => new Response(JSON.stringify(respond()), {
          headers: { "content-type": "application/json" },
        })) as typeof fetch;
      });
    } finally {
      globalThis.fetch = realFetch;
      if (realUrl === undefined) delete process.env.ALPHAENGINE_GATEWAY_URL;
      else process.env.ALPHAENGINE_GATEWAY_URL = realUrl;
      resetGatewayOpenApiEvidenceCache();
    }
  }

  it("never scores an unreachable gateway as drift", async () => {
    await withGateway(async () => {
      globalThis.fetch = refused as unknown as typeof fetch;
      const evidence = await gatewayOpenApiEvidence(1_000_000);

      // The distinction the panel depends on: nothing was compared, so there
      // is no observed digest and no verdict about the live contract.
      assert.equal(evidence.state, "unavailable");
      assert.equal(evidence.passed, false);
      assert.equal(evidence.observedDigest, null);
      assert.match(evidence.detail, /could not be reached/);
      assert.doesNotMatch(evidence.detail, /differs from|matches/);
    });
  });

  it("dates a comparison it replays after the gateway stops answering", async () => {
    await withGateway(async (serve) => {
      serve(() => drifted);
      const read = await gatewayOpenApiEvidence(1_000_000);
      assert.equal(read.state, "mismatch");
      assert.doesNotMatch(read.detail, /Last checked/);

      // The gateway dies. The next poll gets no document at all, and the cache
      // is what answers — so the answer has to carry its own age.
      globalThis.fetch = refused as unknown as typeof fetch;
      const replayed = await gatewayOpenApiEvidence(1_000_000 + 60_000);
      assert.equal(replayed.state, "mismatch");
      assert.equal(replayed.observedDigest, read.observedDigest);
      assert.match(replayed.detail, /Last checked 60s ago\./);

      // A replay is never restamped as fresh, and the window still expires.
      const later = await gatewayOpenApiEvidence(1_000_000 + 120_000);
      assert.match(later.detail, /Last checked 120s ago\./);
      const expired = await gatewayOpenApiEvidence(1_000_000 + 6 * 60_000);
      assert.equal(expired.state, "unavailable");
      assert.equal(expired.observedDigest, null);
    });
  });

  it("holds a match no longer than it holds a mismatch", async () => {
    // The dangerous direction: a cached pass outliving the gateway that earned
    // it would be a promotion gate going green on a dead port.
    await withGateway(async (serve) => {
      serve(() => committedGatewayOpenApi);
      assert.equal((await gatewayOpenApiEvidence(2_000_000)).state, "match");
      globalThis.fetch = refused as unknown as typeof fetch;
      assert.match((await gatewayOpenApiEvidence(2_000_000 + 90_000)).detail, /Last checked 90s ago\./);
      assert.equal((await gatewayOpenApiEvidence(2_000_000 + 6 * 60_000)).state, "unavailable");
    });
  });

  it("re-probes a failure quickly, so recovery is visible", async () => {
    await withGateway(async (serve) => {
      globalThis.fetch = refused as unknown as typeof fetch;
      assert.equal((await gatewayOpenApiEvidence(3_000_000)).state, "unavailable");
      serve(() => committedGatewayOpenApi);
      // Inside the 15s failure window the failure is still what is known.
      assert.equal((await gatewayOpenApiEvidence(3_000_000 + 5_000)).state, "unavailable");
      assert.equal((await gatewayOpenApiEvidence(3_000_000 + 20_000)).state, "match");
    });
  });
});
