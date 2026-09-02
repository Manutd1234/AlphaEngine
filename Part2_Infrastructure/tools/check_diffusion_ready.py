#!/usr/bin/env python3
"""Fail unless the running gateway can supply every Diffusion diagram input.

The container health check proves that the process is alive and its stores are
writable.  It does not prove that an older, empty data volume was restored from
the committed FOMC evidence.  The deployment runs this read-only canary after
startup and before promotion, using the token already present inside the
container.  No credential or response body is printed.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

from modules.coherence.diffusion.bootstrap import EXPECTED_COUNTS

ORIGIN = os.environ.get("ALPHAENGINE_GATEWAY_CANARY_URL", "http://127.0.0.1:8000").rstrip("/")
TIMEOUT_S = 15.0


class DiffusionReadinessError(RuntimeError):
    """A deployment-safe failure containing no payload or credential data."""


def _read(path: str) -> dict[str, Any]:
    token = os.environ.get("WEB_API_TOKEN", "").strip()
    if not token:
        raise DiffusionReadinessError("WEB_API_TOKEN is absent inside the gateway container")
    request = urllib.request.Request(
        f"{ORIGIN}{path}",
        headers={
            "Accept": "application/json",
            "X-AlphaEngine-Token": token,
            "X-AlphaEngine-Budget-Class": "H2",
            "X-AlphaEngine-Remaining-Budget-Ms": "12000",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            if response.status != 200:
                raise DiffusionReadinessError(f"{path} returned HTTP {response.status}")
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        raise DiffusionReadinessError(f"{path} returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise DiffusionReadinessError(f"{path} was unreachable ({type(exc).__name__})") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DiffusionReadinessError(f"{path} did not return JSON") from exc
    if not isinstance(payload, dict):
        raise DiffusionReadinessError(f"{path} returned a non-object payload")
    if payload.get("state") != "ok":
        raise DiffusionReadinessError(f"{path} reported state={payload.get('state')!r}")
    return payload


def readiness_report() -> dict[str, int | str]:
    events = _read("/api/research/diffusion/events?limit=200")
    absorption = _read("/api/research/diffusion/absorption?limit=500")
    findings = _read("/api/research/diffusion/findings")

    event_rows = events.get("events")
    run_rows = absorption.get("runs")
    finding_rows = findings.get("findings")
    if not isinstance(event_rows, list):
        raise DiffusionReadinessError("the event ledger has no events collection")
    if not isinstance(run_rows, list):
        raise DiffusionReadinessError("the absorption ledger has no runs collection")
    if not isinstance(finding_rows, list):
        raise DiffusionReadinessError("the findings read has no findings collection")

    expected_events = EXPECTED_COUNTS["diffusion_events"]
    expected_runs = EXPECTED_COUNTS["diffusion_runs"]
    if len(event_rows) < expected_events:
        raise DiffusionReadinessError(
            f"the event ledger contains {len(event_rows)} rows; expected at least {expected_events}"
        )
    if len(run_rows) < expected_runs:
        raise DiffusionReadinessError(
            f"the absorption ledger contains {len(run_rows)} runs; expected at least {expected_runs}"
        )
    if not absorption.get("horizons") or not absorption.get("release_curve") or not absorption.get("call_curve"):
        raise DiffusionReadinessError("the absorption curves have no drawable horizons")

    calendar = findings.get("calendar")
    calendar_total = int(calendar.get("of") or 0) if isinstance(calendar, dict) else 0
    assessable = sum(
        1
        for row in finding_rows
        if isinstance(row, dict) and int(row.get("n") or 0) > 0
    )
    if calendar_total < expected_events:
        raise DiffusionReadinessError(
            f"the findings calendar covers {calendar_total} events; expected at least {expected_events}"
        )
    if assessable == 0:
        raise DiffusionReadinessError("the findings read contains no measured relationship")

    study = findings.get("study")
    gate = findings.get("gate")
    if not isinstance(study, dict):
        raise DiffusionReadinessError("the information-spectrum study has not been built")
    if not isinstance(gate, dict) or gate.get("state") != "passed" \
            or gate.get("r_squared") is None:
        raise DiffusionReadinessError("the information-spectrum representation gate did not pass")
    skill_meetings = int(study.get("skill_meetings") or 0)
    if skill_meetings <= 0:
        raise DiffusionReadinessError("the information-spectrum study has no out-of-sample score")
    if any(study.get(field) is None for field in (
        "skill_baseline_r2", "skill_gain", "skill_shuffled_p", "skill_stage_minutes",
    )):
        raise DiffusionReadinessError("the information-spectrum score is incomplete")

    return {
        "backend": str(events.get("backend") or "unreported"),
        "events": len(event_rows),
        "runs": len(run_rows),
        "findings": len(finding_rows),
        "assessable_findings": assessable,
        "study": str(study.get("study_id") or "unreported"),
        "skill_meetings": skill_meetings,
    }


def main() -> int:
    try:
        report = readiness_report()
    except DiffusionReadinessError as exc:
        print(f"Diffusion readiness failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
