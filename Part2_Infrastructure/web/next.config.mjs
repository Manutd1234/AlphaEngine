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
/**
 * A PEM pasted into a hosting dashboard rarely survives intact: the editor
 * flattens its newlines to spaces, some shells deliver literal `\n`, and some
 * operators base64 the whole file to sidestep both. OpenSSL accepts none of
 * those shapes (`ERR_OSSL_UNSUPPORTED` — which failed a real deploy), so this
 * normalises every reasonable paste back to a canonical PEM before parsing.
 */
function normalisePemKey(raw) {
  let value = raw.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  if (!value.includes("-----BEGIN")) {
    // No PEM armor at all: treat as base64 of the whole PEM file.
    const decoded = Buffer.from(value.replace(/\s+/g, ""), "base64").toString("utf8");
    if (!decoded.includes("-----BEGIN")) return null;
    value = decoded;
  }
  // Rebuild the armor: whatever happened to the whitespace between the
  // markers, the base64 body is recoverable by stripping it all.
  const match = value.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!match) return null;
  const body = match[2].replace(/\s+/g, "");
  const wrapped = body.replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN ${match[1]}-----\n${wrapped}\n-----END ${match[1]}-----\n`;
}

/**
 * Name the wrong value by its shape, never by echoing it — whatever was pasted
 * may itself be a live secret, and build logs are not a secret store.
 */
function describeWrongShape(raw, pem) {
  // Check the NORMALISED text for armor labels, not the raw value: a
  // well-formed public key survives normalisation intact (the armor regex
  // accepts any [A-Z ]+ label), and base64-of-a-public-key has no armor at all
  // until it is decoded. Testing only `raw` left both branches unreachable and
  // handed the two likeliest paste mistakes a bare OpenSSL decoder code.
  const armored = pem ?? raw;
  if (armored.includes("-----BEGIN PUBLIC KEY")) {
    return "this is the PUBLIC key (artifact-signing-pub.pem); the build signs with the private one";
  }
  if (armored.includes("-----BEGIN CERTIFICATE")) return "this is a certificate, not a private key";
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return "this looks like a 64-character hex digest — probably the signer's "
      + "fingerprint (artifact-signing-fingerprint.txt) or a gateway token, not the private key";
  }
  if (/^eyJ[A-Za-z0-9_-]/.test(raw)) return "this looks like a JWT (a Supabase anon/service key)";
  if (/^(sbp_|sb_secret_|sb_publishable_)/.test(raw)) return "this looks like a Supabase token";
  if (/^https?:\/\//.test(raw)) return "this looks like a URL";
  return null;
}

/**
 * Optional attestation, and *optional* has to mean it: an unusable value here
 * must not be able to fail the build. A failed build never replaces the running
 * deployment, so treating a mistyped signing key as fatal takes the whole site
 * down — and hides every other env fix in the same deploy behind an error about
 * a feature nobody was blocked on. (That happened; this is the fix.)
 *
 * The security assertion is kept where it belongs. An unreadable value proves
 * nothing and yields no attestation, so `evaluateArtifactCustody` reports
 * `unsigned` and the readiness gate stays visibly red. But a *well-formed* key
 * that is the wrong algorithm or signs under an untrusted fingerprint is a real
 * alarm — someone is signing builds with a key this repo does not trust — and
 * that still fails the build, loudly and immediately.
 */
function artifactAttestationEnv() {
  const configured = process.env.ALPHAENGINE_ARTIFACT_SIGNING_KEY?.trim();
  if (!configured) return {};

  const pem = normalisePemKey(configured);
  let privateKey;
  try {
    if (!pem) throw new Error("no PEM armor and not base64-of-PEM");
    privateKey = createPrivateKey(pem);
  } catch (cause) {
    // Consulted for EVERY failure, not just unnormalisable ones — a valid
    // public-key PEM normalises cleanly and only fails at createPrivateKey.
    const shape = describeWrongShape(configured, pem)
      ?? `${cause.message} (${configured.length} characters)`;
    console.warn(
      "\n⚠ ALPHAENGINE_ARTIFACT_SIGNING_KEY could not be read as a private key — "
      + `${shape}.\n`
      + "  Building WITHOUT an attestation: the app deploys and Artifact custody "
      + "reports 'unsigned' rather than a false pass.\n"
      + "  To fix: set it to the PEM contents of your Ed25519 key, or to "
      + "`base64 -i key.pem` output for a paste-proof single line.\n",
    );
    return {};
  }

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
  // The repository's Playwright/layout audits intentionally use the numeric
  // loopback host. Explicitly allow it so Next's dev asset guard does not turn
  // an otherwise healthy localhost session into a partial, style-less render.
  allowedDevOrigins: ["127.0.0.1"],
  // node-oracledb loads its protocol implementation at runtime and is the
  // largest dependency in the tree. Bundling it breaks the dynamic requires and
  // inflates every function that merely imports the route graph; leaving it
  // external keeps it in node_modules where the driver expects to find itself.
  serverExternalPackages: ["oracledb"],
  // The gateway's pinned TLS root is read synchronously before gateway HTTPS
  // dispatch. It is a runtime file rather than a JS import, so trace the exact
  // public certificate into every server function that can import the gateway.
  outputFileTracingIncludes: { "/**": ["./certs/gateway-ca.pem"] },
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
