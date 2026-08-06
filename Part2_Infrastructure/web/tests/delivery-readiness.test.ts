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
  isGatewayOpenApiDocument,
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
