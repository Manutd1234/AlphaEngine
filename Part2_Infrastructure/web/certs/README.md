# Pinned gateway TLS root

**Last verified: 2026-08-29.** The repository wiring was checked against the
[current-state ledger](../../../docs/CURRENT_STATE.md). The live-flip status
below remains a deployment observation and must be re-probed before it is
described as current external state.

`gateway-ca.pem` belongs here: the **public** root certificate of the Caddy
internal CA that terminates TLS in front of the gateway (printed at the end of
the deploy workflow's "TLS sidecar" step). It is not a secret — it contains no
private key material and committing it is the pinning.

Node 22.19+/24.5+ installs it at runtime through
[`lib/gateway-ca.ts`](../lib/gateway-ca.ts). The installer reads Node's current
default roots, appends this certificate, and verifies that the complete old
set remains before any gateway HTTPS request is dispatched. It never disables
certificate verification or replaces the public web PKI with this private
root. `NODE_EXTRA_CA_CERTS` may remain configured as startup defence in depth,
but runtime correctness does not depend on that startup-only mechanism.

Whether the pin is load-bearing is deployment state, not a repository claim:
an `https://` `ALPHAENGINE_GATEWAY_URL` uses it, while a co-located local HTTP
gateway does not need TLS trust setup. See
[`docs/engineering/TLS_FLIP.md`](../../../docs/engineering/TLS_FLIP.md) for the
flip and rollback checklist.
