"""Deployment-side checks: the workspace, its guard, its health route, and the
hop from the deployment to the gateway.

Split out of ``tools/e2e_smoke.py``. ``check_vercel_to_gateway`` is the one that
traverses the hop the workspace actually depends on: every other gateway check
runs from wherever this script executes and proves only that *that* caller can
reach it.
"""

from __future__ import annotations

from tools.e2e_checks.transport import FAIL, OK, SKIP, VERCEL, Result, fetch


def check_vercel_app() -> Result:
    """The app answers — via the sign-in page, which is now where "/" leads.

    This asserted 200 on "/" and would have failed the whole smoke run the moment
    the desk moved behind a routing guard: the root is a signpost now and answers
    307 to /login for a visitor with no desk cookie, which is the correct
    behaviour rather than an outage. Probing /login directly asserts the thing
    that actually matters here — the app builds, renders and serves — without
    depending on which side of the guard an unauthenticated probe lands on.
    """
    status, _, ms = fetch(f"{VERCEL}/login")
    if status != 200:
        return Result(
            "vercel app", FAIL, f"HTTP {status}",
            fix="Check the Vercel deployment log. A missing module here usually means .vercelignore dropped it.",
        )
    return Result("vercel app", OK, f"200 in {ms:.0f}ms")


def check_vercel_root_redirect() -> Result:
    """The guard is doing its job in production, not only in tests.

    A regression here is silent and serious in one direction: if "/" starts
    answering 200 again, the desk is being served to visitors with no session,
    which is precisely what this pass moved it behind a guard to stop.
    """
    status, _, ms = fetch(f"{VERCEL}/", allow_redirects=False)
    if status not in (301, 302, 303, 307, 308):
        return Result(
            "vercel root guard", FAIL, f"HTTP {status} (expected a redirect)",
            fix="middleware.ts should send an unauthenticated / to /login. A 200 means the desk is being served ungated.",
        )
    return Result("vercel root guard", OK, f"{status} in {ms:.0f}ms")


def check_vercel_to_gateway() -> Result:
    """The web→gateway hop, probed from outside instead of inferred.

    Every other gateway check in this file runs from wherever this script
    happens to execute — a GitHub runner, a laptop — and proves only that the
    gateway answers *that* caller. The hop the workspace actually depends on is
    Vercel's serverless function reaching the gateway, and nothing measured it.

    That gap is not hypothetical. The deployment spent a day serving a healthy
    gateway on both ports while every gateway-backed panel showed a degraded
    card, because the function could not verify the gateway's pinned
    certificate. `/health` was green from three other vantage points the whole
    time.

    So this asks the deployment itself, through a route that must traverse the
    hop. A 200 is proof; anything else carries the reason back, now that
    `lib/gateway.ts` names its transport failures.
    """
    status, body, ms = fetch(f"{VERCEL}/api/gateway/portfolio")
    if status == 200:
        return Result("vercel → gateway", OK, f"proxied the book in {ms:.0f}ms")

    code = body.get("code") if isinstance(body, dict) else None
    if code == "gateway_not_configured":
        # A deployment with no gateway is a documented, complete state — the
        # demo tier. Failing here would make a fork red for being a fork.
        return Result(
            "vercel → gateway", SKIP,
            "no gateway configured on this deployment",
        )

    if isinstance(body, dict):
        detail = body.get("error") or f"code {body.get('code')}"
        hint = body.get("hint")
    else:
        # An HTML body means this is not the workspace at all. Echoing 120
        # characters of markup buries that; naming it is the useful answer.
        detail = "non-JSON response — is E2E_VERCEL_URL pointing at the workspace?"
        hint = None
    return Result(
        "vercel → gateway", FAIL,
        f"HTTP {status} · {detail}",
        fix=hint or (
            "The gateway may be reachable from here and unreachable from Vercel — check "
            "ALPHAENGINE_GATEWAY_URL and NODE_EXTRA_CA_CERTS on the deployment, not the gateway host."
        ),
    )


def check_vercel_health() -> Result:
    status, body, ms = fetch(f"{VERCEL}/api/system/health")
    if status != 200 or not isinstance(body, dict):
        return Result("vercel /api/system/health", FAIL, f"HTTP {status}")
    providers = body.get("providers") or []
    ready = sum(1 for p in providers if p.get("configured"))
    return Result(
        "vercel /api/system/health", OK,
        f"{ready}/{len(providers)} providers configured · {ms:.0f}ms",
        data={"providers_ready": ready, "providers_total": len(providers)},
    )
