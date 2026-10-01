// The POSIX-sh shim scripts install.ts writes into the git folder every
// worktree shares (<git-common-dir>/hooks/, git's own default hooks folder).
// Git always runs hooks with `sh`, on every OS including Git for Windows, so
// these are plain POSIX sh, not Node.
//
// The hooks live there, not in a tracked folder of the repo, so the same
// hooks run in every worktree whatever branch it has checked out. A tracked
// folder only exists on branches made after setup: worktrees on older
// branches had no hooks at all, and a fast-forward that brought the folder in
// started running hooks half-way through.
//
// Each shim runs the real CLI at node_modules/.bin/temple-bar (the sh
// launcher npm and pnpm generate on every OS) of some checkout of the repo:
// the one whose install wrote the shims, else this worktree's, else the
// first other worktree's that has one. A brand-new worktree, or one whose
// branch predates setup, has no node_modules of its own and is still checked
// by the copy installed elsewhere. With no copy anywhere the shim fails
// closed: it refuses the operation rather than letting it through.
//
// Kept as plain string constants (not template files) so install.ts and its
// tests share exactly one source of truth for the installed content.

// Every message is printed inside single quotes by `echo`, so none may
// contain a single quote; shims.test.ts would catch one.
const NOT_INSTALLED_MESSAGE =
  "temple-bar is not installed in any checkout of this repo, so its git hooks refuse this change.\n" +
  "Run pnpm install, then run the same git command again.";

const NOT_SET_UP_MESSAGE =
  "temple-bar is not installed in any checkout of this repo, so this new worktree was not set up.\n" +
  "Run pnpm install in it.";

// git updates the files of a fast-forward (a pull or `git checkout -B`)
// before it asks this hook about the ref, so a refusal there leaves the new
// files staged on the old commit. Running the same command once temple-bar is
// installed completes it from exactly that state.
const HALF_DONE_NOTE =
  "If git already updated your files, running the command again finishes it.";

/** Every temple-bar shim, from every release, has this line second, so
 * install.ts can tell a shim another temple-bar version wrote from a hook
 * that belongs to someone else. */
export const SHIM_MARKER = "# Installed by `temple-bar hook install`.";

const HEADER = `#!/bin/sh
${SHIM_MARKER} Do not edit by hand.`;

/** The file, beside the shims, naming the checkout whose temple-bar wrote
 * them (install.ts writes it). */
export const INSTALLED_CHECKOUT_FILE = "temple-bar-checkout";

// Sets $bin to the CLI to run, or to nothing when no worktree has one. First
// choice: the temple-bar that wrote these shims, since an older one may not
// know every hook they call. Then this worktree's own, then any other's;
// `git worktree list` names the main worktree first.
const FIND_CLI = `bin=""
common=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -n "$common" ] && [ -f "$common/hooks/${INSTALLED_CHECKOUT_FILE}" ]; then
  IFS= read -r installed < "$common/hooks/${INSTALLED_CHECKOUT_FILE}"
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
fi`;

const REFUSE_IF_MISSING = `if [ -z "$bin" ]; then
  echo '${NOT_INSTALLED_MESSAGE}' >&2
  exit 1
fi`;

export const PRE_COMMIT_SHIM = `${HEADER}
${FIND_CLI}
${REFUSE_IF_MISSING}
exec "$bin" hook pre-commit
`;

// git passes the message file's path as $1; it is handed to temple-bar as is.
export const COMMIT_MSG_SHIM = `${HEADER}
${FIND_CLI}
${REFUSE_IF_MISSING}
exec "$bin" hook commit-msg "$1"
`;

// git passes the remote's name and URL as $1 and $2, and the refs being
// pushed on stdin, which the hook inherits.
export const PRE_PUSH_SHIM = `${HEADER}
${FIND_CLI}
${REFUSE_IF_MISSING}
exec "$bin" hook pre-push "$1" "$2"
`;

export const REFERENCE_TRANSACTION_SHIM = `${HEADER}
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
${FIND_CLI}
if [ -z "$bin" ]; then
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

// git passes the previous HEAD, the new HEAD and a flag (1 for a branch
// checkout) on every checkout. Only a previous HEAD of all zeros, which is
// what `git worktree add` passes, can mean a new checkout to set up; every
// other checkout returns here without starting even git. The CLI then tells
// a new worktree apart from a fresh clone, which passes zeros too.
//
// The checkout has already happened and can't be refused, so with no
// temple-bar anywhere this only says what was skipped.
export const POST_CHECKOUT_SHIM = `${HEADER}
case "$1" in
  ""|*[!0]*) exit 0 ;;
esac
${FIND_CLI}
if [ -z "$bin" ]; then
  echo '${NOT_SET_UP_MESSAGE}' >&2
  exit 1
fi
exec "$bin" hook post-checkout "$1" "$2" "$3"
`;
