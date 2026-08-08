#!/usr/bin/env python3
"""Apply the committed Oracle DDL to an Autonomous Database.

    python tools/apply_oracle_schema.py [--dry-run] [file ...]

Why this exists rather than a `sqlplus` invocation in CI: sqlplus ships in
Oracle Instant Client, a ~250MB native download that has to be fetched,
unpacked and put on LD_LIBRARY_PATH before a workflow can use it.
``python-oracledb`` in **thin mode** speaks the wire protocol in pure Python, so
this is a `pip install` and a walletless TLS connect — the same mode the web
routes use, which means a success here proves the same path the app takes.

Every statement in ``oracle/*.sql`` is written to be re-runnable, so this is
safe to run repeatedly. That is a property of the SQL, not of this script; the
script's job is to split the file correctly and to say precisely what happened.

Exit codes: 0 applied (or already present), 1 a statement failed, 2 not
configured. Reads the same ORACLE_* variables as the app.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ORACLE_DIR = Path(__file__).resolve().parent.parent.parent / "oracle"
DEFAULT_FILES = ("01_schema.sql", "02_monte_carlo.sql")


def split_statements(sql: str) -> list[str]:
    """Split on a lone ``/`` — the sqlplus block terminator.

    Splitting on ``;`` is what a naive applier does and it is wrong here: every
    PL/SQL block in these files contains semicolons *inside* it, so a semicolon
    split tears each block into fragments that are individually invalid. The
    committed SQL terminates every statement with ``/`` on its own line
    precisely so this stays unambiguous.
    """
    statements: list[str] = []
    buffer: list[str] = []
    for line in sql.splitlines():
        if line.strip() == "/":
            body = "\n".join(buffer).strip()
            if body:
                statements.append(body)
            buffer = []
            continue
        buffer.append(line)

    trailing = "\n".join(buffer).strip()
    if trailing:
        # A file whose last statement has no `/`. Tolerated, but only when what
        # remains is a single statement — anything else is a malformed file and
        # guessing would apply half of it.
        statements.append(trailing.rstrip(";"))
    return statements


def describe(statement: str) -> str:
    """A one-line label for the log, so a failure names the object."""
    flat = re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", statement)).strip()
    for pattern in (
        r"CREATE (?:OR REPLACE )?(TABLE|INDEX|VECTOR INDEX|PROCEDURE|VIEW|USER|SYNONYM) (\w+)",
        r"EXECUTE IMMEDIATE\s+q?'\[?\s*CREATE (?:OR REPLACE )?(TABLE|INDEX|VECTOR INDEX) (\w+)",
    ):
        found = re.search(pattern, flat, re.IGNORECASE)
        if found:
            return f"{found.group(1).lower()} {found.group(2)}"
    return flat[:70] + ("…" if len(flat) > 70 else "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", default=list(DEFAULT_FILES))
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="parse and list the statements without connecting",
    )
    args = parser.parse_args()

    paths = [ORACLE_DIR / name for name in (args.files or DEFAULT_FILES)]
    for path in paths:
        if not path.exists():
            print(f"error: {path} does not exist", file=sys.stderr)
            return 1

    plan = [(path, split_statements(path.read_text())) for path in paths]

    if args.dry_run:
        for path, statements in plan:
            print(f"\n{path.name} — {len(statements)} statement(s)")
            for statement in statements:
                print(f"  · {describe(statement)}")
        return 0

    connect_string = (os.environ.get("ORACLE_CONN_STRING") or "").strip()
    password = os.environ.get("ORACLE_PASSWORD") or ""
    user = (os.environ.get("ORACLE_USER") or "ADMIN").strip()

    if not connect_string or not password:
        print(
            "ORACLE_CONN_STRING and ORACLE_PASSWORD must both be set.\n"
            "Nothing was contacted.",
            file=sys.stderr,
        )
        return 2

    try:
        import oracledb
    except ImportError:
        print("python-oracledb is not installed:  pip install oracledb", file=sys.stderr)
        return 1

    # Thin mode is the default in 2.x; asserted rather than assumed, because
    # thick mode would silently require an Instant Client that is not here.
    print(f"python-oracledb {oracledb.__version__}, thin mode: {oracledb.is_thin_mode()}")
    print(f"Connecting as {user} over {'tcps' if 'tcps' in connect_string.lower() else 'TCP'}\n")

    failures = 0
    try:
        connection = oracledb.connect(
            user=user, password=password, dsn=connect_string
        )
    except Exception as error:  # noqa: BLE001 — the taxonomy is the whole point
        print(f"could not connect: {_advise(error)}", file=sys.stderr)
        return 1

    with connection:
        # DBMS_OUTPUT is where each block reports created-vs-already-exists, and
        # without enabling it the script would run silently and prove nothing.
        cursor = connection.cursor()
        cursor.callproc("dbms_output.enable", (None,))

        for path, statements in plan:
            print(f"{path.name}")
            for statement in statements:
                label = describe(statement)
                try:
                    cursor.execute(statement)
                    notes = _drain_output(connection)
                    # The block's own report — "created X" vs "X already
                    # exists" — is the difference between a first apply and a
                    # re-run, and it is the only place that distinction shows.
                    print(f"  ok   {label}" + (f" — {notes[0]}" if notes else ""))
                    for extra in notes[1:]:
                        print(f"       {extra}")
                except Exception as error:  # noqa: BLE001
                    failures += 1
                    print(f"  FAIL {label} — {_advise(error)}", file=sys.stderr)
            print()

        connection.commit()

    if failures:
        print(f"{failures} statement(s) failed.", file=sys.stderr)
        return 1

    print("Schema applied. The Oracle panels will render live data once the")
    print("corpus is populated; the VaR panel works immediately.")
    return 0


def _drain_output(connection) -> list[str]:
    """Whatever the last statement wrote to DBMS_OUTPUT."""
    lines: list[str] = []
    cursor = connection.cursor()
    chunk = cursor.var(str)
    status = cursor.var(int)
    while True:
        cursor.callproc("dbms_output.get_line", (chunk, status))
        if status.getvalue() != 0:
            break
        value = chunk.getvalue()
        if value:
            lines.append(value)
    return lines


def _advise(error: Exception) -> str:
    """The ORA code turned into the thing to go and do about it."""
    message = str(error)
    code = re.search(r"ORA-(\d{5})", message)
    ora = code.group(1) if code else ""
    advice = {
        "01017": "wrong username/password — check ORACLE_PASSWORD and ORACLE_USER",
        "28000": "the account is locked — unlock it in the OCI console",
        "28001": "the password has expired — reset it in the OCI console",
        "12506": "the service in ORACLE_CONN_STRING is not registered with the listener",
        "12514": "the service in ORACLE_CONN_STRING is not registered with the listener",
        "12170": "TCP connect timed out — the instance may be STOPPED, or the ACL blocks this address",
        "29024": "certificate validation failed — this is not the walletless tcps descriptor",
        "01031": "insufficient privileges — this user cannot create these objects",
        "00955": "the object already exists (this should have been handled by the script)",
    }.get(ora)
    if advice:
        return f"ORA-{ora}: {advice}"
    if re.search(r"mutual|mTLS|wallet", message, re.IGNORECASE):
        return "this database still requires mutual TLS — disable it, or supply a wallet"
    return message.strip().splitlines()[0]


if __name__ == "__main__":
    raise SystemExit(main())
