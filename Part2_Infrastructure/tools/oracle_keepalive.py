#!/usr/bin/env python3
"""Keep the Autonomous Database reachable, and say so when it is not.

    python tools/oracle_keepalive.py

An **Always Free** ADB stops itself after 7 consecutive days with no
connections and is reclaimed entirely after ~90. A **paid** ADB does not: it
stays up until something stops it. Which tier this deployment uses is not
visible from a connection, so this job does not assume one — connecting daily
is harmless on a paid instance and is the only thing that prevents the stop on
a free one.

A stopped instance does not refuse connections in a way that reads as
"stopped" — the listener simply stops registering the service, so every client
gets

    ORA-12514: the service name in ORACLE_CONN_STRING is not registered

which is the same error a typo in the descriptor produces. That ambiguity is
why this exists as its own scheduled job rather than as a line in the health
route: the fix for "stopped" is one click in the OCI console and the fix for
"typo" is a secret change, and a probe that cannot tell them apart sends you
looking in the wrong place.

Connecting is the whole mechanism. Any successful session resets the idle
timer, so a single `SELECT 1 FROM DUAL` a day is enough to keep the instance
up indefinitely.

Exit codes: 0 reachable (timer reset), 1 configured but unreachable, 2 not
configured. Reads the same ORACLE_* variables as the app, so a pass here means
the app's path works too.
"""

from __future__ import annotations

import os
import sys
import time

# The ORA-code taxonomy is deliberately shared with the schema applier rather
# than restated. Two tools that disagree about what ORA-12514 means is how an
# operator ends up rotating a password to fix a stopped instance.
from apply_oracle_schema import _advise


def _shred(wallet_dir: str | None) -> None:
    """Remove the decoded key material.

    The runner is ephemeral, so this is belt and braces — but a private key
    written to disk should be removed by whatever wrote it, not left to the
    platform's cleanup, which is a promise this code cannot verify.
    """
    if not wallet_dir:
        return
    import shutil

    shutil.rmtree(wallet_dir, ignore_errors=True)


def main() -> int:
    connect_string = (os.environ.get("ORACLE_CONN_STRING") or "").strip()
    password = os.environ.get("ORACLE_PASSWORD") or ""
    user = (os.environ.get("ORACLE_USER") or "ADMIN").strip()

    if not connect_string or not password:
        print("ORACLE_CONN_STRING / ORACLE_PASSWORD absent — nothing contacted.")
        return 2

    try:
        import oracledb
    except ImportError:
        print("python-oracledb is not installed:  pip install oracledb", file=sys.stderr)
        return 1

    # Mutual TLS, when the database demands it. An ADB permits walletless TLS
    # only once it has a network ACL or a private endpoint; with "secure access
    # from everywhere" Oracle requires mTLS, and then the wallet is the only way
    # in. Thin mode reads `ewallet.pem` alone, so the secret is one base64 blob
    # rather than the whole downloaded zip.
    wallet_kwargs: dict[str, str] = {}
    wallet_dir: str | None = None
    wallet_b64 = (os.environ.get("ORACLE_WALLET_PEM_B64") or "").strip()
    if wallet_b64:
        import base64
        import tempfile

        try:
            pem = base64.b64decode(wallet_b64, validate=True).decode("utf-8")
        except Exception:
            print("ORACLE_WALLET_PEM_B64 is not valid base64.", file=sys.stderr)
            return 1
        if "-----BEGIN" not in pem:
            print("ORACLE_WALLET_PEM_B64 does not decode to a PEM.", file=sys.stderr)
            return 1
        # mkdtemp is 0700 by definition; the key inside it is written 0600.
        wallet_dir = tempfile.mkdtemp(prefix="alphaengine-wallet-")
        pem_path = os.path.join(wallet_dir, "ewallet.pem")
        with open(os.open(pem_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as handle:
            handle.write(pem)
        wallet_kwargs["wallet_location"] = wallet_dir
        wallet_password = os.environ.get("ORACLE_WALLET_PASSWORD")
        if wallet_password:
            wallet_kwargs["wallet_password"] = wallet_password

    print(f"python-oracledb {oracledb.__version__}, thin mode: {oracledb.is_thin_mode()}")
    print(f"Connecting as {user}{' with a wallet (mTLS)' if wallet_kwargs else ' walletless'}\n")

    started = time.perf_counter()
    try:
        connection = oracledb.connect(
            user=user, password=password, dsn=connect_string, **wallet_kwargs
        )
    except Exception as error:  # noqa: BLE001 — the taxonomy is the whole point
        advice = _advise(error)
        print(f"unreachable — {advice}", file=sys.stderr)
        # ORA-12514/12506 from an instance that used to work is almost always a
        # stopped instance rather than a bad descriptor, and the console is the
        # only place it can be restarted. Say so instead of leaving the reader
        # to infer it from an error code.
        if "not registered with the listener" in advice:
            print(
                "\nThe instance is stopped, or the descriptor names a service that does not\n"
                "exist. Stopped is far likelier if this ever worked: an Always Free ADB stops\n"
                "itself after 7 idle days, and any ADB can be stopped by hand.\n"
                "\n"
                "Start it in the OCI console — Autonomous Database → your instance → Start —\n"
                "and this job keeps it up from then on. If it is already showing as AVAILABLE\n"
                "there, then the service name in ORACLE_CONN_STRING is the thing to check,\n"
                "not the password: authentication is never reached when the listener has no\n"
                "such service to hand the connection to.",
                file=sys.stderr,
            )
        _shred(wallet_dir)
        return 1

    with connection:
        cursor = connection.cursor()
        cursor.execute("SELECT 1 FROM DUAL")
        cursor.fetchone()
    elapsed_ms = (time.perf_counter() - started) * 1000
    _shred(wallet_dir)

    print(f"reachable — SELECT 1 answered in {elapsed_ms:.0f}ms; the idle timer is reset.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
