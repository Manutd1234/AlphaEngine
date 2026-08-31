"""Markets, Proofs and Diffusion companion contracts.

These are engine reads, not shortcuts into the browser.  The registry, domain
values and empty states must therefore remain useful when no web process is
running, while the optional button only identifies the equivalent web view.
"""

import asyncio
from datetime import datetime, timezone

import pytest
from test_telegram import update

from modules.schemas import (
    CoherenceCertificate,
    CoherenceEventView,
    CoherenceIndexPoint,
    CoherenceIndexSeries,
    CoherenceMarketView,
    CoherenceUniverse,
    DiffusionAbsorptionResponse,
    DiffusionFindingsResponse,
)
from modules.schemas_diffusion import DiffusionFinding, DiffusionGate, DiffusionStageRun, DiffusionStageSummary
from modules.telegram import BOT_COMMANDS, COMMAND_SPECS, TelegramBot
from modules.telegram import engine_snapshots as reads
from modules.telegram._mixins import tabs_engine
from modules.telegram.engine_snapshots import DiffusionSnapshot, MarketsSnapshot, ProofsSnapshot


def test_engine_tabs_have_canonical_commands_and_legacy_coherence_alias():
    specs = {spec.name: spec for spec in COMMAND_SPECS}

    assert {"markets", "proofs", "diffusion"} <= specs.keys()
    assert "coherence" not in specs, "coherence is the saved-command alias for /proofs"
    assert "coherence" in specs["proofs"].aliases
    assert specs["markets"].in_menu is True
    assert specs["proofs"].in_menu is True
    assert specs["diffusion"].in_menu is True
    assert len(BOT_COMMANDS) == 100
    assert all(spec.in_menu for spec in COMMAND_SPECS if spec.category == "Tabs")
    assert all(spec.in_menu for spec in COMMAND_SPECS if spec.category == "Controls")


def test_engine_tab_registry_handlers_exist():
    specs = {spec.name: spec for spec in COMMAND_SPECS}

    for name in ("markets", "proofs", "diffusion"):
        assert hasattr(TelegramBot, specs[name].handler)


def _universe(*, age: float | None = None) -> CoherenceUniverse:
    market = CoherenceMarketView(
        ticker="KX-YES", event_ticker="KX-EVENT", series_ticker="KX-SERIES",
        yes_sub_title="Yes", strike_kind="binary", exchange_index=1,
        price_grid="0.01", depth="full", yes_bid="0.41", yes_ask="0.43", spread="0.02",
    )
    event = CoherenceEventView(
        event_ticker="KX-EVENT", series_ticker="KX-SERIES", title="Will the test settle?",
        mutually_exclusive=True, exchange_index=1, markets=[market],
        yes_ask_total="0.97", settlement_sources=["official bulletin"],
    )
    return CoherenceUniverse(
        state="ok", observed_age_s=age, watchlist=["KX-SERIES"], events=[event]
    )


@pytest.mark.asyncio
async def test_market_snapshot_uses_the_route_dto_without_coercing_values(monkeypatch):
    calls = 0

    async def universe(**params):
        nonlocal calls
        calls += 1
        assert params["series"] == "KX-SERIES"
        return _universe()

    monkeypatch.setattr(reads, "_read_universe", universe)
    data = await reads.markets_snapshot("KX-SERIES")

    assert calls == 1, "a read-only snapshot never retries a venue read"
    assert data.state == "fresh"
    assert data.basket_cost == "0.97"
    assert (data.yes_bid, data.yes_ask, data.spread) == ("0.41", "0.43", "0.02")
    assert data.settlement_sources == ("official bulletin",)


@pytest.mark.asyncio
async def test_market_snapshot_marks_an_old_route_snapshot_stale(monkeypatch):
    async def universe(**_params):
        return _universe(age=6.0)

    monkeypatch.setattr(reads, "_read_universe", universe)
    monkeypatch.setattr(reads.warm, "max_age_s", lambda: 5)

    assert (await reads.markets_snapshot()).state == "stale"


@pytest.mark.asyncio
async def test_proofs_snapshot_keeps_certificate_and_index_values_in_parity(monkeypatch):
    async def universe(**_params):
        return _universe()

    async def certificate(**params):
        assert params["event_ticker"] == "KX-EVENT"
        return CoherenceCertificate(
            verdict="incoherent", engine="linear_programme", component_id="KX-EVENT",
            series_ticker="KX-SERIES", exchange_index=1, priced_out=False,
            worth_doing=True, worst_case_payoff="1.0000", gross_edge="0.0300",
            total_fees="0.0040", net_edge="0.0260",
        )

    async def index(**_params):
        return CoherenceIndexSeries(
            state="ok", measured=1, unmeasurable=2,
            points=[CoherenceIndexPoint(
                ts_ns=1, series_ticker="KX-SERIES", event_ticker="KX-EVENT",
                exchange_index=1, ci="0.0300", engine="linear_programme",
            )],
        )

    monkeypatch.setattr(reads, "_read_universe", universe)
    monkeypatch.setattr(reads, "_read_certificate", certificate)
    monkeypatch.setattr(reads, "_read_index", index)
    data = await reads.proofs_snapshot("KX-SERIES")

    assert data.state == "fresh"
    assert data.verdict == "incoherent"
    assert (data.gross_edge, data.total_fees, data.net_edge) == ("0.0300", "0.0040", "0.0260")
    assert (data.index_value, data.index_measured, data.index_unmeasurable) == ("0.0300", 1, 2)


@pytest.mark.asyncio
async def test_diffusion_snapshot_combines_three_read_models_once(monkeypatch):
    now = datetime(2026, 8, 27, tzinfo=timezone.utc)
    calls = {"absorption": 0, "episodes": 0, "findings": 0}

    async def absorption(**_params):
        calls["absorption"] += 1
        return DiffusionAbsorptionResponse(
            observed_at=now, state="ok", runs=[DiffusionStageRun.model_construct()],
            stages=[
                DiffusionStageSummary(stage="release", measured=3, no_signal=2, median_half_life_s=45.0),
                DiffusionStageSummary(stage="call", measured=2, no_signal=1, median_half_life_s=90.0),
            ],
        )

    async def episodes(**_params):
        from modules.schemas import CoherenceEpisodes

        calls["episodes"] += 1
        return CoherenceEpisodes(state="empty", median_withheld_reason="0 closed episode(s); a median needs at least 8")

    async def findings(**_params):
        calls["findings"] += 1
        return DiffusionFindingsResponse(
            observed_at=now, state="ok",
            gate=DiffusionGate(state="passed", r_squared=0.31, floor=0.20, samples=12, fact="held out"),
            findings=[
                DiffusionFinding(name="a", question="q", stage="both", n=12, verdict="holds"),
                DiffusionFinding(name="b", question="q", stage="both", n=12, verdict="absent"),
            ],
        )

    monkeypatch.setattr(reads, "_read_absorption", absorption)
    monkeypatch.setattr(reads, "_read_episodes", episodes)
    monkeypatch.setattr(reads, "_read_findings", findings)
    data = await reads.diffusion_snapshot()

    assert calls == {"absorption": 1, "episodes": 1, "findings": 1}
    assert data.runs == 1
    assert (data.release_measured, data.call_measured) == (3, 2)
    assert (data.gate_state, data.gate_samples, data.gate_r_squared) == ("passed", 12, 0.31)
    assert (data.findings_holds, data.findings_absent) == (1, 1)


@pytest.mark.asyncio
async def test_invalid_market_read_model_is_contained(monkeypatch):
    async def invalid(**_params):
        return object()

    monkeypatch.setattr(reads, "_read_universe", invalid)
    data = await reads.markets_snapshot()

    assert data.state == "invalid"
    assert data.detail == "universe returned an invalid read model"


@pytest.mark.asyncio
async def test_one_diffusion_timeout_returns_partial_without_retry(monkeypatch):
    now = datetime(2026, 8, 27, tzinfo=timezone.utc)
    attempts = 0

    async def timed_out(**_params):
        nonlocal attempts
        attempts += 1
        raise TimeoutError

    async def episodes(**_params):
        from modules.schemas import CoherenceEpisodes

        return CoherenceEpisodes(state="empty")

    async def findings(**_params):
        return DiffusionFindingsResponse(observed_at=now, state="ok")

    monkeypatch.setattr(reads, "_read_absorption", timed_out)
    monkeypatch.setattr(reads, "_read_episodes", episodes)
    monkeypatch.setattr(reads, "_read_findings", findings)
    data = await reads.diffusion_snapshot()

    assert attempts == 1
    assert data.state == "partial"
    assert data.detail == "absorption exceeded the read budget"
    assert data.absorption_state == "timeout"
    assert data.episodes_state == "empty"
    assert data.findings_state == "ok"


@pytest.mark.asyncio
async def test_all_diffusion_timeouts_are_distinct_from_an_empty_ledger(monkeypatch):
    async def timed_out(**_params):
        raise TimeoutError

    monkeypatch.setattr(reads, "_read_absorption", timed_out)
    monkeypatch.setattr(reads, "_read_episodes", timed_out)
    monkeypatch.setattr(reads, "_read_findings", timed_out)

    data = await reads.diffusion_snapshot()
    assert data.state == "timeout"
    assert data.runs == 0 and data.closed_episodes == 0


@pytest.mark.asyncio
async def test_a_failed_read_recovers_on_the_next_command_without_a_retry_loop(monkeypatch):
    attempts = 0

    async def recovers(**_params):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise TimeoutError
        return _universe()

    monkeypatch.setattr(reads, "_read_universe", recovers)
    first = await reads.markets_snapshot()
    second = await reads.markets_snapshot()

    assert first.state == "timeout"
    assert second.state == "fresh"
    assert attempts == 2, "one attempt belongs to each user command"


@pytest.mark.asyncio
async def test_proofs_retains_each_subread_state_when_the_universe_times_out(monkeypatch):
    certificate_calls = 0

    async def timed_out(**_params):
        raise TimeoutError

    async def certificate(**_params):
        nonlocal certificate_calls
        certificate_calls += 1
        raise AssertionError("certificate cannot run without a selected event")

    async def index(**_params):
        return CoherenceIndexSeries(state="empty", measured=0, unmeasurable=0)

    monkeypatch.setattr(reads, "_read_universe", timed_out)
    monkeypatch.setattr(reads, "_read_certificate", certificate)
    monkeypatch.setattr(reads, "_read_index", index)

    data = await reads.proofs_snapshot("KX-SERIES")

    assert data.state == "partial"
    assert data.universe_state == "timeout"
    assert data.certificate_state == "timeout"
    assert data.index_state == "empty"
    assert certificate_calls == 0


@pytest.mark.asyncio
async def test_engine_command_guard_cancels_a_stalled_snapshot_and_answers(bot, monkeypatch):
    cancelled = asyncio.Event()

    async def stalled(_series=None):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(tabs_engine, "ENGINE_COMMAND_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(tabs_engine, "markets_snapshot", stalled)

    await asyncio.wait_for(
        bot.handle_update(update("/markets", update_id=91_005)),
        timeout=0.25,
    )

    assert cancelled.is_set(), "the stalled read must be cancelled at the command deadline"
    assert "Markets" in bot.last and "TIMEOUT" in bot.last
    assert "No market values were substituted" in bot.last
    assert "Command failed" not in bot.last


@pytest.mark.asyncio
async def test_engine_command_contains_snapshot_errors_as_unavailable(bot, monkeypatch):
    async def broken(_series=None):
        raise RuntimeError("provider credentials must not leak")

    monkeypatch.setattr(tabs_engine, "markets_snapshot", broken)
    await bot.handle_update(update("/markets", update_id=91_006))

    assert "Markets" in bot.last and "UNAVAILABLE" in bot.last
    assert "RuntimeError" in bot.last
    assert "provider credentials" not in bot.last
    assert "Command failed" not in bot.last


@pytest.mark.asyncio
async def test_partial_diffusion_does_not_render_missing_parts_as_zero(bot, monkeypatch):
    async def diffusion():
        return DiffusionSnapshot(
            state="partial",
            runs=4,
            absorption_state="ok",
            episodes_state="timeout",
            findings_state="unavailable",
        )

    monkeypatch.setattr(tabs_engine, "diffusion_snapshot", diffusion)
    await bot.handle_update(update("/diffusion", update_id=91_007))

    assert "DEGRADED" in bot.last and "PARTIAL" in bot.last
    assert "Runs" in bot.last and "4" in bot.last
    assert "Episodes" in bot.last and "timeout" in bot.last.lower()
    assert "Findings" in bot.last and "unavailable" in bot.last.lower()
    assert "0/2 closed" not in bot.last
    assert "0/8 closed" not in bot.last


@pytest.mark.asyncio
async def test_partial_proofs_does_not_invent_an_absent_witness(bot, monkeypatch):
    async def proof(_series=None):
        return ProofsSnapshot(
            state="partial",
            selected_series="KX-SERIES",
            universe_state="ok",
            certificate_state="timeout",
            index_state="ok",
            index_value="0.0310",
            index_measured=7,
            index_unmeasurable=2,
        )

    monkeypatch.setattr(tabs_engine, "proofs_snapshot", proof)
    await bot.handle_update(update("/proofs", update_id=91_008))

    assert "DEGRADED" in bot.last and "PARTIAL" in bot.last
    assert "Certificate" in bot.last and "timeout" in bot.last.lower()
    assert "0.0310" in bot.last and "7" in bot.last
    assert "No reproducible fee-surviving witness" not in bot.last


@pytest.mark.asyncio
async def test_commands_escape_dynamic_values_and_preserve_empty_sample_gates(bot, monkeypatch):
    async def market(_series=None):
        return MarketsSnapshot(state="partial", event_title="<unsafe & title>", detail="<provider>")

    async def diffusion():
        return DiffusionSnapshot(state="empty", detail="No measured stages")

    monkeypatch.setattr(tabs_engine, "markets_snapshot", market)
    monkeypatch.setattr(tabs_engine, "diffusion_snapshot", diffusion)
    await bot.handle_update(update("/markets", update_id=91_001))
    market_reply = " ".join(bot.sent)
    assert "&lt;unsafe &amp; title&gt;" in market_reply
    assert "&lt;provider&gt;" in market_reply
    assert "<unsafe" not in market_reply

    bot.sent.clear()
    bot._rate_windows.clear()
    await bot.handle_update(update("/diffusion", update_id=91_002))
    diffusion_reply = " ".join(bot.sent)
    assert "0/2 closed; needs more" in diffusion_reply
    assert "0/8 closed; withheld" in diffusion_reply
    assert "0.0 s" not in diffusion_reply, "missing half-life must not become zero"
    assert all(len(chunk) <= 3900 for chunk in bot.sent)
