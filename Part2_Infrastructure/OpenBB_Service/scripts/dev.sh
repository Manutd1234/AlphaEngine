#!/usr/bin/env bash
#
# Bootstrap and run the research service locally, from nothing.
#
# The previous round recorded this service's blocker as "no checked-in
# environment": `requirements.txt` pinned five packages and nothing in the tree
# turned them into a running process, so every route was unverified and the raw
# fixture was uncapturable. Worse, `pytest` was green throughout — the suite
# replaces the provider fetchers with fakes, so it passes in an environment that
# cannot serve a single real quote. This script is the missing half.
#
# Idempotent: run it again and it reuses the virtualenv it made.
#
#   ./scripts/dev.sh          # 127.0.0.1:8010 — the port both READMEs name
#   ./scripts/dev.sh 8011     # elsewhere, when 8010 is taken
#
# 8010 is not arbitrary and it is not the OpenBB documentation's 6900. That
# default belongs to the `openbb-api` CLI, which builds an OpenBB Workspace
# backend out of a FastAPI app; this service is not a Workspace backend, and the
# CLI is not installed here on purpose (see README, "The openbb-api CLI").
#
# `python3.12` by name rather than `python3`: pyproject requires >=3.12,<3.15,
# and 3.12 is what the repository's root venv, the CI matrix and the Vercel
# runtime all use. A local process on a different interpreter tests a build
# nobody ships.
set -euo pipefail

PORT="${1:-8010}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${HERE}/.venv"

# uvicorn resolves `app:app` from the working directory, and pytest reads its
# `testpaths` from the pyproject beside it.
cd "${HERE}"

if [ ! -x "${VENV}/bin/python" ]; then
  echo "==> creating ${VENV} (python3.12)"
  python3.12 -m venv "${VENV}"
  "${VENV}/bin/python" -m pip install --quiet --upgrade pip
fi

echo "==> installing pinned requirements"
"${VENV}/bin/python" -m pip install --quiet -r requirements-dev.txt

echo "==> offline suite"
"${VENV}/bin/python" -m pytest

echo "==> serving on http://127.0.0.1:${PORT}"
echo "    smoke it from another shell:"
echo "    ${VENV}/bin/python ${HERE}/scripts/smoke.py http://127.0.0.1:${PORT}"
exec "${VENV}/bin/python" -m uvicorn app:app --host 127.0.0.1 --port "${PORT}"
