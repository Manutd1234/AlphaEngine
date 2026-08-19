"""Build the native pre-trade decision core into ``modules/_decision_core``.

    venv/bin/python native/decision_core/setup.py build_ext --inplace \
        --build-temp build/native

Produces ``modules/_decision_core.<abi>.so`` next to the Python reference. The
extension is build-time only: ``requirements-native.txt`` (setuptools, pybind11)
is not part of ``requirements-core.txt``, so the runtime image never carries a
compiler and the loader falls back to the Python engine when the .so is absent.

``-ffp-contract=off`` is not optional here. It forbids the compiler fusing a
multiply-add into one rounding step; the core's whole reason to exist is to
reproduce the Python reference's float sequence to the bit, and an FMA would
round once where CPython rounds twice.
"""

from __future__ import annotations

from pathlib import Path

from pybind11.setup_helpers import Pybind11Extension, build_ext
from setuptools import setup

HERE = Path(__file__).resolve().parent

ext_modules = [
    Pybind11Extension(
        "modules._decision_core",
        [str(HERE / "decision_core.cpp")],
        cxx_std=17,
        # -O3, not -O2: this is a tight numeric kernel whose whole job is the
        # arithmetic, and -O3's extra inlining and unrolling is exactly the
        # class of optimisation it can use. It does NOT imply -ffast-math —
        # that would be a parity break, and the flag below forbids the one
        # transformation that would cause it either way.
        #
        # -ffp-contract=off is not optional. It forbids fusing a multiply-add
        # into one rounding step; the core exists to reproduce CPython's float
        # sequence to the bit, and an FMA rounds once where CPython rounds
        # twice. It is repeated as a #pragma in the translation unit too.
        #
        # NOT here, deliberately: -march=native. The Docker builder stage and
        # a developer's Mac must emit the same floats, and a build tuned to
        # whatever CPU happened to compile it cannot promise that.
        # -O3, not -O2. Measured, and the honest result is that it changes
        # nothing this harness can see: interleaved A/B over three rounds
        # (5 runs each, alternating builds to cancel machine drift) gave
        # decision p50 15.46/15.67/15.67 µs at -O2 against 15.54/15.67/15.67
        # at -O3, and p99 22.88/22.42/22.67 against 22.46/22.42/22.38. It is
        # kept because it is the right level for a numeric kernel and the
        # parity suite proves it costs nothing (864 pass, bit-for-bit), not
        # because it made the desk faster. It did not. The time is not here.
        #
        # -flto was tried in the same A/B and dropped: no measurable gain
        # either, and it changes the link path in the Docker builder stage
        # for nothing. A build-system change with no return is not free.
        #
        # -ffp-contract=off is not optional. It forbids fusing a multiply-add
        # into one rounding step; this core exists to reproduce CPython's
        # float sequence to the bit, and an FMA rounds once where CPython
        # rounds twice. -O3 does NOT imply -ffast-math, and this flag plus the
        # #pragma in the translation unit close the one door that would matter.
        #
        # NOT here, deliberately: -march=native. The Docker builder stage and
        # a developer's Mac must emit the same floats, and a build tuned to
        # whichever CPU compiled it cannot promise that.
        extra_compile_args=["-O3", "-ffp-contract=off", "-fvisibility=hidden"],
    ),
]

setup(
    name="alphaengine-decision-core",
    version="0.1.0",
    description="Native pre-trade decision core for AlphaEngine (slice S3).",
    ext_modules=ext_modules,
    cmdclass={"build_ext": build_ext},
    zip_safe=False,
)
