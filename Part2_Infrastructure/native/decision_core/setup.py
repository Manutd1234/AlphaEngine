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

``ALPHAENGINE_NATIVE_SANITIZERS=1`` enables ASAN and UBSAN together.
``ALPHAENGINE_NATIVE_SANITIZERS=undefined`` is the UBSAN-only execution
fallback for Python runtimes into which macOS cannot interpose ASAN.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import sysconfig
from pathlib import Path

from pybind11.setup_helpers import Pybind11Extension, build_ext
from setuptools import setup

HERE = Path(__file__).resolve().parent
ABI_VERSION = 1


def _build_flags(sanitizers: str | None) -> tuple[list[str], list[str]]:
    """Compiler and linker contract for production or the opt-in safety build."""
    mode = (sanitizers or "").strip()
    if not mode:
        return ["-O3", "-ffp-contract=off", "-fvisibility=hidden"], []
    sanitizer_flag = {
        "1": "-fsanitize=address,undefined",
        # macOS cannot interpose ASAN into every Python distribution. This
        # fallback still executes the full parity suite under UB checks rather
        # than treating a successful combined compile as a successful run.
        "undefined": "-fsanitize=undefined",
    }.get(mode)
    if sanitizer_flag is None:
        raise RuntimeError("ALPHAENGINE_NATIVE_SANITIZERS must be unset, 1, or undefined")
    return (
        [
            "-O1",
            "-g",
            "-fno-omit-frame-pointer",
            sanitizer_flag,
            "-fno-sanitize-recover=all",
            "-ffp-contract=off",
            "-fvisibility=hidden",
            "-Wall",
            "-Wextra",
            "-Wpedantic",
            "-Werror",
        ],
        [sanitizer_flag, "-fno-sanitize-recover=all"],
    )


def _build_id(sanitizers: str | None) -> str:
    """Identify the exact source, compiler contract and Python/CPU target."""
    source_hash = hashlib.sha256((HERE / "decision_core.cpp").read_bytes()).hexdigest()[:16]
    compile_args, _ = _build_flags(sanitizers)
    flags_hash = hashlib.sha256("\0".join(compile_args).encode()).hexdigest()[:12]
    machine = platform.machine() or "unknown-machine"
    soabi = sysconfig.get_config_var("SOABI") or "unknown-soabi"
    return (
        f"alphaengine-decision-core/abi-{ABI_VERSION}/src-{source_hash}/"
        f"flags-{flags_hash}/{machine}/{soabi}"
    )


def _extension() -> Pybind11Extension:
    sanitizers = os.getenv("ALPHAENGINE_NATIVE_SANITIZERS")
    compile_args, link_args = _build_flags(sanitizers)
    return Pybind11Extension(
        "modules._decision_core",
        [str(HERE / "decision_core.cpp")],
        cxx_std=17,
        # The optimisation notes below describe the normal production build.
        # A sanitizer mode deliberately selects O1, symbols and frame pointers
        # so diagnostics remain actionable.
        # -O3, not -O2: this is a tight numeric kernel whose whole job is the
        # arithmetic, and -O3's extra inlining and unrolling is exactly the
        # class of optimisation it can use. It does NOT imply -ffast-math —
        # that would be a parity break, and the flag below forbids the one
        # transformation that would cause it either way. The translation unit
        # deliberately relies on this portable GCC/Clang flag: GCC rejects the
        # C-only STDC FP_CONTRACT pragma under the strict C++ warning contract.
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
        # rounds twice. -O3 does NOT imply -ffast-math; -ffp-contract=off
        # closes the one door that would matter.
        #
        # NOT here, deliberately: -march=native. The Docker builder stage and
        # a developer's Mac must emit the same floats, and a build tuned to
        # whichever CPU compiled it cannot promise that.
        # The sanitizer mode is an opt-in CI build. Production keeps the exact
        # three-flag list it used before this gate existed; no deployment pays
        # for instrumentation and its arithmetic contract is unchanged.
        extra_compile_args=compile_args,
        extra_link_args=link_args,
        define_macros=[("ALPHAENGINE_BUILD_ID", json.dumps(_build_id(sanitizers)))],
    )


def main() -> None:
    setup(
        name="alphaengine-decision-core",
        version="0.1.0",
        description="Native pre-trade decision core for AlphaEngine (slice S3).",
        ext_modules=[_extension()],
        cmdclass={"build_ext": build_ext},
        zip_safe=False,
    )


if __name__ == "__main__":
    main()
