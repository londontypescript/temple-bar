// What the judge looks for in a pull request: changes to the files that
// decide whether and how its checks run. A pull request's own CI runs the
// workflow files and scripts from the pull request itself, so a pull request
// that weakens them could go green on its own say-so. These are the changes
// that can't be judged by the checks they change. See
// docs/adr/0011-which-checks-judge-a-pull-request.md and
// docs/adr/0015-every-package-checked-and-guarded.md.
//
// Pure: it is handed each changed guarded path's state on both sides and
// never reads GitHub or the disk itself. The judge hands it what GitHub's
// trees hold (github-changes.ts); `ready` and `merge` hand it what git holds
// (../merge/guarded-states.ts), so all three name the same changes.

import {
  modeFindings,
  textOf,
  unreadableFindings,
  type FileState,
  type PathChange,
} from "./file-state.ts";
import {
  isGuarded,
  isManifest,
  isRootLockfile,
  isWholeFileGuarded,
} from "./guarded-paths.ts";
import { lockfileFindings } from "./lockfile.ts";
import { manifestFindings, TEMPLE_BAR_PACKAGE } from "./manifests.ts";

/** What to do about a change the judge refuses, said the same way wherever
 * temple-bar refuses one. The maintainer lets it through with the bypass
 * the judge's ruleset gives the repository admin role. Only the maintainer
 * runs that merge; temple-bar never does, and never names how. */
export const ASK_FOR_ADMIN_MERGE =
  "Ask the maintainer to review the pull request and, if they agree, to " +
  "merge it themselves as a repository admin.";

/** Not a regular file at the head, else added, removed or modified. A
 * side that couldn't be read counts as there: unknown is never absent. */
function status({ base, head }: PathChange): string {
  if (head.kind === "special") {
    return "not a regular file";
  }
  if (base.kind === "absent") {
    return "added";
  }
  return head.kind === "absent" ? "removed" : "modified";
}

function text(file: string, state: FileState): string | undefined {
  return state.kind === "regular" ? textOf(file, state) : undefined;
}

/** temple-bar's entries in the root lockfile, compared on both sides. */
function lockfileChange({ path: file, base, head }: PathChange): string[] {
  if (base.kind === "unreadable" || head.kind === "unreadable") {
    return unreadableFindings(file, base, head);
  }
  const findings = modeFindings(file, base, head);
  if (head.kind === "special") {
    return findings;
  }
  return [
    ...findings,
    ...lockfileFindings(TEMPLE_BAR_PACKAGE, text(file, base), text(file, head)),
  ];
}

const byPath = (a: PathChange, b: PathChange): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * Every change to the checks, one line each, in a stable order: workflows,
 * pnpm's install settings and temple-bar's config first, then each
 * package.json by path, then temple-bar's entries in the root lockfile.
 * Empty when the change leaves them alone. Paths that aren't guarded are
 * left out, whatever their state. A path that is the same on both sides
 * still counts when the head has it as something other than a regular
 * file: the readers hand those over changed or not.
 */
export function findCheckChanges(changes: readonly PathChange[]): string[] {
  const guarded = changes.filter((change) => isGuarded(change.path));
  guarded.sort(byPath);
  const files = guarded
    .filter((change) => isWholeFileGuarded(change.path))
    .map((change) => `${change.path} (${status(change)})`);
  const manifests = guarded
    .filter(
      (change) => !isWholeFileGuarded(change.path) && isManifest(change.path),
    )
    .flatMap((change) =>
      manifestFindings(change.path, change.base, change.head),
    );
  const lockfile = guarded
    .filter((change) => isRootLockfile(change.path))
    .flatMap(lockfileChange);
  return [...files, ...manifests, ...lockfile];
}
