"""Data-plane checks: the two databases, market data, a real backtest, and the
embedding route the Oracle search depends on.

Split out of ``tools/e2e_smoke.py``. Unconfigured is reported as SKIP with the
reason, never as a pass and never as an empty result.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from tools.e2e_checks.transport import FAIL, GATEWAY, OK, SKIP, TIMEOUT, VERCEL, Result, fetch


def check_oracle() -> Result:
    """Reported through the app's own probe, so this is the panel's real state."""
    status, body, _ = fetch(f"{VERCEL}/api/system/health")
    if status != 200 or not isinstance(body, dict):
        return Result("oracle adb", FAIL, "health route unavailable")
    oracle = body.get("oracle") or {}
    if not oracle.get("configured"):
        return Result(
            "oracle adb", SKIP, "not configured in this deployment",
            fix="Set ORACLE_CONN_STRING and ORACLE_PASSWORD in Vercel.",
        )
    if oracle.get("ready"):
        return Result("oracle adb", OK, f"answered in {oracle.get('latencyMs')}ms")
    reason = oracle.get("reason") or "unknown"
    fixes = {
        "oracle_wallet_invalid":
            "This database requires mutual TLS. Set ORACLE_WALLET_PEM_B64 (base64 of ewallet.pem) "
            "and ORACLE_WALLET_PASSWORD in Vercel, or give the database a network ACL and turn mTLS off.",
        "oracle_service_unknown":
            "The listener answered but has no such service. Compare the service name in "
            "ORACLE_CONN_STRING with the console's connection strings.",
        "oracle_timeout":
            "The probe exceeded its budget. Usually mutual TLS or a wrong service name underneath — "
            "run `gh workflow run 'Keep Oracle ADB awake'` for the precise ORA code.",
        "oracle_auth_failed": "Wrong ORACLE_PASSWORD, or the account is locked or expired.",
        "oracle_schema_missing":
            "Connected, but the objects are absent. Run the 'Apply database schema' workflow.",
    }
    return Result("oracle adb", FAIL, f"configured but not ready: {reason}", fix=fixes.get(reason, ""))


def check_supabase() -> Result:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        return Result("supabase rls", SKIP, "SUPABASE_URL / anon key not in this environment")
    request = urllib.request.Request(f"{url.rstrip('/')}/rest/v1/desk_risk_limits?select=id&limit=1")
    request.add_header("apikey", key)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
    except Exception as error:  # noqa: BLE001
        return Result("supabase rls", FAIL, str(error))
    if status == 200:
        return Result(
            "supabase rls", FAIL, "anon can read desk_risk_limits",
            fix="The REVOKE was lost. Publishing where the gates sit tells anyone how to size an order that passes them.",
        )
    if status in (401, 403, 404):
        return Result("supabase rls", OK, f"anon correctly denied ({status})")
    return Result("supabase rls", FAIL, f"unexpected status {status}")


def check_supabase_mirror(token: str | None) -> Result:
    """The gateway's durable decision mirror, through its secret-free counters."""
    if not token:
        return Result("supabase decision mirror", SKIP, "needs the gateway token")
    status, body, ms = fetch(f"{GATEWAY}/api/ops/snapshot", token=token)
    if status != 200 or not isinstance(body, dict):
        return Result(
            "supabase decision mirror",
            FAIL,
            f"operations snapshot answered HTTP {status}",
            fix="The authenticated operations snapshot must answer before mirror readiness can be verified.",
        )
    mirror = body.get("supabase")
    if not isinstance(mirror, dict) or not mirror.get("configured"):
        return Result(
            "supabase decision mirror",
            SKIP,
            "the gateway reports no configured Supabase mirror",
            fix="Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DESK_ID and "
            "SUPABASE_MIRROR_ENABLED=1 on the gateway.",
        )
    if not mirror.get("running"):
        return Result(
            "supabase decision mirror",
            FAIL,
            "configured but its drain task is not running",
            fix="Inspect gateway startup logs for `supabase mirror started`; one configured mirror needs one drain task.",
        )
    failed = int(mirror.get("failed") or 0)
    dropped = int(mirror.get("dropped") or 0)
    if failed or dropped:
        return Result(
            "supabase decision mirror",
            FAIL,
            f"running, but {failed} decision(s) failed and {dropped} were dropped",
            fix="Inspect the classified last_error_kind and reconcile the missing decision rows from the OCI ledger.",
        )
    return Result(
        "supabase decision mirror",
        OK,
        f"running · {int(mirror.get('written') or 0)} written · "
        f"{int(mirror.get('queued') or 0)} queued · {ms:.0f}ms",
        data={
            "written": int(mirror.get("written") or 0),
            "queued": int(mirror.get("queued") or 0),
        },
    )


def check_market_data() -> Result:
    """The backtester's own data path, through Vercel."""
    status, body, ms = fetch(f"{VERCEL}/api/ohlcv?symbol=BTCUSDT&interval=1h&bars=120")
    if status != 200 or not isinstance(body, dict):
        return Result("market data (ohlcv)", FAIL, f"HTTP {status}")
    bars = body.get("bars") or body.get("data") or []
    source = body.get("source") or body.get("provider") or "?"
    if not bars:
        return Result("market data (ohlcv)", FAIL, "no bars returned")
    synthetic = "synthetic" in json.dumps(body).lower()
    if synthetic:
        return Result(
            "market data (ohlcv)", FAIL, f"{len(bars)} bars but SYNTHETIC",
            fix="Binance was unreachable from the serverless region and a deterministic fallback was served. "
                "It is tagged as such, but it is not market data.",
        )
    return Result("market data (ohlcv)", OK, f"{len(bars)} real bars from {source} · {ms:.0f}ms")


def check_backtest() -> Result:
    """The money path: a real sweep through the deployed engine."""
    status, body, ms = fetch(
        f"{VERCEL}/api/backtest", method="POST",
        body={"symbol": "BTCUSDT", "interval": "1h", "bars": 800, "strategy": "ma_cross",
              "fastFrom": 5, "fastTo": 20, "fastStep": 5,
              "slowFrom": 30, "slowTo": 90, "slowStep": 30,
              "direction": "long_only", "feeBps": 6, "slippageBps": 2, "folds": 4},
    )
    if status != 200 or not isinstance(body, dict):
        return Result("backtest sweep", FAIL, f"HTTP {status}: {str(body)[:120]}")
    results = body.get("results") or []
    best = body.get("best") or {}
    if not results:
        return Result("backtest sweep", FAIL, "no combinations returned")
    return Result(
        "backtest sweep", OK,
        f"{len(results)} combos in {ms:.0f}ms · best Sharpe {best.get('sharpe', '?')}",
        data={"combos": len(results), "ms": round(ms)},
    )


def check_rag_embed(token: str | None) -> Result:
    """The route whose absence made Oracle RAG return embed_failed forever."""
    if not token:
        return Result("rag embed route", SKIP, "needs the gateway token")
    status, body, ms = fetch(
        f"{GATEWAY}/api/research/rag/embed", token=token, method="POST",
        body={"texts": ["donchian breakout drawdown"]},
    )
    if status != 200 or not isinstance(body, dict):
        return Result("rag embed route", FAIL, f"HTTP {status}", fix="Route added in main.py; is the image current?")
    state = body.get("state")
    if state == "unavailable":
        return Result(
            "rag embed route", SKIP, "route live, embedding service not configured",
            fix="Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and RESEARCH_RAG_ENABLED=1 on the gateway.",
        )
    vectors = body.get("embeddings") or []
    dims = len(vectors[0]) if vectors else 0
    if dims != 384:
        return Result(
            "rag embed route", FAIL, f"got {dims} dimensions, expected 384",
            fix="A dimension mismatch means the corpus and queries used different models — retrieval would rank nonsense.",
        )
    return Result("rag embed route", OK, f"{len(vectors)}x{dims}-dim vector in {ms:.0f}ms")


def check_rag_status(token: str | None) -> Result:
    """The live corpus writer, not merely an embedding function that answers once."""
    if not token:
        return Result("rag index drain", SKIP, "needs the gateway token")
    status, body, ms = fetch(f"{GATEWAY}/api/research/rag/status", token=token)
    if status != 200 or not isinstance(body, dict):
        return Result(
            "rag index drain", FAIL, f"HTTP {status}",
            fix="The authenticated RAG status route must answer before ingestion can be verified.",
        )
    if not body.get("configured"):
        return Result(
            "rag index drain", SKIP, "Supabase corpus ingestion is not configured",
            fix="Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DESK_ID and "
                "RESEARCH_RAG_ENABLED=1 on the gateway.",
        )
    if not body.get("running"):
        return Result(
            "rag index drain", FAIL, "configured but the drain task is not running",
            fix="Inspect gateway logs for `alphaengine.rag`; a configured index must have one live drain task.",
        )
    dropped = int(body.get("dropped") or 0)
    failed = int(body.get("failed") or 0)
    if dropped or failed:
        return Result(
            "rag index drain", FAIL,
            f"running, but {failed} document(s) failed and {dropped} were dropped",
            fix="Replay the RAG dead-letter/backfill input after fixing the reported Supabase or embed failure.",
        )
    return Result(
        "rag index drain", OK,
        f"running · {int(body.get('indexed') or 0)} indexed · "
        f"{int(body.get('queued') or 0)} queued · {ms:.0f}ms",
        data={
            "indexed": int(body.get("indexed") or 0),
            "queued": int(body.get("queued") or 0),
            "pending_embeddings": int(body.get("pending_embeddings") or 0),
        },
    )


def _read_model_reason(body: dict) -> str:
    read_model = body.get("read_model") or {}
    return str(read_model.get("reason") or "the Neo4j read model did not answer")


def check_graph_linkage(token: str | None) -> Result:
    """Prove Supabase edges were projected and read back from one Neo4j sweep.

    A successful corpus fallback is useful product behaviour, but it does not
    prove the optional projection works. This check therefore requires both
    whole-corpus reports to say ``source: neo4j`` and to agree on the sweep and
    graph population. It never writes or starts a sweep.
    """
    if not token:
        return Result("neo4j graph readback", SKIP, "needs the gateway token")

    responses: dict[str, dict] = {}
    for name in ("communities", "centrality"):
        status, body, _ = fetch(f"{GATEWAY}/api/research/graph/{name}", token=token)
        if status != 200 or not isinstance(body, dict):
            return Result(
                "neo4j graph readback", FAIL, f"{name} answered HTTP {status}",
                fix="Check the gateway graph route and Supabase/Neo4j connectivity before running the sweep.",
            )
        responses[name] = body

    communities = responses["communities"]
    centrality = responses["centrality"]
    if communities.get("source") != "neo4j" or centrality.get("source") != "neo4j":
        reasons = [_read_model_reason(communities), _read_model_reason(centrality)]
        detail = "; ".join(dict.fromkeys(reasons))
        optional = any(
            marker in detail
            for marker in ("NEO4J_URI", "neo4j driver is not installed", "requirements-graph.txt")
        )
        return Result(
            "neo4j graph readback", SKIP if optional else FAIL,
            f"served from the corpus fallback: {detail}",
            fix=(
                "Set NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD and NEO4J_DATABASE, install "
                "requirements-graph.txt, then let the graph and community schedules complete."
                if optional else
                "The graph is configured but its projection is absent, stale or mid-rebuild; inspect the "
                "research reconcile job and run one complete graph/community sweep."
            ),
        )

    detection = communities.get("detection") or {}
    ranking = centrality.get("ranking") or {}
    if not detection.get("detected") or not ranking.get("ranked"):
        return Result(
            "neo4j graph readback", FAIL, "Neo4j answered without a complete partition and ranking",
            fix="Run one complete whole-corpus community sweep; partial labels are refused by design.",
        )

    community_sweep = str(communities.get("sweep") or detection.get("sweep") or "")
    centrality_sweep = str(ranking.get("sweep") or "")
    community_documents = int(detection.get("documents") or 0)
    centrality_documents = int(ranking.get("documents") or 0)
    community_edges = int(detection.get("edges") or 0)
    centrality_edges = int(ranking.get("edges") or 0)
    if (
        not community_sweep
        or community_sweep != centrality_sweep
        or community_documents != centrality_documents
        or community_edges != centrality_edges
    ):
        return Result(
            "neo4j graph readback", FAIL,
            "community and centrality projections do not describe the same sweep/population",
            fix="Let one whole-corpus sweep write both label sets; never combine rows from two sweeps.",
        )

    return Result(
        "neo4j graph readback", OK,
        f"{community_documents} documents · {community_edges} edges · "
        f"{int(detection.get('community_count') or 0)} communities · sweep {community_sweep}",
        data={
            "documents": community_documents,
            "edges": community_edges,
            "communities": int(detection.get("community_count") or 0),
            "sweep": community_sweep,
        },
    )
