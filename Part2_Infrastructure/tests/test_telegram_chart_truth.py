"""Telegram chart inputs, pixels, and fabricated-reading guards."""

from __future__ import annotations

import ast
import contextlib
import importlib
from pathlib import Path

from config import settings


class TestMultiSymbolParsingAndDrawing:
    def test_no_fabricated_desk_figures_survive_in_the_module(self):
        import modules.telegram as telegram_module

        # A package now, so __file__ names only __init__.py: scan every module.
        files = sorted(Path(telegram_module.__file__).parent.rglob("*.py"))
        raw = "\n".join(path.read_text() for path in files)
        assert len(files) > 5 and "class TelegramBot" in raw, f"scan read {len(files)} files"
        source = "\n".join(line for line in raw.splitlines() if not line.lstrip().startswith("#"))
        for fabricated in [
            "Sharpe Ratio <code>2.14",
            "99.99%",
            "84% Remaining",
            "Binance 58% / Bybit 42%",
            "$64,608.20",
            "1,080 CI PASSED",
        ]:
            assert fabricated not in source, f"fabricated desk figure is back: {fabricated}"

    def test_no_chart_generator_invents_its_own_data(self):
        """Every generate_*_png function must plot values it was handed."""
        import modules.telegram as telegram_module

        scan = sorted(Path(telegram_module.__file__).parent.rglob("*.py"))
        with contextlib.suppress(ModuleNotFoundError):
            charts = importlib.import_module("modules.telegram_charts")
            scan += sorted(Path(charts.__file__).parent.rglob("*.py"))
        banned = {"random", "sin", "cos", "uniform", "randn", "normal"}
        inspected = 0
        for path in scan:
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if not isinstance(node, ast.FunctionDef):
                    continue
                if not (node.name.startswith("generate_") and node.name.endswith("_png")):
                    continue
                inspected += 1
                for inner in ast.walk(node):
                    if isinstance(inner, ast.Call) and isinstance(inner.func, ast.Attribute):
                        assert inner.func.attr not in banned, (
                            f"{path.name}::{node.name} synthesises data with {inner.func.attr}()"
                        )
        assert inspected >= 16, f"the scan inspected {inspected} generators — wrong files"
        assert not hasattr(telegram_module, "generate_chart_png"), (
            "generate_chart_png drew fake desk data under factual captions"
        )

    def test_symbol_parsing_stops_at_the_asset_argument(self, bot):
        assert bot._symbols(["btcusdt", "ethusdt", "solusdt"]) == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
        assert bot._symbols(["AAPL", "equity"]) == ["AAPL"]
        assert bot._symbols(["BTCUSDT", "BTCUSDT"]) == ["BTCUSDT"]
        assert bot._symbols([]) == [settings.symbols[0].upper()]
        assert len(bot._symbols(["A", "B", "C", "D", "E", "F", "G", "H"])) == 6

    def test_the_series_chart_is_drawn_from_the_closes_it_is_given(self):
        from modules.telegram_charts import generate_series_chart_png

        rising = generate_series_chart_png("BTCUSDT", [100.0, 101.0, 108.0], "1d", "OpenBB")
        falling = generate_series_chart_png("BTCUSDT", [108.0, 101.0, 100.0], "1d", "OpenBB")
        assert rising[:4] == b"\x89PNG" and falling[:4] == b"\x89PNG"
        assert rising != falling
