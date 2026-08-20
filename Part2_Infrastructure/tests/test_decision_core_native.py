"""The native decision core reproduces the Python reference, to the bit.

Five claims, each an assertion rather than a skip:

* the core *builds and imports* — unless an operator has explicitly opted out
  with ``DECISION_CORE=python``, an unimportable ``modules._decision_core`` is a
  red build, not a quiet fall-back to Python (that is what CI must catch);
* forced onto the native engine, the gateway decides every gate-parity scenario
  *exactly* as the committed fixture — same accept/reject, same gate order, same
  observed and limit floats — and a divergence names the gate and the delta;
* ``BookLadder`` folds a book identically to a fresh Python dict-sort, including
  ``depth_usd``'s Neumaier-compensated sum, over random deltas;
* the ladder ``BookState`` now *keeps* stays a bit-exact mirror of its dicts
  across arbitrary snapshot/delta sequences — the mirror is only worth having if
  it can never drift, and drift would be silent;
* the routed walk in the core agrees with ``TCAEngine.route_estimate`` on random
  multi-venue books, to the last bit of ``slippage_bps``, including the
  cross-venue price ties whose fold order decides that bit.

The sister suite ``test_gate_parity.py`` pins the same fixture to the Python
reference; a break in either is a real parity failure, never a tolerance to
loosen.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import random
import time
from pathlib import Path

import pytest

from modules.risk_proxy import GATE_ORDER as ENGINE_GATE_ORDER
from modules.risk_proxy import RiskGateway
from modules.schemas import OrderRequest
from modules.tca_engine import BookState, TCAEngine
from tools.gate_fixture import GATE_ORDER, build_gateway, expected_from

FIXTURE = Path(__file__).resolve().parent.parent / "web" / "tests" / "fixtures" / "gate-parity.json"
DATA = json.loads(FIXTURE.read_text())
SCENARIOS = DATA["scenarios"]

#: submit()'s gate battery. Compared below against BOTH other copies — the one
#: in `tools/gate_fixture.py` and the registry in `modules/risk_proxy/gates.py`.
EXPECTED_GATE_ORDER = (
    "kill_switch",
    "symbol_halt",
    "symbol_whitelist",
    "paper_execution_model",
    "reference_freshness",
    "duplicate_order",
    "rate_limit",
    "price_available",
    "order_sized",
    "max_order_notional",
    "symbol_concentration",
    "gross_exposure",
    "price_band",
    "working_book",
    "daily_drawdown",
    "reduce_only",
    "est_slippage",
)


def _native_module():
    """The built extension, or None if it will not import."""
    try:
        return importlib.import_module("modules._decision_core")
    except ImportError:
        return None


def test_native_core_imports() -> None:
    """The .so must build and import — a hard failure unless python was requested.

    CI does not set ``DECISION_CORE``, so the default (``auto``) reaches here and
    a broken build turns this red. Only an explicit ``DECISION_CORE=python`` — a
    deliberate opt-out of the native engine — excuses a missing extension.
    """
    requested = os.getenv("DECISION_CORE", os.getenv("ALPHAENGINE_DECISION_CORE", "auto")).strip().lower()
    module = _native_module()
    if requested == "python":
        return  # operator opted out of native; its absence is not a failure here
    assert module is not None, (
        "modules._decision_core failed to import. Build it with: "
        "python native/decision_core/setup.py build_ext --inplace --build-temp build/native"
    )
    assert hasattr(module, "decide"), "native core is missing decide()"
    assert hasattr(module, "BookLadder"), "native core is missing BookLadder"


def test_gate_order_matches_the_fixture() -> None:
    assert ENGINE_GATE_ORDER == GATE_ORDER == EXPECTED_GATE_ORDER, "the three copies disagree"
    for name, scenario in SCENARIOS.items():
        names = [c["name"] for c in scenario["expected"]["checks"]]
        assert set(names) <= set(EXPECTED_GATE_ORDER), f"{name} names an unknown gate"
        ranks = [EXPECTED_GATE_ORDER.index(n) for n in names]
        assert ranks == sorted(ranks), f"{name} checks are out of gate order"


def _force_native(monkeypatch) -> object:
    module = _native_module()
    if module is None:
        pytest.fail(
            "modules._decision_core is not built — cannot exercise the native engine. "
            "Build it with: python native/decision_core/setup.py build_ext --inplace "
            "--build-temp build/native"
        )
    # Pin the engine regardless of DECISION_CORE / loader state: every gateway
    # built under this test resolves to the native module.
    monkeypatch.setattr(RiskGateway, "_resolve_decision_core", staticmethod(lambda: module))
    return module


def _diff_message(name: str, expected: dict, actual: dict) -> str:
    lines = [f"scenario {name}: native decision diverged from the committed reference"]
    if expected.get("accepted") != actual.get("accepted"):
        lines.append(f"  accepted: reference={expected['accepted']} native={actual['accepted']}")
    if expected.get("status") != actual.get("status"):
        lines.append(f"  status: reference={expected['status']} native={actual['status']}")
    if expected.get("rejected_by") != actual.get("rejected_by"):
        lines.append(f"  rejected_by: reference={expected['rejected_by']} native={actual['rejected_by']}")
    for field in ("quantity", "notional"):
        if expected.get(field) != actual.get(field):
            lines.append(f"  {field}: reference={expected[field]!r} native={actual[field]!r}")
    exp_checks = {c["name"]: c for c in expected["checks"]}
    act_checks = {c["name"]: c for c in actual["checks"]}
    for gate in EXPECTED_GATE_ORDER:
        e = exp_checks.get(gate)
        a = act_checks.get(gate)
        if e is None and a is None:
            continue
        if (e is None) != (a is None):
            lines.append(f"  gate {gate}: reference={'present' if e else 'absent'} "
                         f"native={'present' if a else 'absent'}")
            continue
        for field in ("passed", "observed", "limit"):
            ev, av = e[field], a[field]
            if ev != av:
                delta = ""
                if isinstance(ev, (int, float)) and isinstance(av, (int, float)):
                    delta = f" (delta={av - ev:+.6g})"
                lines.append(f"  gate {gate}.{field}: reference={ev!r} native={av!r}{delta}")
    return "\n".join(lines)


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_native_engine_matches_fixture(name: str, monkeypatch) -> None:
    module = _force_native(monkeypatch)
    scenario = SCENARIOS[name]
    gw = build_gateway(scenario, monkeypatch)
    assert gw._decision_core is module, "the gateway did not wire the native engine"

    order = OrderRequest(**scenario["order"])
    decision = asyncio.run(gw.submit(order, source="fixture"))

    # The core actually ran — a silent fall-back to Python would still match the
    # fixture (Python is the reference) and hide a broken native path.
    assert gw.last_decision_core_ns is not None, (
        f"scenario {name}: the native core did not run (silent fall-back to Python)"
    )
    assert gw.last_decision_core_ns >= 0

    actual = expected_from(decision)
    expected = scenario["expected"]
    assert actual == expected, _diff_message(name, expected, actual)


# --------------------------------------------------------------------------- #
# BookLadder is a faithful mirror of BookState's dict-then-sort views.
# --------------------------------------------------------------------------- #
def _reference_sides(bids: list, asks: list):
    """BookState.apply_snapshot semantics: {p: q for p, q in side if q > 0}."""
    bd = {p: q for p, q in bids if q > 0}
    ad = {p: q for p, q in asks if q > 0}
    sb = sorted(bd.items(), key=lambda kv: -kv[0])
    sa = sorted(ad.items(), key=lambda kv: kv[0])
    return sb, sa


def _reference_depth(levels: list, k: int) -> float:
    return sum(p * q for p, q in levels[:k])


def _reference_mid(sb: list, sa: list):
    bb = sb[0][0] if sb else None
    ba = sa[0][0] if sa else None
    return (bb + ba) / 2 if bb and ba else None


def test_bookladder_matches_python_over_random_deltas() -> None:
    module = _native_module()
    if module is None:
        pytest.skip("native core not built")
    rng = random.Random(20260817)
    for _ in range(4000):
        # A snapshot assembled from deltas: duplicate prices (last size wins) and
        # non-positive sizes (dropped) exercise the dict semantics, not just a
        # clean ladder.
        n_bid = rng.randint(0, 12)
        n_ask = rng.randint(0, 12)
        bids = [(round(rng.uniform(90.0, 100.0), 2), round(rng.uniform(-2.0, 5000.0), 1)) for _ in range(n_bid)]
        asks = [(round(rng.uniform(100.0, 110.0), 2), round(rng.uniform(-2.0, 5000.0), 1)) for _ in range(n_ask)]

        sb, sa = _reference_sides(bids, asks)
        ladder = module.BookLadder()
        ladder.snapshot(bids, asks)

        assert ladder.bids == sb
        assert ladder.asks == sa
        assert ladder.mid() == _reference_mid(sb, sa)
        for k in (1, 3, 5, 20):
            assert ladder.depth_usd("bid", k) == _reference_depth(sb, k), (bids, k)
            assert ladder.depth_usd("ask", k) == _reference_depth(sa, k), (asks, k)


# --------------------------------------------------------------------------- #
# The ladder BookState keeps cannot drift from the dicts it mirrors.
# --------------------------------------------------------------------------- #
def test_native_ladder_mirror_tracks_bookstate_over_random_sequences() -> None:
    """After any sequence of snapshots and deltas, the mirror *is* the book.

    The mirror is only worth having because a decision may trust it without
    checking, and a stale one is exactly the silent-wrongness defect this
    codebase is most alert to: every gate would still return a number, the
    number would be computed from a book that no longer exists, and nothing in
    the response would say so. So this asserts equality to the last bit — same
    sorted levels, same ``mid``, same ``depth_usd`` at every depth a caller
    reads — rather than to a tolerance.
    """
    if _native_module() is None:
        pytest.skip("native core not built")
    rng = random.Random(20260817)
    book = BookState("MIRROR", "BTCUSDT")

    for step in range(1500):
        if step % 7 == 0:
            book.apply_snapshot(
                bids=[(round(rng.uniform(90.0, 100.0), 2), round(rng.uniform(-1.0, 900.0), 3))
                      for _ in range(rng.randint(0, 14))],
                asks=[(round(rng.uniform(100.0, 110.0), 2), round(rng.uniform(-1.0, 900.0), 3))
                      for _ in range(rng.randint(0, 14))],
            )
        else:
            # Non-positive sizes delete on a delta (unlike a snapshot, where they
            # are merely dropped), so this exercises both halves of the funnel.
            book.apply_delta(
                bids=[(round(rng.uniform(90.0, 100.0), 2), round(rng.uniform(-1.0, 900.0), 3))
                      for _ in range(rng.randint(0, 6))],
                asks=[(round(rng.uniform(100.0, 110.0), 2), round(rng.uniform(-1.0, 900.0), 3))
                      for _ in range(rng.randint(0, 6))],
            )

        ladder = book.native_ladder()
        assert ladder is not None, "a mutated book must carry its native mirror"
        assert ladder.bids == book.sorted_bids(), f"bid ladder drifted at step {step}"
        assert ladder.asks == book.sorted_asks(), f"ask ladder drifted at step {step}"
        assert ladder.mid() == book.mid, f"mid drifted at step {step}"
        for depth in (1, 5, 10, 20, 50):
            assert ladder.depth_usd("bid", depth) == book.depth_usd("bid", depth), (step, depth)
            assert ladder.depth_usd("ask", depth) == book.depth_usd("ask", depth), (step, depth)


# --------------------------------------------------------------------------- #
# The routed walk agrees with TCAEngine.route_estimate, bit for bit.
# --------------------------------------------------------------------------- #
class _Feed:
    def __init__(self, books: dict) -> None:
        self.connected = True
        self.books = books


def _decide_route(module, ladders: list, side: str, notional: float):
    """Call the core for the routed walk alone, with every other gate neutered."""
    return module.decide(
        side_is_buy=(side == "BUY"),
        order_type_is_limit=False,
        order_quantity=None,
        order_notional=notional,
        limit_price=None,
        is_paper=False,
        paper_price=None,
        order_books=ladders,
        pos_quantities=[],
        pos_avg_prices=[],
        pos_realized=[],
        pos_marks=[],
        pos_is_order_symbol=[],
        working_buys=0.0,
        working_sells=0.0,
        starting_equity=0.0,
        carried_realized_pnl=0.0,
        start_of_day_equity=0.0,
        max_order_notional_usd=0.0,
        max_symbol_notional_usd=0.0,
        max_gross_exposure_usd=0.0,
        max_price_deviation_bps=0.0,
        max_daily_drawdown_pct=0.0,
        reduce_only_threshold=1.0,
        reduce_only_override=False,
        route_enabled=True,
    )


def test_native_routed_walk_matches_route_estimate() -> None:
    """Random multi-venue books, random sizes: identical routing, identical bps.

    The fixture's twenty scenarios pin the shapes that matter operationally;
    this pins the arithmetic that decides the last bit. Two traps live here and
    both are exercised on purpose:

    * every venue quotes off ONE shared price grid, so cross-venue ties are
      common. Python's ``list.sort`` is stable (and stays stable under
      ``reverse=True``), so on a tie the venue that was extended first fills
      first — and which venue fills first moves the blended VWAP by a ULP;
    * the requested notional is often chosen to land exactly on a level or a
      cumulative boundary, which is where ``dust`` and ``absorbs`` decide
      whether one more level is consumed and whether the order is fillable at
      all.
    """
    module = _native_module()
    if module is None:
        pytest.skip("native core not built")
    rng = random.Random(4242)
    now = time.time()

    for case in range(400):
        n_venues = rng.randint(1, 3)
        grid = [round(100.0 + i * 0.01, 4) for i in range(24)]
        engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
        feeds = {}
        for v in range(n_venues):
            book = BookState(f"V{v}", "BTCUSDT")
            book.apply_snapshot(
                bids=[(p - 1.0, round(rng.uniform(0.0, 40.0), 4)) for p in grid],
                asks=[(p, round(rng.uniform(0.0, 40.0), 4)) for p in grid],
            )
            book.last_update_wall = now
            feeds[f"V{v}"] = _Feed({"BTCUSDT": book})
        engine.feeds = feeds

        live = engine._live_books("BTCUSDT")
        names = list(live)
        ladders = [b.native_ladder() for b in live.values()]
        assert all(ladders), "every live book must carry a mirror"

        side = "BUY" if case % 2 == 0 else "SELL"
        notional = rng.choice([
            rng.uniform(1.0, 50.0),          # inside the first level
            rng.uniform(50.0, 4000.0),       # a handful of levels
            rng.uniform(4000.0, 90000.0),    # deep, often more than the book holds
            round(rng.uniform(10.0, 5000.0), 2),
        ])

        est = engine.route_estimate("BTCUSDT", side, notional)
        core = _decide_route(module, ladders, side, notional)

        assert core.route_ran
        if est is None:
            assert core.route_none, f"case {case}: python routed nothing, core routed something"
            continue
        assert not core.route_none, f"case {case}: core routed nothing, python routed {est.venue}"
        assert core.route_fillable == est.fillable, f"case {case}: fillable"
        assert round(core.route_filled_notional, 2) == est.filled_notional, f"case {case}: filled"
        core_slip = core.route_slippage_bps if core.route_has_slip else None
        assert core_slip == est.slippage_bps, (
            f"case {case}: slippage_bps python={est.slippage_bps!r} native={core_slip!r}"
        )
        assert "+".join(names[i] for i in core.route_venue_order) == est.venue, f"case {case}: legs"


def test_a_none_ladder_is_refused_rather_than_dereferenced() -> None:
    """A None among the ladders must raise, not take the interpreter down.

    ``std::vector<BookLadder *>`` accepts a Python ``None`` as a null pointer,
    and every use of a ladder in the core dereferences it without checking.
    This segfaulted before the guard existed — the worst failure mode a gateway
    has, because no Python-level ``except`` can catch it and the process dies
    holding the lock. ``_native_decide`` never passes a None, which is exactly
    why the crash needs a test rather than a comment.
    """
    module = _native_module()
    if module is None:
        pytest.skip("native core not built")
    with pytest.raises(ValueError):
        _decide_route(module, [None], "BUY", 1000.0)


def test_native_routed_walk_reports_no_liquidity_like_python() -> None:
    """The empty cases too: no live book, and a book with only one side.

    ``route_estimate`` returning None is a *reject* ("no routable liquidity"),
    not an absent gate, so the core has to agree about emptiness as precisely as
    it agrees about arithmetic. The random sweep above almost never produces
    these, which is exactly why they are pinned here instead.
    """
    module = _native_module()
    if module is None:
        pytest.skip("native core not built")
    now = time.time()

    # No live book at all: the core is handed no ladders.
    engine = TCAEngine(symbols=["BTCUSDT"], venues=[])
    engine.feeds = {}
    assert engine.route_estimate("BTCUSDT", "BUY", 1000.0) is None
    assert _decide_route(module, [], "BUY", 1000.0).route_none

    # One-sided book: `has_book` is False, so it is not live either.
    one_sided = BookState("V0", "BTCUSDT")
    one_sided.apply_snapshot(bids=[(99.0, 10.0)], asks=[])
    one_sided.last_update_wall = now
    engine.feeds = {"V0": _Feed({"BTCUSDT": one_sided})}
    assert engine._live_books("BTCUSDT") == {}
    assert engine.route_estimate("BTCUSDT", "BUY", 1000.0) is None
    assert _decide_route(module, [], "BUY", 1000.0).route_none

    # A live book that the requested side cannot fill from: BUY consumes asks,
    # so a book whose asks are all zero-size routes nothing.
    empty_side = BookState("V0", "BTCUSDT")
    empty_side.apply_snapshot(bids=[(99.0, 10.0)], asks=[(101.0, 5.0)])
    empty_side.last_update_wall = now
    engine.feeds = {"V0": _Feed({"BTCUSDT": empty_side})}
    ladders = [b.native_ladder() for b in engine._live_books("BTCUSDT").values()]
    est = engine.route_estimate("BTCUSDT", "BUY", 1_000_000.0)
    core = _decide_route(module, ladders, "BUY", 1_000_000.0)
    assert est is not None and not est.fillable
    assert not core.route_none and not core.route_fillable
    assert round(core.route_filled_notional, 2) == est.filled_notional
    assert core.route_slippage_bps == est.slippage_bps
