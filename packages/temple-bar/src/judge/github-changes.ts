// What a pull request changes in the guarded files, read from GitHub as two
// fixed commits: the base branch's tip and the pull request's head, each
// read as a whole tree, and the blobs of the guarded files that differ.
//
// Why trees and not the pull request's list of changed files: that list
// can't be asked for a given commit, so one read while the head moves away
// and back can describe a commit neither read of the pull request names.
// Commits never change, so judging two named commits judges exactly them.
// A rename needs no model of its own: it is the old path gone and the new
// one there. See docs/adr/0015-every-package-checked-and-guarded.md.
//
// The base branch's current tip, not where the pull request branched off:
// that is what a merge would change. The judge's ruleset merges only
// branches that are up to date, and there the two are the same commit. On a
// branch that is behind, the comparison can only see too much (the base
// branch's own newer changes look like the pull request undoing them), so
// it refuses wrongly rather than passes wrongly, and updating the branch
// runs the judge again. The one thing it can't do is re-judge a pull
// request that has already merged: its changes are then on the base branch
// too, so it passes.

import type { Context } from "../context.ts";
import type { FileState, PathChange } from "./file-state.ts";
import { isGuarded, isWorkflowFolder, readsText } from "./guarded-paths.ts";
import {
  readBlob,
  readBranchTip,
  readPullRequest,
  readTree,
  type PullRequestRef,
  type Read,
} from "./github.ts";
import { isRegularFile, type TreeEntry } from "./tree-entry.ts";

export interface FixedChanges {
  readonly baseRef: string;
  readonly baseSha: string;
  readonly headSha: string;
  /** Each guarded path that differs, or that isn't a regular file at the
   * head, with both sides' state. */
  readonly changes: readonly PathChange[];
  /** Every path that differs between the two trees, guarded or not, in
   * plain code-unit order. Names only: none of them is read for this. */
  readonly paths: readonly string[];
}

export const MOVED_WHILE_READ =
  "the pull request or its base branch changed while the judge read it; " +
  "it runs again on the next push or update";

function differs(
  base: TreeEntry | undefined,
  head: TreeEntry | undefined,
): boolean {
  return base?.mode !== head?.mode || base?.id !== head?.id;
}

/** A path the pull request changes, for the list of everything it touches.
 * The recursive trees list folders too, and a folder's id changes whenever
 * anything inside it does, so a path that is only ever a folder (or not
 * there) is left out: the files inside it are listed by their own paths. A
 * folder replaced by a file, a symlink or a submodule still counts. */
function changedPath(
  base: TreeEntry | undefined,
  head: TreeEntry | undefined,
): boolean {
  const onlyFolder = (entry: TreeEntry | undefined) =>
    entry === undefined || entry.type === "tree";
  return differs(base, head) && !(onlyFolder(base) && onlyFolder(head));
}

/** A guarded path is judged when it changed, or when the head has it as
 * something other than a regular file, changed or not: a manifest that is
 * already a symlink follows a file no guard covers, so a pull request
 * changing only that file would change the manifest unseen. */
function judged(
  base: TreeEntry | undefined,
  head: TreeEntry | undefined,
): boolean {
  return differs(base, head) || (head !== undefined && !isRegularFile(head));
}

/** A tree entry as the comparison sees it, with its text read only where
 * the comparison needs it, and only from a regular file. */
async function stateOf(
  ctx: Context,
  pr: PullRequestRef,
  file: string,
  entry: TreeEntry | undefined,
): Promise<Read<FileState>> {
  if (entry === undefined) {
    return { ok: true, value: { kind: "absent" } };
  }
  if (!isRegularFile(entry)) {
    return { ok: true, value: { kind: "special", mode: entry.mode } };
  }
  if (!readsText(file)) {
    return { ok: true, value: { kind: "regular", mode: entry.mode } };
  }
  const text = await readBlob(ctx, pr, entry.id);
  return text.ok
    ? {
        ok: true,
        value: { kind: "regular", mode: entry.mode, text: text.value },
      }
    : text;
}

/** The guarded paths that differ between the two trees, read, and the
 * names of every path that differs. */
async function compareTrees(
  ctx: Context,
  pr: PullRequestRef,
  base: ReadonlyMap<string, TreeEntry>,
  head: ReadonlyMap<string, TreeEntry>,
): Promise<Read<Pick<FixedChanges, "changes" | "paths">>> {
  const changes: PathChange[] = [];
  const paths: string[] = [];
  const seen = (tree: ReadonlyMap<string, TreeEntry>, file: string) => {
    const entry = tree.get(file);
    return entry === undefined || isWorkflowFolder(file, entry)
      ? undefined
      : entry;
  };
  for (const file of new Set([...base.keys(), ...head.keys()])) {
    if (changedPath(base.get(file), head.get(file))) {
      paths.push(file);
    }
    const before = seen(base, file);
    const after = seen(head, file);
    if (!isGuarded(file) || !judged(before, after)) {
      continue;
    }
    const was = await stateOf(ctx, pr, file, before);
    if (!was.ok) {
      return was;
    }
    const now = await stateOf(ctx, pr, file, after);
    if (!now.ok) {
      return now;
    }
    changes.push({ path: file, base: was.value, head: now.value });
  }
  // The default sort compares UTF-16 code units, the order every other
  // list of paths in the judge uses.
  paths.sort();
  return { ok: true, value: { changes, paths } };
}

/** Fixes the two commits, reads them, then checks that neither the pull
 * request nor its base branch moved meanwhile. If one did, what was read
 * may not be what GitHub would merge, so it is no answer. */
export async function readFixedChanges(
  ctx: Context,
  pr: PullRequestRef,
): Promise<Read<FixedChanges>> {
  const first = await readPullRequest(ctx, pr);
  if (!first.ok) {
    return first;
  }
  const { headSha, baseRef } = first.value;
  const baseSha = await readBranchTip(ctx, pr, baseRef);
  if (!baseSha.ok) {
    return baseSha;
  }
  const baseTree = await readTree(ctx, pr, baseSha.value);
  if (!baseTree.ok) {
    return baseTree;
  }
  const headTree = await readTree(ctx, pr, headSha);
  if (!headTree.ok) {
    return headTree;
  }
  const compared = await compareTrees(ctx, pr, baseTree.value, headTree.value);
  if (!compared.ok) {
    return compared;
  }

  const last = await readPullRequest(ctx, pr);
  if (!last.ok) {
    return last;
  }
  if (last.value.headSha !== headSha || last.value.baseRef !== baseRef) {
    return { ok: false, reason: MOVED_WHILE_READ };
  }
  const lastBase = await readBranchTip(ctx, pr, baseRef);
  if (!lastBase.ok) {
    return lastBase;
  }
  if (lastBase.value !== baseSha.value) {
    return { ok: false, reason: MOVED_WHILE_READ };
  }
  return {
    ok: true,
    value: { baseRef, baseSha: baseSha.value, headSha, ...compared.value },
  };
}
