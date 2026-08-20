"""Sharpe, Sortino, drawdown, and the deflation that makes them arguable."""

from __future__ import annotations

import logging
import math

import numpy as np

log = logging.getLogger("alphaengine.backtest")

# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #
def _annualised_sharpe(returns: np.ndarray, ann: float) -> float:
    sd = returns.std(ddof=1)
    return float(returns.mean() / sd * math.sqrt(ann)) if sd > 0 else 0.0


def _sortino(returns: np.ndarray, ann: float) -> float:
    downside = returns[returns < 0]
    dd = downside.std(ddof=1) if downside.size > 1 else 0.0
    return float(returns.mean() / dd * math.sqrt(ann)) if dd > 0 else 0.0


def _max_drawdown(equity: np.ndarray) -> float:
    peak = np.maximum.accumulate(equity)
    return float(np.min(equity / peak - 1.0)) if peak.size else 0.0


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_ppf(p: float) -> float:
    """Acklam's inverse-normal approximation (|error| < 1.15e-9). Avoids a SciPy
    dependency on the critical DSR path."""
    p = min(max(p, 1e-12), 1 - 1e-12)
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)


def probabilistic_sharpe_ratio(sr: float, sr_benchmark: float, n: int, skew: float, kurt: float) -> float:
    """PSR — P(true SR > benchmark) given a finite, non-normal sample.

    ``sr``/``sr_benchmark`` are **per-observation** (not annualised) Sharpes.
    """
    if n < 3:
        return 0.0
    denom = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr**2))
    return _norm_cdf((sr - sr_benchmark) * math.sqrt(n - 1) / denom)


def deflated_sharpe_ratio(
    sr_candidates: np.ndarray, sr_selected: float, n_obs: int, skew: float, kurt: float
) -> tuple[float, float, float]:
    """DSR — PSR measured against the Sharpe a *random* search of the same size
    would have produced. Returns (dsr, psr_vs_zero, expected_max_sr).

    Bailey & López de Prado (2014), eq. 3 — the expected maximum of N trials
    **under the null that every trial's true Sharpe is zero**:

        SR*₀ = √V[{SRₙ}] · [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]

    Note the null drops the sample mean: the hurdle is generated entirely by the
    *dispersion* of the search, not by how well the search happened to do. Adding
    the mean back (a common implementation slip) makes the hurdle negative when a
    grid is uniformly unprofitable, which would let a losing strategy clear it.
    """
    n_trials = max(1, len(sr_candidates))
    sd = float(np.std(sr_candidates, ddof=1)) if n_trials > 1 else 0.0
    gamma = 0.5772156649015329  # Euler–Mascheroni

    if n_trials > 1 and sd > 0:
        expected_max = sd * (
            (1 - gamma) * _norm_ppf(1 - 1 / n_trials) + gamma * _norm_ppf(1 - 1 / (n_trials * math.e))
        )
    else:
        expected_max = 0.0

    dsr = probabilistic_sharpe_ratio(sr_selected, expected_max, n_obs, skew, kurt)
    psr0 = probabilistic_sharpe_ratio(sr_selected, 0.0, n_obs, skew, kurt)
    return dsr, psr0, expected_max


def min_track_record_length(
    sr: float, sr_benchmark: float, skew: float, kurt: float, confidence: float = 0.95
) -> float:
    """MinTRL — the observation count at which PSR(benchmark) reaches ``confidence``.

    Bailey & López de Prado:  N* = 1 + (1 − γ₃·S + (γ₄−1)/4·S²)·(Z_conf/(S−S*))²

    The exact inverse of :func:`probabilistic_sharpe_ratio` solved for n, using
    the same per-observation Sharpe convention, raw kurtosis (normal = 3) and
    the same 1e-12 variance clamp. Returns ``inf`` when ``sr <= sr_benchmark``:
    no finite record can prove an edge that is not there. Mirrored in the
    portal's ``lib/stats.ts``.
    """
    if sr <= sr_benchmark:
        return math.inf
    z = _norm_ppf(confidence)
    var_term = max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr**2)
    return 1 + var_term * (z / (sr - sr_benchmark)) ** 2


def dsr_verdict(dsr: float) -> str:
    if dsr >= 0.95:
        return "PASS — selected parameters survive the multiple-testing penalty (DSR ≥ 0.95)."
    if dsr >= 0.80:
        return "MARGINAL — edge is plausible but not established; needs more data or fewer trials."
    return "FAIL — the winning Sharpe is consistent with selection bias over this grid. Do not allocate."
