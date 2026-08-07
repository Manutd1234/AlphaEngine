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
// Pinned 2026-08-08. Ed25519 keypair generated locally (~/.alphaengine/,
// outside the repository); the private PEM lives only in Vercel's
// ALPHAENGINE_ARTIFACT_SIGNING_KEY. Rotating the signer = generate a new pair,
// replace this fingerprint in the same commit, update the Vercel secret.
export const TRUSTED_ARTIFACT_PUBLIC_KEY_SHA256 =
  "3db8b54f0f95d635c5533277042f384cdc953f9d43fc879558164823c8a25970";
