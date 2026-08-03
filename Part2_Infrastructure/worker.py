#!/usr/bin/env python3
"""
Celery worker entrypoint.

    REDIS_URL=redis://localhost:6379/0 python worker.py

Only needed for the horizontally-scaled topology. With no broker configured the
gateway executes the same tasks in its own bounded thread pool.
"""

from __future__ import annotations

import sys

from config import settings


def main() -> int:
    if not settings.celery_broker_url:
        print(
            "No CELERY_BROKER_URL / REDIS_URL configured.\n"
            "The gateway will run backtests in its in-process worker pool — no worker needed.\n"
            "To use Celery:  REDIS_URL=redis://localhost:6379/0 python worker.py",
            file=sys.stderr,
        )
        return 1

    from celery_tasks import celery_app

    print(f"AlphaEngine Trading Automation worker -> broker {settings.celery_broker_url}")
    celery_app.worker_main(["worker", "--loglevel=info", f"--concurrency={settings.job_workers}"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
