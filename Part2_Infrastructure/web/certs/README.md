# Pinned gateway TLS root

`gateway-ca.pem` belongs here: the **public** root certificate of the Caddy
internal CA that terminates TLS in front of the gateway (printed at the end of
the deploy workflow's "TLS sidecar" step). It is not a secret — it contains no
private key material and committing it is the pinning.

Node trusts it via `NODE_EXTRA_CA_CERTS` (see `docs/TLS_FLIP.md` for the full
flip checklist), *in addition to* the default bundle, so Supabase, Oracle and
every other TLS peer keep verifying exactly as before.

The file has been here since 2026-08-11. It is not yet load-bearing on its own:
until `ALPHAENGINE_GATEWAY_URL` on the deployment is flipped to the TLS port
(and `NODE_EXTRA_CA_CERTS` points at this file), the workspace talks to the
gateway over `http://…:8000` exactly as it always has. The flip is made
deliberately, per the checklist.
