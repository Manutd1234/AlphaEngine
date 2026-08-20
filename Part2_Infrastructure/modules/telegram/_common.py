"""Names the whole package shares: the logger, three regexes, one identity read.

Split out of ``modules/telegram.py`` so every other file in the package can
import them without importing each other. Nothing here reaches back into the
package.
"""

from __future__ import annotations

import logging
import re
from typing import Any

log = logging.getLogger("alphaengine.telegram")

_SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,20}$")
_HTML_TAG_RE = re.compile(r"</?(?:b|i|code|pre|u|s)(?:\s[^>]*)?>", re.IGNORECASE)
_TELEGRAM_ACTOR_RE = re.compile(r"^tg:([1-9][0-9]*):")


def actor_user_id(actor: Any) -> str:
    """The bare numeric Telegram user id inside a ``tg:<id>:<username>`` actor.

    Empty string when the actor is not that shape, and every caller must treat
    that as "no identity" rather than as a name. The composite exists because
    the audit log wants a readable actor; every allow-list in this module
    compares bare ids, and handing one of them the whole string is how `/halt`
    spent months answering "not permitted" to the operators who configured it.
    """
    match = _TELEGRAM_ACTOR_RE.match(str(actor))
    return match.group(1) if match else ""
