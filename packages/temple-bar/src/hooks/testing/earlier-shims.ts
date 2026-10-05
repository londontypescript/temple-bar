// The shims exactly as earlier releases installed them, so the
// install tests can prove an upgrade replaces them. Frozen history: never
// edit these to match the current shims.

export const PRE_COMMIT_SHIM_0_0_3 = `#!/bin/sh
# Installed by \`temple-bar hook install\`. Do not edit by hand: a second
# install run only reports a conflict if this content has changed.
root=$(git rev-parse --show-toplevel) || exit 1
bin="$root/node_modules/.bin/temple-bar"
if [ ! -x "$bin" ]; then
  echo "temple-bar isn't installed here: run your package manager's install" >&2
  exit 1
fi
exec "$bin" hook pre-commit
`;

export const REFERENCE_TRANSACTION_SHIM_0_0_3 = `#!/bin/sh
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
  echo "temple-bar isn't installed here: run your package manager's install" >&2
  exit 1
fi
printf '%s\\n' "$input" | exec "$bin" hook reference-transaction "$state"
`;

// 0.0.5 to 0.0.7: only a new worktree started Node.
export const POST_CHECKOUT_SHIM_0_0_7 = `#!/bin/sh
# Installed by \`temple-bar hook install\`. Do not edit by hand.
case "$1" in
  ""|*[!0]*) exit 0 ;;
esac
bin=""
common=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -n "$common" ] && [ -f "$common/hooks/temple-bar-checkout" ]; then
  IFS= read -r installed < "$common/hooks/temple-bar-checkout"
  bin="$installed/node_modules/.bin/temple-bar"
fi
if [ ! -x "$bin" ]; then
  root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$root" ]; then
    bin="$root/node_modules/.bin/temple-bar"
  fi
fi
if [ ! -x "$bin" ]; then
  bin=$(git worktree list --porcelain | while IFS= read -r line; do
    candidate="\${line#worktree }/node_modules/.bin/temple-bar"
    if [ "\${line#worktree }" != "$line" ] && [ -x "$candidate" ]; then
      printf '%s\\n' "$candidate"
      break
    fi
  done)
fi
if [ -z "$bin" ]; then
  echo 'temple-bar is not installed in any checkout of this repo, so this new worktree was not set up.
Run pnpm install in it.' >&2
  exit 1
fi
exec "$bin" hook post-checkout "$1" "$2" "$3"
`;
