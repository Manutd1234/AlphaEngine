// --------------------------------------------------------------------------
// Instance identity
// --------------------------------------------------------------------------

/**
 * Random per-process id, shown in every telemetry payload.
 *
 * Deliberately not derived from a Vercel env var: those identify a *deployment*,
 * and the thing a reader needs to distinguish is two live instances of the same
 * deployment holding two different ledgers.
 */
export const instanceId: string = Math.random().toString(36).slice(2, 10);

export const startedAt: number = Date.now();
