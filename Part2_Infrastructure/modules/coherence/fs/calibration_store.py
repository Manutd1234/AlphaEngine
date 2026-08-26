"""The settled score over time: one row per scoring run, nulls and all.

``calibration.py`` scores a corpus and ``corpus.py`` builds one. Both answer
about NOW — of everything that has settled, how good were the prices. This
module is the tape of those answers, and it exists because the Scorecard has
never had a time axis: a reader could see that the venue is well calibrated and
had no way to ask whether it is getting better.

Written here rather than in ``store.py`` for the reason ``corpus.py`` gives for
the settlements table, and it is the same reason twice: this is not on the
recorder's hot path — a score is taken on its own slow cadence, long after the
books it is built from — and a table with one reader belongs beside that reader.
It borrows the store's single connection under the store's lock, because DuckDB
gives a second writer an error rather than a queue.

**THE FIGURES ARE TEXT, AND THAT IS THE SAME DECISION THE WIRE MAKES.** A Brier
of 0.00010533 and a skill of 0.99935238 are fixed-point quantities whose last
places are the finding; DECIMAL(n, m) would fix a scale here that neither the
kernel nor the schema fixes anywhere else, and every one of these leaves as a
string in ``schemas_coherence_lab.py`` regardless. So each is stored as the
exact text of the Decimal the kernel produced, and a reader gets back what was
computed rather than what a column could hold. ``ts_ns`` and ``markets`` are
integers because they are counts, and ``thin`` is a flag.

**A RUN THAT COULD NOT BE SCORED STILL WRITES A ROW.** On a cold tape nothing
has settled, so the report comes back with a null Brier and a detail saying why,
and that row is the record that scoring was attempted and refused. Dropping it
would leave a gap indistinguishable from an outage; writing a zero would put a
perfect forecaster at the origin of every chart drawn afterwards, which is this
codebase's most alert-to defect — "we do not know" rendered as "it is fine".

**THE SERIES ACCRUES FORWARD ONLY.** Nothing back-fills it. The history begins
when the recorder began, and the figure that draws it has to say so rather than
implying the venue had no score before that.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from modules.coherence.fs.store import CoherenceStore
from modules.coherence.kernel.calibration import Report

_SCORES_DDL = """
CREATE TABLE IF NOT EXISTS calibration_scores (
    ts_ns            BIGINT  NOT NULL,
    engine           VARCHAR NOT NULL,
    markets          INTEGER NOT NULL,
    brier            VARCHAR,
    skill            VARCHAR,
    base_rate        VARCHAR,
    uncertainty      VARCHAR,
    bias_slope       VARCHAR,
    median_horizon_s INTEGER,
    thin             BOOLEAN NOT NULL,
    detail           VARCHAR,
    horizon_s        INTEGER
)
"""

#: The live table predates ``horizon_s`` and has rows in it, and ``CREATE TABLE
#: IF NOT EXISTS`` does nothing to an existing table. So every reader and writer
#: runs this after the DDL: the column arrives on first touch after deploy,
#: and every row written before it carries NULL — a horizon nobody applied is
#: not a horizon of zero.
_ADD_HORIZON = "ALTER TABLE calibration_scores ADD COLUMN IF NOT EXISTS horizon_s INTEGER"

#: The columns ``calibration_history`` selects, in order. Named once so the
#: SELECT and the dict it is zipped into cannot drift apart — the failure mode
#: is a silent column shift, where every field is populated and half of them
#: hold the neighbouring value. ``horizon_s`` is LAST because it was added last:
#: the ALTER appends, and the zip is strict.
COLUMNS = (
    "ts_ns", "engine", "markets", "brier", "skill", "base_rate",
    "uncertainty", "bias_slope", "median_horizon_s", "thin", "detail", "horizon_s",
)


def _text(value: Decimal | None) -> str | None:
    """A Decimal as its own exact text, or a null that stays null."""
    return None if value is None else str(value)


def _prepare(conn: Any) -> None:
    conn.execute(_SCORES_DDL)
    conn.execute(_ADD_HORIZON)


def ensure_table(store: CoherenceStore) -> None:
    with store.connection() as conn:
        _prepare(conn)


def record_calibration(store: CoherenceStore, report: Report, now_ns: int, horizon_s: int | None = None) -> None:
    """Append one scoring run, whether or not it produced a score.

    Append-only and never de-duplicated, unlike ``record_settlements``: two
    runs at different instants are two readings of a corpus that has grown
    between them, which is the whole point of the series. A run that refused is
    written with null figures and the report's own ``detail`` as the reason.

    ``horizon_s`` is the floor the scorer applied to this run, so the recorded
    series can be read against the snapshot the Scorecard shows. It is None
    when the caller did not say — never a default, because a default here
    would claim a horizon for rows scored under a different one.
    """
    with store.connection() as conn:
        _prepare(conn)
        conn.execute(
            "INSERT INTO calibration_scores VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                int(now_ns),
                report.engine,
                int(report.count),
                _text(report.brier),
                _text(report.skill),
                _text(report.base_rate),
                _text(report.uncertainty),
                _text(report.bias_slope),
                report.median_horizon_s,
                bool(report.thin),
                report.detail or None,
                None if horizon_s is None else int(horizon_s),
            ),
        )


def last_calibration_ns(store: CoherenceStore) -> int | None:
    """When the last score was taken, or None if none ever was.

    Read off the tape rather than held in ``RecorderState``, because each
    recorded row IS a run: an in-memory copy would be a weaker second answer
    that resets on restart and could disagree with the series it describes.
    """
    with store.connection() as conn:
        _prepare(conn)
        row = conn.execute("SELECT MAX(ts_ns) FROM calibration_scores").fetchone()
    return None if row is None or row[0] is None else int(row[0])


def calibration_history(
    store: CoherenceStore, since_ts_ns: int = 0, limit: int = 2000
) -> list[dict[str, Any]]:
    """Every recorded score, oldest first so a chart can plot it left to right.

    The DDL runs on the read as well as the write, so the first read of a fresh
    deployment is an empty list rather than a missing-table error. An empty tape
    and a broken one must not look alike, and only one of them is normal.
    """
    with store.connection() as conn:
        _prepare(conn)
        rows = conn.execute(
            f"SELECT {', '.join(COLUMNS)} FROM calibration_scores "  # noqa: S608 - a fixed tuple, never input
            "WHERE ts_ns >= ? ORDER BY ts_ns ASC LIMIT ?",
            (int(since_ts_ns), int(limit)),
        ).fetchall()
    return [dict(zip(COLUMNS, row, strict=True)) for row in rows]
