"""The append-only book tape and its replay.

A current book cannot reconstruct a past one, and depth is forward-only: miss
it live and it is gone. The recorder therefore stores whole ladders rather than
summary prices, and the replay driver exposes the same interface as the live
one so the kernel cannot tell them apart."""
