import { execFileSync } from "node:child_process";

/**
 * Build identity for the reproducibility capsule and exports. Vercel injects
 * the SHA in CI; locally we ask git. Both failing is a real state (tarball
 * build) and reads "dev" — never a fabricated identity.
 */
function commitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "dev";
  }
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
    NEXT_PUBLIC_COMMIT_SHA: commitSha(),
    // A Git SHA proves source identity, not that the artifact was deployed.
    // Expose Vercel's build context separately so the Developer control plane
    // can keep local builds and deployed artifacts visibly distinct.
    NEXT_PUBLIC_DEPLOYMENT_ENV: deploymentEnvironment(),
  },
};

export default nextConfig;
