# @londontypescript/temple-bar

**Prose != Enforcement.** Rules for AI coding agents that git actually enforces.

> **Pre-release** (`0.0.x`). Expect changes.

Set it up in a project with the launcher:

```bash
pnpm create @londontypescript/temple-bar@latest
```

temple-bar works with pnpm only: [install it](https://pnpm.io/installation) first. Installing this package on its own doesn't set anything up; if you already have, finish with `pnpm exec temple-bar init`.

Once the repo has files of its own, beyond the ones it starts with, `temple-bar gate` needs `typecheck`, `lint`, `format:check` and `test` scripts in `package.json`, and fails one that does nothing. It runs every one that exists, then the file-length cap and the AGENTS.md size limit (200 lines, 32 KiB), and lists each check with its result. Every command takes `--help`.

What setup does, and how to use it with an AI agent: [the full README](https://github.com/londontypescript/temple-bar#readme).

MIT licence.
