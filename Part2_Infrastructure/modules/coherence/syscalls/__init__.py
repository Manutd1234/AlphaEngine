"""The engine's verbs: observe, certify, size, execute, replay.

One module per verb, each a thin composition over kernel and drivers.
These are what the gateway routes call, and what a notebook calls, so the two
cannot drift."""
