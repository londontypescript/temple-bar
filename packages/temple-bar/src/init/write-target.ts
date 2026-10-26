// Classifies each entry before an operation, including every folder below the
// chosen root. The root and its parents may themselves be links. The disk is
// classified afresh before every operation, and so is git's index, except in a
// batch (WriteTargets.batch), which reads it once: a batch holds no prompt and
// no git command that writes the index, so only another process can change the
// index under it, which ADR 0018 accepts. There is still a check-to-write race
// if another process replaces an entry after inspection: Node has no portable
// no-follow write. Setup is a local command run by its owner.

import path from "node:path";

import type { Context } from "../context.ts";
import { JUDGE_WORKFLOW_PATH } from "../judge/workflow.ts";
import { CLAUDE_MD_PATH, COMPANION_FILES } from "./companion-docs.ts";
import { reportWriteTarget } from "./files-report.ts";
import { readIndex, type IndexEntry, type IndexMap } from "./git-index.ts";
import { CHECKED_WORKFLOWS } from "./workflows.ts";
import { PRETTIER_IGNORE_PATH } from "./prettier-ignore.ts";

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
  PRETTIER_IGNORE_PATH,
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

/** How a refusal names a folder and what to run once it's fixed. Setup's
 * paths are shown as they are, relative to the repo; the hooks name their
 * folder in full, since git's folder can be outside the checkout, and are put
 * back by `temple-bar hook install` as well as by setup. */
export interface RefusalWording {
  readonly show: (relative: string) => string;
  readonly rerun: string;
}

const SETUP_WORDING: RefusalWording = {
  show: (relative) => relative,
  rerun: "run setup again",
};

function refused(
  reason: string,
  wording: RefusalWording,
  folder?: string,
): RefusedTarget {
  return {
    kind: "refused",
    reason,
    fix:
      folder === undefined
        ? `replace it with an ordinary file, or remove it, then ${wording.rerun}`
        : `replace ${wording.show(folder)} with an ordinary folder, or remove it, then ${wording.rerun}`,
  };
}

/** Checks `relative` and each folder on the way to it below `root`, never
 * following a link. Setup also passes git's index, so a link git checked out
 * as a plain file still counts as a link; the gate and the hooks don't (git
 * doesn't track its own hooks folder). */
export async function classifyDiskTarget(
  ctx: Context,
  root: string,
  relative: string,
  index?: ReadonlyMap<string, readonly IndexEntry[]>,
  wording: RefusalWording = SETUP_WORDING,
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
      const shown = wording.show(folder);
      return refused(
        kind === "symlink"
          ? `is a path through a linked folder ${shown}`
          : `is a path through ${shown}, which is ${kind === "file" ? "an ordinary file" : "not an ordinary folder"}`,
        wording,
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
    wording,
  );
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
      SETUP_WORDING,
      folder ? relative : undefined,
    );
  }
  return undefined;
}

/** A batch's own state, held by its view. `index` is the batch's one index
 * read, shared by every inspection through the view, even one that starts
 * while it is in flight; it is unset until the first inspection, after a
 * failed read, and once the batch has ended. */
interface BatchState {
  open: boolean;
  index: Promise<IndexMap> | undefined;
}

const BATCH_ENDED =
  "Setup's write targets were used after their batch ended: a batch's view works only inside its callback.";
const NESTED_BATCH =
  "A batch can't start inside another: pass the outer batch's view on instead, which already shares its index read.";

/** Owns safe reads, writes and chmod, so a writer cannot accidentally treat a
 * refusal as a missing file. The disk is classified afresh at every
 * operation, and git's index is read afresh at every operation too, except
 * through a batch's view (see `batch`), which reads it once.
 * Setup passes its paths, which turns on what only setup does: reading git's
 * index, the CLAUDE.md exception, and reporting each refusal as it's found.
 * The hooks pass none and report refusals as hook conflicts instead; they
 * read no index, so a batch on them changes nothing. */
export class WriteTargets {
  // Not readonly: a batch's view is made like any other WriteTargets, then
  // given these from the targets it came from (see `batch`), so each refusal
  // is recorded and reported once, whichever of them found it.
  private shared = {
    refusals: new Map<string, RefusedTarget>(),
    announced: new Set<string>(),
  };
  private batchState: BatchState | undefined;
  private indexPaths: readonly string[] | undefined;

  private readonly ctx: Context;
  private readonly root: string;
  private readonly wording: RefusalWording;

  constructor(
    ctx: Context,
    root: string,
    options: {
      readonly setupPaths?: readonly string[];
      readonly wording?: RefusalWording;
    } = {},
  ) {
    const { setupPaths } = options;
    this.ctx = ctx;
    this.root = root;
    this.wording = options.wording ?? SETUP_WORDING;
    this.indexPaths =
      setupPaths === undefined
        ? undefined
        : [...new Set(setupPaths.flatMap((file) => [...folders(file), file]))];
  }

  /** Every path refused so far, by these targets or a batch's view of them. */
  get refusals(): ReadonlyMap<string, RefusedTarget> {
    return this.shared.refusals;
  }

  /**
   * Runs `work` with a view of these targets whose inspections share one
   * read of git's index; a failed read isn't kept, so the next one retries.
   * The disk is still classified at every operation. Once `work` settles,
   * the read is dropped and the view throws if used again. These targets
   * never keep a read: inspecting them, or another batch, reads afresh.
   * `work` must not prompt or run git that writes the index (ADR 0018).
   */
  async batch<T>(work: (batched: WriteTargets) => Promise<T>): Promise<T> {
    this.assertOpen();
    // A batch inside another would share the outer read while seeming to
    // start its own, so it is refused rather than given two meanings.
    if (this.batchState !== undefined) throw new Error(NESTED_BATCH);
    const state: BatchState = { open: true, index: undefined };
    const view = new WriteTargets(this.ctx, this.root, {
      wording: this.wording,
    });
    view.indexPaths = this.indexPaths;
    view.shared = this.shared;
    view.batchState = state;
    try {
      return await work(view);
    } finally {
      state.open = false;
      state.index = undefined;
    }
  }

  /** Throws when these targets are a batch's view and the batch has ended. */
  private assertOpen(): void {
    if (this.batchState?.open === false) throw new Error(BATCH_ENDED);
  }

  /** Git's index for setup's paths, or undefined for the hooks, which read
   * none. Read afresh each time, except through a batch's view. */
  private index(): Promise<IndexMap | undefined> {
    const paths = this.indexPaths;
    if (paths === undefined) return Promise.resolve(undefined);
    const batch = this.batchState;
    if (batch === undefined) return readIndex(this.ctx, this.root, paths);
    if (batch.index === undefined) {
      const read = readIndex(this.ctx, this.root, paths);
      batch.index = read;
      // A failed read is forgotten, so the next inspection reads again.
      read.catch(() => {
        if (batch.index === read) batch.index = undefined;
      });
    }
    return batch.index;
  }

  async inspect(relative: string): Promise<WriteTarget> {
    this.assertOpen();
    const index = await this.index();
    this.assertOpen();
    let state = await classifyDiskTarget(
      this.ctx,
      this.root,
      relative,
      index,
      this.wording,
    );
    if (
      this.indexPaths !== undefined &&
      relative === CLAUDE_MD_PATH &&
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
          if (["AGENTS.md", "./AGENTS.md", ".\\AGENTS.md"].includes(stored)) {
            if (agents.kind === "file") {
              state = { kind: "claude-link" };
            } else if (agents.kind === "refused") {
              // The link itself is fine; what it points at isn't, so the
              // fix is AGENTS.md's, not CLAUDE.md's.
              state = {
                kind: "refused",
                reason: `links to AGENTS.md, which ${agents.reason}`,
                fix: `fix AGENTS.md first (${agents.fix})`,
              };
            }
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
    if (state.kind === "refused") this.shared.refusals.set(relative, state);
    if (
      this.indexPaths !== undefined &&
      (state.kind === "refused" || state.kind === "claude-link") &&
      !this.shared.announced.has(`${state.kind}:${relative}`)
    ) {
      reportWriteTarget(this.ctx, relative, state);
      this.shared.announced.add(`${state.kind}:${relative}`);
    }
    return state;
  }

  // Each operation checks again that its batch is open just before it
  // touches the disk, so one left running when its batch ended fails there.

  async readText(relative: string): Promise<string | undefined> {
    const state = await this.inspect(relative);
    if (state.kind !== "file") return undefined;
    this.assertOpen();
    return this.ctx.fs.readText(path.join(this.root, ...relative.split("/")));
  }

  async writeText(relative: string, content: string): Promise<boolean> {
    const state = await this.inspect(relative);
    if (state.kind !== "missing" && state.kind !== "file") return false;
    const full = path.join(this.root, ...relative.split("/"));
    this.assertOpen();
    await this.ctx.fs.mkdirp(path.dirname(full));
    this.assertOpen();
    await this.ctx.fs.writeText(full, content);
    return true;
  }

  async chmod(relative: string, mode: number): Promise<boolean> {
    if ((await this.inspect(relative)).kind !== "file") return false;
    this.assertOpen();
    await this.ctx.fs.chmod(path.join(this.root, ...relative.split("/")), mode);
    return true;
  }
}

export function setupWriteTargets(ctx: Context, root: string): WriteTargets {
  return new WriteTargets(ctx, root, { setupPaths: SETUP_PATHS });
}
