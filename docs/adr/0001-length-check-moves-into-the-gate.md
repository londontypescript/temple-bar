# ADR 0001: The file-length check moves into the gate

Date: 2026-09-29. Status: accepted (decision 23).

## Context

In 1.2, before any gate existed, this repo checked its file-length cap with its
own script: `scripts/lengths.ts`, run by `scripts/check-lengths.ts` through
`pnpm check`. In 1.6 the gate got its own length check, ported by hand from that
script. From then on, the cap was checked twice, by two copies of the same
logic that could drift apart.

## Decision

The repo's own script is deleted. CI runs the pinned, published `pnpm gate`,
which checks the cap from the same `temple-bar.config.json`. `pnpm check` stays
as an alias for the gate.

## What ended the old choice

The old choice was right while no published gate existed: the repo had to check
itself somehow. It ended when the pinned release (0.0.3) required every check
this repo runs, including `format:check`, so the published gate could judge
every pull request on its own (decisions 7 and 23).
