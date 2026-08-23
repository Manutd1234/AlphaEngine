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
        with pytest.raises(SigningUnavailable, match="demo environment"):
            kalshi_auth.sign("GET", "/trade-api/v2/x", tunables.PUBLIC_BASE_URL)

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


@cryptography_required
class TestARealSignature:
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
