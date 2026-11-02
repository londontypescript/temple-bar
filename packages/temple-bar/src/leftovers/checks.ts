// The checks on what is inside one worktree: what `--release` requires and
// what `--remove` checks again right before deleting. Each reads fresh and
// reads git's exit status and warnings; whatever can't be told is a reason
// to keep the worktree. They sit on top of git's own refusals (no --force is
// ever used), never instead of them.

import path from "node:path";

import type { Context } from "../context.ts";
import type { Worktree } from "../merge/worktrees.ts";
import {
  allPaths,
  bareRepositories,
  linksLeadingOutside,
  mountedFolders,
  nestedRepositories,
  readInventory,
  type Inventory,
} from "./inventory.ts";
import type { MarkerRefs } from "./marker.ts";
import {
  firstFew,
  isInside,
  samePath,
  splitNul,
  undecodable,
  withoutNewline,
} from "./paths.ts";
import { gitEntriesInside } from "./walk.ts";

/** Files git leaves in a worktree's own git folder while an operation is
 * under way; deleting the folder would lose the operation's state. */
const OPERATIONS = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
  "sequencer",
  "BISECT_LOG",
];

/** Reasons from one git listing, or the reason it couldn't be read. */
async function listing(
  ctx: Context,
  worktree: string,
  args: readonly string[],
): Promise<string[] | string> {
  const result = await ctx.git.run(args, worktree);
  if (result.code !== 0 || result.stderr !== "") {
    return `git couldn't read its state (${args.join(" ")})`;
  }
  return (
    splitNul(result.stdout) ?? `git's output was cut short (${args[0] ?? ""})`
  );
}

/** Submodules and hidden index flags: a gitlink in the index (mode
 * 160000) whatever .gitmodules says, and an assume-unchanged (lower-case
 * tag) or skip-worktree (`S`) entry, whose changes git doesn't show. */
async function indexProblems(
  ctx: Context,
  worktree: string,
): Promise<string[]> {
  const staged = await listing(ctx, worktree, ["ls-files", "-z", "-s"]);
  const tagged = await listing(ctx, worktree, ["ls-files", "-z", "-v"]);
  const problems: string[] = [];
  if (typeof staged === "string") {
    problems.push(staged);
  } else {
    const gitlinks = staged
      .filter((entry) => entry.startsWith("160000 "))
      .map((entry) => entry.slice(entry.indexOf("\t") + 1));
    if (gitlinks.length > 0) {
      problems.push(`a submodule in its index: ${firstFew(gitlinks)}`);
    }
  }
  if (typeof tagged === "string") {
    problems.push(tagged);
  } else {
    const hidden = tagged
      .filter((entry) => {
        const tag = entry[0] ?? "";
        return tag === "S" || (tag !== tag.toUpperCase() && entry[1] === " ");
      })
      .map((entry) => entry.slice(2));
    if (hidden.length > 0) {
      problems.push(
        `assume-unchanged or skip-worktree entries, whose changes git hides: ${firstFew(hidden)}`,
      );
    }
  }
  return problems;
}

/** A merge, cherry-pick, revert, rebase, sequence or bisect under way, or
 * another per-worktree ref (a bisect's, or another tool's). */
async function operationProblems(
  ctx: Context,
  worktree: string,
  refs: MarkerRefs,
): Promise<string[]> {
  const problems: string[] = [];
  const result = await ctx.git.run(
    ["rev-parse", "--path-format=absolute", "--git-dir"],
    worktree,
  );
  const gitDir = result.code === 0 ? withoutNewline(result.stdout) : undefined;
  if (gitDir === undefined) {
    problems.push("git couldn't say where its git folder is");
  } else {
    for (const name of OPERATIONS) {
      const kind = await ctx.fs
        .classify(path.join(gitDir, name))
        .catch(() => "unreadable");
      if (kind !== "missing") {
        problems.push(`a git operation is under way (${name})`);
      }
    }
  }
  // An unreadable marker is the marker check's reason, not repeated here.
  if (refs.kind === "read" && refs.others.length > 0) {
    problems.push(`per-worktree refs: ${firstFew(refs.others)}`);
  }
  return problems;
}

/** Staged or unstaged changes, submodules included. Read without taking
 * the index lock, so a session working there isn't disturbed. */
async function changeProblems(
  ctx: Context,
  worktree: string,
): Promise<string[]> {
  const status = await listing(ctx, worktree, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=no",
    "--ignore-submodules=none",
  ]);
  if (typeof status === "string") {
    return [status];
  }
  // Each entry is "XY path"; a rename adds its old path as the next entry.
  const changed = status.filter(
    (entry) => entry.length > 3 && entry[2] === " ",
  );
  return status.length > 0
    ? [
        `staged or unstaged changes: ${firstFew(changed.map((entry) => entry.slice(3)))}`,
      ]
    : [];
}

export interface Contents {
  readonly reasons: string[];
  /** git's lists, when they could be read. */
  readonly inventory: Inventory | undefined;
}

/** Everything inside the worktree that removing its folder could lose:
 * another worktree, repository or mounted folder in it, a gitlink, hidden
 * index flags, an operation under way, changes, untracked files, or a path
 * that can't be read back exactly. */
export async function inspectContents(
  ctx: Context,
  worktree: { readonly path: string; readonly realPath: string | undefined },
  others: readonly Worktree[],
  refs: MarkerRefs,
): Promise<Contents> {
  const reasons: string[] = [];
  const insideOf = [
    worktree.path,
    ...(worktree.realPath === undefined ? [] : [worktree.realPath]),
  ];
  const nested = others.filter(
    (other) =>
      !samePath(other.path, worktree.path) &&
      insideOf.some((folder) => isInside(other.path, folder)),
  );
  if (nested.length > 0) {
    reasons.push(
      `another worktree is inside it: ${firstFew(nested.map((other) => other.path))}`,
    );
  }
  const inventory = await readInventory(ctx, worktree.path);
  if (typeof inventory === "string") {
    reasons.push(inventory);
  } else {
    const unreadable = allPaths(inventory).filter(undecodable);
    if (unreadable.length > 0) {
      reasons.push(
        `paths that aren't valid UTF-8, so can't be checked: ${firstFew(unreadable)}`,
      );
    }
    reasons.push(...nestedRepositories(inventory));
    reasons.push(...(await bareRepositories(ctx, worktree.path, inventory)));
    reasons.push(...(await mountedFolders(ctx, worktree.path, inventory)));
    reasons.push(...(await gitEntriesInside(ctx, worktree.path)));
    if (process.platform === "win32") {
      reasons.push(
        ...(await linksLeadingOutside(ctx, worktree.path, insideOf, inventory)),
      );
    }
    const untracked = inventory.untracked.filter(
      (entry) => !entry.endsWith("/"),
    );
    if (untracked.length > 0) {
      reasons.push(`untracked files: ${firstFew(untracked)}`);
    }
  }
  reasons.push(...(await indexProblems(ctx, worktree.path)));
  reasons.push(...(await operationProblems(ctx, worktree.path, refs)));
  reasons.push(...(await changeProblems(ctx, worktree.path)));
  return {
    reasons,
    inventory: typeof inventory === "string" ? undefined : inventory,
  };
}
