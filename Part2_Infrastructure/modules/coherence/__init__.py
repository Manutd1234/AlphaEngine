"""COHERENCE — a de Finetti coherence engine for Kalshi.

A Kalshi contract pays one dollar if an event happens, so its price *is* a
probability. The exchange publishes the logical structure between contracts in
its own metadata — mutually exclusive baskets, strike ladders, buckets,
settlement sources — which makes the whole venue a partially ordered set of
probability claims.

De Finetti's theorem gives the test. A set of prices is **coherent** when some
probability measure reproduces them, and incoherent otherwise; an incoherent
set admits a Dutch book, a portfolio that wins in every state of the world. So
this engine does not scan for arbitrage patterns a person thought of in
advance. It asks one question — *does a measure exist consistent with all of
these prices, given the books, the fees and the capital?* — and when the answer
is no, the certificate of infeasibility **is** the trade: legs, ratios, size.

Layout follows that argument:

* ``kernel/``    pure, deterministic, no I/O, no clock, and no float ever
* ``drivers/``   the Kalshi REST client, its parsers and its fee sources
* ``fs/``        the append-only book tape and its replay
* ``scheduler/`` a token budgeter that plans spend rather than reacting to 429s
* ``syscalls/``  observe, certify, size, execute (dry run), replay

The invariant that makes this infrastructure rather than a script: ``kernel``
never touches the network or the clock, so live and replay call the identical
function and the same tape must produce the same decision.
"""
