# AlphaEngine stateful gateway — the always-on half of the platform.
#
# Build from Part2_Infrastructure as the context (the repo-root compose file
# sets this):   docker build -f docker/gateway.Dockerfile .
#
# Decisions that are load-bearing, not stylistic:
#
#  * requirements-core.txt, not requirements.txt. vectorbt/numba adds hundreds
#    of megabytes and can fail to compile per-platform; the NumPy backtest
#    engine is the documented, tested degradation and /health reports which
#    engine is live. Opt back in with:
#      --build-arg REQUIREMENTS=requirements.txt
#
#  * ONE uvicorn process — no --workers, no gunicorn. The risk gateway holds a
#    mutable in-memory position book, a resting-order book, a token bucket and
#    the kill switch. A second worker would fork the book and make the halt
#    local to whichever process happened to serve the request.
#
#  * chown BEFORE USER. config.py calls settings.ensure_dirs() at import time;
#    if uid 10001 cannot create /app/data the process dies before FastAPI
#    starts — or silently degrades to a SQLite file it also cannot write.
#
#  * The health probe is stdlib urllib against the unauthenticated /health —
#    python:slim ships no curl, and installing one to run a probe grows the
#    runtime surface for no gain.
#
#  * Port 8000 is fixed in EXPOSE/HEALTHCHECK/CMD. The container's internal
#    port is an implementation detail; flexibility belongs on the host side of
#    the compose `ports:` mapping.

ARG REQUIREMENTS=requirements-core.txt

# ---- builder ---------------------------------------------------------------
FROM python:3.12-slim AS builder
ARG REQUIREMENTS
WORKDIR /build

COPY requirements-core.txt requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r "${REQUIREMENTS}"

# ---- runtime ---------------------------------------------------------------
FROM python:3.12-slim

WORKDIR /app
COPY --from=builder /install /usr/local

# templates/ is load-bearing: main.py constructs Jinja2Templates at import and
# the /app console renders from it. tools/ ships so the money-path smoke test
# (`python tools/synthetic_probe.py`) runs in-container.
COPY main.py config.py celery_tasks.py worker.py ./
COPY modules/ modules/
COPY templates/ templates/
COPY tools/ tools/

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin alphaengine \
    && mkdir -p /app/data \
    && chown -R 10001:10001 /app
USER 10001

ENV DATA_DIR=/app/data \
    DB_PATH=/app/data/alphaengine.duckdb \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4).status==200 else 1)"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
