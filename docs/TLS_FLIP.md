# The TLS flip — moving the web→gateway hop to HTTPS

The deploy workflow now runs a **Caddy sidecar** on the OCI VM: TLS terminates
on `:8443` with Caddy's internal CA (a bare IP cannot get a public certificate
here, and the only client that needs to trust it is the Vercel project — so
the trust root is *pinned*, which is stronger than public PKI for a
single-client hop) and proxies to the gateway on `127.0.0.1:8000`. Port 8000
keeps serving throughout, so nothing breaks while the flip is partial.

Everything below is deliberate operator action, with one exception: the
deploy already tries to open 8443 in the *instance* firewall itself (§1).

**Where the flip stands (2026-08-17).** Step 2 is done: the root is committed at
`Part2_Infrastructure/web/certs/gateway-ca.pem` (since 2026-08-11). Step 1 is
done: `https://149.118.48.255:8443/health` answered from outside the VM on
2026-08-17, as did `:8000`. Steps 3–5 are operator actions outside this
repository — verify them with §4 rather than assuming. The `reachable` job's
notice line reports only whether TCP 8443 answers from a GitHub runner; it
cannot see the Vercel project's environment. Nothing here is load-bearing
until step 3 is made: the workspace keeps talking to `:8000` exactly as
before, and the smoke tool's default `E2E_GATEWAY_URL` is still the plaintext
port.

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

## 3. Point the Vercel project at it

In the Vercel project settings (Production), set:

| Variable | Value |
|---|---|
| `NODE_EXTRA_CA_CERTS` | `/var/task/certs/gateway-ca.pem` |
| `ALPHAENGINE_GATEWAY_URL` | `https://<IP>:8443` |

`NODE_EXTRA_CA_CERTS` **adds** to Node's default trust store — Supabase,
Oracle and every other TLS peer verify exactly as before. If the path is ever
wrong, Node logs a boot warning and gateway calls fail with
`gateway_unreachable` (a certificate error, honestly reported) — flip
`ALPHAENGINE_GATEWAY_URL` back to `http://<IP>:8000` and nothing else is
affected. `web/lib/gateway.ts` names each failure separately — an untrusted
root, `https://` aimed at the plaintext port, a handshake failure — so the
Reliability tab says which one happened rather than a bare `unreachable`.

Redeploy the web project (any push, or "Redeploy" in the dashboard).

## 4. Verify

- `/api/system/health` → `sources.gateway.state` is `fresh` and
  `delivery.schema.state` is `match` — the same evidence as before, now over
  TLS.
- `python3 Part2_Infrastructure/tools/e2e_smoke.py` with
  `E2E_GATEWAY_URL=https://<IP>:8443` and `SSL_CERT_FILE` pointing at the
  saved `gateway-ca.pem` (Python needs the pin too).

## 5. Afterwards (optional)

Close ingress TCP 8000 once everything reads green — but only after checking
nothing else consumes it: the Telegram webhook path (if webhook mode is ever
enabled) and any personal scripts hit `:8000` directly. The smoke tool's
default `E2E_GATEWAY_URL` should be flipped in the same commit.
