/**
 * Request-scoped upstream capture — server only.
 * ==============================================
 *
 * The pipeline inspector shows the *raw* payload each vendor returned, which
 * means something has to hold those bodies between the adapter parsing them and
 * the route serialising them. A module-level "current capture" variable is the
 * obvious way and it is wrong: two inspections in flight at once would write
 * into whichever buffer was assigned last, and the bug would only appear under
 * concurrency, which is exactly when nobody is looking.
 *
 * `AsyncLocalStorage` is the correct primitive — the scope follows the async
 * continuation rather than the wall clock, so a capture opened by request A is
 * invisible to request B no matter how their awaits interleave.
 *
 * This file is the *only* place in the provider layer that imports a Node
 * built-in. `lib/observability.ts` stays isomorphic and takes the resolver by
 * injection, so `lib/venues.ts` — which is imported by client components — can
 * report upstream calls without dragging `node:async_hooks` into the browser
 * bundle.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import {
  type CaptureScope,
  type UpstreamCall,
  registerSecret,
  setCaptureResolver,
} from "../observability";

const storage = new AsyncLocalStorage<CaptureScope>();

setCaptureResolver(() => storage.getStore() ?? null);

export interface CaptureResult<T> {
  result: T;
  calls: UpstreamCall[];
}

/**
 * Run `fn` with upstream capture enabled and return what it produced alongside
 * every outbound call made inside it.
 *
 * The buffer is returned even when `fn` throws, because a failed lookup is the
 * case where the captured attempts matter most — "which three vendors did it
 * ask, and what did each say" is the whole question.
 */
export async function withCapture<T>(
  bodies: boolean,
  fn: () => Promise<T>,
): Promise<CaptureResult<T>> {
  const scope: CaptureScope = { calls: [], bodies };
  try {
    const result = await storage.run(scope, fn);
    return { result, calls: scope.calls };
  } catch (err) {
    (err as Error & { captured?: UpstreamCall[] }).captured = scope.calls;
    throw err;
  }
}

/** Upstream calls attached to a thrown error by `withCapture`, if any. */
export function capturedFrom(err: unknown): UpstreamCall[] {
  return (err as { captured?: UpstreamCall[] })?.captured ?? [];
}

// --------------------------------------------------------------------------
// Secret registration
// --------------------------------------------------------------------------

/**
 * Variables whose *value* is a credential, matched by name.
 *
 * Pattern-matched rather than listed, so adding an eighth provider does not
 * silently create a key the redactor has never heard of. The failure mode of a
 * hand-maintained list here is a credential in a screenshot.
 */
const SECRET_ENV_RE = /(_API_KEY|_APIKEY|_KEY|_TOKEN|_SECRET|_PASSWORD|_PWD)$/i;

/** Never treated as secret — public identifiers that merely end in a keyword. */
const SECRET_ENV_ALLOW = new Set(["NEXT_PUBLIC_API_KEY"]);

/**
 * Teach the redactor every credential this process holds.
 *
 * Called at import time and again after a provider hot-reload, because the
 * point of a reload is that the environment may have changed.
 */
export function registerEnvSecrets(env: NodeJS.ProcessEnv = process.env): number {
  let registered = 0;
  for (const [name, value] of Object.entries(env)) {
    if (!value || SECRET_ENV_ALLOW.has(name)) continue;
    if (!SECRET_ENV_RE.test(name)) continue;
    registerSecret(value);
    registered += 1;
  }
  return registered;
}

registerEnvSecrets();
