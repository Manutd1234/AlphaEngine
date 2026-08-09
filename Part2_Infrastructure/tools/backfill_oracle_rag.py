#!/usr/bin/env python3
"""Populate the Oracle research corpus from the desk's own backtest history.

    python tools/backfill_oracle_rag.py [--limit 200] [--dry-run]

WHY THIS EXISTS

`strategy_research_rag` had a CREATE TABLE, a GRANT and a read query, and
nothing anywhere in the repository ever wrote a row to it. The Oracle vector
search was therefore complete, correct and permanently empty — it answered
every query with "nothing similar is recorded", which is a sentence the UI
renders honestly and which nobody investigates.

WHY IT RUNS HERE RATHER THAN IN THE GATEWAY

The gateway is Python and deliberately carries no Oracle client — `deploy.yml`
says so, and adding one would put a database driver, credentials and a wallet
into the container that places orders. So this reads the history over the
gateway's own audit API and writes to Oracle from outside, which is also the
one place Oracle connectivity is already proven (the keepalive job).

THE TEXT MUST MATCH SUPABASE'S EXACTLY

`render_backtest_card` is imported, never re-implemented. Two corpora built
from differently-worded cards are not comparable even when both are correct:
the same run would land in a different place in each vector space, and the
"which backend found better neighbours" question the two-backend design exists
to answer would be measuring the wording instead.

Embeddings come from the gateway's `/api/research/rag/embed`, which is the same
gte-small session that embedded the Supabase corpus. A vector from any other
model is not comparable to the ones already indexed — it returns confident
neighbours that mean nothing.

Re-runnable: MERGE on (kind, source_ref), the table's own unique key. A row
that could not be embedded is stored `embedding_status='pending'` with a NULL
vector, never a zero vector — a zero vector is equidistant from every query and
would surface as "similar" to anything asked.

Exit codes: 0 wrote or had nothing to write, 1 a failure, 2 not configured.
"""

from __future__ import annotations

import argparse
import array
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.research_rag import (  # noqa: E402
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    render_backtest_card,
)

MERGE_SQL = """
MERGE INTO strategy_research_rag t
USING (SELECT :kind AS kind, :source_ref AS source_ref FROM dual) s
   ON (t.kind = s.kind AND t.source_ref = s.source_ref)
 WHEN MATCHED THEN UPDATE SET
      t.title = :title, t.body = :body, t.metrics = :metrics,
      t.strategy_name = :strategy_name, t.symbol = :symbol,
      t.embedding = :embedding, t.embedding_status = :embedding_status
 WHEN NOT MATCHED THEN INSERT
      (kind, source_ref, strategy_name, symbol, title, body, metrics,
       embedding, embedding_status, occurred_at)
      VALUES (:kind, :source_ref, :strategy_name, :symbol, :title, :body,
              :metrics, :embedding, :embedding_status, SYSTIMESTAMP)
"""


def gateway_get(path: str, token: str, base: str) -> list[dict]:
    request = urllib.request.Request(f"{base.rstrip('/')}{path}")
    request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def gateway_embed(texts: list[str], token: str, base: str) -> list[list[float]] | None:
    """One call for the whole batch — the route accepts up to 32."""
    payload = json.dumps({"texts": texts}).encode()
    request = urllib.request.Request(f"{base.rstrip('/')}/api/research/rag/embed", data=payload)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        print(f"  embed failed: HTTP {error.code}", file=sys.stderr)
        return None
    if body.get("state") != "ok":
        print(f"  embed unavailable: {body.get('state')}", file=sys.stderr)
        return None
    vectors = body.get("embeddings") or []
    if len(vectors) != len(texts):
        print("  embed returned a different number of vectors than texts", file=sys.stderr)
        return None
    return vectors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=200, help="most recent backtests to index")
    parser.add_argument("--dry-run", action="store_true", help="render the cards, contact no database")
    args = parser.parse_args()

    gateway_url = (os.environ.get("ALPHAENGINE_GATEWAY_URL") or "").strip()
    gateway_token = (os.environ.get("WEB_API_TOKEN") or "").strip()
    if not gateway_url or not gateway_token:
        print("ALPHAENGINE_GATEWAY_URL and WEB_API_TOKEN must be set.", file=sys.stderr)
        return 2

    try:
        rows = gateway_get(f"/api/audit/backtests?limit={args.limit}", gateway_token, gateway_url)
    except Exception as error:  # noqa: BLE001
        print(f"could not read the audit history: {error}", file=sys.stderr)
        return 1
    print(f"{len(rows)} backtest run(s) in the gateway's audit log")
    if not rows:
        print("Nothing to index.")
        return 0

    documents = []
    for row in rows:
        title, body = render_backtest_card(row)
        source_ref = str(row.get("job_id") or row.get("ts") or "")
        if not source_ref:
            continue
        documents.append({
            "kind": "backtest_run",
            "source_ref": source_ref,
            "strategy_name": (row.get("strategy") or None),
            "symbol": (row.get("symbol") or None),
            "title": title,
            "body": body,
            "metrics": json.dumps({
                k: row.get(k)
                for k in ("sharpe", "total_return", "max_drawdown", "dsr", "oos_sharpe", "pbo")
                if row.get(k) is not None
            }),
        })

    if args.dry_run:
        for doc in documents[:5]:
            print(f"  · {doc['source_ref']}  {doc['title']}")
        print(f"\n{len(documents)} document(s) would be indexed. Nothing was contacted.")
        return 0

    connect_string = (os.environ.get("ORACLE_CONN_STRING") or "").strip()
    password = os.environ.get("ORACLE_PASSWORD") or ""
    if not connect_string or not password:
        print("ORACLE_CONN_STRING / ORACLE_PASSWORD absent — nothing written.", file=sys.stderr)
        return 2

    try:
        import oracledb
    except ImportError:
        print("python-oracledb is not installed:  pip install oracledb", file=sys.stderr)
        return 1

    # Same wallet handling as the keepalive: an ADB permits walletless TLS only
    # once it has a network ACL, so mutual TLS is the common case.
    wallet_kwargs: dict[str, str] = {}
    wallet_dir: str | None = None
    wallet_b64 = (os.environ.get("ORACLE_WALLET_PEM_B64") or "").strip()
    if wallet_b64:
        import base64
        import tempfile

        pem = base64.b64decode(wallet_b64, validate=True).decode("utf-8")
        wallet_dir = tempfile.mkdtemp(prefix="alphaengine-wallet-")
        with open(os.open(os.path.join(wallet_dir, "ewallet.pem"),
                          os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as handle:
            handle.write(pem)
        wallet_kwargs["wallet_location"] = wallet_dir
        if os.environ.get("ORACLE_WALLET_PASSWORD"):
            wallet_kwargs["wallet_password"] = os.environ["ORACLE_WALLET_PASSWORD"]

    indexed = pending = 0
    try:
        connection = oracledb.connect(
            user=(os.environ.get("ORACLE_USER") or "ADMIN").strip(),
            password=password, dsn=connect_string, **wallet_kwargs,
        )
        with connection:
            cursor = connection.cursor()
            # Batched through the embed route in groups of 32 — its own limit,
            # and the difference between one round trip and two hundred.
            for start in range(0, len(documents), 32):
                batch = documents[start:start + 32]
                vectors = gateway_embed([d["body"] for d in batch], gateway_token, gateway_url)
                for offset, doc in enumerate(batch):
                    vector = vectors[offset] if vectors else None
                    if vector is not None and len(vector) != EMBEDDING_DIMENSIONS:
                        vector = None
                    cursor.execute(MERGE_SQL, {
                        **doc,
                        # FLOAT32 to match VECTOR(384, FLOAT32); a Python float
                        # is a double and the driver would have to narrow it.
                        "embedding": array.array("f", vector) if vector else None,
                        "embedding_status": "ready" if vector else "pending",
                    })
                    if vector:
                        indexed += 1
                    else:
                        pending += 1
            connection.commit()
    except Exception as error:  # noqa: BLE001
        print(f"write failed: {error}", file=sys.stderr)
        return 1
    finally:
        if wallet_dir:
            import shutil

            shutil.rmtree(wallet_dir, ignore_errors=True)

    print(f"\nindexed {indexed} with a {EMBEDDING_MODEL} vector, {pending} left pending.")
    if pending:
        print("Pending rows have a NULL vector and are excluded from search until re-run —")
        print("never a zero vector, which would rank as 'similar' to every query.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
