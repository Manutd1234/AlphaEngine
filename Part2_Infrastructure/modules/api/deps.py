"""What every router in this package depends on.

``trader_identity`` was a module-level dependency of ``main.py`` back when all
fifty-two routes were declared there. It cannot stay in ``main`` now that the
routers are imported *by* ``main``: a router importing it back would close an
import cycle and the gateway would not boot. So it sits one level below both.

A test that reached it as ``main.settings`` now reaches it as
``modules.api.deps.settings``. That is not a cosmetic move — patching a name
patches the module that reads it and no other, and this is the module that
reads it.
"""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException

from config import settings


async def trader_identity(
    authorization: str | None = Header(default=None),
    x_alphaengine_token: str | None = Header(default=None, alias="X-AlphaEngine-Token"),
) -> str:
    """Resolve the caller to an audit actor.

    The dedicated server-to-server header is preferred because some public
    tunnel and access proxies reserve or rewrite ``Authorization``. Standard
    bearer auth remains supported for direct clients. ``REQUIRE_AUTH=1`` turns
    the anonymous path into a 401. Telegram has its own user allow-list and
    never authenticates web requests.

    Account linking does not weaken that, because it runs one way only: a web
    identity can authorise a *Telegram* read, and nothing a Telegram user does
    is ever evidence about a web request. A binding also grants no more than a
    desk pass already does — and ``POST /api/auth/guest`` hands a pass to
    anyone who asks — so it moves data between transports it was already on
    rather than unlocking any. Control commands stay on their own allow-list.
    """
    presented = x_alphaengine_token.strip() if x_alphaengine_token else None
    if presented is None and authorization and authorization.startswith("Bearer "):
        presented = authorization.removeprefix("Bearer ").strip()

    if presented is not None:
        if hmac.compare_digest(presented, settings.web_api_token):
            return "web:token"
        raise HTTPException(status_code=401, detail="invalid gateway token")

    if settings.require_auth:
        raise HTTPException(status_code=401, detail="authentication required")
    return "web:anonymous"
