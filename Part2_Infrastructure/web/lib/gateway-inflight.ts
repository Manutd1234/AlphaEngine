/**
 * One in-flight GET per path, and the rule for when joining one is worth it.
 *
 * SPLIT OUT OF `lib/gateway.ts` on 2026-08-26, when that file crossed the 400
 * line ceiling. The seam is the one it already had: everything here is about
 * WHO WAITS FOR WHOM, and nothing here knows what a gateway is, how a failure
 * is shaped or where the token lives. `gateway.ts` keeps the boundary; this
 * keeps the sharing.
 *
 * WHY THE SHARING NEEDS A RULE AT ALL. Collapsing identical GETs is right —
 * three panes opening the Proofs tab ask for one universe read between them,
 * and without this each would put its own request on the exchange's token
 * bucket. What was wrong was that a LATE caller was handed a promise whose
 * budget was already spent, and then reported its answer as its own.
 *
 * MEASURED IN THE PRODUCT, NOT IN THE ABSTRACT. `/api/coherence/combos` is
 * budgeted 25s at the route and was budgeted 9s in the browser. A first poll
 * that hangs is abandoned browser-side at 9s; the SECOND poll, twenty seconds
 * later, joined the first request's still-open promise and received its 504
 * body a few seconds in — comfortably inside its own budget. So "The risk
 * gateway did not answer within 25000ms" was rendered by a request that had
 * waited five, describing a poll the reader had already given up on. The
 * failure on screen was twenty seconds stale and attributed to the wrong ask.
 */

/** A GET in flight, and when it started. The timestamp is the whole fix. */
interface InflightGet<T> {
  started: number;
  promise: Promise<T>;
}

const inflight = new Map<string, InflightGet<unknown>>();

/**
 * How much of its own budget a joiner must still have for joining to be worth it.
 *
 * A shared call with less than this left is about to abort, and joining it buys
 * the joiner nothing but somebody else's failure. Two seconds is longer than
 * any answer this boundary serves from a store and shorter than every deadline
 * a live read carries, so the branch fires only where it is meant to.
 */
export const JOIN_FLOOR_MS = 2_000;

/** Whether a caller with `budgetMs` should wait on a call started `elapsedMs` ago. */
export function joinIsWorthIt(elapsedMs: number, budgetMs: number): boolean {
  return budgetMs - elapsedMs >= JOIN_FLOOR_MS;
}

/**
 * Runs `start()`, or joins an equivalent call already running for this path.
 *
 * `clone` is the caller's, because what may be shared is a decision this module
 * cannot make: a success handed to two waiters is one object, and a route that
 * mutated its payload before serialising would corrupt the other's.
 */
export async function shareGet<T>(
  path: string,
  budgetMs: number,
  start: () => Promise<T>,
  clone: (value: T) => T,
): Promise<T> {
  const pending = inflight.get(path) as InflightGet<T> | undefined;
  if (pending && joinIsWorthIt(Date.now() - pending.started, budgetMs)) {
    return clone(await pending.promise);
  }
  // Either nothing is in flight, or what is in flight cannot answer inside this
  // caller's budget. Asking again costs one request; being told the answer to a
  // question that has already timed out costs the reader a sentence describing
  // a poll they never made.
  const entry: InflightGet<T> = { started: Date.now(), promise: start() };
  inflight.set(path, entry as InflightGet<unknown>);
  try {
    return clone(await entry.promise);
  } finally {
    // ONLY IF IT IS STILL OURS. A later caller that could not join replaced
    // this entry with its own; deleting unconditionally would drop a live
    // registration and let the call after that make a third request.
    if (inflight.get(path) === (entry as InflightGet<unknown>)) inflight.delete(path);
  }
}
