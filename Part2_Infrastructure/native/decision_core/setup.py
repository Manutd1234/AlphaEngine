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
        extra_compile_args=["-O2", "-ffp-contract=off", "-fvisibility=hidden"],
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
