# ADR 0008: Status without a `doctor` command

Date: 2026-10-01. Status: accepted (decisions 13 and 14; 14 is decided but
not built yet).

## Context

People and tools need to know a branch's state: whether its checks pass,
whether its setup is complete, what is happening in each worktree. The
earlier brief asked for this through "the gate _or doctor_", a separate
command to inspect a repo's health, and for status a morning summary could
read. These two decisions replace both.

## Decision

**Decision 13: no `doctor` command.** Status stays truthful through the hooks
and the gate, which run whether or not anyone remembers to ask. A separate
health command is one more thing an agent can forget to run, and a second
place where the same checks could drift apart. So "the core can't be
trimmed" is checked by the gate only. Views across several projects stay in
each person's own tools, which temple-bar never mentions.

**Decision 14: status is a published contract.** It has a versioned schema,
exported types, and additive-only changes, so tools that read it don't break
on an upgrade. A live JSONL log per worktree records status plus git events,
and is cleared when the branch ends. One rule: _when a branch's work ends,
everything local about it goes_, so no stale state outlives the branch it
describes. Not built yet (theme E).

Decision 14 is what let 13 drop `doctor`: anything that wants a branch's
state reads the contract instead of running a command.

## What would end it

This is wrong if a check is needed that neither the hooks nor the gate can
run at the right moment, for example something only worth checking on
request. If that kind of check accumulates, a command that runs them on
demand earns its place.
