"""The committed container definition, held to the promises its comments make.

These are text-analysis tests on purpose — CI is network-free and never builds
an image. Every fact asserted here has already been wrong once somewhere:
multi-worker uvicorn forks an in-memory risk book, a USER before its chown
produces an unwritable /app/data (which config.py's import-time ensure_dirs
turns into a dead process), and a token pasted into a compose file is how the
last leaked credential got leaked.

The limit of this file is worth stating: it reads the committed image
definition and nothing else. It cannot see `docker compose up --scale
gateway=2`, a second container on the same named volume, or a uvicorn started
by hand with `--workers`. `modules/single_writer.py` is what refuses those at
runtime, and `tests/test_single_writer.py` pins it. Neither makes the gateway
multi-process — the `--workers` ban below is exactly as load-bearing as it was;
what the pair adds is that breaking it now fails loudly instead of silently.
"""

from __future__ import annotations

import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DOCKERFILE = (BASE / "docker" / "gateway.Dockerfile").read_text()
COMPOSE = (BASE.parent / "docker-compose.yml").read_text()
KALSHI_COMPOSE = (BASE / "docker" / "compose.kalshi.yml").read_text()
DOCKERIGNORE = (BASE / ".dockerignore").read_text()
GITIGNORE = (BASE / ".gitignore").read_text()
ENV_EXAMPLE = (BASE / ".env.example").read_text()
SETUP = (BASE.parent / "SETUP.md").read_text()
COHERENCE_REQUIREMENTS = (BASE / "requirements-coherence.txt").read_text()


def _instructions(text: str) -> str:
    """The file minus comments — the Dockerfile's own prose explains *why*
    `--workers` is banned, and a raw scan would read the explanation as the
    offence (the exact trap the telegram honesty test already documents)."""
    return "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )


DOCKERFILE_CODE = _instructions(DOCKERFILE)
COMPOSE_CODE = _instructions(COMPOSE)
KALSHI_COMPOSE_CODE = _instructions(KALSHI_COMPOSE)


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

    def test_healthcheck_requires_readiness_not_only_an_http_200(self):
        healthcheck = DOCKERFILE_CODE[DOCKERFILE_CODE.index("HEALTHCHECK") :]
        assert "body.get('ready') is True" in healthcheck, (
            "a failed startup canary still returns HTTP 200; the container probe "
            "must consume the readiness bit or deploy will call it healthy"
        )

    def test_three_failed_healthchecks_exit_pid_one_for_restart_policy(self):
        healthcheck = DOCKERFILE_CODE[DOCKERFILE_CODE.index("HEALTHCHECK") :]
        assert "alphaengine-health-failures" in healthcheck
        assert "if n>=3:os.kill(1,signal.SIGTERM)" in healthcheck, (
            "Docker marks an alive process unhealthy but does not restart it; "
            "the probe must terminate pid 1 after the configured retry count"
        )

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

    def test_coherence_signing_dependencies_ship_in_the_runtime(self):
        builder_start = DOCKERFILE_CODE.index("FROM python:3.12-slim AS builder")
        runtime_start = DOCKERFILE_CODE.index("FROM python:3.12-slim", builder_start + 1)
        builder = DOCKERFILE_CODE[builder_start:runtime_start]
        assert re.search(r"COPY[^\n]*requirements-coherence\.txt", builder), (
            "the production build cannot install the Kalshi signing extra if its "
            "requirements file is absent from the builder"
        )
        install = builder[
            builder.index("RUN pip install --no-cache-dir --prefix=/install"):
            builder.index("RUN pip install --no-cache-dir -r requirements-native.txt")
        ]
        assert '-r "${REQUIREMENTS}"' in install
        assert "-r requirements-coherence.txt" in install, (
            "the coherence extra must land in /install, which is copied into the runtime image"
        )
        assert re.search(r"^cryptography(?:[<>=!~].*)?$", COHERENCE_REQUIREMENTS, re.M), (
            "requirements-coherence.txt no longer provides the RSA library the Kalshi signer imports"
        )

    def test_configured_graph_dependencies_ship_in_the_runtime(self):
        builder_start = DOCKERFILE_CODE.index("FROM python:3.12-slim AS builder")
        runtime_start = DOCKERFILE_CODE.index("FROM python:3.12-slim", builder_start + 1)
        builder = DOCKERFILE_CODE[builder_start:runtime_start]
        for requirements in ("requirements-communities.txt", "requirements-graph.txt"):
            assert requirements in builder
            assert re.search(rf"-r {re.escape(requirements)}", builder), (
                f"{requirements} must land in /install; credentials alone cannot make the "
                "production graph projection run"
            )

    def test_native_core_is_built_in_the_builder_and_copied_not_compiled_at_runtime(self):
        # g++ lives in the builder stage only; a compiler in the runtime image
        # is the surface this multi-stage split exists to avoid.
        runtime_start = DOCKERFILE.index("\nFROM python:3.12-slim\n", DOCKERFILE.index("AS builder"))
        builder = DOCKERFILE[:runtime_start]
        runtime = DOCKERFILE[runtime_start:]
        assert "build-essential" in builder, "the builder must install a compiler for the core"
        assert "apt-get install" not in runtime, "the runtime image must not install anything"
        assert "build_ext --inplace" in builder, "the core is compiled in the builder"
        assert re.search(r"COPY --from=builder /build/modules/_decision_core\*\.so modules/", runtime), (
            "the runtime must copy the finished .so, not rebuild it"
        )
        # A locally built darwin .so must never ride into the linux context.
        assert "modules/_decision_core*.so" in DOCKERIGNORE
        assert "build/" in DOCKERIGNORE


class TestEveryRootModuleShips:
    """The runtime `COPY` names its modules one by one, so a new one is missed by
    default and a split one disappears.

    `COPY main.py config.py celery_tasks.py worker.py ./` is an allow-list
    written by hand. Nothing else checks it: the suite imports from the source
    tree, so a module absent from the image passes every test here and fails
    only when the container starts — and `config.py` in particular is imported
    at module scope by `main.py`, so its absence is not a degraded gateway but
    a process that never listens.

    That is also what makes `config.py` awkward to split at 433 lines. Turning
    it into a `config/` package is a correct refactor that would silently ship
    a broken image, because the `COPY` names a file. This test is the guard
    that has to exist first: with it, the split fails in CI instead of in
    production.
    """

    #: Root modules deliberately not in the runtime image, with the reason.
    EXCUSED: dict[str, str] = {}

    def _copied_names(self) -> set[str]:
        """Every path named by a runtime-stage COPY, excluding --from builders."""
        runtime = DOCKERFILE_CODE[DOCKERFILE_CODE.rindex("FROM python:3.12-slim") :]
        names: set[str] = set()
        for line in runtime.splitlines():
            stripped = line.strip()
            if not stripped.startswith("COPY") or "--from=" in stripped:
                continue
            # COPY <src>... <dest> — the last token is the destination.
            names.update(stripped.split()[1:-1])
        return names

    def test_every_root_python_module_is_copied_into_the_image(self):
        copied = self._copied_names()
        on_disk = {path.name for path in BASE.glob("*.py")}
        missing = sorted(name for name in on_disk - copied if name not in self.EXCUSED)
        assert not missing, (
            f"these gateway modules exist but no runtime COPY ships them: {missing}. "
            "Add them to the COPY line in docker/gateway.Dockerfile, or to EXCUSED "
            "with the reason they are not needed at runtime."
        )

    def test_the_copy_line_names_nothing_that_has_been_deleted(self):
        # The other direction: a COPY naming a file that no longer exists fails
        # the build, but only once someone builds. This says so at test time.
        copied = self._copied_names()
        on_disk = {path.name for path in BASE.glob("*.py")}
        stale = sorted(
            name for name in copied
            if name.endswith(".py") and name not in on_disk
        )
        assert not stale, (
            f"docker/gateway.Dockerfile copies files that are not in the tree: {stale}"
        )

    def test_config_is_reachable_as_a_module_or_a_package(self):
        """Whichever shape `config` takes, the image must carry it.

        Written this way on purpose: it passes today for the single file and
        keeps passing after a `config/` package split, provided the Dockerfile
        is updated to match. It fails only for the case that actually breaks —
        a split with the COPY left behind.
        """
        copied = self._copied_names()
        assert "config.py" in copied or "config/" in copied, (
            "main.py imports config at module scope; an image without it is a "
            "gateway that never listens"
        )


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

    def test_default_compose_remains_keyless(self):
        assert "kalshi-demo-key-install" not in COMPOSE_CODE
        assert "kalshi_demo_key:/run/secrets" not in COMPOSE_CODE
        assert "kalshi_production_key:/run/reference-secrets" not in COMPOSE_CODE

    def test_opt_in_kalshi_keys_are_installed_for_the_gateway_uid(self):
        assert "source: ./Part2_Infrastructure/secrets" in KALSHI_COMPOSE
        assert "target: /source" in KALSHI_COMPOSE
        assert "read_only: true" in KALSHI_COMPOSE
        assert "create_host_path: false" in KALSHI_COMPOSE, (
            "a missing secrets directory must fail the opt-in startup, not be created by Docker"
        )
        assert 'chown 10001:10001 "$${incoming}"' in KALSHI_COMPOSE
        assert 'chown 10001:10001 "$${production_incoming}"' in KALSHI_COMPOSE
        assert 'chmod 0400 "$${incoming}"' in KALSHI_COMPOSE
        assert 'chmod 0400 "$${production_incoming}"' in KALSHI_COMPOSE
        assert KALSHI_COMPOSE.count("RSAPrivateKey") == 4
        assert "trap cleanup EXIT" in KALSHI_COMPOSE
        assert 'rm -f "$${incoming}" "$${production_incoming}"' in KALSHI_COMPOSE
        assert "KALSHI_PRODUCTION_KEY_ID requires secrets/kalshi-production-private-key.pem" in KALSHI_COMPOSE
        assert "secrets/kalshi-production-private-key.pem requires KALSHI_PRODUCTION_KEY_ID" in KALSHI_COMPOSE
        assert "condition: service_completed_successfully" in KALSHI_COMPOSE

    def test_opt_in_gateway_sees_only_the_separate_read_only_secret_volumes(self):
        assert "KALSHI_DEMO_PRIVATE_KEY_PATH: /run/secrets/kalshi-demo-private-key.pem" in KALSHI_COMPOSE
        assert "KALSHI_PRODUCTION_PRIVATE_KEY_PATH: /run/reference-secrets/kalshi-production-private-key.pem" in KALSHI_COMPOSE
        assert "kalshi_demo_key:/run/secrets:ro" in KALSHI_COMPOSE
        assert "kalshi_demo_key:/run/secrets\n" in KALSHI_COMPOSE
        assert "kalshi_production_key:/run/reference-secrets:ro" in KALSHI_COMPOSE
        assert "kalshi_production_key:/run/reference-secrets\n" in KALSHI_COMPOSE
        assert "-----BEGIN" not in KALSHI_COMPOSE

    def test_host_container_and_documented_paths_stay_aligned(self):
        assert re.search(
            r"^KALSHI_DEMO_PRIVATE_KEY_PATH=secrets/kalshi-demo-private-key\.pem$",
            ENV_EXAMPLE,
            re.M,
        )
        assert re.search(
            r"^KALSHI_PRODUCTION_PRIVATE_KEY_PATH=secrets/kalshi-production-private-key\.pem$",
            ENV_EXAMPLE,
            re.M,
        )
        assert re.search(r"^/secrets/$", GITIGNORE, re.M)
        assert "-f Part2_Infrastructure/docker/compose.kalshi.yml" in SETUP
        assert "Part2_Infrastructure/secrets/kalshi-demo-private-key.pem" in SETUP
        assert "Part2_Infrastructure/secrets/kalshi-production-private-key.pem" in SETUP
        assert "alphaengine-gateway:local" in COMPOSE
        assert "alphaengine-gateway:local" in KALSHI_COMPOSE


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
        for name, text in (
            ("Dockerfile", DOCKERFILE_CODE),
            ("compose", COMPOSE_CODE),
            ("Kalshi compose override", KALSHI_COMPOSE_CODE),
        ):
            for line in text.splitlines():
                if "${" in line:  # an env reference, not a literal
                    continue
                for shape in self.SECRET_SHAPES:
                    match = shape.search(line)
                    assert match is None, (
                        f"secret-shaped literal in {name}: {match.group(0)[:12]}…"
                    )
