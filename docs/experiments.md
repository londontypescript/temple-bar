# Experiments

How this repo runs work whose result is a measurement: performance work and
long CI experiments. Read it before planning either.

- **Performance work freezes a baseline before building:** its plan names the
  benchmark, the commits and the target, and it is done on that benchmark's
  result, never on ordinary CI times.
- **A long CI experiment smoke-tests first:** one round with fail-fast, and the
  full run only once that round is clean.
