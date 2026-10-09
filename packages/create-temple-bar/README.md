# @londontypescript/create-temple-bar

The setup launcher for [temple-bar](https://github.com/londontypescript/temple-bar#readme), the London TypeScript workflow enforced on AI coding agents via git hooks, a quality gate and GitHub rules.

> **Pre-release** (`0.0.x`). Expect changes.

```bash
pnpm create @londontypescript/temple-bar@latest
```

temple-bar works with pnpm only: [install it](https://pnpm.io/installation) first. It adds `@londontypescript/temple-bar` as a dev dependency, pinned to its own version, runs `pnpm install --frozen-lockfile`, then runs `temple-bar init`.

Installation runs the project's lifecycle scripts, including framework preparation, unless your pnpm settings disable them. In a workspace, pnpm installs the workspace and runs its lifecycle scripts. An installation failure stops setup before `init`. Run the launcher from the repository root. Workspace member setup is not supported: installation runs across the workspace, but `init` configures the repository root while the dependency is added to the member.

Run `pnpm create @londontypescript/temple-bar@latest -- --help` to see the usage. It changes nothing.

MIT licence.
