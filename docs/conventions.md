# Conventions

This project's stack conventions: the framework and libraries it uses, and
the patterns to follow with them. Every agent reads this file before writing
code, whatever tool it runs in.

Add a convention when the user settles one, in a line or two, with the
reason where it isn't obvious. Keep rules about how work is done in
AGENTS.md; this file is about the code.

## The machinery

- **Node built-ins only** for the machinery. Bash appears only as one-line
  hook shims that call Node, and as the test runner's one Windows anchor
  command.
- **The test run's global setup starts one shell on Windows.** Git for
  Windows' shells share one `/tmp` mapping, set from the `TEMP` of the first
  one to start and kept while any of them is alive. The suite gives each test
  file its own temp folder and deletes it when the file ends, so without a
  long-lived shell of Git's own install holding `/tmp` on a folder that
  outlives the run, a shell started later can find `/tmp` gone and warn.
  Every `test` script names a global setup (Node's `--test-global-setup`),
  which the test runner runs once, before the first test file: it starts that
  shell, and closes it after the last. Only an MSYS process of that install
  can hold it, so this one command can't be Node.
- **Seams** between domain logic and git, `gh`, the filesystem, the clock and
  user prompts, so tests can fake them.
- **Deep modules:** simple interfaces over substantial implementations. Apply
  the deletion test: if deleting a module makes complexity vanish, it was a
  pass-through.
- **File length** is capped in one config file, the only place the number
  appears. Split along existing seams; don't raise the cap.
- **Comments are for TypeScript developers of every level.** No internal plan
  IDs (`P3.1`, `D2`, "decision 23", "subtask 1.7"): state the reason itself,
  and point to an ADR when the full story matters.

## Tests and delivery

- **The gate runs every test file,** whatever changed: never select tests by
  diff.
- **Tests that install real frameworks are the release tier**
  (`pnpm test:release`), required before a release, not on every pull
  request.
- **Verified means installing what `pnpm pack:local <dir>` packs,** never
  `pnpm pack`.
