// The shims exactly as releases 0.0.1 to 0.0.3 installed them, so the
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
