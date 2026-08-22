"""Where ``tools/bench_image_retrieval.py`` gets its three models, and seeds them.

Three, not two, and the third is the whole point of the bench. The CLIP pair is
the thing under test; the text encoder is the BASELINE it has to beat, and a
harness that reported the image arm's nDCG with nothing to compare it against
would be the unmeasured assertion the exercise exists to retire.

Split out of the entry point under the file-length ceiling
``tests/test_file_size.py`` enforces, and the split falls where the subject
does: this file answers "which weights, from where, and what if they are not
there", and the entry point answers "what was measured".

THE SUBSTITUTION, NAMED HERE BECAUSE THIS IS WHERE IT HAPPENS
--------------------------------------------------------------

The deployed description arm embeds with ``gte-small`` inside the
``embed-research`` edge function — ``research_rag/embedding.py`` pins
``EMBEDDING_MODEL = "gte-small"`` at 384 dimensions. fastembed does not serve
gte-small; its list holds bge-small, gte-base and gte-large. So the baseline
here is ``BAAI/bge-small-en-v1.5``: the same 384 dimensions, the same size
class, the same generation of small English retrieval encoder, 67 MB on disk
and no network call per embed. That is the single largest caveat on every
number the bench prints, which is why it is stated in three places and settable
with ``--text-model`` in one.

The rejected alternative was calling the real edge function. It would measure
the deployed encoder exactly, and it would put a network round trip, a Supabase
project and a service key on the path of a tool whose entire value is that
anyone holding this repository can re-run it offline.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

#: The stand-in for the deployed ``gte-small``. See the module docstring.
TEXT_MODEL = "BAAI/bge-small-en-v1.5"


def load_image_arm(model_path: str, *, offline: bool = True):
    """``(research_image, research_image_ingest, reason)``. Never raises.

    The environment is written BEFORE the first import for ``bench_rerank``'s
    reason: ``research_image.IMAGE_MODEL_PATH`` is read off ``os.environ`` in a
    module-level assignment, so before the import is the only moment it is
    settable. The constant is then ASSIGNED as well, because a tool should not
    silently depend on nothing else having imported the module first — that is
    the same seam the image suites set in their autouse fixture.

    ``HF_HUB_OFFLINE`` is set for every mode except ``--seed``: a bench that
    quietly downloaded would contradict the property this arm was chosen for,
    which is that nothing touches the network at request time. A cold number
    reported under a warm label is worse than no number.
    """
    os.environ["RESEARCH_IMAGE_MODEL_PATH"] = model_path
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    else:
        os.environ.pop("HF_HUB_OFFLINE", None)

    from modules import research_image as ri
    from modules import research_image_ingest as ingest

    ri.IMAGE_MODEL_PATH = model_path
    if not model_path:
        return None, None, (
            "no model path: pass --model-path or set RESEARCH_IMAGE_MODEL_PATH to the "
            "directory the CLIP pair was seeded into (run --seed once)"
        )
    if not Path(model_path).is_dir():
        return None, None, f"the model directory {model_path} does not exist (run --seed)"
    # The module's own loader, so the bench measures the construction path the
    # gateway uses rather than a second one it invented. It returns a REASON on
    # every failure and raises on none, which is the contract relied on here.
    _vision, _text, _lib, reason, _state = ri._encoders()
    if reason is not None:
        return None, None, reason
    return ri, ingest, None


def load_text_encoder(name: str, model_path: str):
    """The description arm's encoder, or a named reason. Never raises.

    Constructed here rather than behind ``research_image._import_encoders``
    deliberately: that seam owns the CLIP PAIR and is the ONE boundary the image
    suites substitute. Borrowing it to load a fourth, unrelated model would make
    that boundary mean two things, and the next person to fake it in a test
    would fake more than they meant to.
    """
    try:
        from fastembed import TextEmbedding  # type: ignore[import-not-found]
    except ImportError:
        return None, "the fastembed package is not installed (pip install fastembed)"
    try:
        return TextEmbedding(model_name=name, cache_dir=model_path), None
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        # As broad as the module's own load guard and for its reason: a missing
        # directory, an unreadable one and an ONNX file this fastembed cannot
        # open are three sentences and one outcome — no baseline, here is why.
        return None, f"{type(exc).__name__} loading {name} from {model_path}: {exc}"


def seed(model_path: str, text_model: str) -> int:
    """Fetch all three models into ``model_path``. The one networked mode.

    Measured once, cold, on a domestic connection: 21.6 s for 0.63 GiB across
    the three models — 0.34 GB of vision weights, 0.25 GB of CLIP text and 67 MB
    of the description-arm stand-in. That size is the argument for seeding at image build time and never
    on a request path — the same argument ``requirements-rerank.txt`` makes
    about the cross-encoder, and the reason CI never walks this path and no
    test in this tree may.

    The one mode that returns non-zero on failure. Everywhere else in this
    bench an absent model is a named state and exit 0; here seeding IS the job,
    so a seed that did not seed must be a red step.
    """
    from modules.research_image import IMAGE_MODEL_TEXT, IMAGE_MODEL_VISION, _import_encoders

    vision_cls, text_cls, _image, reason = _import_encoders()
    if vision_cls is None:
        print(f"cannot seed: {reason}")
        return 1
    os.environ.pop("HF_HUB_OFFLINE", None)
    Path(model_path).mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    try:
        vision_cls(model_name=IMAGE_MODEL_VISION, cache_dir=model_path)
        text_cls(model_name=IMAGE_MODEL_TEXT, cache_dir=model_path)
        text_cls(model_name=text_model, cache_dir=model_path)
    except Exception as exc:  # noqa: BLE001 - the reason is the product here
        print(f"cannot seed: {type(exc).__name__} fetching the models: {exc}")
        return 1
    # Symlinks skipped, or every weight is counted twice: the hub cache keeps
    # one blob and points a snapshot name at it, and `stat` follows the link.
    # `bench_rerank` reported 2.10 GiB for a 1.05 GiB directory before it did.
    total = sum(
        f.stat().st_size
        for f in Path(model_path).rglob("*")
        if f.is_file() and not f.is_symlink()
    )
    print(
        f"seeded {IMAGE_MODEL_VISION}, {IMAGE_MODEL_TEXT} and {text_model} into "
        f"{model_path} in {time.perf_counter() - started:.1f} s, "
        f"{total / 1024**3:.2f} GiB on disk"
    )
    return 0
