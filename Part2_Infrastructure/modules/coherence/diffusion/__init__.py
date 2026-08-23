"""DIFFUSION — how fast an announcement reaches the price.

A sibling of the coherence kernel rather than part of it. The kernel asks
whether a set of prices admits a probability measure at one instant; this asks
how long a *single* price takes to finish absorbing one piece of news, and
whether the text of that news says in advance how long it will take.

Two things are measured and they are kept apart on purpose:

* **absorption** — the shape of the abnormal-return path after a timestamped
  announcement, reduced to a half-life. Arithmetic over bars; no model.
* **information** — the resolution at which one text explains another,
  estimated as the integrand of a diffusion mutual-information bound over
  log-SNR. A model, and an optional one: the Gaussian reference is closed form
  and ships without torch.

The first is the dependent variable and the second is the instrument, so they
must be computable independently or the study cannot be falsified. Everything
here is importable without a network, without Supabase and without torch; what
is missing is reported as a state with a reason, never as a zero.
"""
