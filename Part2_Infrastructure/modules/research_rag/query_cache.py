"""Bounded desk-scoped retrieval cache and the cached search orchestration."""

from __future__ import annotations

import asyncio
import copy
import os
import time
from collections import OrderedDict
from dataclasses import dataclass
from threading import RLock
from typing import Any, Callable

from modules.research_image import unavailable as image_unavailable
from modules.research_rag.arms import REASON_RETRIEVAL_UNAVAILABLE, _unretrieved
from modules.research_rag.chunking import collapse_parent_matches


def _integer(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if low <= value <= high else default


def _seconds(name: str, default: float, low: float, high: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if low <= value <= high else default


CACHE_MAX = _integer("RESEARCH_RETRIEVAL_CACHE_MAX", 256, 1, 4096)
CACHE_TTL_S = _seconds("RESEARCH_RETRIEVAL_CACHE_TTL_S", 30.0, 0.1, 3600.0)
CACHE_STALE_TTL_S = max(
    CACHE_TTL_S,
    _seconds("RESEARCH_RETRIEVAL_CACHE_STALE_TTL_S", 300.0, 1.0, 86400.0),
)


@dataclass(frozen=True)
class CacheKey:
    query: str
    match_count: int
    kind: str | None
    desk_id: str | None


@dataclass(frozen=True)
class CacheLookup:
    result: dict[str, Any]
    age_s: float
    fresh: bool


@dataclass
class _Entry:
    stored_at: float
    result: dict[str, Any]


class RetrievalResultCache:
    """An LRU whose stale horizon is finite and whose key includes the desk."""

    def __init__(
        self, *, maximum: int = CACHE_MAX, ttl_s: float = CACHE_TTL_S,
        stale_ttl_s: float = CACHE_STALE_TTL_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.maximum = max(1, int(maximum))
        self.ttl_s = max(0.0, float(ttl_s))
        self.stale_ttl_s = max(self.ttl_s, float(stale_ttl_s))
        self._clock = clock
        self._entries: OrderedDict[CacheKey, _Entry] = OrderedDict()
        self._lock = RLock()

    def lookup(self, key: CacheKey) -> CacheLookup | None:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            age = max(0.0, self._clock() - entry.stored_at)
            if age > self.stale_ttl_s:
                del self._entries[key]
                return None
            self._entries.move_to_end(key)
            return CacheLookup(copy.deepcopy(entry.result), age, age <= self.ttl_s)

    def put(self, key: CacheKey, result: dict[str, Any]) -> None:
        canonical = copy.deepcopy(result)
        canonical.pop("cache", None)
        with self._lock:
            self._entries[key] = _Entry(self._clock(), canonical)
            self._entries.move_to_end(key)
            while len(self._entries) > self.maximum:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


def _cache_for(rag: Any) -> RetrievalResultCache:
    cache = getattr(rag, "_retrieval_cache", None)
    if cache is None:
        cache = RetrievalResultCache()
        rag._retrieval_cache = cache
    return cache


def invalidate(rag: Any) -> None:
    cache = getattr(rag, "_retrieval_cache", None)
    if cache is not None:
        cache.clear()


def _marked(
    result: dict[str, Any], state: str, *, age_s: float = 0.0, reason: str | None = None,
) -> dict[str, Any]:
    marked = copy.deepcopy(result)
    marked["cache"] = {
        "state": state,
        "age_seconds": round(max(0.0, age_s), 3),
        **({"reason": reason} if reason else {}),
    }
    return marked


def _stale(lookup: CacheLookup | None, reason: str) -> dict[str, Any] | None:
    if lookup is None:
        return None
    return _marked(lookup.result, "stale", age_s=lookup.age_s, reason=reason)


def _all_retrieval_arms_failed(bm25: dict[str, Any], image: dict[str, Any]) -> bool:
    text_failed = bm25.get("reason") == REASON_RETRIEVAL_UNAVAILABLE
    image_searched = bool(image.get("ranked"))
    return text_failed and not image_searched


async def _once(
    rag: Any, vector: list[float], query: str, count: int, kind: str | None,
    desk_id: str | None, image_search: Callable[..., Any],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any], bool]:
    matches, bm25 = await rag._match_arms(
        vector, match_count=count, kind=kind, query_text=query, desk_id=desk_id,
    )
    matches, image = await image_search(rag._client, query, matches, count, kind, desk_id)
    collapsed, duplicate = collapse_parent_matches(matches, count)
    return collapsed, bm25, image, duplicate


async def _ranked(
    rag: Any, vector: list[float], query: str, count: int, kind: str | None,
    desk_id: str | None, image_search: Callable[..., Any],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    first = await _once(rag, vector, query, count, kind, desk_id, image_search)
    matches, bm25, image, duplicate = first
    wider = min(20, max(count + 1, count * 4))
    if duplicate and len(matches) < count and wider > count:
        candidate = await _once(rag, vector, query, wider, kind, desk_id, image_search)
        if not _all_retrieval_arms_failed(candidate[1], candidate[2]):
            matches, bm25, image, _duplicate = candidate
            matches = matches[:count]
    return matches, bm25, image


async def search_with_cache(
    rag: Any, query: str, match_count: int, kind: str | None, desk_id: str | None,
    image_search: Callable[..., Any],
) -> dict[str, Any]:
    """Search once per fresh key; serve bounded stale data only on upstream failure."""
    if not rag.enabled or not rag._client:
        detail = "the research index is not configured, so nothing was retrieved"
        return {
            "state": "unavailable", "matches": [], "bm25": _unretrieved(detail),
            "image": image_unavailable(REASON_RETRIEVAL_UNAVAILABLE, detail),
            "cache": {"state": "bypass", "age_seconds": 0.0},
        }

    count = max(1, int(match_count))
    key = CacheKey(str(query), count, kind, desk_id)
    cache = _cache_for(rag)
    lookup = cache.lookup(key)
    if lookup is not None and lookup.fresh:
        return _marked(lookup.result, "hit", age_s=lookup.age_s)

    vector = await rag._embed(query)
    if vector is None:
        detail = "the query could not be embedded, so nothing was retrieved"
        fallback = _stale(lookup, detail)
        if fallback is not None:
            return fallback
        return {
            "state": "embed_failed", "matches": [], "bm25": _unretrieved(detail),
            "image": image_unavailable(REASON_RETRIEVAL_UNAVAILABLE, detail),
            "cache": {"state": "miss", "age_seconds": 0.0},
        }

    corpus_size = asyncio.create_task(rag._corpus_size(desk_id))
    try:
        matches, bm25, image = await _ranked(
            rag, vector, query, count, kind, desk_id, image_search,
        )
    except BaseException:
        corpus_size.cancel()
        await asyncio.gather(corpus_size, return_exceptions=True)
        raise

    if _all_retrieval_arms_failed(bm25, image):
        corpus_size.cancel()
        await asyncio.gather(corpus_size, return_exceptions=True)
        detail = str(bm25.get("detail") or "all configured retrieval arms were unavailable")
        fallback = _stale(lookup, detail)
        if fallback is not None:
            return fallback
        return {
            "state": "unavailable", "matches": [], "corpus_size": None,
            "bm25": bm25, "image": image,
            "cache": {"state": "miss", "age_seconds": 0.0},
        }

    result = {
        "state": "ok", "matches": matches, "corpus_size": await corpus_size,
        "bm25": bm25, "image": image,
    }
    cache.put(key, result)
    return _marked(result, "miss")
