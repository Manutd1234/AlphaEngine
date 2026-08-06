import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import { TRUSTED_ARTIFACT_PUBLIC_KEY_SHA256 } from "./lib/artifact-trust.mjs";

/**
 * Build identity for the reproducibility capsule and exports. Vercel injects
 * the SHA in CI; locally we ask git. Both failing is a real state (tarball
 * build) and reads "dev" — never a fabricated identity.
 */
function commitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "dev";
  }
}

const buildCommitSha = commitSha();
const buildDeploymentEnvironment = deploymentEnvironment();

function gitTreeIdentity() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

/** Content-addressed build inputs plus the deployment identity the signer saw. */
function buildProvenanceDigest() {
  const lockfile = readFileSync(new URL("./package-lock.json", import.meta.url));
  const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  const provenance = JSON.stringify({
    schemaVersion: 1,
    subject: "alphaengine-web-build",
    commit: buildCommitSha.toLowerCase(),
    gitTree: gitTreeIdentity().toLowerCase(),
    packageLockSha256: createHash("sha256").update(lockfile).digest("hex"),
    node: process.version,
    next: packageJson.dependencies?.next ?? "unknown",
    environment: buildDeploymentEnvironment,
    deployment: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL ?? "local",
  });
  return createHash("sha256").update(provenance, "utf8").digest("hex");
}

const buildProvenanceSha256 = buildProvenanceDigest();

/**
 * Optional build-time Ed25519 attestation. The private key is consumed only by
 * next.config.mjs; the compiled app receives the claim, signature and public
 * key needed to verify it, never the signer.
 */
function artifactAttestationEnv() {
  const configured = process.env.ALPHAENGINE_ARTIFACT_SIGNING_KEY?.trim();
  if (!configured) return {};
  const privateKey = createPrivateKey(configured.replace(/\\n/g, "\n"));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("ALPHAENGINE_ARTIFACT_SIGNING_KEY must be an Ed25519 private key");
  }
  const claim = JSON.stringify({
    schemaVersion: 1,
    subject: "alphaengine-web",
    commit: buildCommitSha.toLowerCase(),
    environment: buildDeploymentEnvironment,
    provenanceSha256: buildProvenanceSha256,
  });
  const payload = Buffer.from(claim, "utf8");
  const publicKeyObject = createPublicKey(privateKey);
  const publicKeyDer = publicKeyObject.export({ type: "spki", format: "der" });
  const fingerprint = createHash("sha256").update(publicKeyDer).digest("hex");
  if (!TRUSTED_ARTIFACT_PUBLIC_KEY_SHA256) {
    throw new Error("Pin the build signer's public-key fingerprint in lib/artifact-trust.mjs");
  }
  if (fingerprint !== TRUSTED_ARTIFACT_PUBLIC_KEY_SHA256) {
    throw new Error("ALPHAENGINE_ARTIFACT_SIGNING_KEY does not match the pinned artifact trust root");
  }
  const publicKey = publicKeyObject.export({ type: "spki", format: "pem" }).toString();
  return {
    ALPHAENGINE_ARTIFACT_ATTESTATION: payload.toString("base64"),
    ALPHAENGINE_ARTIFACT_SIGNATURE: sign(null, payload, privateKey).toString("base64"),
    ALPHAENGINE_ARTIFACT_PUBLIC_KEY: publicKey,
  };
}

function deploymentEnvironment() {
  const value = process.env.VERCEL_ENV;
  return value === "production" || value === "preview" || value === "development"
    ? value
    : "local";
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep framework-generated AI instruction files out of a candidate's
  // committed assessment tree. Repository guidance belongs at the repo root.
  agentRules: false,
  env: {
    NEXT_PUBLIC_COMMIT_SHA: buildCommitSha.slice(0, 7),
    ALPHAENGINE_BUILD_COMMIT_SHA: buildCommitSha,
    ALPHAENGINE_BUILD_PROVENANCE_SHA256: buildProvenanceSha256,
    // A Git SHA proves source identity, not that the artifact was deployed.
    // Expose Vercel's build context separately so the Developer control plane
    // can keep local builds and deployed artifacts visibly distinct.
    NEXT_PUBLIC_DEPLOYMENT_ENV: buildDeploymentEnvironment,
    ...artifactAttestationEnv(),
  },
};

export default nextConfig;
