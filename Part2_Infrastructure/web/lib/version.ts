/**
 * Build identity, inlined at build time by `next.config.mjs`. Usable from both
 * client and server code; "dev" means no git and no CI env were available.
 */
export const APP_COMMIT = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "dev";
