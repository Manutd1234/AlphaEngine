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
import time

import pytest
from conftest import TELEGRAM_TEST_CHAT, TELEGRAM_TEST_USER
from test_telegram import StubBot, update

from config import settings
from modules.telegram import (
    LINK_KIND_ACCOUNT,
    LINK_KIND_GUEST,
    decode_link_token,
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
    assert "TEXT ONLY" in bot.last


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
