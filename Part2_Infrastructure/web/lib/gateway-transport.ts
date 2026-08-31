/** Stable, non-sensitive diagnoses for errors thrown by Node's fetch. */

const GATEWAY_URL_ENV = "ALPHAENGINE_GATEWAY_URL";

/** Fetch hides the operating-system code one level down in `cause`. */
export function transportCause(error: unknown): string | null {
  const direct = (error as { code?: unknown })?.code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown })?.cause;
  const nested = (cause as { code?: unknown })?.code;
  return typeof nested === "string" ? nested : null;
}

/** Operator action for each transport failure, never a host or credential. */
export const TRANSPORT_HINTS: Record<string, string> = {
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    `The gateway's certificate is signed by a root this deployment does not trust. `
    + `Point NODE_EXTRA_CA_CERTS at the bundled certs/gateway-ca.pem and verify ${GATEWAY_URL_ENV}; `
    + `roll back to the previous known-good deployment if the pin cannot be restored.`,
  SELF_SIGNED_CERT_IN_CHAIN:
    `The gateway's certificate chain ends in a root this deployment does not trust — see docs/engineering/TLS_FLIP.md.`,
  DEPTH_ZERO_SELF_SIGNED_CERT:
    `The gateway presented a self-signed certificate with no chain — see docs/engineering/TLS_FLIP.md.`,
  CERT_HAS_EXPIRED:
    `The gateway's certificate has expired. Re-copy the root printed by the deploy workflow's TLS sidecar step.`,
  ERR_TLS_CERT_ALTNAME_INVALID:
    `The gateway's certificate does not cover the host ${GATEWAY_URL_ENV} names.`,
  ERR_SSL_WRONG_VERSION_NUMBER:
    `The server on that port is not speaking TLS. ${GATEWAY_URL_ENV} is https:// against the gateway's plaintext port — use the TLS port. http:// is local-only; Vercel rejects public plaintext origins.`,
  EPROTO:
    `The TLS handshake failed. ${GATEWAY_URL_ENV} may be https:// against the gateway's plaintext port.`,
  ECONNREFUSED:
    `Nothing is listening on the port ${GATEWAY_URL_ENV} names. Check the gateway container and the port.`,
  ENOTFOUND: `The host in ${GATEWAY_URL_ENV} does not resolve.`,
  EAI_AGAIN: `DNS lookup for the host in ${GATEWAY_URL_ENV} failed temporarily.`,
  ETIMEDOUT:
    `The connection timed out before any response. Usually a firewall or cloud security list, not the gateway process.`,
  EHOSTUNREACH: `No route to the gateway host — check the network path and any security list.`,
  ENETUNREACH: `No route to the gateway network — check the network path and any security list.`,
  ECONNRESET: `The gateway closed the connection mid-request.`,
};
