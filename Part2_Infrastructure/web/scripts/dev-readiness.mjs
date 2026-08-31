/**
 * HTTP readiness is stronger than a bound port.
 *
 * Next can inherit a stale listener, choose another port, or leave a process
 * alive while compilation never produces a document. The supervisor therefore
 * waits for the response body that identifies the application it started.
 * Kept separate so the retry/deadline arithmetic is tested without spawning
 * either service or opening a real loopback socket.
 */

function defaultSleep(milliseconds) {
  return new Promise((resolveSleep) => {
    const timer = setTimeout(resolveSleep, milliseconds);
    timer.unref?.();
  });
}

/**
 * @typedef {object} ReadinessOptions
 * @property {string} name
 * @property {string} url
 * @property {(reading: { response: Response, body: string }) => boolean | Promise<boolean>} [accept]
 * @property {number} [deadlineMs]
 * @property {number} [intervalMs]
 * @property {number} [requestTimeoutMs]
 * @property {typeof fetch} [fetchImpl]
 * @property {(milliseconds: number) => Promise<void>} [sleep]
 * @property {() => number} [now]
 * @property {AbortSignal} [signal]
 */

async function attemptRequest({ url, requestTimeoutMs, fetchImpl, accept }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await response.text();
    const ready = Boolean(await accept({ response, body }));
    return {
      ready,
      status: response.status,
      detail: `HTTP ${response.status}${ready ? "" : ", unexpected response"}`,
    };
  } catch (error) {
    const detail = error?.name === "AbortError"
      ? `request exceeded ${requestTimeoutMs}ms`
      : error instanceof Error ? error.message : String(error);
    return { ready: false, status: null, detail };
  } finally {
    clearTimeout(timer);
  }
}

/** @param {ReadinessOptions} options */
export async function waitForReadiness({
  name,
  url,
  accept = ({ response }) => response.ok,
  deadlineMs = 45_000,
  intervalMs = 250,
  requestTimeoutMs = 2_000,
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = Date.now,
  signal = undefined,
}) {
  const startedAt = now();
  let attempts = 0;
  let last = { status: null, detail: "no response" };

  while (!signal?.aborted) {
    attempts += 1;
    last = await attemptRequest({ url, requestTimeoutMs, fetchImpl, accept });
    if (last.ready) return { ...last, attempts, elapsedMs: now() - startedAt };

    const elapsed = now() - startedAt;
    if (elapsed >= deadlineMs) {
      throw new Error(
        `${name} was not ready after ${deadlineMs}ms `
        + `(${attempts} attempts; ${last.detail})`,
      );
    }
    await sleep(Math.min(intervalMs, deadlineMs - elapsed));
  }

  throw new Error(`${name} readiness was cancelled after ${now() - startedAt}ms`);
}
