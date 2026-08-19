"""Supervised learning on the desk's own bars.

Three modules, in dependency order:

* ``splits``   — purged, embargoed walk-forward. The leak guard.
* ``models``   — ridge and logistic regression, hand-rolled in NumPy.
* ``features`` — the feature builder and its canonical spec.

Everything here is deterministic given a seed and a data hash, because the
project's standard for a research result is that someone else can reproduce it,
and a fitted model that cannot be re-fitted is an anecdote.
"""
