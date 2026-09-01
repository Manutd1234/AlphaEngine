"""Signing, and every way it can be wrong without looking wrong.

The signature itself is three lines of library call. What this suite is really
about is the four ways a correct-looking signature gets rejected: the query
string left in the message, the wrong environment's key, a key that never
loaded, and a request signed when it should have refused.

The library is optional, so almost every case here runs without it. Only the
one real vector needs `cryptography`, and it is marked — a suite that skipped
silently on the deployment image would report green for a signer that never ran.
"""

from __future__ import annotations

from importlib.util import find_spec
from pathlib import Path

import pytest

from modules.coherence import tunables
from modules.coherence.drivers import kalshi_auth
from modules.coherence.drivers.kalshi_auth import SigningUnavailable, signing_message, status

cryptography_required = pytest.mark.skipif(
    find_spec("cryptography") is None,
    reason="cryptography is not installed (pip install -r requirements-coherence.txt)",
)


class TestTheMessageBeingSigned:
    def test_is_timestamp_then_method_then_path(self):
        assert signing_message(1_700_000_000_000, "GET", "/trade-api/v2/portfolio/balance") == (
            b"1700000000000GET/trade-api/v2/portfolio/balance"
        )

    def test_strips_the_query_string(self):
        """The documented rule, and the failure it prevents.

        Signing the query produces a signature that verifies for every call
        without parameters and fails for every paginated one — which reads as
        an intermittent credential fault rather than as a bug.
        """
        assert signing_message(1, "GET", "/trade-api/v2/portfolio/orders?limit=5") == (
            b"1GET/trade-api/v2/portfolio/orders"
        )

    def test_upper_cases_the_method(self):
        assert signing_message(1, "get", "/x") == signing_message(1, "GET", "/x")

    def test_keeps_the_api_root_in_the_path(self):
        """The exchange hashes the full path from the root, not the route."""
        assert b"/trade-api/v2" in signing_message(1, "GET", "/trade-api/v2/exchange/status")


class TestRefusals:
    def test_refuses_without_a_configured_key(self, monkeypatch):
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", "")
        with pytest.raises(SigningUnavailable, match="no demo key configured"):
            kalshi_auth.sign("GET", "/trade-api/v2/x", tunables.DEMO_BASE_URL)

    def test_refuses_to_sign_a_production_request_with_a_demo_key(self, monkeypatch):
        """A sandbox key cannot sign production, and the 401 it earns reads as
        a bad signature rather than as the wrong environment."""
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", "/nowhere.pem")
        monkeypatch.setattr(tunables, "PRODUCTION_KEY_ID", "")
        monkeypatch.setattr(tunables, "PRODUCTION_PRIVATE_KEY_PATH", "")
        with pytest.raises(SigningUnavailable, match="no production key configured"):
            kalshi_auth.sign("GET", "/trade-api/v2/x", tunables.PUBLIC_BASE_URL)

    def test_refuses_a_host_whose_name_only_prefixes_the_demo_origin(self, monkeypatch):
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", "/nowhere.pem")
        lookalike = "https://external-api.demo.kalshi.co.evil.example/trade-api/v2"
        with pytest.raises(SigningUnavailable, match="configured Kalshi demo or production API roots"):
            kalshi_auth.sign("GET", "/trade-api/v2/x", lookalike)

    def test_refuses_a_path_outside_the_validated_api_root(self, monkeypatch):
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", "/nowhere.pem")
        with pytest.raises(SigningUnavailable, match="signed path"):
            kalshi_auth.sign("GET", "/portfolio/balance", tunables.DEMO_BASE_URL)

    def test_refuses_a_key_path_that_is_not_there(self, monkeypatch, tmp_path):
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", str(tmp_path / "absent.pem"))
        kalshi_auth._load_key.cache_clear()
        if find_spec("cryptography") is None:
            pytest.skip("the library check fires first without cryptography installed")
        with pytest.raises(SigningUnavailable, match="no private key"):
            kalshi_auth.sign("GET", "/trade-api/v2/x", tunables.DEMO_BASE_URL)

    def test_refuses_a_file_that_is_not_a_key(self, monkeypatch, tmp_path):
        bad = tmp_path / "not-a-key.pem"
        bad.write_text("this is not a PEM private key")
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", str(bad))
        kalshi_auth._load_key.cache_clear()
        if find_spec("cryptography") is None:
            pytest.skip("the library check fires first without cryptography installed")
        report = status()
        assert not kalshi_auth.signing_available()
        assert report["available"] is False
        assert report["reason"] == "private_key_malformed"
        assert bad.name not in str(report["detail"])
        with pytest.raises(SigningUnavailable, match="did not parse"):
            kalshi_auth.sign("GET", "/trade-api/v2/x", tunables.DEMO_BASE_URL)


class TestWhatTheSurfaceIsTold:
    def test_reports_the_librarys_absence_with_a_reason(self):
        report = status()
        assert report["library"] in {"available", "unavailable"}
        if report["library"] == "unavailable":
            assert report["library_detail"], "an unavailable library must say why"

    def test_says_the_read_path_needs_no_key(self):
        """The most important sentence on this surface: almost nothing needs it."""
        assert "no key" in str(status()["detail"]) or status()["configured"]

    def test_configured_needs_both_halves(self, monkeypatch):
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", "")
        assert not tunables.signing_configured()
        monkeypatch.setattr(tunables, "PRODUCTION_KEY_ID", "production-key-id")
        monkeypatch.setattr(tunables, "PRODUCTION_PRIVATE_KEY_PATH", "")
        assert not tunables.production_signing_configured()
        assert "KALSHI_PRODUCTION_PRIVATE_KEY_PATH" in str(status("production")["detail"])

    def test_a_nonexistent_configured_path_is_not_reported_available(self, monkeypatch, tmp_path):
        missing = tmp_path / "do-not-disclose-this-key-name.pem"
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", str(missing))
        assert not kalshi_auth.signing_available()
        report = status()
        assert report["reason"] == "private_key_missing"
        assert "missing file" in str(report["detail"])
        assert missing.name not in str(report)


@cryptography_required
class TestARealSignature:
    def test_an_encrypted_rsa_key_is_a_typed_unavailable_state(self, monkeypatch, tmp_path):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = tmp_path / "encrypted-do-not-disclose.pem"
        pem.write_bytes(
            private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.BestAvailableEncryption(b"test-only-password"),
            )
        )
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "test-key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", str(pem))
        kalshi_auth._load_key.cache_clear()

        report = status()

        assert not kalshi_auth.signing_available()
        assert report["reason"] == "private_key_encrypted"
        assert "encrypted" in str(report["detail"])
        assert pem.name not in str(report)

    def test_a_non_rsa_private_key_is_rejected_before_signing(self, monkeypatch, tmp_path):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        private = ec.generate_private_key(ec.SECP256R1())
        pem = tmp_path / "elliptic-curve-do-not-disclose.pem"
        pem.write_bytes(
            private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "test-key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", str(pem))
        kalshi_auth._load_key.cache_clear()

        report = status()

        assert not kalshi_auth.signing_available()
        assert report["reason"] == "private_key_not_rsa"
        assert "not an RSA private key" in str(report["detail"])
        assert pem.name not in str(report)

    def test_an_unreadable_key_is_a_typed_state_without_the_path(self, monkeypatch, tmp_path):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = tmp_path / "unreadable-do-not-disclose.pem"
        pem.write_bytes(
            private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        read_bytes = Path.read_bytes

        def refuse_configured_key(path: Path) -> bytes:
            if path == pem:
                raise PermissionError("test-only filesystem detail")
            return read_bytes(path)

        monkeypatch.setattr(Path, "read_bytes", refuse_configured_key)
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "test-key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", str(pem))
        kalshi_auth._load_key.cache_clear()

        report = status()

        assert not kalshi_auth.signing_available()
        assert report["reason"] == "private_key_unreadable"
        assert pem.name not in str(report)
        assert "test-only filesystem detail" not in str(report)

    @pytest.mark.parametrize("failure", [TypeError, ValueError])
    def test_a_crypto_signing_error_becomes_signing_unavailable(self, monkeypatch, failure):
        class BrokenRsaKey:
            def sign(self, *_args, **_kwargs):
                raise failure("test-only crypto detail")

        configured_path = "/configured/do-not-disclose.pem"
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "test-key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", configured_path)
        monkeypatch.setattr(kalshi_auth, "_load_key", lambda _path: BrokenRsaKey())

        with pytest.raises(SigningUnavailable) as raised:
            kalshi_auth.sign("GET", "/trade-api/v2/portfolio/balance", tunables.DEMO_BASE_URL)

        assert raised.value.code == "private_key_sign_failed"
        assert "could not sign" in raised.value.reason
        assert "do-not-disclose.pem" not in str(raised.value)
        assert "test-only crypto detail" not in str(raised.value)

    def test_signs_a_known_vector_and_verifies_against_the_public_key(self, monkeypatch, tmp_path):
        """The only test that needs the library, and it proves the whole shape.

        Generated rather than committed: a private key in the repository is a
        private key in the repository, whatever it is for.
        """
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding, rsa

        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = tmp_path / "demo.pem"
        pem.write_bytes(
            private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "test-key-id")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", str(pem))
        kalshi_auth._load_key.cache_clear()

        headers = kalshi_auth.sign("GET", "/trade-api/v2/portfolio/balance", tunables.DEMO_BASE_URL, timestamp_ms=1_700_000_000_000)
        assert headers.key_id == "test-key-id"
        assert headers.timestamp_ms == "1700000000000"

        import base64

        private.public_key().verify(
            base64.b64decode(headers.signature),
            signing_message(1_700_000_000_000, "GET", "/trade-api/v2/portfolio/balance"),
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
            hashes.SHA256(),
        )

        # Production uses a different, explicitly configured credential. The
        # same generated key is reused only as a test vector; the distinct key
        # id proves the signer selected the production slot by exact host.
        monkeypatch.setattr(tunables, "PRODUCTION_KEY_ID", "production-test-key-id")
        monkeypatch.setattr(tunables, "PRODUCTION_PRIVATE_KEY_PATH", str(pem))
        production_headers = kalshi_auth.sign(
            "GET",
            "/trade-api/v2/cfbenchmarks/values",
            tunables.PUBLIC_BASE_URL,
            timestamp_ms=1_700_000_000_000,
        )
        assert production_headers.key_id == "production-test-key-id"
        private.public_key().verify(
            base64.b64decode(production_headers.signature),
            signing_message(1_700_000_000_000, "GET", "/trade-api/v2/cfbenchmarks/values"),
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
            hashes.SHA256(),
        )

    def test_the_headers_are_the_three_kalshi_names(self, monkeypatch, tmp_path):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = tmp_path / "demo.pem"
        pem.write_bytes(
            private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        monkeypatch.setattr(tunables, "DEMO_KEY_ID", "k")
        monkeypatch.setattr(tunables, "DEMO_PRIVATE_KEY_PATH", str(pem))
        kalshi_auth._load_key.cache_clear()
        headers = kalshi_auth.sign("GET", "/trade-api/v2/x", tunables.DEMO_BASE_URL).as_dict()
        assert set(headers) == {"KALSHI-ACCESS-KEY", "KALSHI-ACCESS-TIMESTAMP", "KALSHI-ACCESS-SIGNATURE"}
