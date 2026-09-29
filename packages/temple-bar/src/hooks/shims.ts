// The two POSIX-sh shim scripts installed into <repoRoot>/.githooks/ by
// install.ts. Git always runs hooks with `sh`, on every OS including Git for
// Windows, so these are plain POSIX sh, not Node. Each locates the real CLI
// at node_modules/.bin/temple-bar (the sh launcher npm and pnpm generate on
// every OS) via `git rev-parse --show-toplevel`, so it works from any
// worktree. A missing/non-executable CLI fails closed: the shim refuses the
// operation rather than silently letting it through.
//
// Kept as plain string constants (not template files) so install.ts and its
// tests share exactly one source of truth for the installed content.

const CLI_NOT_FOUND_MESSAGE =
  "temple-bar isn't installed here: run your package manager's install";

export const PRE_COMMIT_SHIM = `#!/bin/sh
# Installed by \`temple-bar hook install\`. Do not edit by hand: a second
# install run only reports a conflict if this content has changed.
root=$(git rev-parse --show-toplevel) || exit 1
bin="$root/node_modules/.bin/temple-bar"
if [ ! -x "$bin" ]; then
  echo "${CLI_NOT_FOUND_MESSAGE}" >&2
  exit 1
fi
exec "$bin" hook pre-commit
`;

export const REFERENCE_TRANSACTION_SHIM = `#!/bin/sh
# Installed by \`temple-bar hook install\`. Do not edit by hand: a second
# install run only reports a conflict if this content has changed.
#
# Must stay fast on ordinary fetches: only starts Node when the "prepared"
# state's stdin mentions refs/heads/main. Everything else exits 0 without
# touching Node.
state=$1
if [ "$state" != "prepared" ]; then
  exit 0
fi
input=$(cat)
case "$input" in
  *refs/heads/main*) ;;
  *) exit 0 ;;
esac
root=$(git rev-parse --show-toplevel) || exit 1
bin="$root/node_modules/.bin/temple-bar"
if [ ! -x "$bin" ]; then
  echo "${CLI_NOT_FOUND_MESSAGE}" >&2
  exit 1
fi
printf '%s\\n' "$input" | exec "$bin" hook reference-transaction "$state"
`;
