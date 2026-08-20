"""Supervised learning on the desk's own bars.

Four modules, in dependency order:

* ``splits``    — purged, embargoed walk-forward. The leak guard.
* ``models``    — ridge and logistic regression, hand-rolled in NumPy.
* ``features``  — the feature builder and its canonical spec.
* ``selection`` — the candidate set a run chose from, and the PBO that says
  whether the choosing was worth anything. Refuses to answer rather than
  answering 0.0 when there is nothing to answer from.

Everything here is deterministic given a seed and a data hash, because the
project's standard for a research result is that someone else can reproduce it,
and a fitted model that cannot be re-fitted is an anecdote.
"""
