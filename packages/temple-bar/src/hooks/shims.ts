// The POSIX-sh shim scripts installed into <repoRoot>/.githooks/ by
// install.ts. Git always runs hooks with `sh`, on every OS including Git for
// Windows, so these are plain POSIX sh, not Node. Each locates the real CLI
// at node_modules/.bin/temple-bar (the sh launcher npm and pnpm generate on
// every OS) via `git rev-parse --show-toplevel`, so it works from any
// worktree. A missing/non-executable CLI fails closed: the shim refuses the
// operation rather than silently letting it through.
//
// Kept as plain string constants (not template files) so install.ts and its
// tests share exactly one source of truth for the installed content.

// Both messages are printed inside single quotes by `echo`, so they must not
// contain a single quote; shims.test.ts would catch one.
const NOT_INSTALLED_MESSAGE =
  "temple-bar is not installed in this checkout, so its git hooks refuse this change.\n" +
  "Run pnpm install, then run the same git command again.";

// git updates the files of a fast-forward (a pull or `git checkout -B`)
// before it asks this hook about the ref, so a refusal there leaves the new
// files staged on the old commit. Running the same command once temple-bar is
// installed completes it from exactly that state.
const HALF_DONE_NOTE =
  "If git already updated your files, running the command again finishes it.";

export const PRE_COMMIT_SHIM = `#!/bin/sh
# Installed by \`temple-bar hook install\`. Do not edit by hand: a second
# install run only reports a conflict if this content has changed.
root=$(git rev-parse --show-toplevel) || exit 1
bin="$root/node_modules/.bin/temple-bar"
if [ ! -x "$bin" ]; then
  echo '${NOT_INSTALLED_MESSAGE}' >&2
  exit 1
fi
exec "$bin" hook pre-commit
`;

// git passes the message file's path as $1; it is handed to temple-bar as is.
export const COMMIT_MSG_SHIM = `#!/bin/sh
# Installed by \`temple-bar hook install\`. Do not edit by hand: a second
# install run only reports a conflict if this content has changed.
root=$(git rev-parse --show-toplevel) || exit 1
bin="$root/node_modules/.bin/temple-bar"
if [ ! -x "$bin" ]; then
  echo '${NOT_INSTALLED_MESSAGE}' >&2
  exit 1
fi
exec "$bin" hook commit-msg "$1"
`;

export const REFERENCE_TRANSACTION_SHIM = `#!/bin/sh
# Installed by \`temple-bar hook install\`. Do not edit by hand: a second
# install run only reports a conflict if this content has changed.
#
# git runs this on every ref change, so it stays cheap: Node starts only when
# the change moves the protected branch. That branch is origin's default
# (refs/remotes/origin/HEAD), or main when that isn't known; temple-bar's
# protected-branch.ts holds the same rule.
state=$1
if [ "$state" != "prepared" ]; then
  exit 0
fi
input=$(cat)
# A fetch only touches remote-tracking refs and tags: no local branch, no
# ORIG_HEAD. Let it through without starting even git.
case "$input" in
  *" refs/heads/"*|*" ORIG_HEAD"*) ;;
  *) exit 0 ;;
esac
target=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)
case "$target" in
  refs/remotes/origin/HEAD) branch=main ;;
  refs/remotes/origin/?*) branch=\${target#refs/remotes/origin/} ;;
  *) branch=main ;;
esac
moves=no
orig_head=no
while read -r old new ref; do
  if [ "$ref" = "refs/heads/$branch" ]; then
    moves=yes
  fi
  if [ "$ref" = "ORIG_HEAD" ]; then
    orig_head=yes
  fi
done <<EOF
$input
EOF
if [ "$moves" = no ] && [ "$orig_head" = no ]; then
  exit 0
fi
root=$(git rev-parse --show-toplevel) || exit 1
bin="$root/node_modules/.bin/temple-bar"
if [ ! -x "$bin" ]; then
  # A pull, merge, rebase or reset records ORIG_HEAD before it touches any
  # file. Refusing there, while the protected branch is checked out, stops a
  # fast-forward before git rewrites the working tree.
  if [ "$moves" = no ] && [ "$(git symbolic-ref --quiet HEAD)" != "refs/heads/$branch" ]; then
    exit 0
  fi
  echo '${NOT_INSTALLED_MESSAGE}' >&2
  echo '${HALF_DONE_NOTE}' >&2
  exit 1
fi
if [ "$moves" = no ]; then
  exit 0
fi
printf '%s\\n' "$input" | exec "$bin" hook reference-transaction "$state"
`;
