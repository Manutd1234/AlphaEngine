import { createHash, createPublicKey, verify } from "node:crypto";

import { canonicalJson } from "@/lib/canonical-json";
import { COMMITTED_GATEWAY_OPENAPI_SHA256 } from "@/lib/gateway-openapi-digest.generated";
import { callGateway, gatewayState } from "@/lib/gateway";
import { computeMcParityJson, MC_PARITY_HORIZON_BARS, MC_PARITY_PATHS } from "@/lib/mc-parity";
import { MC_PARITY_REFERENCE_SHA256 } from "@/lib/mc-parity-reference.generated";

export { COMMITTED_GATEWAY_OPENAPI_SHA256 } from "@/lib/gateway-openapi-digest.generated";

/**
 * Server-side delivery-readiness evidence.
 *
 * `node:crypto` deliberately keeps this module out of the browser bundle. Route
 * handlers can pass a fetched OpenAPI document in, then return the small evidence
 * objects below without serialising either schema document to the client.
 */

const HASH_ALGORITHM = "sha256" as const;
const OPENAPI_MAX_BYTES = 512 * 1024;
const OPENAPI_CACHE_MS = 5 * 60_000;
const OPENAPI_FAILURE_CACHE_MS = 15_000;

// Moved to its own isomorphic module so the browser's parity check serialises
// with the exact same code; re-exported so existing imports keep working.
export { canonicalJson } from "@/lib/canonical-json";

/** SHA-256 of the stable UTF-8 JSON encoding, expressed as lowercase hex. */
export function canonicalJsonSha256(value: unknown): string {
  return createHash(HASH_ALGORITHM).update(canonicalJson(value), "utf8").digest("hex");
}

export type GatewayOpenApiUnavailableCause =
  | "not_configured"
  | "unreachable"
  | "invalid_response";

export type GatewayOpenApiInput =
  | { available: true; document: unknown }
  | { available: false; cause: GatewayOpenApiUnavailableCause };

export interface GatewayOpenApiEvidence {
  kind: "gateway_openapi";
  state: "match" | "mismatch" | "unavailable";
  passed: boolean;
  algorithm: typeof HASH_ALGORITHM;
  expectedDigest: string;
  observedDigest: string | null;
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Minimal shape check before a live document is allowed to become drift evidence. */
export function isGatewayOpenApiDocument(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.openapi === "string"
    && isRecord(value.info)
    && isRecord(value.paths);
}

const UNAVAILABLE_DETAIL: Record<GatewayOpenApiUnavailableCause, string> = {
  not_configured: "No gateway is configured, so its OpenAPI contract cannot be compared.",
  unreachable: "The gateway OpenAPI contract could not be reached.",
  invalid_response: "The gateway did not supply a canonical JSON OpenAPI document.",
};

function unavailableGatewayOpenApi(cause: GatewayOpenApiUnavailableCause): GatewayOpenApiEvidence {
  return {
    kind: "gateway_openapi",
    state: "unavailable",
    passed: false,
    algorithm: HASH_ALGORITHM,
    expectedDigest: COMMITTED_GATEWAY_OPENAPI_SHA256,
    observedDigest: null,
    detail: UNAVAILABLE_DETAIL[cause],
  };
}

/**
 * Compare one live document with the repository-owned gateway contract.
 *
 * Invalid JSON-domain values are classified as unavailable. The result contains
 * digests only, so a route can safely send this evidence to the browser.
 */
export function compareGatewayOpenApi(input: GatewayOpenApiInput): GatewayOpenApiEvidence {
  if (!input.available) return unavailableGatewayOpenApi(input.cause);

  let observedDigest: string;
  try {
    observedDigest = canonicalJsonSha256(input.document);
  } catch {
    return unavailableGatewayOpenApi("invalid_response");
  }

  const matches = observedDigest === COMMITTED_GATEWAY_OPENAPI_SHA256;
  return {
    kind: "gateway_openapi",
    state: matches ? "match" : "mismatch",
    passed: matches,
    algorithm: HASH_ALGORITHM,
    expectedDigest: COMMITTED_GATEWAY_OPENAPI_SHA256,
    observedDigest,
    detail: matches
      ? "The live gateway OpenAPI contract matches the committed contract."
      : "The live gateway OpenAPI contract differs from the committed contract.",
  };
}

// ---------------------------------------------------------------------------
// Numerics parity — the Monte Carlo engine, checked against its own reference
// ---------------------------------------------------------------------------

export interface McParityEvidence {
  kind: "mc_parity";
  state: "match" | "mismatch";
  passed: boolean;
  algorithm: typeof HASH_ALGORITHM;
  expectedDigest: string;
  observedDigest: string;
  paths: number;
  horizonBars: number;
  detail: string;
}

let mcParityCache: McParityEvidence | null = null;

/**
 * Recompute the committed parity fixture on this Node instance and compare.
 *
 * Cached per instance after the first call: the simulation is deterministic,
 * so recomputing per poll would spend milliseconds proving the same bytes.
 * The browser leg of the same claim runs in the Developer console, against
 * the same committed reference.
 */
export function mcParityEvidence(): McParityEvidence {
  if (mcParityCache) return mcParityCache;
  const observedJson = computeMcParityJson();
  const observedDigest = createHash(HASH_ALGORITHM).update(observedJson, "utf8").digest("hex");
  const matches = observedDigest === MC_PARITY_REFERENCE_SHA256;
  mcParityCache = {
    kind: "mc_parity",
    state: matches ? "match" : "mismatch",
    passed: matches,
    algorithm: HASH_ALGORITHM,
    expectedDigest: MC_PARITY_REFERENCE_SHA256,
    observedDigest,
    paths: MC_PARITY_PATHS,
    horizonBars: MC_PARITY_HORIZON_BARS,
    detail: matches
      ? `This instance reproduced the committed ${MC_PARITY_PATHS}-path simulation byte for byte.`
      : "This instance's Monte Carlo engine no longer reproduces the committed reference — the numerics drifted.",
  };
  return mcParityCache;
}

interface GatewayOpenApiCacheEntry {
  key: string;
  expiresAt: number;
  evidence: GatewayOpenApiEvidence;
}

let gatewayOpenApiCache: GatewayOpenApiCacheEntry | null = null;
let gatewayOpenApiFlight: { key: string; promise: Promise<GatewayOpenApiEvidence> } | null = null;

function gatewayOpenApiCacheKey(): string {
  const state = gatewayState();
  const endpoint = state.kind === "url" ? state.url.origin : state.kind;
  return `${endpoint}:${process.env.ALPHAENGINE_GATEWAY_TOKEN?.trim() ? "authenticated" : "anonymous"}`;
}

/**
 * Fetch and compare the nearly-static live contract without turning every
 * 30-second public health poll into a 111 KB gateway transfer. Concurrent reads
 * share one request; success/drift is held for five minutes and failures only
 * briefly, so recovery is still visible promptly.
 */
export async function gatewayOpenApiEvidence(now = Date.now()): Promise<GatewayOpenApiEvidence> {
  const key = gatewayOpenApiCacheKey();
  if (gatewayOpenApiCache?.key === key && gatewayOpenApiCache.expiresAt > now) {
    return gatewayOpenApiCache.evidence;
  }
  if (gatewayOpenApiFlight?.key === key) return gatewayOpenApiFlight.promise;

  const promise = callGateway<unknown>("/openapi.json", {
    method: "GET",
    timeoutMs: 1_500,
    maxResponseBytes: OPENAPI_MAX_BYTES,
    subject: "the live gateway OpenAPI contract",
    validate: isGatewayOpenApiDocument,
  }).then((result) => {
    const evidence = result.ok
      ? compareGatewayOpenApi({ available: true, document: result.data })
      : compareGatewayOpenApi({
          available: false,
          cause: result.failure.code === "gateway_not_configured"
            ? "not_configured"
            : result.failure.code === "gateway_invalid_payload"
              ? "invalid_response"
              : "unreachable",
        });
    gatewayOpenApiCache = {
      key,
      expiresAt: now + (evidence.state === "unavailable" ? OPENAPI_FAILURE_CACHE_MS : OPENAPI_CACHE_MS),
      evidence,
    };
    return evidence;
  }).finally(() => {
    if (gatewayOpenApiFlight?.key === key) gatewayOpenApiFlight = null;
  });
  gatewayOpenApiFlight = { key, promise };
  return promise;
}

/** Test boundary for route cases that deliberately swap gateway responses. */
export function resetGatewayOpenApiEvidenceCache(): void {
  gatewayOpenApiCache = null;
  gatewayOpenApiFlight = null;
}

export interface BuildTraceabilityEvidence {
  kind: "build_traceability";
  state: "traceable" | "unverified";
  passed: boolean;
  deploymentEnvironment: string | null;
  commitIdentity: string | null;
  detail: string;
}

const IMMUTABLE_COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/** Pure evaluation of whether a deployed build has an immutable source identity. */
export function evaluateBuildTraceability(
  deploymentEnvironment: string | null | undefined,
  commitIdentity: string | null | undefined,
): BuildTraceabilityEvidence {
  const environment = deploymentEnvironment?.trim().toLowerCase() || null;
  const commit = commitIdentity?.trim().toLowerCase() || null;
  const deployed = environment === "production" || environment === "preview";
  const identified = commit !== null && IMMUTABLE_COMMIT_RE.test(commit);

  if (!deployed) {
    return {
      kind: "build_traceability",
      state: "unverified",
      passed: false,
      deploymentEnvironment: environment,
      commitIdentity: identified ? commit : null,
      detail: "Build traceability requires a production or preview deployment.",
    };
  }

  if (!identified) {
    return {
      kind: "build_traceability",
      state: "unverified",
      passed: false,
      deploymentEnvironment: environment,
      commitIdentity: null,
      detail: "The deployed build does not expose an immutable Git commit identity.",
    };
  }

  return {
    kind: "build_traceability",
    state: "traceable",
    passed: true,
    deploymentEnvironment: environment,
    commitIdentity: commit,
    detail: `The deployed build is traceable to commit ${commit}.`,
  };
}

export const ARTIFACT_ATTESTATION_ENV = "ALPHAENGINE_ARTIFACT_ATTESTATION";
export const ARTIFACT_SIGNATURE_ENV = "ALPHAENGINE_ARTIFACT_SIGNATURE";
export const ARTIFACT_PUBLIC_KEY_ENV = "ALPHAENGINE_ARTIFACT_PUBLIC_KEY";

export interface ArtifactCustodyEvidence {
  kind: "artifact_custody";
  state: "attested" | "unsigned" | "untrusted" | "invalid" | "unverified";
  passed: boolean;
  algorithm: "ed25519";
  deploymentEnvironment: string | null;
  commitIdentity: string | null;
  provenanceDigest: string | null;
  detail: string;
}

/** Exact claim a build signer must sign, encoded as UTF-8 then base64. */
export function artifactAttestationPayload(
  environment: string,
  commit: string,
  provenanceSha256: string,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    subject: "alphaengine-web",
    commit: commit.toLowerCase(),
    environment: environment.toLowerCase(),
    provenanceSha256: provenanceSha256.toLowerCase(),
  });
}

function decodeBase64(value: string): Buffer | null {
  const compact = value.trim();
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return Buffer.from(compact, "base64");
}

/**
 * Verify that the deployed commit/environment identity was signed during the
 * build. Missing evidence stays visibly unsigned; malformed or mismatched
 * evidence is a harder failure and never degrades into a traceability pass.
 */
export function evaluateArtifactCustody(input: {
  deploymentEnvironment: string | null | undefined;
  commitIdentity: string | null | undefined;
  attestation: string | null | undefined;
  signature: string | null | undefined;
  publicKey: string | null | undefined;
  trustedPublicKeySha256: string | null | undefined;
  provenanceSha256: string | null | undefined;
}): ArtifactCustodyEvidence {
  const build = evaluateBuildTraceability(input.deploymentEnvironment, input.commitIdentity);
  const base = {
    kind: "artifact_custody" as const,
    algorithm: "ed25519" as const,
    deploymentEnvironment: build.deploymentEnvironment,
    commitIdentity: build.commitIdentity,
    provenanceDigest: /^[0-9a-f]{64}$/i.test(input.provenanceSha256?.trim() ?? "")
      ? input.provenanceSha256!.trim().toLowerCase()
      : null,
  };
  if (!build.passed || !build.deploymentEnvironment || !build.commitIdentity) {
    return {
      ...base,
      state: "unverified",
      passed: false,
      detail: "Artifact custody requires a deployed build with its full Git commit identity.",
    };
  }
  if (!base.provenanceDigest) {
    return {
      ...base,
      state: "unverified",
      passed: false,
      detail: "Artifact custody requires a content-addressed build-provenance digest.",
    };
  }
  if (!input.attestation?.trim() || !input.signature?.trim() || !input.publicKey?.trim()) {
    return {
      ...base,
      state: "unsigned",
      passed: false,
      detail: `Build ${build.commitIdentity.slice(0, 7)} is traceable but has no verified Ed25519 attestation.`,
    };
  }
  if (!input.trustedPublicKeySha256?.trim()) {
    return {
      ...base,
      state: "untrusted",
      passed: false,
      detail: "No approved artifact-signing public key is pinned in reviewed source.",
    };
  }

  const payload = decodeBase64(input.attestation);
  const signature = decodeBase64(input.signature);
  const expected = artifactAttestationPayload(
    build.deploymentEnvironment,
    build.commitIdentity,
    base.provenanceDigest,
  );
  try {
    const publicKey = createPublicKey(input.publicKey.replace(/\\n/g, "\n"));
    const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
    const fingerprint = createHash("sha256").update(publicKeyDer).digest("hex");
    const matchesClaim = payload?.toString("utf8") === expected;
    const valid = Boolean(
      matchesClaim
      && signature
      && publicKey.asymmetricKeyType === "ed25519"
      && fingerprint === input.trustedPublicKeySha256.trim().toLowerCase()
      && verify(null, payload!, publicKey, signature),
    );
    if (!valid) throw new Error("invalid attestation");
  } catch {
    return {
      ...base,
      state: "invalid",
      passed: false,
      detail: "The artifact attestation is invalid or belongs to another build identity.",
    };
  }
  return {
    ...base,
    state: "attested",
    passed: true,
    detail: `Trusted signer attested build provenance ${base.provenanceDigest.slice(0, 12)}… for commit ${build.commitIdentity.slice(0, 7)}.`,
  };
}
