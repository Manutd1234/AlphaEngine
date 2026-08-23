"""The engine still answers when SciPy is not installed, and says which engine did.

The deployment image does not carry SciPy — it reaches CI through
``requirements-dev.txt`` and never gets into ``requirements.txt``. So the
production answer to "is this family coherent" comes from the closed-form
checks, and the thing that must not happen is for that to look identical to the
LP's answer.

Run in a subprocess whose import machinery refuses the package, because that is
the only way to prove the fallback rather than assert it. Monkeypatching the
seam would test the mock.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PROGRAM = textwrap.dedent(
    """
    import sys

    class Refuse:
        def find_module(self, name, path=None):
            return self if name == "scipy" or name.startswith("scipy.") else None
        def load_module(self, name):
            raise ImportError("scipy is refused by this test")
        def find_spec(self, name, path=None, target=None):
            if name == "scipy" or name.startswith("scipy."):
                raise ImportError("scipy is refused by this test")
            return None

    sys.meta_path.insert(0, Refuse())
    sys.path.insert(0, {root!r})

    from decimal import Decimal

    from modules.coherence.kernel import closedform, dutchbook
    from modules.coherence.kernel.book import Book, Level
    from modules.coherence.kernel.constraints import rows_for
    from modules.coherence.kernel.costs import FeeSchedule
    from modules.coherence.kernel.lattice import Component, Node

    assert dutchbook.import_linprog()[0] is None, "scipy was not actually refused"
    assert not dutchbook.linprog_available()

    nodes = [
        Node(ticker=f"X-{{i}}", event_ticker="X", series_ticker="X", exchange_index=0,
             strike_kind="custom", floor_strike=None, cap_strike=None,
             settlement_sources=("S",), label=f"Outcome {{i}}")
        for i in (1, 2, 3)
    ]
    component = Component(component_id="X", event_ticker="X", series_ticker="X",
                          exchange_index=0, mutually_exclusive=True, nodes=nodes)
    books = {{
        f"X-{{i}}": Book(ticker=f"X-{{i}}",
                       yes_bids=(Level(price=Decimal("0.28"), size_hundredths=50000),),
                       no_bids=(Level(price=Decimal("0.70"), size_hundredths=50000),))
        for i in (1, 2, 3)
    }}

    assert dutchbook.solve(component, books, FeeSchedule()) is None, "the LP must decline, not degrade"

    certificate = closedform.solve(component, rows_for(component, books), FeeSchedule())
    assert certificate.verdict == "incoherent", "the fallback found nothing"
    assert certificate.engine == "closed_form", certificate.engine
    assert certificate.net_edge > 0

    print("FALLBACK_OK", certificate.engine, certificate.net_edge)
    """
).format(root=str(ROOT))


def test_the_engine_answers_and_names_itself_without_scipy():
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", PROGRAM],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=str(ROOT),
    )
    assert result.returncode == 0, f"the fallback path failed:\n{result.stdout}\n{result.stderr}"
    assert "FALLBACK_OK closed_form" in result.stdout, result.stdout


def test_the_certify_syscall_says_the_programme_did_not_run():
    """A weaker answer must announce itself as one."""
    program = PROGRAM.replace(
        'print("FALLBACK_OK", certificate.engine, certificate.net_edge)',
        textwrap.dedent(
            """
            from modules.coherence.syscalls.certify import certify
            from modules.coherence.drivers.kalshi_parse import Event, Market
            from modules.coherence.kernel.grid import parse_price_ranges
            from modules.coherence.kernel.book import top_of_book
            from modules.coherence.syscalls.observe import MarketObservation, Observation

            grid = parse_price_ranges([{"start": "0.0000", "end": "1.0000", "step": "0.0100"}], "linear_cent")
            markets = tuple(
                Market(ticker=f"X-{i}", event_ticker="X", series_ticker="X", status="active",
                       strike_kind="custom", floor_strike=None, cap_strike=None, grid=grid,
                       exchange_index=0, yes_sub_title=f"Outcome {i}",
                       top=top_of_book(f"X-{i}", "0.28", "1.00", "0.30", "1.00"))
                for i in (1, 2, 3)
            )
            event = Event(event_ticker="X", series_ticker="X", title="", mutually_exclusive=True,
                          exchange_index=0, settlement_sources=("S",), markets=markets)
            observation = Observation(ts_ns=0, event=event)
            observation.markets = [
                MarketObservation(market=market, book=books[market.ticker]) for market in markets
            ]
            result = certify(observation, FeeSchedule())
            assert result.engine == "closed_form", result.engine
            assert any("SciPy is not installed" in note for note in result.notes), result.notes
            print("CERTIFY_SAYS_SO")
            """
        ),
    )
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-c", program], capture_output=True, text=True, timeout=120, cwd=str(ROOT)
    )
    assert completed.returncode == 0, f"{completed.stdout}\n{completed.stderr}"
    assert "CERTIFY_SAYS_SO" in completed.stdout
