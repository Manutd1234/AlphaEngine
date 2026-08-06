/**
 * Build identity and deployment context, inlined by `next.config.mjs`. A Git
 * SHA identifies source but does not, by itself, prove that Vercel deployed it.
 */
export const APP_COMMIT = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "dev";

export type AppDeploymentEnvironment = "production" | "preview" | "development" | "local";

const deploymentEnvironment = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV;

export const APP_DEPLOYMENT_ENV: AppDeploymentEnvironment =
  deploymentEnvironment === "production"
    || deploymentEnvironment === "preview"
    || deploymentEnvironment === "development"
    ? deploymentEnvironment
    : "local";

export const IS_VERCEL_DEPLOYMENT =
  APP_DEPLOYMENT_ENV === "production" || APP_DEPLOYMENT_ENV === "preview";
