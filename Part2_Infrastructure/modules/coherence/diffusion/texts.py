"""Where the fetched text lives, and what it is allowed to claim.

One row per (event, stage, source). The row holds the text that was embedded,
its digest, and the clock at which this desk first saw it — the same
point-in-time discipline the event ledger keeps, for the same reason: a study
that scores an announcement using a document revised afterwards has look-ahead
in it.

`verified_release_time` is the issuer's own words — "For release at 2:00 p.m.
EDT" — parsed off the page. It is not decoration. The calendar in `fomc.py` was
written from knowledge, so its rows ship unverified; a statement fetched from
the date's own URL that also states the hour confirms both, and
`verify_calendar` is what turns that into a `verified_at` on the event.

A refusal is stored too. A page that 404s says the calendar row is wrong, and
that is a finding worth keeping rather than a fetch worth retrying silently.
"""

from __future__ import annotations

from typing import Any

from modules.coherence.diffusion.text import StatementText
from modules.data_ops_backend import DataOpsStore, get_data_ops_store


class DiffusionTextStore:
    """Fetched documents, their digests, and the refusals beside them."""

    _DDL = [
        """
        CREATE TABLE IF NOT EXISTS diffusion_texts (
            text_id TEXT PRIMARY KEY,
            desk_id TEXT NOT NULL,
            source_ref TEXT NOT NULL,
            stage TEXT NOT NULL,
            source TEXT NOT NULL,
            url TEXT,
            state TEXT NOT NULL,
            reason TEXT,
            body TEXT,
            sha256 TEXT,
            characters INTEGER NOT NULL DEFAULT 0,
            verified_release_time TEXT,
            body_isolated INTEGER NOT NULL DEFAULT 1,
            first_seen_at REAL NOT NULL,
            fetched_at REAL NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS diffusion_texts_by_event ON diffusion_texts (desk_id, source_ref)",
    ]

    def __init__(self, store: DataOpsStore | None = None, *, desk_id: str = "default") -> None:
        self._store = store if store is not None else get_data_ops_store()
        self._desk_id = desk_id
        self._store.migrate(self._DDL)

    @property
    def backend(self) -> str:
        return self._store.backend

    def record(self, fetched: StatementText, *, stage: str, source: str, now_ms: float) -> str:
        """Store a document or a refusal. `first_seen_at` is written once."""
        text_id = f"{fetched.source_ref}|{stage}|{source}"
        existing = self._store.fetch_one("diffusion_texts", filters={"text_id": text_id})
        row: dict[str, Any] = {
            "text_id": text_id, "desk_id": self._desk_id, "source_ref": fetched.source_ref,
            "stage": stage, "source": source, "url": fetched.url, "state": fetched.state,
            "reason": fetched.reason, "body": fetched.text, "sha256": fetched.sha256,
            "characters": int(fetched.characters),
            "verified_release_time": fetched.release_time,
            "body_isolated": 1 if fetched.body_isolated else 0,
            "fetched_at": float(fetched.fetched_at_ms or now_ms),
        }
        if existing is None:
            self._store.add("diffusion_texts", {**row, "first_seen_at": now_ms})
            return text_id
        self._store.patch("diffusion_texts", filters={"text_id": text_id}, patch=row)
        return text_id

    def get(self, source_ref: str, *, stage: str = "release", source: str = "statement"
            ) -> dict[str, Any] | None:
        return self._store.fetch_one("diffusion_texts",
                                     filters={"text_id": f"{source_ref}|{stage}|{source}"})

    def list_texts(self, *, limit: int = 200) -> tuple[list[dict[str, Any]], bool]:
        rows = self._store.fetch("diffusion_texts", filters={"desk_id": self._desk_id},
                                 order="first_seen_at.asc", limit=max(1, int(limit)) + 1)
        return rows[:limit], len(rows) > limit

    def count(self) -> int:
        return self._store.count("diffusion_texts", filters={"desk_id": self._desk_id})

    def close(self) -> None:
        self._store.close()


def verify_calendar(fetched: StatementText, expected_et: str) -> tuple[bool, str | None]:
    """Does the issuer's own page agree with the calendar row?

    Two things have to line up and both are checked. A 200 from the date's URL
    confirms the DATE. The "For release at" line confirms the HOUR — which is
    the part a written-from-knowledge calendar is most likely to get wrong, and
    the part the whole two-stage comparison rests on. `2020-03-15` at 17:00 is
    the case that would otherwise pass a date check and place the measurement
    three hours before anything happened.
    """
    if fetched.state != "ok":
        return False, fetched.reason or f"the statement page answered {fetched.state}"
    if fetched.release_time is None:
        return False, "the page carried no release time, so the hour is still unconfirmed"
    stated = fetched.release_time.split(" ", 1)[0]
    if stated != expected_et:
        return False, (f"the issuer says {fetched.release_time} and the calendar says "
                       f"{expected_et} — the calendar row is wrong")
    return True, None
