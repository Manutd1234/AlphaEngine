"""Freeze the diffusion estimator's answers, so the browser twin can be held to them.

The gateway's maths exists twice — Python for the server, TypeScript for the
browser, because neither runtime can call the other — and CLAUDE.md's rule is
that **Python is the reference**. The desk already holds four fixtures of this
shape (`gate-parity.json`, `mc-resampler-parity.json`, `bars-contract-parity.json`,
`risk-parity.json`); this is the fifth, and it exists because the Diffusion tab
is about to compute half-lives and information spectra in the browser.

What is frozen is chosen by one rule: every case is either a value the reader
will see, or a REFUSAL the estimator has to make in the same words on both
sides. A twin that agrees on the numbers and disagrees on when to say "not
resolved" is a twin that lies at exactly the moment honesty matters.

Regenerate deliberately — `python tools/export_diffusion_parity.py` — and never
loosen the tolerance in the suite instead. A moved formula should fail the other
language; that is the whole design.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Run as a script from anywhere, the way `tools/bench_core_ticks.py` does: the
# gateway package lives one directory up and is not installed.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from modules.coherence.diffusion import decay, gaussian
from modules.coherence.diffusion.sampler import sigmoid

OUT = Path(__file__).resolve().parents[1] / "web" / "tests" / "fixtures" / "diffusion-parity.json"

#: The v2 horizon grid, in seconds. Roughly geometric, which is why the
#: half-life is interpolated in LOG x — a linear reading between 15m and 30m
#: would place a crossing at the arithmetic midpoint of a cell that spans a
#: doubling.
GRID = [60.0, 120.0, 300.0, 600.0, 900.0, 1800.0]


def _half_life_cases() -> list[dict]:
    """One case per state the crossing can be in, plus the tie."""
    cases = [
        ("ok, interpolated between two grid points", GRID, [0.10, 0.30, 0.55, 0.70, 0.85, 1.00]),
        ("ok, an overshoot that comes back is not clipped", GRID, [0.20, 0.60, 1.30, 0.90, 0.95, 1.00]),
        ("at_or_before_first: already past the level at the first horizon", GRID,
         [0.60, 0.70, 0.80, 0.90, 0.95, 1.00]),
        ("never_reached: the path never got to half inside the window", GRID,
         [0.01, 0.05, 0.10, 0.20, 0.30, 0.40]),
        ("too_few_points: one measured horizon is not a curve", [600.0], [0.80]),
        ("a flat pair across the crossing takes the later horizon", GRID,
         [0.10, 0.20, 0.50, 0.50, 0.80, 1.00]),
    ]
    out = []
    for name, xs, absorbed in cases:
        result = decay.half_life(np.array(xs, dtype=float), np.array(absorbed, dtype=float))
        out.append({
            "name": name,
            "x": xs,
            "absorbed": absorbed,
            "expect": {
                "state": result.state,
                "value": result.value,
                "lower": result.lower,
                "upper": result.upper,
            },
        })
    return out


def _fit_cases() -> list[dict]:
    """The two parametric fits, which are reported and are never the verdict."""
    cases = [
        ("a clean exponential decay", GRID, [0.20, 0.36, 0.63, 0.86, 0.95, 0.99]),
        ("a slow decay that leaves an asymptote", GRID, [0.10, 0.18, 0.32, 0.45, 0.52, 0.60]),
        ("fewer than three horizons refuses both fits", [60.0, 120.0], [0.30, 0.60]),
    ]
    out = []
    for name, xs, absorbed in cases:
        seconds = np.array(xs, dtype=float)
        values = np.array(absorbed, dtype=float)
        exponential = decay.fit_exponential(seconds, values)
        power = decay.fit_power(seconds, values)
        out.append({
            "name": name,
            "seconds": xs,
            "absorbed": absorbed,
            "expect": {
                "exponential": {
                    "model": exponential.model,
                    "half_life": exponential.half_life,
                    "terminal_unpriced_fraction": exponential.terminal_unpriced_fraction,
                    "sse": exponential.sse,
                    "n_points": exponential.n_points,
                    "overshoot_points": exponential.overshoot_points,
                },
                "power": {
                    "model": power.model,
                    "half_life": power.half_life,
                    "sse": power.sse,
                    "n_points": power.n_points,
                    "overshoot_points": power.overshoot_points,
                },
            },
        })
    return out


def _spectrum_cases() -> list[dict]:
    """The closed-form Gaussian information spectrum, and its exact integral.

    `g(a) = 1/2 sum_i [sigmoid(a + log l_i) - sigmoid(a + log m_i)]`, whose
    integral over the whole log-SNR axis is `1/2 sum_i (log l_i - log m_i)` and
    is exactly `I(x;c)`. That identity is what makes the browser able to draw
    this with no torch, no network and no training — and it is the thing a twin
    could silently get wrong by whitening, which sends every `log l_i` to zero
    and collapses the spectrum to one bump at a = 0.
    """
    alphas = [-6.0, -3.0, -1.0, 0.0, 1.0, 3.0, 6.0]
    cases = [
        ("a spectrum with mass at coarse resolution", [1.6, 0.4, -0.9], [0.7, -0.1, -1.2]),
        ("a spectrum with mass at fine resolution", [2.2, 1.1, 0.3], [2.0, 0.6, -0.8]),
        ("no conditioning information: the spectrum is flat zero", [1.0, 0.2], [1.0, 0.2]),
    ]
    out = []
    for name, log_lambda, log_mu in cases:
        unconditional = gaussian.GaussianRef(
            mean=np.zeros(len(log_lambda)), covariance=np.eye(len(log_lambda)),
            log_eigs=np.array(log_lambda, dtype=float), samples=1000,
        )
        conditional = gaussian.GaussianRef(
            mean=np.zeros(len(log_mu)), covariance=np.eye(len(log_mu)),
            log_eigs=np.array(log_mu, dtype=float), samples=1000,
        )
        grid = np.array(alphas, dtype=float)
        out.append({
            "name": name,
            "alpha": alphas,
            "log_lambda": log_lambda,
            "log_mu": log_mu,
            "expect": {
                "mmse_unconditional": [float(v) for v in unconditional.mmse(grid)],
                "density": [float(v) for v in gaussian.gaussian_spectrum(grid, unconditional, conditional)],
                "information_nats": gaussian.gaussian_information(unconditional, conditional),
                "entropy_nats": unconditional.entropy_nats,
                "sigmoid": [float(sigmoid(a)) for a in alphas],
            },
        })
    return out


def build() -> dict:
    return {
        "note": "Python is the reference. Regenerate with tools/export_diffusion_parity.py; "
                "never loosen the suite's tolerance instead.",
        "half_life": _half_life_cases(),
        "fits": _fit_cases(),
        "spectrum": _spectrum_cases(),
    }


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=2) + "\n")
    print(f"wrote {OUT.relative_to(Path(__file__).resolve().parents[2])}")
