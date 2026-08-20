"""The seam between ``main.py`` and ``modules/api/`` — held where it was drawn.

``main.py`` declared all fifty-two paths until the tag groups became routers.
The split is worth almost nothing on its own; what makes it safe is that the
two ways it can rot are both caught here rather than in production.

ROT ONE — a router nobody mounts.
    A new route lands in ``modules/api/whatever.py``, the module is never added
    to the include list in ``main.py``, and every check downstream still
    passes: ruff is happy, the module imports, its own unit tests exercise the
    handler directly. The gateway simply 404s. ``tools/openapi.json`` would
    catch a route that *disappeared* — it is a committed snapshot — but not one
    that never arrived, because nothing regenerates a snapshot for a route it
    has never seen.

ROT TWO — routes drifting back into ``main.py``.
    One ``@app.get`` added "just here for now" and the file starts growing
    again. That is how it reached 1,241 lines the first time.

The third assertion is the seam itself: one tag group per router module, and no
tag shared between two of them. That is what makes "which file does this route
live in" answerable from the tag in ``/docs``.
"""

from __future__ import annotations

import ast
from pathlib import Path

from fastapi import APIRouter

import main
import modules.api as api_package

ROOT = Path(__file__).resolve().parent.parent

#: Every router the package publishes, by the name ``main.py`` imports it under.
ROUTERS: dict[str, APIRouter] = {
    name: getattr(api_package, name)
    for name in api_package.__all__
    if isinstance(getattr(api_package, name), APIRouter)
}


def _declared(router: APIRouter) -> set[tuple[str, str]]:
    """The (path, method) pairs a router publishes to the schema."""
    return {
        (route.path, method.lower())
        for route in router.routes
        if getattr(route, "include_in_schema", False)
        for method in getattr(route, "methods", ())
        if method != "HEAD"
    }


def _published() -> set[tuple[str, str]]:
    return {
        (path, method)
        for path, operations in main.app.openapi()["paths"].items()
        for method in operations
    }


def test_every_router_the_package_publishes_is_actually_mounted():
    assert ROUTERS, "modules.api exported no routers — the introspection below is measuring nothing"

    published = _published()
    unmounted = sorted(
        f"{name}: {sorted(missing)}"
        for name, router in ROUTERS.items()
        if (missing := _declared(router) - published)
    )
    assert not unmounted, (
        "these routers declare routes the gateway does not serve — add them to "
        "the include list in main.py:\n  " + "\n  ".join(unmounted)
    )


def test_nothing_is_published_from_outside_a_router():
    """The other direction: every published path traces back to a router module.

    Without this the first assertion is satisfied by a route re-declared in
    ``main.py`` as well as in its router, which is the state the split exists
    to end.
    """
    from_routers: set[tuple[str, str]] = set()
    for router in ROUTERS.values():
        from_routers |= _declared(router)

    orphans = sorted(_published() - from_routers)
    assert not orphans, (
        "these paths are served but belong to no router in modules/api:\n  "
        f"{orphans}"
    )


def test_main_declares_no_api_routes_of_its_own():
    """``main.py`` may keep the console aliases and nothing else.

    Read from the file at its committed path on purpose — that path is fixed by
    ``docker/gateway.Dockerfile``, which copies the root modules by name, so a
    ``main.py`` this test could not find would be a container missing its
    entrypoint long before it was a missing test.
    """
    source = ROOT / "main.py"
    assert source.exists(), "main.py must stay at the repository root — the image copies it by name"

    decorated: list[str] = []
    for node in ast.walk(ast.parse(source.read_text())):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            call = decorator.func if isinstance(decorator, ast.Call) else decorator
            if (
                isinstance(call, ast.Attribute)
                and isinstance(call.value, ast.Name)
                and call.value.id == "app"
                and call.attr in {"get", "post", "put", "patch", "delete", "websocket"}
                and isinstance(decorator, ast.Call)
                and decorator.args
                and isinstance(decorator.args[0], ast.Constant)
            ):
                decorated.append(str(decorator.args[0].value))

    assert sorted(decorated) == ["/", "/app", "/ui"], (
        "main.py declares routes again — they belong in a modules/api router:\n  "
        f"{sorted(decorated)}"
    )


def test_each_router_owns_exactly_one_tag_and_shares_it_with_no_other():
    """One tag group per module. That is the seam the split was drawn along."""
    paths = main.app.openapi()["paths"]
    tags_by_router: dict[str, set[str]] = {}
    for name, router in ROUTERS.items():
        tags: set[str] = set()
        for path, method in _declared(router):
            # `.get` rather than `[]`: an unmounted router is the assertion
            # above's finding to report, and a KeyError here would bury it.
            tags |= set(paths.get(path, {}).get(method, {}).get("tags", []))
        tags_by_router[name] = tags

    multiple = sorted(f"{name}: {sorted(tags)}" for name, tags in tags_by_router.items() if len(tags) != 1)
    assert not multiple, (
        "a router module must publish exactly one tag group:\n  " + "\n  ".join(multiple)
    )

    seen: dict[str, str] = {}
    shared = []
    for name, tags in tags_by_router.items():
        tag = next(iter(tags))
        if tag in seen:
            shared.append(f"{tag}: {seen[tag]} and {name}")
        seen[tag] = name
    assert not shared, (
        "two router modules publish the same tag, so the tag no longer says "
        "which file a route lives in:\n  " + "\n  ".join(shared)
    )
