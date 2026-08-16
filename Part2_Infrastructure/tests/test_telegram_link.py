"""
Connecting a Telegram chat to a web desk identity.

The security question this file exists to answer is narrow and worth stating
before the code: a binding grants READ PARITY WITH A WEB DESK PASS AND NOTHING
MORE. The desk hands a guest pass to anyone who asks for one, so a bound user is
shown exactly what they could already see by opening the workspace — one shared
book, one kill switch, one set of counters — over a second transport. It moves
data between transports it was already on; it unlocks none.

What is therefore pinned hardest is the boundary: no binding, guest or account,
may ever reach `_may_control`. Every test that grants read access here is
followed by one asserting the controls stayed shut.

Nothing in this file touches a network. Supabase is switched off explicitly so
the account path exercises the "no durable copy, and say so" branch rather than
dialling out of a network-free suite.
"""

from __future__ import annotations

import base64
import json
import time

import httpx
import pytest
from conftest import TELEGRAM_TEST_CHAT, TELEGRAM_TEST_USER
from test_telegram import StubBot, update

from config import settings
from modules import telegram as telegram_module
from modules.telegram import (
    LINK_KIND_ACCOUNT,
    LINK_KIND_GUEST,
    LINK_PROBE_MAX_TTL_S,
    decode_link_probe,
    decode_link_token,
    link_probe_secret,
    link_token_fingerprint,
    mint_link_token,
)

SECRET = "a-shared-link-secret-of-more-than-32-chars"
GUEST_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
ACCOUNT_ID = "9c5b94b1-35ad-49bb-b118-8e8fc24abf80"

#: Shared with `web/tests/telegram-link.test.ts`. The verifier and the minter
#: live in different languages in different processes, and neither build would
#: notice a one-byte layout change until a real person tapped Connect. Do not
#: adjust one side without the other.
VECTOR = {
    "secret": "x" * 40,
    "kind": LINK_KIND_GUEST,
    "id": GUEST_ID,
    "now": 1_800_000_000,
    "ttl": 900,
    "nonce": bytes([1, 2, 3, 4]),
    "token": "AQJrSdWEAQIDBD8lBOBPiRHTmgwDBegsMwFgI2xPwQd27wYqtOA",
}

#: The status probe's own vector, shared with `web/tests/telegram-link.test.ts`
#: for the same reason. Same layout, same identity, same clock — a DIFFERENT
#: key, derived by domain separation, which is why the token differs from the
#: link token above in its MAC and nowhere else.
PROBE_VECTOR = {
    "secret": "x" * 40,
    "key": "4c4e93d04e9784d3f70f30f64db5ad02ca0d8df6d816a6f8c6aaf6b423b32470",
    "kind": LINK_KIND_GUEST,
    "id": GUEST_ID,
    "now": 1_800_000_000,
    "ttl": 120,
    "nonce": bytes([1, 2, 3, 4]),
    "token": "AQJrSdJ4AQIDBD8lBOBPiRHTmgwDBegsMwGXMR4wmQHfKCNOfrQ",
}


def _set(field: str, value) -> None:
    """`settings` is a frozen dataclass; patch the real object, not a stand-in."""
    object.__setattr__(settings, field, value)


@pytest.fixture(autouse=True)
def link_configuration():
    saved = {
        field: getattr(settings, field)
        for field in (
            "telegram_link_secret",
            "telegram_guest_link_ttl_s",
            "supabase_url",
            "supabase_service_role_key",
        )
    }
    _set("telegram_link_secret", SECRET)
    # Explicitly unconfigured: the account path must exercise its "no durable
    # copy" branch rather than reaching for a network this suite does not have.
    _set("supabase_url", "")
    _set("supabase_service_role_key", "")
    yield
    for field, value in saved.items():
        _set(field, value)


def token_for(kind: str, identity: str) -> str:
    return mint_link_token(kind, identity, settings.telegram_link_secret, 900)


def probe_for(kind: str, identity: str, ttl: float = 120) -> str:
    """What the web desk mints to ask "is the pass I hold already bound?"."""
    return mint_link_token(kind, identity, link_probe_secret(settings.telegram_link_secret), ttl)


# --------------------------------------------------------------------------- #
# The token
# --------------------------------------------------------------------------- #

def test_the_token_matches_the_vector_the_typescript_minter_pins():
    minted = mint_link_token(
        VECTOR["kind"], VECTOR["id"], VECTOR["secret"], VECTOR["ttl"],
        now=VECTOR["now"], nonce=VECTOR["nonce"],
    )
    assert minted == VECTOR["token"], (
        "the packed layout changed on this side only — update "
        "web/lib/telegram-link.ts and its vector in the same commit"
    )


def test_a_token_fits_the_telegram_start_payload():
    # Telegram allows at most 64 characters from [A-Za-z0-9_-]. A UUID in text
    # is already 36 of them, which is why the payload is packed binary.
    token = token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)
    assert len(token) <= 64
    assert token.isascii() and all(c.isalnum() or c in "-_" for c in token)


def test_a_token_carries_its_kind_and_identity():
    for kind, identity in ((LINK_KIND_GUEST, GUEST_ID), (LINK_KIND_ACCOUNT, ACCOUNT_ID)):
        decoded = decode_link_token(token_for(kind, identity), SECRET)
        assert (decoded.kind, decoded.identity) == (kind, identity)
        assert decoded.web_identity == f"{kind}:{identity}"


def test_another_deployments_secret_cannot_mint_for_this_one():
    token = token_for(LINK_KIND_GUEST, GUEST_ID)
    with pytest.raises(ValueError, match="not issued by this desk"):
        decode_link_token(token, SECRET + "-different")


def test_a_tampered_identity_does_not_survive_the_signature():
    """The whole attack in one test: swap the UUID, keep the signature."""
    raw = bytearray(base64.urlsafe_b64decode(token_for(LINK_KIND_GUEST, GUEST_ID) + "=="))
    raw[25] ^= 0xFF  # the last byte of the embedded UUID
    forged = base64.urlsafe_b64encode(bytes(raw)).decode().rstrip("=")
    with pytest.raises(ValueError, match="not issued by this desk"):
        decode_link_token(forged, SECRET)


def test_a_kind_flipped_from_guest_to_account_does_not_survive_either():
    # Otherwise an ephemeral guest link would upgrade itself into a permanent
    # account one by flipping a single byte.
    raw = bytearray(base64.urlsafe_b64decode(token_for(LINK_KIND_GUEST, GUEST_ID) + "=="))
    raw[1] = 1
    forged = base64.urlsafe_b64encode(bytes(raw)).decode().rstrip("=")
    with pytest.raises(ValueError, match="not issued by this desk"):
        decode_link_token(forged, SECRET)


def test_an_expired_token_is_refused_and_says_what_to_do():
    token = mint_link_token(LINK_KIND_GUEST, GUEST_ID, SECRET, 60, now=1_000)
    decode_link_token(token, SECRET, now=1_060)
    with pytest.raises(ValueError, match="expired"):
        decode_link_token(token, SECRET, now=1_061)


def test_the_ledger_stores_a_fingerprint_rather_than_the_token():
    # The ledger outlives the token it describes, and an audit file holding live
    # credentials is a second place to leak them.
    token = token_for(LINK_KIND_GUEST, GUEST_ID)
    fingerprint = link_token_fingerprint(token)
    assert token not in fingerprint
    assert len(fingerprint) == 64


# --------------------------------------------------------------------------- #
# Redeeming one
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_a_guest_link_grants_reading_and_says_it_is_ephemeral(bot):
    settings.telegram_allowed_user_ids[:] = []
    assert bot._authorised(TELEGRAM_TEST_USER) is False

    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=200))
    assert "Connected" in bot.last
    assert "Guest desk pass" in bot.last
    # The bot must SAY the guest binding is ephemeral rather than let someone
    # discover it by finding themselves locked out.
    assert "lapses" in bot.last

    assert bot._authorised(TELEGRAM_TEST_USER) is True
    await bot.handle_update(update("/portfolio", update_id=201))
    assert "Not authorised" not in bot.last


@pytest.mark.asyncio
async def test_a_binding_never_grants_control(bot):
    """The invariant. Read parity is the whole grant."""
    settings.telegram_allowed_user_ids[:] = []
    _set("telegram_control_user_ids", [])
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=210))
    assert bot._authorised(TELEGRAM_TEST_USER) is True

    controls = ("/halt", "/resume", "/flatten", "/reduceonly", "/resetbook")
    for index, command in enumerate(controls):
        # Distinct ids, deterministically: a collision would be swallowed by the
        # dedup ring and the assertion would pass on a command never dispatched.
        await bot.handle_update(update(command, update_id=211 + index))
        assert "not permitted" in bot.last, f"{command} was not refused: {bot.last}"
    assert bot._may_control(TELEGRAM_TEST_USER) is False
    assert bot.gateway.state().kill_switch_active is False


@pytest.mark.asyncio
async def test_an_account_link_admits_it_when_the_durable_copy_is_missing(bot):
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=230))
    assert "Connected" in bot.last
    assert "Account" in bot.last
    # Supabase is unconfigured in this suite, and the card refuses to imply a
    # durability the deployment cannot provide.
    assert "no Supabase credentials" in bot.last
    row = bot.audit.get_subscriber(TELEGRAM_TEST_CHAT)
    assert row["web_identity"] == f"{LINK_KIND_ACCOUNT}:{ACCOUNT_ID}"


@pytest.mark.asyncio
async def test_a_connect_code_is_single_use(bot):
    settings.telegram_allowed_user_ids[:] = []
    token = token_for(LINK_KIND_GUEST, GUEST_ID)
    await bot.handle_update(update(f"/start {token}", update_id=240))
    assert "Connected" in bot.last

    # A double tap on the deep link delivers the same payload twice; the second
    # must lose. Different update_id, because the dedup ring would otherwise
    # answer this for the wrong reason.
    await bot.handle_update(update(f"/start {token}", update_id=241))
    assert "CODE ALREADY USED" in bot.last


@pytest.mark.asyncio
async def test_a_binding_survives_the_process_that_wrote_it(bot):
    """
    The reason the token is not a row in `self._challenges`.

    That dict dies on restart, which is right for a 90-second kill-switch
    confirmation and fatal for a link someone completes a minute later from
    another device. The binding is written to the audit store, so a bot rebuilt
    on the same store still honours it.
    """
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=250))

    reborn = StubBot(gateway=bot.gateway, tca=bot.tca, queue=bot.queue, audit=bot.audit)
    assert reborn._authorised(TELEGRAM_TEST_USER) is True
    assert reborn._may_control(TELEGRAM_TEST_USER) is False


@pytest.mark.asyncio
async def test_a_guest_binding_lapses_on_its_own_clock(bot):
    """
    A guest desk pass is a browser-session cookie the gateway cannot watch die,
    so the binding carries its own expiry rather than pretending to track one it
    cannot see.
    """
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=260))
    assert bot._authorised(TELEGRAM_TEST_USER) is True

    _set("telegram_guest_link_ttl_s", 0.0)
    bot._forget_bindings()
    assert bot._authorised(TELEGRAM_TEST_USER) is False

    await bot.handle_update(update("/portfolio", update_id=261))
    assert "Not authorised" in bot.last


@pytest.mark.asyncio
async def test_an_account_binding_does_not_lapse(bot):
    # The durable half ends with the account, through the migration's cascade —
    # not on a timer this process invented.
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=270))
    _set("telegram_guest_link_ttl_s", 0.0)
    bot._forget_bindings()
    assert bot._authorised(TELEGRAM_TEST_USER) is True


# --------------------------------------------------------------------------- #
# What a binding does and does not touch
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_connecting_does_not_subscribe_the_chat_to_alerts(bot):
    """Binding is identity, not consent to be messaged."""
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=280))
    assert bot._subscribers() == []
    assert bot._alert_targets() == []

    await bot.handle_update(update("/subscribe", update_id=281))
    assert bot._alert_targets() == [TELEGRAM_TEST_CHAT]


@pytest.mark.asyncio
async def test_subscribing_later_does_not_erase_the_binding(bot):
    """
    `upsert_subscriber` is a DELETE-then-INSERT, so a column it does not carry
    forward is erased. /subscribe knows nothing about linking and must not unbind
    a chat merely by touching its alert preference.
    """
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=290))
    await bot.handle_update(update("/subscribe", update_id=291))
    await bot.handle_update(update("/watch BTCUSDT 100000 25", update_id=292))

    row = bot.audit.get_subscriber(TELEGRAM_TEST_CHAT)
    assert row["web_identity"] == f"{LINK_KIND_GUEST}:{GUEST_ID}"
    bot._forget_bindings()
    assert bot._authorised(TELEGRAM_TEST_USER) is True


@pytest.mark.asyncio
async def test_alert_delivery_follows_the_binding(bot):
    """A lapsed binding stops pushed alerts, exactly as a revoked allow-list does."""
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=300))
    await bot.handle_update(update("/subscribe", update_id=301))
    bot.sent.clear()
    await bot.broadcast("critical", "delivered while bound")
    assert any("delivered while bound" in message for message in bot.sent)

    _set("telegram_guest_link_ttl_s", 0.0)
    bot._forget_bindings()
    bot.sent.clear()
    await bot.broadcast("critical", "must not be delivered")
    assert bot.sent == []


# --------------------------------------------------------------------------- #
# Refusals
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_linking_is_refused_when_the_gateway_has_no_secret(bot):
    settings.telegram_allowed_user_ids[:] = []
    token = token_for(LINK_KIND_GUEST, GUEST_ID)
    _set("telegram_link_secret", "")
    await bot.handle_update(update(f"/start {token}", update_id=310))
    assert "LINKING NOT CONFIGURED" in bot.last
    assert "TELEGRAM_LINK_SECRET" in bot.last
    assert bot._authorised(TELEGRAM_TEST_USER) is False


@pytest.mark.asyncio
async def test_a_short_secret_is_no_secret(bot):
    # The verifier is a pure function anyone may call as often as they like.
    _set("telegram_link_secret", "short")
    assert settings.telegram_link_enabled is False
    await bot.handle_update(update("/start AQJrSdWEAQIDBD8", update_id=320))
    assert "LINKING NOT CONFIGURED" in bot.last


@pytest.mark.asyncio
async def test_a_foreign_code_is_refused_with_its_reason(bot):
    settings.telegram_allowed_user_ids[:] = []
    forged = mint_link_token(LINK_KIND_ACCOUNT, ACCOUNT_ID, "another-deployments-secret-key-0123456789", 900)
    await bot.handle_update(update(f"/start {forged}", update_id=330))
    assert "CODE REJECTED" in bot.last
    assert "not issued by this desk" in bot.last
    assert bot._authorised(TELEGRAM_TEST_USER) is False


@pytest.mark.asyncio
async def test_an_expired_code_is_refused_with_its_reason(bot):
    settings.telegram_allowed_user_ids[:] = []
    stale = mint_link_token(LINK_KIND_GUEST, GUEST_ID, SECRET, -1, now=time.time())
    await bot.handle_update(update(f"/start {stale}", update_id=340))
    assert "CODE REJECTED" in bot.last
    assert "expired" in bot.last


@pytest.mark.asyncio
async def test_the_legacy_start_payload_signposts_rather_than_erroring(bot):
    # The header's link carried `?start=auth` before there was anything to hand
    # over. An old bookmark is not a mistake.
    await bot.handle_update(update("/start auth", update_id=350))
    assert "NO CODE IN THIS LINK" in bot.last
    assert "Connect" in bot.last


@pytest.mark.asyncio
async def test_bare_start_is_unchanged(bot):
    await bot.handle_update(update("/start", update_id=360))
    assert "TEXT + CHARTS + BUTTONS" in bot.last


# --------------------------------------------------------------------------- #
# The status probe
# --------------------------------------------------------------------------- #
#
# A guest binding lives in this gateway's DuckDB and nowhere the web app can
# read, so before this existed the header chip could never turn green for a
# guest: the bot said "Connected" and the desk went on saying "Connect".
#
# The probe answers that, and the property that makes it safe to send on every
# header load is that it is NOT a link token — different key, same layout.

def test_the_probe_matches_the_vector_the_typescript_minter_pins():
    assert link_probe_secret(PROBE_VECTOR["secret"]) == PROBE_VECTOR["key"]
    minted = mint_link_token(
        PROBE_VECTOR["kind"], PROBE_VECTOR["id"], PROBE_VECTOR["key"], PROBE_VECTOR["ttl"],
        now=PROBE_VECTOR["now"], nonce=PROBE_VECTOR["nonce"],
    )
    assert minted == PROBE_VECTOR["token"], (
        "the probe key derivation changed on this side only — update "
        "web/lib/telegram-link.ts and its vector in the same commit"
    )


def test_a_probe_cannot_be_redeemed_as_a_connect_code():
    """The whole reason for the separate key.

    A probe travels server-to-server on every header load and can land in a
    proxy log. A link token BINDS a chat. If one could be presented as the
    other, anything that could read a probe in flight could bind its own
    Telegram account to somebody else's desk pass.
    """
    probe = probe_for(LINK_KIND_GUEST, GUEST_ID)
    with pytest.raises(ValueError, match="not issued by this desk"):
        decode_link_token(probe, SECRET)


def test_a_connect_code_cannot_be_spent_as_a_probe():
    """And the other direction, so the separation is not one-way."""
    with pytest.raises(ValueError, match="not issued by this desk"):
        decode_link_probe(token_for(LINK_KIND_GUEST, GUEST_ID), SECRET)


def test_a_probe_carries_its_own_identity_and_cannot_be_pointed_at_another():
    decoded = decode_link_probe(probe_for(LINK_KIND_ACCOUNT, ACCOUNT_ID), SECRET)
    assert (decoded.kind, decoded.identity) == (LINK_KIND_ACCOUNT, ACCOUNT_ID)

    # The identity is inside the signature, so there is no way to ask about
    # somebody else's: swapping the embedded UUID invalidates the MAC.
    raw = bytearray(base64.urlsafe_b64decode(probe_for(LINK_KIND_GUEST, GUEST_ID) + "=="))
    raw[25] ^= 0xFF
    forged = base64.urlsafe_b64encode(bytes(raw)).decode().rstrip("=")
    with pytest.raises(ValueError, match="not issued by this desk"):
        decode_link_probe(forged, SECRET)


def test_the_gateway_caps_how_long_a_probe_may_answer_for():
    """The ceiling is enforced here, not trusted to the minter.

    A probe is minted and spent inside one request. A bug or a compromise on the
    web side must not be able to issue one that answers the same question for a
    week.
    """
    decode_link_probe(probe_for(LINK_KIND_GUEST, GUEST_ID, LINK_PROBE_MAX_TTL_S - 5), SECRET)
    with pytest.raises(ValueError, match="valid for longer than this desk accepts"):
        decode_link_probe(probe_for(LINK_KIND_GUEST, GUEST_ID, LINK_PROBE_MAX_TTL_S + 60), SECRET)


@pytest.mark.asyncio
async def test_the_desk_can_see_a_guest_binding_it_could_not_see_before(bot):
    """The user-visible bug this closes: guest connects, chip stays grey."""
    settings.telegram_allowed_user_ids[:] = []
    assert bot.binding_status(LINK_KIND_GUEST, GUEST_ID) == "not-linked"

    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=400))
    assert bot.binding_status(LINK_KIND_GUEST, GUEST_ID) == "linked"

    # A binding is for one identity of one kind. Neither half is a wildcard.
    assert bot.binding_status(LINK_KIND_ACCOUNT, GUEST_ID) == "not-linked"
    assert bot.binding_status(LINK_KIND_GUEST, ACCOUNT_ID) == "not-linked"


@pytest.mark.asyncio
async def test_the_status_follows_the_same_expiry_the_authorisation_does(bot):
    """One freshness rule, not two.

    Two copies of an expiry policy is how a chip goes on saying Connected for a
    binding that stopped granting hours ago.
    """
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=410))
    assert bot.binding_status(LINK_KIND_GUEST, GUEST_ID) == "linked"

    _set("telegram_guest_link_ttl_s", 0.0)
    bot._forget_bindings()
    assert bot._authorised(TELEGRAM_TEST_USER) is False
    assert bot.binding_status(LINK_KIND_GUEST, GUEST_ID) == "not-linked"


@pytest.mark.asyncio
async def test_no_store_means_unknown_rather_than_not_linked(bot):
    """"Cannot tell" and "not connected" are different things to say.

    Reporting an unreadable store as an absent binding would invite someone to
    reconnect a chat they have already connected.
    """
    bot.audit = None
    assert bot.binding_status(LINK_KIND_GUEST, GUEST_ID) == "unknown"


# --------------------------------------------------------------------------- #
# The endpoint the desk asks
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_the_status_route_answers_the_identity_the_probe_signs(bot, monkeypatch):
    import main

    monkeypatch.setattr(main, "get_bot", lambda: bot)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=420))

    bound = await main.telegram_link_status(probe=probe_for(LINK_KIND_GUEST, GUEST_ID))
    assert bound["link_status"] == "linked"
    assert bound["kind"] == LINK_KIND_GUEST
    # The contract is stated, for the reason `read_only` in health() is a
    # cautionary tale: a promise nobody can assert drifts silently.
    assert bound["grants_control"] is False

    other = await main.telegram_link_status(probe=probe_for(LINK_KIND_ACCOUNT, ACCOUNT_ID))
    assert other["link_status"] == "not-linked"


@pytest.mark.asyncio
async def test_the_status_route_never_names_a_chat_a_handle_or_a_count(bot, monkeypatch):
    """The whole answer is a state and a kind.

    Same line `TelegramBot.health()`'s links block draws, narrowed to one row:
    a caller learns one fact about one identity it already speaks for, and
    cannot walk from that answer to a second one.
    """
    import main

    monkeypatch.setattr(main, "get_bot", lambda: bot)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_GUEST, GUEST_ID)}", update_id=430))

    answer = await main.telegram_link_status(probe=probe_for(LINK_KIND_GUEST, GUEST_ID))
    rendered = repr(answer)
    assert TELEGRAM_TEST_CHAT not in rendered
    assert TELEGRAM_TEST_USER not in rendered
    assert "operator" not in rendered
    assert set(answer) == {"link_status", "kind", "grants", "grants_control"}


@pytest.mark.asyncio
async def test_the_status_route_refuses_a_probe_it_did_not_issue(bot, monkeypatch):
    from fastapi import HTTPException

    import main

    monkeypatch.setattr(main, "get_bot", lambda: bot)
    foreign = mint_link_token(
        LINK_KIND_ACCOUNT, ACCOUNT_ID,
        link_probe_secret("another-deployments-secret-key-0123456789"), 120,
    )
    with pytest.raises(HTTPException) as refusal:
        await main.telegram_link_status(probe=foreign)
    assert refusal.value.status_code == 403
    assert "not issued by this desk" in refusal.value.detail


@pytest.mark.asyncio
async def test_the_status_route_refuses_rather_than_guessing_when_unconfigured(bot, monkeypatch):
    """An absent secret is not evidence of an absent binding."""
    from fastapi import HTTPException

    import main

    monkeypatch.setattr(main, "get_bot", lambda: bot)
    probe = probe_for(LINK_KIND_GUEST, GUEST_ID)
    _set("telegram_link_secret", "")
    with pytest.raises(HTTPException) as refusal:
        await main.telegram_link_status(probe=probe)
    assert refusal.value.status_code == 503
    assert "TELEGRAM_LINK_SECRET" in refusal.value.detail


# --------------------------------------------------------------------------- #
# What the health endpoint may say about all this
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_health_counts_bindings_without_naming_anyone(bot):
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=370))
    health = bot.health()

    assert health["links"]["configured"] is True
    assert health["links"]["bound_users"] == 1
    assert health["links"]["completed"] == 1
    # Stated as a field for the reason `read_only` above it is a cautionary
    # tale: a contract nobody can assert drifts silently.
    assert health["links"]["grants_control"] is False
    # /telegram/health is proxied to a public web origin, and the binding is the
    # one genuinely personal fact this module holds.
    rendered = repr(health)
    assert ACCOUNT_ID not in rendered
    assert TELEGRAM_TEST_CHAT not in rendered


# --------------------------------------------------------------------------- #
# The durable copy
#
# This is the branch that had no test at all, and production was its first
# execution. It failed there — `public.telegram_link` had never been created,
# because the migration ships by manual dispatch and the writer shipped with the
# code — and the card reported it as a credentials problem, because the only
# sentence naming the real cause was in `response.text`, which the writer threw
# away.
#
# Nothing here touches a network: the module's own `httpx.AsyncClient` is routed
# through a MockTransport, which is the only way to exercise a status code the
# suite can otherwise never reach.
# --------------------------------------------------------------------------- #

MISSING_TABLE = {
    "code": "42P01",
    "message": 'relation "public.telegram_link" does not exist',
    "hint": None,
}
BAD_KEY = {
    "code": "42501",
    "message": "permission denied for table telegram_link",
    "hint": None,
}


def supabase_returns(monkeypatch, handler) -> list[httpx.Request]:
    """Point the module's Supabase client at `handler` and record what it sent.

    `_record_account_link` builds its own client, so the seam is the module's
    reference to `httpx.AsyncClient` rather than an injected dependency.
    """
    seen: list[httpx.Request] = []
    real = httpx.AsyncClient

    def factory(**kwargs):
        def record(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return handler(request)

        kwargs["transport"] = httpx.MockTransport(record)
        return real(**kwargs)

    monkeypatch.setattr(telegram_module.httpx, "AsyncClient", factory)
    _set("supabase_url", "https://project.supabase.co")
    _set("supabase_service_role_key", "service-role-key-for-tests")
    return seen


def _json(status: int, body) -> httpx.Response:
    return httpx.Response(status, json=body)


@pytest.mark.asyncio
async def test_a_missing_table_is_named_on_the_card(bot, monkeypatch):
    """The production failure, reproduced.

    A 404 from PostgREST for a table that does not exist and a 401 for a key
    that may not write it are both "the durable copy did not happen". Only the
    body tells them apart, and only one of them is fixed by running a migration.
    """
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return _json(200, [])
        return _json(404, MISSING_TABLE)

    supabase_returns(monkeypatch, handler)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=500))

    assert "Connected" in bot.last
    assert "refused" in bot.last
    # The sentence that would have saved the debugging session.
    assert "public.telegram_link" in bot.last
    assert "does not exist" in bot.last
    # And it must not be reported as the other failure.
    assert "no Supabase credentials" not in bot.last


@pytest.mark.asyncio
async def test_a_rejected_key_says_so_instead_of_blaming_the_schema(bot, monkeypatch):
    """The same status class, the opposite fix. The card must not conflate them."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return _json(200, [])
        return _json(401, BAD_KEY)

    supabase_returns(monkeypatch, handler)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=505))

    assert "permission denied" in bot.last
    assert "does not exist" not in bot.last


@pytest.mark.asyncio
async def test_durability_is_claimed_only_once_the_write_returns(bot, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return _json(200, [])
        return httpx.Response(201)

    seen = supabase_returns(monkeypatch, handler)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=510))

    assert "durable copy was written" in bot.last
    assert "survives restarts" in bot.last
    assert "refused" not in bot.last
    # The row carries the identity the token signed, not the Telegram handle.
    written = json.loads(seen[-1].content)
    assert written["user_id"] == ACCOUNT_ID
    assert written["telegram_user_id"] == TELEGRAM_TEST_USER


@pytest.mark.asyncio
async def test_replacing_someone_elses_binding_is_announced(bot, monkeypatch):
    """The delete is destructive and used to be silent.

    A guest connects, then signs in and connects again: the second write
    destroys the first binding, which the first card promised would last. The
    policy is latest-wins, and a policy the user cannot see is not a policy.
    """
    other = "11111111-2222-3333-4444-555555555555"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return _json(200, [{"user_id": other, "telegram_user_id": TELEGRAM_TEST_USER}])
        return httpx.Response(201)

    supabase_returns(monkeypatch, handler)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=515))

    assert "replaced" in bot.last
    assert "latest connect wins" in bot.last
    assert other[:8] in bot.last


@pytest.mark.asyncio
async def test_reconnecting_the_same_identity_is_not_called_a_replacement(bot, monkeypatch):
    """Refreshing your own binding is not news, and crying wolf costs the notice."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return _json(200, [{"user_id": ACCOUNT_ID, "telegram_user_id": TELEGRAM_TEST_USER}])
        return httpx.Response(201)

    supabase_returns(monkeypatch, handler)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=520))

    assert "replaced" not in bot.last


@pytest.mark.asyncio
async def test_a_refused_delete_does_not_pass_as_a_clean_write(bot, monkeypatch):
    """A successful delete followed by a failed insert is silent data loss.

    So is the reverse when nobody checks the delete: the row survives, the
    insert collides with it, and the only account of what happened is a status
    code nobody kept.
    """
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return _json(401, BAD_KEY)
        return _json(409, {"code": "23505", "message": "duplicate key value violates unique constraint"})

    supabase_returns(monkeypatch, handler)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=525))

    assert "refused" in bot.last
    assert "duplicate key" in bot.last


@pytest.mark.asyncio
async def test_an_unreachable_supabase_is_named_as_a_network_failure(bot, monkeypatch):
    """Not reaching the database and being refused by it are different sentences."""
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    supabase_returns(monkeypatch, handler)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=530))

    assert "could not reach Supabase" in bot.last
    assert "ConnectError" in bot.last
    # The local copy still stands, and the card must not imply otherwise.
    assert bot._authorised(TELEGRAM_TEST_USER) is True


@pytest.mark.asyncio
async def test_a_failed_durable_copy_never_costs_the_local_binding(bot, monkeypatch):
    """The confirmation is best-effort; the binding is not."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return _json(200, [])
        return _json(404, MISSING_TABLE)

    supabase_returns(monkeypatch, handler)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=535))

    row = bot.audit.get_subscriber(TELEGRAM_TEST_CHAT)
    assert row["web_identity"] == f"{LINK_KIND_ACCOUNT}:{ACCOUNT_ID}"
    assert bot.binding_status(LINK_KIND_ACCOUNT, ACCOUNT_ID) == "linked"


@pytest.mark.asyncio
async def test_the_card_labels_both_identities_it_binds(bot, monkeypatch):
    """The user-visible confusion this closes.

    "Connected as @handle" sat directly above "recorded against your desk
    account", so the Telegram handle read as the desk identity — and a second
    connect through a different web identity looked like it had kept the first.
    """
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(201) if request.method == "POST" else _json(200, [])

    supabase_returns(monkeypatch, handler)
    settings.telegram_allowed_user_ids[:] = []
    await bot.handle_update(update(f"/start {token_for(LINK_KIND_ACCOUNT, ACCOUNT_ID)}", update_id=540))

    assert "<b>Telegram</b>" in bot.last
    assert "<b>Desk identity</b>" in bot.last
    assert ACCOUNT_ID[:8] in bot.last
    # Two labelled identities, not one ambiguous one.
    assert "Connected as" not in bot.last


def test_a_reason_survives_a_body_that_is_not_json():
    """Not every refusal is PostgREST's. A proxy's HTML must not read as silence."""
    reason = telegram_module._postgrest_reason(httpx.Response(502, text="<html>Bad Gateway</html>"))
    assert "Bad Gateway" in reason


def test_a_reason_is_reported_even_when_the_body_is_empty():
    reason = telegram_module._postgrest_reason(httpx.Response(500, text=""))
    assert "500" in reason


def test_a_reason_is_clipped_to_fit_a_card():
    reason = telegram_module._postgrest_reason(httpx.Response(400, json={"message": "x" * 400}))
    assert len(reason) <= 220
