/**
 * Test-only deterministic snapshots for Markets, Proofs, and Diffusion.
 *
 * These are not a substitute for the stateful gateway and never cross a write
 * boundary. They exist for the exact serverless failure mode where the browser
 * can reach this Next.js app but its function cannot reach a loopback/private
 * `ALPHAENGINE_GATEWAY_URL`. The caller keeps the typed transport failure next
 * to this payload, so a sandbox drawing can never be mistaken for a live venue
 * read. `read-cache.ts` then holds the hydrated answer by URL, just as it holds
 * a last-known-good gateway response.
 */

import { absorption, diffusionEvents, findings } from "./coherence-fallback-diffusion";
import { books, certificate, history, status, universe } from "./coherence-fallback-market-base";
import { episodes, feeCurve, fees, indexSeries, replay } from "./coherence-fallback-market-evidence";
import {
  calibration, calibrationHistory, combos, rfq, settlement, shell, stake, surface,
} from "./coherence-fallback-market-models";

/** A fresh, isolated payload for a known read-only diagram route. */
export function coherenceFallbackFor(rawUrl: string): unknown | null {
  const url = new URL(rawUrl, "https://alphaengine.invalid");
  let payload: unknown | null;
  switch (url.pathname) {
    case "/api/gateway/coherence/status": payload = status; break;
    case "/api/gateway/coherence/universe": payload = universe; break;
    case "/api/gateway/coherence/books": payload = books; break;
    case "/api/gateway/coherence/books/history": payload = history(url); break;
    case "/api/gateway/coherence/certify": payload = certificate(url); break;
    case "/api/gateway/coherence/fees": payload = fees(url); break;
    case "/api/gateway/coherence/fees/curve": payload = feeCurve(url); break;
    case "/api/gateway/coherence/index": payload = indexSeries(); break;
    case "/api/gateway/coherence/episodes": payload = episodes(); break;
    case "/api/gateway/coherence/replay": payload = replay(); break;
    case "/api/gateway/coherence/surface": payload = surface(url); break;
    case "/api/gateway/coherence/stake": payload = stake(); break;
    case "/api/gateway/coherence/combos": payload = combos(); break;
    case "/api/gateway/coherence/calibration": payload = calibration(); break;
    case "/api/gateway/coherence/calibration/history": payload = calibrationHistory(); break;
    case "/api/gateway/coherence/settlement": payload = settlement(); break;
    case "/api/gateway/coherence/rfq": payload = rfq(); break;
    case "/api/gateway/coherence/shell": payload = shell(url); break;
    case "/api/gateway/diffusion/events": payload = diffusionEvents(); break;
    case "/api/gateway/diffusion/absorption": payload = absorption(); break;
    case "/api/gateway/diffusion/findings": payload = findings(); break;
    default: return null;
  }
  return structuredClone(payload);
}

/**
 * Add a sandbox drawing only when the transport and live cache have no
 * payload. Typed errors, request ids, endpoint budgets, and prior live data
 * otherwise survive exactly as received.
 */
export function withCoherenceFallback<A extends { data: unknown | null }>(
  rawUrl: string,
  answer: A,
  hasCachedData = false,
): A {
  if (answer.data !== null || hasCachedData) return answer;
  const payload = coherenceFallbackFor(rawUrl);
  return payload === null ? answer : { ...answer, data: payload as A["data"] };
}
