"""The append-only table set, and nothing else.

Every statement here is ``CREATE ... IF NOT EXISTS``. The columns added after
the first databases existed are widened by ``AuditStore._migrate`` instead,
which is where the reasoning about back-filling lives — a column added to this
list would be created on a fresh database and missing on every existing one.
"""

from __future__ import annotations

_DDL = [
    """
    CREATE TABLE IF NOT EXISTS orders (
        ts              TIMESTAMP,
        order_id        VARCHAR,
        client_order_id VARCHAR,
        strategy        VARCHAR,
        symbol          VARCHAR,
        side            VARCHAR,
        order_type      VARCHAR,
        quantity        DOUBLE,
        notional        DOUBLE,
        limit_price     DOUBLE,
        accepted        BOOLEAN,
        rejected_by     VARCHAR,
        reason          VARCHAR,
        latency_ms      DOUBLE,
        fill_price      DOUBLE,
        fill_qty        DOUBLE,
        fee_usd         DOUBLE,
        slippage_bps    DOUBLE,
        venue           VARCHAR,
        checks_json     VARCHAR,
        source          VARCHAR,
        status          VARCHAR,
        time_in_force   VARCHAR,
        decided_at      TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS order_events (
        ts              TIMESTAMP,
        order_id        VARCHAR,
        client_order_id VARCHAR,
        event           VARCHAR,
        status          VARCHAR,
        symbol          VARCHAR,
        side            VARCHAR,
        order_type      VARCHAR,
        time_in_force   VARCHAR,
        quantity        DOUBLE,
        limit_price     DOUBLE,
        notional        DOUBLE,
        fill_price      DOUBLE,
        fill_qty        DOUBLE,
        fee_usd         DOUBLE,
        venue           VARCHAR,
        actor           VARCHAR,
        detail          VARCHAR,
        replaces        VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS risk_events (
        ts        TIMESTAMP,
        event     VARCHAR,
        severity  VARCHAR,
        actor     VARCHAR,
        symbol    VARCHAR,
        detail    VARCHAR,
        payload   VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tca_snapshots (
        ts             TIMESTAMP,
        symbol         VARCHAR,
        venue          VARCHAR,
        best_bid       DOUBLE,
        best_ask       DOUBLE,
        mid            DOUBLE,
        spread_bps     DOUBLE,
        depth_usd_bid  DOUBLE,
        depth_usd_ask  DOUBLE,
        probe_notional DOUBLE,
        buy_slip_bps   DOUBLE,
        sell_slip_bps  DOUBLE,
        synthetic      BOOLEAN
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS backtest_runs (
        ts            TIMESTAMP,
        job_id        VARCHAR,
        symbol        VARCHAR,
        interval      VARCHAR,
        strategy      VARCHAR,
        engine        VARCHAR,
        combos_tested INTEGER,
        best_fast     INTEGER,
        best_slow     INTEGER,
        sharpe        DOUBLE,
        total_return  DOUBLE,
        max_drawdown  DOUBLE,
        dsr           DOUBLE,
        oos_sharpe    DOUBLE,
        duration_s    DOUBLE,
        request_json  VARCHAR,
        data_hash     VARCHAR,
        label         VARCHAR,
        pbo           DOUBLE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS equity_snapshots (
        ts               TIMESTAMP,
        session_date     VARCHAR,
        equity           DOUBLE,
        start_of_day     DOUBLE,
        realized_pnl     DOUBLE,
        unrealized_pnl   DOUBLE,
        daily_pnl        DOUBLE,
        gross_exposure   DOUBLE,
        drawdown_pct     DOUBLE,
        open_positions   INTEGER,
        kill_switch      BOOLEAN
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS jobs (
        job_id       VARCHAR,
        kind         VARCHAR,
        status       VARCHAR,
        submitted_at TIMESTAMP,
        finished_at  TIMESTAMP,
        backend      VARCHAR,
        error        VARCHAR
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_jobs_job_id ON jobs(job_id)",
    """
    CREATE TABLE IF NOT EXISTS subscribers (
        chat_id       VARCHAR,
        username      VARCHAR,
        subscribed_at TIMESTAMP,
        alerts        BOOLEAN,
        watches       VARCHAR,
        user_id       VARCHAR,
        web_identity  VARCHAR,
        linked_at     TIMESTAMP,
        role          VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS telegram_link_tokens (
        token_hash  VARCHAR,
        redeemed_at TIMESTAMP,
        expires_at  TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS ohlcv_cache (
        symbol   VARCHAR,
        interval VARCHAR,
        ts       TIMESTAMP,
        open     DOUBLE,
        high     DOUBLE,
        low      DOUBLE,
        close    DOUBLE,
        volume   DOUBLE
    )
    """,
]

