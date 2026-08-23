"""Everything that talks to Kalshi: the REST client, the parsers, the fee feeds.

The boundary is deliberate — drivers turn the venue's strings into kernel types
and nothing else. Business logic here would be logic the replay path never
runs."""
