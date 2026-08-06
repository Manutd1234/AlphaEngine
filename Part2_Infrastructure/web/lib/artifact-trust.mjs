/**
 * Approved Ed25519 signer, as the SHA-256 hex fingerprint of its SPKI DER
 * public key. Keep this trust root in reviewed source, independently from the
 * deployment environment that carries an attestation and signature.
 *
 * `null` is fail-closed: Artifact custody remains "No trust root" until an
 * operator deliberately pins the public key used by the build signer.
 *
 * @type {string | null}
 */
export const TRUSTED_ARTIFACT_PUBLIC_KEY_SHA256 = null;
