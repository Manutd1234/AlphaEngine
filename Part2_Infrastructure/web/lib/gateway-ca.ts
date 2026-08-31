/**
 * Install the gateway's committed public root without replacing Node's roots.
 *
 * `NODE_EXTRA_CA_CERTS` is read only while Node starts. A Vercel function can
 * have the file in its trace and the environment variable set correctly yet
 * still start without loading it. Node 22.19+/24.5+ exposes the operation we
 * actually need at runtime: read the current defaults, append the pinned root,
 * and make that combined list the default for subsequent TLS connections.
 */

import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as tls from "node:tls";

export const GATEWAY_CA_RELATIVE_PATH = "certs/gateway-ca.pem";
export const GATEWAY_CA_SETUP_ERROR = "GATEWAY_CA_SETUP_FAILED";

export interface GatewayCaRuntime {
  cwd: () => string;
  readCertificate: (path: string) => string;
  getDefaultCACertificates?: () => string[];
  setDefaultCACertificates?: (certificates: ReadonlyArray<string>) => void;
}

export interface GatewayFetchDependencies {
  install: () => void;
  fetch: typeof globalThis.fetch;
}

export class GatewayCaSetupError extends Error {
  readonly code = GATEWAY_CA_SETUP_ERROR;

  constructor(cause?: unknown) {
    super("The bundled gateway certificate authority could not be installed.", { cause });
    this.name = "GatewayCaSetupError";
  }
}

const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

function parsePinnedRoot(raw: string): { pem: string; fingerprint: string } {
  const trimmed = raw.trim();
  const blocks = trimmed.match(CERTIFICATE_BLOCK);
  if (blocks?.length !== 1 || blocks[0] !== trimmed) {
    throw new Error("gateway-ca.pem must contain exactly one PEM certificate");
  }

  const certificate = new X509Certificate(trimmed);
  if (
    !certificate.ca
    || !certificate.checkIssued(certificate)
    || !certificate.verify(certificate.publicKey)
  ) {
    throw new Error("gateway-ca.pem must be a self-signed CA root");
  }
  return { pem: `${trimmed}\n`, fingerprint: certificate.fingerprint256 };
}

function fingerprints(certificates: ReadonlyArray<string>): Set<string> {
  return new Set(certificates.map((certificate) => new X509Certificate(certificate).fingerprint256));
}

const nodeRuntime: GatewayCaRuntime = {
  cwd: () => process.cwd(),
  readCertificate: (path) => readFileSync(path, "utf8"),
  getDefaultCACertificates: typeof tls.getCACertificates === "function"
    ? () => tls.getCACertificates("default")
    : undefined,
  setDefaultCACertificates: typeof tls.setDefaultCACertificates === "function"
    ? (certificates) => tls.setDefaultCACertificates(certificates)
    : undefined,
};

/**
 * A synchronous, idempotent installer. Synchronous setup is intentional: no
 * HTTPS request can race ahead while the process-wide trust list is changing.
 */
export function createGatewayCaInstaller(runtime: GatewayCaRuntime = nodeRuntime): () => void {
  let installed = false;

  return () => {
    if (installed) return;

    const getDefaults = runtime.getDefaultCACertificates;
    const setDefaults = runtime.setDefaultCACertificates;
    if (!getDefaults || !setDefaults) {
      // Node 20 remains within this workspace's declared engine range. It has
      // no runtime CA API, so preserve its established startup path:
      // NODE_EXTRA_CA_CERTS is still verified by TLS itself when fetch opens
      // the connection. A missing pin therefore fails closed at the handshake
      // instead of making every correctly configured Node 20 deployment fail
      // before dispatch.
      installed = true;
      return;
    }

    let defaults: string[] | null = null;
    let setAttempted = false;
    try {
      const pinned = parsePinnedRoot(
        runtime.readCertificate(resolve(runtime.cwd(), GATEWAY_CA_RELATIVE_PATH)),
      );
      defaults = getDefaults();
      const defaultsBefore = fingerprints(defaults);

      // setDefaultCACertificates replaces the list. Appending the pin to the
      // current list is therefore the security boundary: public web PKI roots
      // remain available, and verification is never disabled.
      setAttempted = true;
      setDefaults([...defaults, pinned.pem]);

      const defaultsAfter = fingerprints(getDefaults());
      if (!defaultsAfter.has(pinned.fingerprint)) {
        throw new Error("the gateway root was not present after installation");
      }
      for (const fingerprint of defaultsBefore) {
        if (!defaultsAfter.has(fingerprint)) {
          throw new Error("a pre-existing Node root was lost during installation");
        }
      }
      installed = true;
    } catch (cause) {
      // A failed postcondition must not leave a partially replaced global CA
      // list behind. Dispatch remains blocked even if rollback itself fails.
      if (setAttempted && defaults) {
        try {
          setDefaults(defaults);
        } catch {
          // The original setup failure remains the useful, non-sensitive cause.
        }
      }
      throw cause instanceof GatewayCaSetupError
        ? cause
        : new GatewayCaSetupError(cause);
    }
  };
}

const installGatewayCa = createGatewayCaInstaller();

/**
 * Build a gateway transport with explicit dependencies. The production export
 * below cannot accept per-call overrides, so an application caller cannot
 * accidentally bypass installation while supplying fetch options.
 */
export function createGatewayFetch(
  dependencies: GatewayFetchDependencies,
): (input: URL, init?: RequestInit) => Promise<Response> {
  return (input, init) => {
    if (input.protocol === "https:") dependencies.install();
    return dependencies.fetch(input, init);
  };
}

/**
 * Fetch a gateway URL, installing the pin first for TLS. Local co-located HTTP
 * remains usable on older Node releases; public HTTP is rejected by the origin
 * resolver before it can reach this boundary.
 */
export const gatewayFetch = createGatewayFetch({
  install: installGatewayCa,
  // Resolve global fetch at dispatch time so tests and instrumented runtimes
  // retain the platform's current implementation rather than a stale capture.
  fetch: (input, init) => globalThis.fetch(input, init),
});
