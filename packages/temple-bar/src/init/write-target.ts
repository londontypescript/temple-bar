// Classifies each entry before an operation, including every folder below the
// chosen root. The root and its parents may themselves be links. There is still
// a check-to-write race if another process replaces an entry after inspection:
// Node has no portable no-follow write. Setup is a local command run by its owner.

import path from "node:path";

import type { Context } from "../context.ts";
import { JUDGE_WORKFLOW_PATH } from "../judge/workflow.ts";
import { COMPANION_FILES } from "./companion-docs.ts";
import { reportWriteTarget } from "./files-report.ts";
import { CHECKED_WORKFLOWS } from "./workflows.ts";

export interface RefusedTarget {
  readonly kind: "refused";
  readonly reason: string;
  readonly fix: string;
}

export type WriteTarget =
  | { readonly kind: "missing" | "file" }
  | { readonly kind: "claude-link" }
  | RefusedTarget;

export const SETUP_PATHS: readonly string[] = [
  ".gitignore",
  "AGENTS.md",
  ...COMPANION_FILES.map((file) => file.path),
  JUDGE_WORKFLOW_PATH,
  ...CHECKED_WORKFLOWS.map((file) => file.path),
  "package.json",
];

function folders(relative: string): string[] {
  const parts = relative.split("/");
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}

function refused(reason: string, folder?: string): RefusedTarget {
  return {
    kind: "refused",
    reason,
    fix:
      folder === undefined
        ? "replace it with an ordinary file, or remove it, then run setup again"
        : `replace ${folder} with an ordinary folder, or remove it, then run setup again`,
  };
}

/** Used by the gate and hooks too: no git index applies to git's hooks folder. */
export async function classifyDiskTarget(
  ctx: Context,
  root: string,
  relative: string,
  index?: ReadonlyMap<string, readonly IndexEntry[]>,
): Promise<WriteTarget> {
  let missingFolder = false;
  for (const folder of folders(relative)) {
    const problem = indexProblem(index?.get(folder), folder, true);
    if (problem !== undefined) return problem;
    // A missing ancestor means there is nothing below it to probe on disk,
    // but staged links below it still forbid creating a folder or file.
    if (missingFolder) continue;
    const kind = await ctx.fs.classify(path.join(root, ...folder.split("/")));
    if (kind === "missing") {
      missingFolder = true;
      continue;
    }
    if (kind !== "directory") {
      return refused(
        kind === "symlink"
          ? `is a path through a linked folder ${folder}`
          : `is a path through ${folder}, which is ${kind === "file" ? "an ordinary file" : "not an ordinary folder"}`,
        folder,
      );
    }
  }
  const problem = indexProblem(index?.get(relative), relative);
  if (problem !== undefined) return problem;
  if (missingFolder) return { kind: "missing" };
  const kind = await ctx.fs.classify(path.join(root, ...relative.split("/")));
  if (kind === "missing" || kind === "file") return { kind };
  return refused(
    kind === "symlink"
      ? "is a symlink"
      : kind === "directory"
        ? "is a folder, not an ordinary file"
        : "is not an ordinary file",
  );
}

interface IndexEntry {
  readonly mode: string;
  readonly stage: string;
}

/** NUL records keep whitespace and quoted-looking path names literal. */
async function readIndex(
  ctx: Context,
  root: string,
  paths: readonly string[],
): Promise<Map<string, IndexEntry[]>> {
  const result = await ctx.git.run(
    ["ls-files", "-s", "-z", "--", ...paths],
    root,
  );
  if (result.code !== 0)
    throw new Error(
      `Could not inspect setup's git index: ${result.stderr.trim()}`,
    );
  const entries = new Map<string, IndexEntry[]>();
  for (const record of result.stdout.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) [0-9a-f]+ ([0-3])\t([\s\S]+)$/.exec(record);
    if (match === null)
      throw new Error("Could not parse setup's git index entry");
    const mode = match[1];
    // The regexp has three captures: mode, stage and the literal path.
    const file = match[3];
    if (mode === undefined || file === undefined || match[2] === undefined)
      throw new Error("Incomplete git index entry");
    const list = entries.get(file) ?? [];
    list.push({ mode, stage: match[2] });
    entries.set(file, list);
  }
  return entries;
}

function indexProblem(
  entries: readonly IndexEntry[] | undefined,
  relative: string,
  folder = false,
): RefusedTarget | undefined {
  if (entries === undefined) return undefined;
  if (entries.length !== 1 || entries[0]?.stage !== "0") {
    return {
      kind: "refused",
      reason: `has unresolved git index stages${folder ? ` at ${relative}` : ""}`,
      fix: "resolve the merge conflict, then run setup again",
    };
  }
  if (entries[0].mode === "120000") {
    return refused(
      folder
        ? `is a path through a tracked symlink ${relative}`
        : "is a tracked symlink",
      folder ? relative : undefined,
    );
  }
  return undefined;
}

/** Owns safe reads, writes and chmod, so a writer cannot accidentally treat a
 * refusal as a missing file. No disk or index classification is cached. */
export class WriteTargets {
  readonly refusals = new Map<string, RefusedTarget>();
  private readonly announced = new Set<string>();
  private readonly indexPaths: readonly string[] | undefined;

  private readonly ctx: Context;
  private readonly root: string;

  constructor(ctx: Context, root: string, setupPaths?: readonly string[]) {
    this.ctx = ctx;
    this.root = root;
    this.indexPaths =
      setupPaths === undefined
        ? undefined
        : [...new Set(setupPaths.flatMap((file) => [...folders(file), file]))];
  }

  async inspect(relative: string): Promise<WriteTarget> {
    const index =
      this.indexPaths === undefined
        ? undefined
        : await readIndex(this.ctx, this.root, this.indexPaths);
    let state = await classifyDiskTarget(this.ctx, this.root, relative, index);
    if (
      this.indexPaths !== undefined &&
      relative === "CLAUDE.md" &&
      state.kind === "refused"
    ) {
      const problem = indexProblem(index?.get(relative), relative);
      if (problem === undefined || problem.reason === "is a tracked symlink") {
        const disk = await this.ctx.fs.classify(path.join(this.root, relative));
        if (disk === "symlink") {
          const stored = await this.ctx.fs.readlink(
            path.join(this.root, relative),
          );
          const agents = await classifyDiskTarget(
            this.ctx,
            this.root,
            "AGENTS.md",
            index,
          );
          if (
            ["AGENTS.md", "./AGENTS.md", ".\\AGENTS.md"].includes(stored) &&
            agents.kind === "file"
          ) {
            state = { kind: "claude-link" };
          }
        } else if (
          problem?.reason === "is a tracked symlink" &&
          disk === "file"
        ) {
          state = {
            kind: "refused",
            reason: "is a tracked symlink checked out as an ordinary file",
            fix: "turn on links in git (core.symlinks=true, with Windows developer mode) and check the file out again, or replace CLAUDE.md with an ordinary file importing @AGENTS.md, then run setup again",
          };
        }
      }
    }
    if (state.kind === "refused") this.refusals.set(relative, state);
    if (
      this.indexPaths !== undefined &&
      (state.kind === "refused" || state.kind === "claude-link") &&
      !this.announced.has(`${state.kind}:${relative}`)
    ) {
      reportWriteTarget(this.ctx, relative, state);
      this.announced.add(`${state.kind}:${relative}`);
    }
    return state;
  }

  async readText(relative: string): Promise<string | undefined> {
    const state = await this.inspect(relative);
    return state.kind === "file"
      ? this.ctx.fs.readText(path.join(this.root, ...relative.split("/")))
      : undefined;
  }

  async writeText(relative: string, content: string): Promise<boolean> {
    let state = await this.inspect(relative);
    if (state.kind !== "missing" && state.kind !== "file") return false;
    const full = path.join(this.root, ...relative.split("/"));
    await this.ctx.fs.mkdirp(path.dirname(full));
    state = await this.inspect(relative);
    if (state.kind !== "missing" && state.kind !== "file") return false;
    await this.ctx.fs.writeText(full, content);
    return true;
  }

  async chmod(relative: string, mode: number): Promise<boolean> {
    if ((await this.inspect(relative)).kind !== "file") return false;
    await this.ctx.fs.chmod(path.join(this.root, ...relative.split("/")), mode);
    return true;
  }
}

export function setupWriteTargets(ctx: Context, root: string): WriteTargets {
  return new WriteTargets(ctx, root, SETUP_PATHS);
}
