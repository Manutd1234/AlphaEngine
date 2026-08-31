# The TLS flip — moving the web→gateway hop to HTTPS

*TLS reachability and the Vercel Production configuration were last checked
**2026-09-01**. A probe of `https://149.118.48.255:8443/health` using the
committed `Part2_Infrastructure/web/certs/gateway-ca.pem` returned HTTP 200.
The Production environment change is staged for the next deployment; the
deployed web/API path has not yet been validated through that configuration.*

[`CURRENT_STATE.md`](../CURRENT_STATE.md) applies the same measurement boundary
to the repository-wide release ledger.

The deploy workflow now runs a **Caddy sidecar** on the OCI VM: TLS terminates
on `:8443` with Caddy's internal CA (a bare IP cannot get a public certificate
here, and the only client that needs to trust it is the Vercel project — so
the trust root is *pinned*, which is stronger than public PKI for a
single-client hop) and proxies to the gateway on `127.0.0.1:8000`. Direct port
8000 remains available for the deploy workflow's reachability check, explicit
rollback and documented scripts while the flip is being validated; it is not
the recommended Vercel origin.

Everything below is deliberate operator action, with one exception: the
deploy already tries to open 8443 in the *instance* firewall itself (§1).

**Where the flip stands (2026-09-01).** Steps 1–3 are done. The root is
committed at `Part2_Infrastructure/web/certs/gateway-ca.pem` (since
2026-08-11), and the pinned external probe of
`https://149.118.48.255:8443/health` returned HTTP 200 on 2026-09-01. Vercel's
Production environment now has `ALPHAENGINE_GATEWAY_URL` set to that HTTPS
origin and `NODE_EXTRA_CA_CERTS` set to
`/var/task/certs/gateway-ca.pem`. Those values take effect on the next
Production deployment; §4's web/API validation is still pending. This record
does not assert any change to the Preview environment or any high-availability
property.

Step 5 is also pending. The deploy workflow still makes its required direct
HTTP `:8000` reachability probe before its advisory `:8443` probe, and the
standalone smoke tool still defaults `E2E_GATEWAY_URL` to
`http://149.118.48.255:8000`. Neither probe can see Vercel's environment. Keep
that plaintext path only for the documented deployment check, rollback and
scripts until their callers have been migrated; it is no longer the canonical
Production web origin. The TLS flip becomes load-bearing when the staged
Production configuration is deployed and passes §4.

## 1. Open ingress TCP 8443

OCI Console → Networking → your VCN → Security List: add an ingress rule for
TCP 8443 (same shape as the existing 8000 rule). This half is yours — nothing
in the deploy touches the VCN.

Oracle images also ship restrictive iptables on the instance itself, and the
deploy's TLS sidecar step already tries to open 8443 there — firewalld first,
then iptables, idempotent, and persisted where it can be. That attempt is
advisory: where `sudo` is not available non-interactively it prints a
`::notice::` and the deploy stays green, and then it is yours too
(`sudo firewall-cmd --permanent --add-port=8443/tcp && sudo firewall-cmd
--reload`, or the iptables equivalent).

The deploy's `reachable` job probes `https://<IP>:8443/health` and prints a
notice (never a failure) until this is open.

## 2. Copy the pinned root certificate

Open the latest **Deploy gateway to OCI** run → job *"Swap the container on
the OCI VM"* → step *"TLS sidecar — Caddy with a pinned internal CA on :8443"*. The step ends by
printing the CA root certificate (`-----BEGIN CERTIFICATE----- …`). This is a
public certificate; printing and committing it is the point.

Save it verbatim as:

    Part2_Infrastructure/web/certs/gateway-ca.pem

commit, and push. (`next.config.mjs` already traces `certs/*.pem` into every
function bundle.)

## 3. Point the Vercel project at it (configured; deployment pending)

The Vercel project settings for **Production** were set on 2026-09-01 as
follows:

| Variable | Value |
|---|---|
| `NODE_EXTRA_CA_CERTS` | `/var/task/certs/gateway-ca.pem` |
| `ALPHAENGINE_GATEWAY_URL` | `https://149.118.48.255:8443` |

This is a Production-only status record; it makes no claim about Preview.
Environment changes are staged for the next Production deployment, so do not
call the flip complete until §4 passes against that deployment.

`NODE_EXTRA_CA_CERTS` **adds** to Node's default trust store — Supabase,
Oracle and every other TLS peer verify exactly as before. If the path is ever
wrong, Node logs a boot warning and gateway calls fail with
`gateway_unreachable` (a certificate error, honestly reported). Roll back by
promoting the previous known-good Vercel deployment while repairing the pin;
the new server boundary deliberately rejects a public plaintext origin on
Vercel. `web/lib/gateway.ts` names each failure separately — an untrusted root,
`https://` aimed at the plaintext port, a handshake failure — so the Reliability
tab says which one happened rather than a bare `unreachable`.

Redeploy the web project (any push, or "Redeploy" in the dashboard).

## 4. Verify

The transport preflight is complete: on 2026-09-01 the command below returned
HTTP 200 with the committed root pinned. This proves endpoint reachability and
certificate trust; it does not prove that the not-yet-deployed web functions
are using the new origin.

```bash
curl --cacert Part2_Infrastructure/web/certs/gateway-ca.pem \
  https://149.118.48.255:8443/health
```

After the next Production deployment, complete these still-pending checks:

- `/api/system/health` → `sources.gateway.state` is `fresh` and
  `delivery.schema.state` is `match` — the same evidence as before, now over
  TLS.
- `python3 Part2_Infrastructure/tools/e2e_smoke.py` with
  `E2E_GATEWAY_URL=https://149.118.48.255:8443` and `SSL_CERT_FILE` pointing at
  the saved `gateway-ca.pem` (Python needs the pin too).

## 5. Afterwards (optional)

Close ingress TCP 8000 only after the Production web/API checks read green and
the required deploy-workflow probe, the smoke tool default, rollback procedure,
Telegram webhook path (if webhook mode is ever enabled) and any personal
scripts have been migrated or retired. Until then it is a documented
compatibility and rollback path, not the Vercel Production origin.
