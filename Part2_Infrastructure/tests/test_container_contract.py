"""The committed container definition, held to the promises its comments make.

These are text-analysis tests on purpose — CI is network-free and never builds
an image. Every fact asserted here has already been wrong once somewhere:
multi-worker uvicorn forks an in-memory risk book, a USER before its chown
produces an unwritable /app/data (which config.py's import-time ensure_dirs
turns into a dead process), and a token pasted into a compose file is how the
last leaked credential got leaked.
"""

from __future__ import annotations

import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DOCKERFILE = (BASE / "docker" / "gateway.Dockerfile").read_text()
COMPOSE = (BASE.parent / "docker-compose.yml").read_text()
DOCKERIGNORE = (BASE / ".dockerignore").read_text()


def _instructions(text: str) -> str:
    """The file minus comments — the Dockerfile's own prose explains *why*
    `--workers` is banned, and a raw scan would read the explanation as the
    offence (the exact trap the telegram honesty test already documents)."""
    return "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )


DOCKERFILE_CODE = _instructions(DOCKERFILE)
COMPOSE_CODE = _instructions(COMPOSE)


class TestDockerfile:
    def test_base_image_is_python_312_family(self):
        assert re.search(r"FROM python:3\.12-slim", DOCKERFILE)

    def test_runs_as_non_root_after_owning_app(self):
        chown_at = DOCKERFILE.index("chown -R 10001:10001 /app")
        user_at = DOCKERFILE.index("\nUSER 10001")
        assert chown_at < user_at, (
            "USER before chown: ensure_dirs() runs at import and uid 10001 "
            "cannot create /app/data it does not own"
        )

    def test_single_process_uvicorn_on_8000(self):
        assert "EXPOSE 8000" in DOCKERFILE
        cmd = DOCKERFILE_CODE[DOCKERFILE_CODE.rindex("CMD [") :]
        assert '"uvicorn"' in cmd and '"--port", "8000"' in cmd
        assert "--workers" not in DOCKERFILE_CODE and "gunicorn" not in DOCKERFILE_CODE, (
            "a second worker forks the in-memory book and localises the kill switch"
        )

    def test_healthcheck_probes_health_route(self):
        assert "HEALTHCHECK" in DOCKERFILE
        assert "/health" in DOCKERFILE

    def test_templates_ship_in_the_image(self):
        # main.py constructs Jinja2Templates at import; without templates/ the
        # gateway console route is a 500.
        assert re.search(r"COPY templates/ templates/", DOCKERFILE)

    def test_data_paths_agree_with_compose_volume(self):
        assert "DATA_DIR=/app/data" in DOCKERFILE
        assert "DB_PATH=/app/data/alphaengine.duckdb" in DOCKERFILE
        assert "alphaengine_audit:/app/data" in COMPOSE

    def test_build_context_excludes_the_heavy_trees(self):
        for entry in ("venv/", "web/", "OpenBB_Service/", "data/", ".env"):
            assert entry in DOCKERIGNORE, f".dockerignore lost {entry}"


class TestCompose:
    def test_maps_host_port_8000(self):
        assert re.search(r"-\s*\"8000:8000\"", COMPOSE)

    def test_declares_a_named_volume_not_a_bind_mount(self):
        assert re.search(r"^volumes:\n\s+alphaengine_audit:", COMPOSE, re.M), (
            "the audit volume must be named — a bind mount arrives host-owned "
            "and uid 10001 cannot write it"
        )
        mount = re.search(r"volumes:\n\s+- (\S+):/app/data", COMPOSE)
        assert mount and not mount.group(1).startswith((".", "/")), (
            "audit mount looks like a bind path, not a named volume"
        )

    def test_no_obsolete_version_key(self):
        assert not re.search(r"^version:", COMPOSE, re.M)

    def test_env_file_is_optional_for_clean_clones(self):
        assert "required: false" in COMPOSE

    def test_grace_period_covers_the_audit_shutdown_write(self):
        assert "stop_grace_period" in COMPOSE

    def test_auth_is_required_in_the_shipped_default(self):
        assert re.search(r"REQUIRE_AUTH:\s*\"1\"", COMPOSE)


class TestNoSecretShapes:
    """No committed container file may contain a credential-shaped literal.

    ${VAR} references and env_file indirection are the only ways a secret may
    reach the container. The shapes below cover the classes this project
    handles: hex tokens, Supabase sb_* keys, JWTs, and Telegram bot tokens.
    """

    SECRET_SHAPES = [
        re.compile(r"\b[0-9a-f]{24,}\b", re.I),
        re.compile(r"\bsb_(secret|publishable)_\S+"),
        re.compile(r"\beyJ[A-Za-z0-9_-]{10,}"),
        re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b"),
    ]

    def test_dockerfile_and_compose_are_clean(self):
        for name, text in (("Dockerfile", DOCKERFILE_CODE), ("compose", COMPOSE_CODE)):
            for line in text.splitlines():
                if "${" in line:  # an env reference, not a literal
                    continue
                for shape in self.SECRET_SHAPES:
                    match = shape.search(line)
                    assert match is None, (
                        f"secret-shaped literal in {name}: {match.group(0)[:12]}…"
                    )
