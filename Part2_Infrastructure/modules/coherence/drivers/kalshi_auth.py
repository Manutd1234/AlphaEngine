"""Signing a Kalshi request, when there is a key to sign with.

Kalshi authenticates with RSA-PSS: SHA-256 for both the hash and the MGF1 mask,
a salt the length of the digest, over the concatenation of the timestamp in
milliseconds, the HTTP method and the path. The path includes ``/trade-api/v2``
and **excludes the query string** — the documentation says so twice, and signing
the query is the mistake that produces a valid-looking signature the exchange
rejects on every paginated call and nowhere else.

Nothing in the read path needs this. Kalshi's markets, events, series, trades,
fee feeds and exchange status are all public, and that is the whole reason this
engine can run with no account at all. Signing exists for the endpoints that do
need a key — ``/account/limits`` for the real rate tier, and the demo
environment's portfolio surface.

**Production and demo keys are not interchangeable.** A sandbox key generated at
demo.kalshi.co cannot sign a production request, so the client keeps the two
hosts apart and this module refuses to sign for a host it was not given a key
for. Getting that wrong produces a 401 that looks like a bad signature rather
than like the wrong environment.

``cryptography`` is imported through a seam because it is not on the deployment
image. Absent, the state is reported and the signed endpoints are skipped; the
public ones are unaffected, which is nearly all of them.
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType

from modules.coherence import tunables


class SigningUnavailable(RuntimeError):
    """No key, no library, or a key that could not be read. Never a fallback."""


@lru_cache(maxsize=1)
def import_rsa() -> tuple[ModuleType | None, str | None]:
    """The signing primitives, or the reason there are none.

    Cached both ways. A missing package does not appear halfway through a
    process, and retrying the import per request turns one absence into
    thousands of failed imports.
    """
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
    except ImportError as exc:
        return None, f"cryptography is not installed here ({exc})"

    class _Primitives:
        def __init__(self) -> None:
            self.hashes = hashes
            self.padding = padding
            self.serialization = serialization

    return _Primitives(), None  # type: ignore[return-value]


def signing_available() -> bool:
    """Both a key pair and the library. Either alone is not enough."""
    return tunables.signing_configured() and import_rsa()[0] is not None


@dataclass(frozen=True, slots=True)
class SignedHeaders:
    """The three headers Kalshi wants, and the host they are valid for."""

    key_id: str
    timestamp_ms: str
    signature: str
    host: str

    def as_dict(self) -> dict[str, str]:
        return {
            "KALSHI-ACCESS-KEY": self.key_id,
            "KALSHI-ACCESS-TIMESTAMP": self.timestamp_ms,
            "KALSHI-ACCESS-SIGNATURE": self.signature,
        }


def signing_message(timestamp_ms: int, method: str, path: str) -> bytes:
    """``timestamp + METHOD + path``, with the query string removed.

    The path is taken as given apart from the query: it must be the full path
    from the API root including ``/trade-api/v2``, because that is what the
    exchange hashes on its side.
    """
    without_query = path.split("?", 1)[0]
    return f"{timestamp_ms}{method.upper()}{without_query}".encode()


@lru_cache(maxsize=4)
def _load_key(pem_path: str):
    """Read and parse a private key once.

    Cached because parsing an RSA key is not free and the key does not change
    within a process. The path is the cache key rather than the contents, so
    replacing the file needs a restart — which is the correct behaviour for a
    credential.
    """
    primitives, error = import_rsa()
    if primitives is None:
        raise SigningUnavailable(error or "cryptography is unavailable")
    path = Path(pem_path)
    if not path.exists():
        raise SigningUnavailable(f"no private key at the configured path ({path.name})")
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise SigningUnavailable(f"the private key could not be read: {type(exc).__name__}") from exc
    try:
        return primitives.serialization.load_pem_private_key(data, password=None)
    except (ValueError, TypeError) as exc:
        raise SigningUnavailable(f"the private key did not parse as PEM: {type(exc).__name__}") from exc


def sign(method: str, path: str, host: str, timestamp_ms: int | None = None) -> SignedHeaders:
    """Sign one request for one host.

    Raises rather than returning unsigned headers. An unsigned request to a
    signed endpoint gets a 401 that reads as a credential problem, which sends
    whoever debugs it looking at the key rather than at the code that decided
    not to use it.
    """
    if not tunables.signing_configured():
        raise SigningUnavailable(
            "no demo key configured; set KALSHI_DEMO_KEY_ID and KALSHI_DEMO_PRIVATE_KEY_PATH"
        )
    if not host.startswith(tunables.DEMO_BASE_URL.rsplit("/trade-api", 1)[0]):
        raise SigningUnavailable(
            "this key belongs to the demo environment and cannot sign a production request; "
            "the public read path needs no key at all"
        )

    primitives, error = import_rsa()
    if primitives is None:
        raise SigningUnavailable(error or "cryptography is unavailable")

    stamp = timestamp_ms if timestamp_ms is not None else int(time.time() * 1000)
    key = _load_key(tunables.DEMO_PRIVATE_KEY_PATH)
    signature = key.sign(
        signing_message(stamp, method, path),
        primitives.padding.PSS(
            mgf=primitives.padding.MGF1(primitives.hashes.SHA256()),
            salt_length=primitives.padding.PSS.DIGEST_LENGTH,
        ),
        primitives.hashes.SHA256(),
    )
    return SignedHeaders(
        key_id=tunables.DEMO_KEY_ID,
        timestamp_ms=str(stamp),
        signature=base64.b64encode(signature).decode("ascii"),
        host=host,
    )


def status() -> dict[str, object]:
    """What the surface reports about signing. Never a bare boolean."""
    primitives, error = import_rsa()
    configured = tunables.signing_configured()
    return {
        "configured": configured,
        "library": "available" if primitives is not None else "unavailable",
        "library_detail": error,
        "environment": "demo" if configured else None,
        "detail": (
            "signed demo reads are available"
            if configured and primitives is not None
            else "public production reads need no key; signed demo reads are not configured"
        ),
    }
