"""A token budgeter, not a rate limiter.

Kalshi's limits are token buckets with a published cost per endpoint, so the
honest client models its own bucket and PLANS spend. Reacting to 429s is the
design that gets a client banned; and for keyless traffic no budget is
documented at all, so this package assumes far less than the smallest tier."""
