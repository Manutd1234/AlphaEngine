/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep framework-generated AI instruction files out of a candidate's
  // committed assessment tree. Repository guidance belongs at the repo root.
  agentRules: false,
};

export default nextConfig;
