"""Signing a Kalshi request, when there is a key to sign with.

Kalshi authenticates with RSA-PSS: SHA-256 for both the hash and the MGF1 mask,
a salt the length of the digest, over the concatenation of the timestamp in
milliseconds, the HTTP method and the path. The path includes ``/trade-api/v2``
and **excludes the query string** — the documentation says so twice, and signing
the query is the mistake that produces a valid-looking signature the exchange
rejects on every paginated call and nowhere else.

Almost nothing in the read path needs this. Kalshi's markets, events, series,
trades, fee feeds and exchange status are public, so the engine still runs with
no account. Signing exists for the endpoints that do need a key: the demo
environment's private-channel surface and production ``/cfbenchmarks/values``.

**Production and demo keys are not interchangeable.** A sandbox key generated at
demo.kalshi.co cannot sign a production request, so the client keeps the two
hosts apart and this module refuses to sign for a host it was not given a key
for. Getting that wrong produces a 401 that looks like a bad signature rather
than like the wrong environment.

``cryptography`` is imported through a seam so an image built without the
optional signing dependency still reports a typed setup state. The signed
endpoints are skipped in that case; the public ones are unaffected, which is
nearly all of them.
"""

from __future__ import annotations

import base64
import stat
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Literal

from modules.coherence import tunables

SigningEnvironment = Literal["demo", "production"]


@dataclass(frozen=True, slots=True)
class SigningProblem:
    """One operator-safe reason signing cannot start."""

    code: str
    detail: str


class SigningUnavailable(RuntimeError):
    """No usable RSA key or signing library. Never an unsigned fallback."""

    def __init__(self, reason: str, *, code: str = "signing_unavailable") -> None:
        super().__init__(reason)
        self.reason = reason
        self.code = code


@lru_cache(maxsize=1)
def import_rsa() -> tuple[ModuleType | None, str | None]:
    """The signing primitives, or the reason there are none.

    Cached both ways. A missing package does not appear halfway through a
    process, and retrying the import per request turns one absence into
    thousands of failed imports.
    """
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding, rsa
    except ImportError as exc:
        return None, f"cryptography is not installed here ({exc})"

    class _Primitives:
        def __init__(self) -> None:
            self.hashes = hashes
            self.padding = padding
            self.rsa = rsa
            self.serialization = serialization

    return _Primitives(), None  # type: ignore[return-value]


def _credentials(environment: SigningEnvironment) -> tuple[str, str, str]:
    """Key id, key path and operator-facing variable prefix for one venue."""
    if environment == "production":
        return (
            tunables.PRODUCTION_KEY_ID,
            tunables.PRODUCTION_PRIVATE_KEY_PATH,
            "KALSHI_PRODUCTION",
        )
    return tunables.DEMO_KEY_ID, tunables.DEMO_PRIVATE_KEY_PATH, "KALSHI_DEMO"


def signing_available(environment: SigningEnvironment = "demo") -> bool:
    """A complete environment-specific configuration with a valid RSA key."""
    return _availability_problem(environment) is None


def _configuration_problem(environment: SigningEnvironment = "demo") -> SigningProblem | None:
    """Name the incomplete half without exposing a configured path."""
    key_id, private_key_path, prefix = _credentials(environment)
    if not key_id:
        return SigningProblem("key_id_missing", f"{prefix}_KEY_ID is not set on the gateway")
    if not private_key_path:
        return SigningProblem(
            "private_key_path_missing",
            f"{prefix}_PRIVATE_KEY_PATH is not set on the gateway",
        )
    path = Path(private_key_path)
    try:
        mode = path.stat().st_mode
    except FileNotFoundError:
        return SigningProblem(
            "private_key_missing",
            f"{prefix}_PRIVATE_KEY_PATH points to a missing file",
        )
    except OSError:
        return SigningProblem(
            "private_key_unreadable",
            "the configured private key file is unreadable",
        )
    if not stat.S_ISREG(mode):
        return SigningProblem(
            "private_key_not_file",
            f"{prefix}_PRIVATE_KEY_PATH must point to a regular PEM file",
        )
    return None


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
    """Read and parse one unencrypted RSA private key once.

    Cached because parsing an RSA key is not free and the key does not change
    within a process. The path is the cache key rather than the contents, so
    replacing the file needs a restart — which is the correct behaviour for a
    credential.
    """
    primitives, error = import_rsa()
    if primitives is None:
        raise SigningUnavailable(
            error or "cryptography is unavailable",
            code="cryptography_unavailable",
        )
    path = Path(pem_path)
    try:
        data = path.read_bytes()
    except FileNotFoundError as exc:
        raise SigningUnavailable(
            "no private key exists at the configured location",
            code="private_key_missing",
        ) from exc
    except OSError as exc:
        raise SigningUnavailable(
            "the configured private key file is unreadable",
            code="private_key_unreadable",
        ) from exc
    if b"-----BEGIN ENCRYPTED PRIVATE KEY-----" in data or b"Proc-Type: 4,ENCRYPTED" in data:
        raise SigningUnavailable(
            "the configured private key is encrypted; provide an unencrypted RSA PEM",
            code="private_key_encrypted",
        )
    try:
        key = primitives.serialization.load_pem_private_key(data, password=None)
    except (ValueError, TypeError) as exc:
        raise SigningUnavailable(
            "the configured private key did not parse as an unencrypted PEM private key",
            code="private_key_malformed",
        ) from exc
    if not isinstance(key, primitives.rsa.RSAPrivateKey):
        raise SigningUnavailable(
            "the configured private key is not an RSA private key",
            code="private_key_not_rsa",
        )
    return key


def _availability_problem(environment: SigningEnvironment = "demo") -> SigningProblem | None:
    """Validate every local prerequisite without sending or signing a request."""
    configuration_problem = _configuration_problem(environment)
    if configuration_problem is not None:
        return configuration_problem
    primitives, error = import_rsa()
    if primitives is None:
        return SigningProblem(
            "cryptography_unavailable",
            error or "cryptography is unavailable",
        )
    try:
        _load_key(_credentials(environment)[1])
    except SigningUnavailable as exc:
        return SigningProblem(exc.code, exc.reason)
    return None


def sign(method: str, path: str, host: str, timestamp_ms: int | None = None) -> SignedHeaders:
    """Sign one request for one host.

    Raises rather than returning unsigned headers. An unsigned request to a
    signed endpoint gets a 401 that reads as a credential problem, which sends
    whoever debugs it looking at the key rather than at the code that decided
    not to use it.
    """
    try:
        signing_host = tunables.normalize_base_url(host, name="signing host")
    except ValueError as exc:
        raise SigningUnavailable("the signing host is not a valid Kalshi API root") from exc
    if signing_host in {tunables.DEMO_BASE_URL, tunables.DEMO_FAILOVER_URL}:
        environment: SigningEnvironment = "demo"
    elif signing_host in {tunables.PUBLIC_BASE_URL, tunables.PUBLIC_FAILOVER_URL}:
        environment = "production"
    else:
        raise SigningUnavailable(
            "the signing host is not one of the configured Kalshi demo or production API roots"
        )
    key_id, private_key_path, prefix = _credentials(environment)
    if not key_id or not private_key_path:
        raise SigningUnavailable(
            f"no {environment} key configured; set {prefix}_KEY_ID and {prefix}_PRIVATE_KEY_PATH"
        )
    path_without_query = path.split("?", 1)[0]
    if path_without_query != tunables.API_ROOT_PATH and not path_without_query.startswith(
        f"{tunables.API_ROOT_PATH}/"
    ):
        raise SigningUnavailable(f"the signed path must start at {tunables.API_ROOT_PATH}")

    primitives, error = import_rsa()
    if primitives is None:
        raise SigningUnavailable(
            error or "cryptography is unavailable",
            code="cryptography_unavailable",
        )

    stamp = timestamp_ms if timestamp_ms is not None else int(time.time() * 1000)
    key = _load_key(private_key_path)
    try:
        signature = key.sign(
            signing_message(stamp, method, path),
            primitives.padding.PSS(
                mgf=primitives.padding.MGF1(primitives.hashes.SHA256()),
                salt_length=primitives.padding.PSS.DIGEST_LENGTH,
            ),
            primitives.hashes.SHA256(),
        )
    except (TypeError, ValueError) as exc:
        raise SigningUnavailable(
            "the configured RSA private key could not sign this request",
            code="private_key_sign_failed",
        ) from exc
    return SignedHeaders(
        key_id=key_id,
        timestamp_ms=str(stamp),
        signature=base64.b64encode(signature).decode("ascii"),
        host=signing_host,
    )


def status(environment: SigningEnvironment = "demo") -> dict[str, object]:
    """What a surface reports about one signing environment."""
    primitives, error = import_rsa()
    key_id, private_key_path, _prefix = _credentials(environment)
    configured = bool(key_id and private_key_path)
    problem = _availability_problem(environment)
    available = problem is None
    return {
        "configured": configured,
        "available": available,
        "reason": problem.code if problem is not None else None,
        "library": "available" if primitives is not None else "unavailable",
        "library_detail": error,
        "environment": environment if available else None,
        "detail": (
            f"signed {environment} reads are available"
            if available
            else f"{problem.detail if problem is not None else f'signed {environment} reads are unavailable'}; "
            + (
                "public production reads need no key"
                if environment == "demo"
                else "the CF Benchmarks read will not fall back to an unsigned request"
            )
        ),
    }
