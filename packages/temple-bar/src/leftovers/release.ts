// `--release` and `--unrelease`, run by the session that owns a worktree,
// inside it: the session's word that the worktree holds nothing worth
// keeping beyond GitHub, and its withdrawal. Also how `temple-bar merge`
// carries a release over its own commit.

import type { Context } from "../context.ts";
import { listWorktrees } from "../merge/worktrees.ts";
import { inspectContents } from "./checks.ts";
import { checksums, readInventory } from "./inventory.ts";
import {
  readMarker,
  readMarkerRefs,
  release,
  sameFiles,
  unrelease,
  writeMarkerBlob,
} from "./marker.ts";
import { samePath, undecodable, withoutNewline } from "./paths.ts";
import { readLocalRefs } from "./repository.ts";

const BEING_REMOVED = "this worktree is being removed; don't work in it";

async function readLine(
  ctx: Context,
  args: readonly string[],
  cwd: string,
): Promise<string | undefined> {
  const result = await ctx.git.run(args, cwd);
  return result.code === 0 ? withoutNewline(result.stdout) : undefined;
}

/** The branch HEAD is on, when it is a real branch: not detached, and not
 * a symbolic ref standing in for another branch. */
async function branchProblems(
  ctx: Context,
  worktree: string,
): Promise<{ branch: string | undefined; reasons: string[] }> {
  const branch = await readLine(ctx, ["symbolic-ref", "-q", "HEAD"], worktree);
  if (branch?.startsWith("refs/heads/") !== true) {
    return { branch: undefined, reasons: ["HEAD isn't on a branch"] };
  }
  const local = (await readLocalRefs(ctx, worktree))?.get(branch);
  if (local === undefined) {
    return { branch, reasons: [`its branch ${branch} can't be read`] };
  }
  return local.symref === ""
    ? { branch, reasons: [] }
    : {
        branch,
        reasons: [`HEAD is on ${branch}, a symbolic ref to ${local.symref}`],
      };
}

/** Writes the release marker for the worktree at `ctx.cwd`, or refuses
 * with every reason, writing nothing. */
export async function releaseWorktree(
  ctx: Context,
  prefix: string,
): Promise<number> {
  const refuse = (reasons: readonly string[]): number => {
    ctx.stderr.write(
      `${prefix}not released, nothing written:\n${reasons.map((reason) => `${prefix}  ${reason}\n`).join("")}`,
    );
    return 1;
  };
  const top = await readLine(ctx, ["rev-parse", "--show-toplevel"], ctx.cwd);
  if (top === undefined) {
    return refuse(["this isn't inside a git worktree"]);
  }
  const worktrees = await listWorktrees(ctx, top);
  const self = worktrees.find((worktree) => samePath(worktree.path, top));
  if (self === undefined || self.primary) {
    return refuse([
      self === undefined
        ? "git doesn't list this folder as a worktree"
        : "this is the primary checkout: release runs in a linked worktree",
    ]);
  }
  const refs = await readMarkerRefs(ctx, top);
  if (refs.kind === "read" && refs.removing !== undefined) {
    ctx.stderr.write(`${prefix}${BEING_REMOVED}\n`);
    return 1;
  }
  const { branch, reasons } = await branchProblems(ctx, top);
  if (refs.kind === "unreadable") {
    reasons.push(refs.why);
  }
  if (undecodable(top)) {
    reasons.push("its path isn't valid UTF-8, so it can't be checked");
  }
  const realPath = await ctx.fs.realpath(top).catch(() => undefined);
  const contents = await inspectContents(
    ctx,
    { path: top, realPath },
    worktrees,
    refs,
  );
  reasons.push(...contents.reasons);
  const head = await readLine(
    ctx,
    ["rev-parse", "--verify", "-q", "HEAD"],
    top,
  );
  const files =
    contents.inventory === undefined
      ? "its ignored files can't be listed"
      : await checksums(ctx, top, contents.inventory.ignored);
  if (typeof files === "string") {
    reasons.push(files);
  }
  if (
    reasons.length > 0 ||
    typeof files === "string" ||
    branch === undefined ||
    head === undefined ||
    refs.kind === "unreadable"
  ) {
    return refuse(reasons.length > 0 ? reasons : ["HEAD can't be read"]);
  }
  const blob = await writeMarkerBlob(ctx, top, { head, branch, files });
  const refused =
    blob === undefined
      ? "git couldn't store the marker"
      : await release(ctx, top, blob, refs.released);
  if (refused !== undefined) {
    const now = await readMarkerRefs(ctx, top);
    if (now.kind === "read" && now.removing !== undefined) {
      ctx.stderr.write(`${prefix}${BEING_REMOVED}\n`);
      return 1;
    }
    return refuse([`git refused the marker: ${refused}`]);
  }
  const certified = [...files.keys()].sort();
  ctx.stdout.write(
    `${prefix}released ${top} on ${branch.slice("refs/heads/".length)} at ${head}.\n` +
      `${prefix}Once its pull request merges, \`temple-bar leftovers --remove\` deletes this worktree ` +
      "and all ignored local data in it, .temple-bar/ included. Make sure everything worth keeping is on GitHub.\n" +
      (certified.length === 0
        ? `${prefix}No ignored files beyond node_modules and build output.\n`
        : `${prefix}Ignored files certified for deletion (beyond node_modules and build output):\n` +
          certified
            .map((file) => `${prefix}  ${JSON.stringify(file)}\n`)
            .join("")),
  );
  return 0;
}

/** Withdraws the release of the worktree at `ctx.cwd`. A removal that has
 * already claimed it wins, and the session is told to stop. */
export async function unreleaseWorktree(
  ctx: Context,
  prefix: string,
): Promise<number> {
  const top = await readLine(ctx, ["rev-parse", "--show-toplevel"], ctx.cwd);
  if (top === undefined) {
    ctx.stderr.write(`${prefix}this isn't inside a git worktree\n`);
    return 1;
  }
  const refs = await readMarkerRefs(ctx, top);
  if (refs.kind === "unreadable") {
    ctx.stderr.write(`${prefix}${refs.why}; nothing changed\n`);
    return 1;
  }
  if (refs.removing !== undefined) {
    ctx.stderr.write(`${prefix}${BEING_REMOVED}\n`);
    return 1;
  }
  if (refs.released === undefined) {
    ctx.stdout.write(`${prefix}${top} isn't released; nothing to withdraw\n`);
    return 0;
  }
  const refused = await unrelease(ctx, top, refs.released);
  if (refused !== undefined) {
    const now = await readMarkerRefs(ctx, top);
    ctx.stderr.write(
      now.kind === "read" && now.removing !== undefined
        ? `${prefix}${BEING_REMOVED}\n`
        : `${prefix}could not withdraw the release: ${refused}\n`,
    );
    return 1;
  }
  ctx.stdout.write(`${prefix}withdrew the release of ${top}\n`);
  return 0;
}

/** After merge brings a released worktree up to date and pushes, its own
 * merge commit would invalidate the marker. Only merge knows that commit is
 * its own, so it moves a marker that is otherwise still valid (same branch,
 * same files, HEAD exactly `to`, whose first parent is the released `from`)
 * to the new HEAD. Anything else leaves the marker alone. Resolves what it
 * did, for merge's report, or undefined when it did nothing. */
export async function carryReleaseForward(
  ctx: Context,
  worktree: string,
  from: string,
  to: string,
): Promise<string | undefined> {
  const refs = await readMarkerRefs(ctx, worktree);
  if (
    refs.kind !== "read" ||
    refs.removing !== undefined ||
    refs.released === undefined
  ) {
    return undefined;
  }
  const marker = await readMarker(ctx, worktree, refs.released);
  const branch = await readLine(ctx, ["symbolic-ref", "-q", "HEAD"], worktree);
  const head = await readLine(
    ctx,
    ["rev-parse", "--verify", "-q", "HEAD"],
    worktree,
  );
  const parent = await readLine(
    ctx,
    ["--no-replace-objects", "rev-parse", "--verify", "-q", `${to}^1`],
    worktree,
  );
  if (
    marker?.head !== from ||
    marker.branch !== branch ||
    head !== to ||
    parent !== from
  ) {
    return undefined;
  }
  const inventory = await readInventory(ctx, worktree);
  const files =
    typeof inventory === "string"
      ? inventory
      : await checksums(ctx, worktree, inventory.ignored);
  if (typeof files === "string" || sameFiles(files, marker.files).length > 0) {
    return undefined;
  }
  const blob = await writeMarkerBlob(ctx, worktree, { ...marker, head: to });
  if (
    blob === undefined ||
    (await release(ctx, worktree, blob, refs.released)) !== undefined
  ) {
    return undefined;
  }
  return `moved the release of ${worktree} to merge's own commit ${to}`;
}
