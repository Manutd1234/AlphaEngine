"""The graph recall operator tool never invents or widens a missing desk."""

from __future__ import annotations

import json
from types import SimpleNamespace

from tools import graph_recall


def test_missing_desk_refuses_before_opening_postgrest(monkeypatch, capsys):
    monkeypatch.setattr(graph_recall, "settings", SimpleNamespace(supabase_desk_id=""))
    monkeypatch.setattr(
        graph_recall, "open_client",
        lambda: (_ for _ in ()).throw(AssertionError("missing tenant opened PostgREST")),
    )

    code = graph_recall.main(["--symbol", "BTCUSDT", "--json"])
    payload = json.loads(capsys.readouterr().out)

    assert code == 2 and payload["state"] == "unavailable"
    assert "SUPABASE_DESK_ID is unset" in payload["reason"]
