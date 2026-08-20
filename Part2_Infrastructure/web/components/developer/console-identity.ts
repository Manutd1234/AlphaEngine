/**
 * Build-time identity for the Developer control plane, in one place.
 *
 * These three are read by the console head, the pipeline strip and the commit
 * links, which now live in four files. They are constants derived from the
 * build, not state — a second copy of the ternary that spells the runtime
 * label is exactly how two surfaces come to disagree about which environment
 * this is.
 */

import { GITHUB_SOURCE_ROOT } from "@/lib/repository-catalog";
import { APP_COMMIT, APP_DEPLOYMENT_ENV } from "@/lib/version";

export const GITHUB_REPOSITORY_ROOT = GITHUB_SOURCE_ROOT.split("/blob/main")[0];

/** `dev` is the fallback stamped when no commit reached the build. */
export const HAS_COMMIT_IDENTITY = APP_COMMIT !== "dev";

export const RUNTIME_LABEL = APP_DEPLOYMENT_ENV === "production"
  ? "Vercel production"
  : APP_DEPLOYMENT_ENV === "preview"
    ? "Vercel preview"
    : process.env.NODE_ENV === "production"
      ? "Local production build"
      : "Local development";
