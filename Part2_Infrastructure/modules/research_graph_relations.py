"""The traversal's relation vocabulary, in the one form a ROUTE can take.

`supabase/migrations/20260820090400_research_edges.sql` declares
`public.research_relation` and `modules/research_graph_projection.RELATION_TYPES`
maps each value to a Neo4j relationship type. Neither is usable as a FastAPI
query parameter's type, so this is a third statement of the same six values and
that needs justifying rather than apologising for.

WHY A `Literal` AND NOT `RELATION_TYPES`' KEYS. FastAPI derives the OpenAPI
schema from the annotation, and two independently-deployed clients — the Next.js
workspace and the Telegram companion — generate against that schema. A parameter
annotated `list[str]` accepts `?relations=banana`, sends it to Postgres, and is
answered `invalid input value for enum research_relation` as a 500; a `Literal`
is an enum in the schema, is rejected 422 at the door with the six values in the
message, and appears in the clients' generated types. An enum built at import
time from a dict's keys renders as an opaque generated name in that schema, so
the clients get a contract nobody can read.

WHY NOT AN `assert` THAT THE THREE AGREE, at import. Because this module is
imported by `modules/api/research.py`, which is imported by the app that also
serves the pre-trade risk checks. An assertion here turns "somebody added a
relation to Postgres" into "the gateway does not boot", and losing the risk
plane is a far worse answer to that than serving a traversal that cannot yet
filter on the new value. `tests/test_research_seam_wiring.py` pins this tuple
against `RELATION_TYPES` and against the migration's own text instead, so drift
fails in CI — which is where a vocabulary change should be caught, and where
somebody is already looking.
"""

from __future__ import annotations

from typing import Literal, get_args

GraphRelation = Literal[
    "same_data", "same_symbol", "same_strategy", "same_regime", "followed_by", "promoted_to",
]

#: The same six as a tuple, for the drift test and for any caller that needs to
#: enumerate them. Derived from the annotation rather than written twice: two
#: hand-maintained copies in ONE file is the drift this module exists to bound.
RELATIONS: tuple[str, ...] = get_args(GraphRelation)
