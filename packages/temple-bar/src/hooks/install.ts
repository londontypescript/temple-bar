// `installHooks`: writes the shims into the git folder every worktree shares
// (<git-common-dir>/hooks/, git's default hooks folder; shims.ts says why
// there) and sets the local git config that makes them active. Used by
// `temple-bar hook install` (command.ts) and by `init`. Idempotent: a second
// run changes nothing. Never overwrites a file or config value that already
// differs from what temple-bar would write; that's reported as a conflict
// instead, and the caller (command.ts) turns a report with conflicts into a
// non-zero exit.
//
// The exceptions are temple-bar's own earlier output, because the install
// runs from `prepare` on every `pnpm install`, and a conflict there would
// fail the very install that upgrades temple-bar:
// - A shim exactly as an earlier release wrote it is replaced. It's known by
//   its hash.
// - A shim with temple-bar's marker line that this version doesn't know is
//   kept as it is: every worktree shares the folder, so a worktree on an
//   older branch installs an older temple-bar, and must neither fail nor
//   take a newer release's shims back to its own. A hook without the marker
//   is someone else's, and stays a conflict.
//
// When this version's shims are the ones in place, the install also records
// its own checkout in the folder (INSTALLED_CHECKOUT_FILE), so the shims
// prefer the temple-bar that wrote them: an older one in another worktree
// may not know every hook they call.
// - `core.hooksPath` set to `.githooks`, the folder earlier releases used,
//   is removed: while it is set, git runs no hook from the shared folder.

import { createHash } from "node:crypto";
import path from "node:path";

import type { Context } from "../context.ts";
import {
  COMMIT_MSG_SHIM,
  POST_CHECKOUT_SHIM,
  PRE_COMMIT_SHIM,
  PRE_PUSH_SHIM,
  INSTALLED_CHECKOUT_FILE,
  REFERENCE_TRANSACTION_SHIM,
  SHIM_MARKER,
} from "./shims.ts";

type InstallItemStatus = "written" | "unchanged" | "conflict";

interface InstallItem {
  /** What this item is: a hook file's path relative to the repo root, or a
   * `<section>.<key>` git config key. */
  readonly item: string;
  readonly status: InstallItemStatus;
  /** Why, when the status alone doesn't say: always present for "conflict". */
  readonly detail?: string;
}

export interface InstallReport {
  readonly items: readonly InstallItem[];
  readonly hasConflicts: boolean;
}

/** The hooks folder earlier releases tracked in the repo and pointed
 * `core.hooksPath` at. */
const EARLIER_HOOKS_PATH = ".githooks";

interface Shim {
  readonly name: string;
  readonly content: string;
  /** SHA-256 of this shim's content as earlier releases wrote it. */
  readonly earlierReleases: readonly string[];
}

const SHIMS: readonly Shim[] = [
  {
    name: "pre-commit",
    content: PRE_COMMIT_SHIM,
    // 0.0.1 to 0.0.3
    earlierReleases: [
      "c8516a24ea300186603b86e8e5f1fe758774796a76248657fa5e5600346ae729",
    ],
  },
  {
    name: "commit-msg",
    content: COMMIT_MSG_SHIM,
    earlierReleases: [],
  },
  {
    name: "pre-push",
    content: PRE_PUSH_SHIM,
    earlierReleases: [],
  },
  {
    name: "reference-transaction",
    content: REFERENCE_TRANSACTION_SHIM,
    // 0.0.1 to 0.0.3
    earlierReleases: [
      "75971844b8a72064af9970d8bd01f61fc4b094315b4f847542860ba8e7de2590",
    ],
  },
  {
    name: "post-checkout",
    content: POST_CHECKOUT_SHIM,
    earlierReleases: [],
  },
];

const EXECUTABLE_MODE = 0o755;

const KEPT_DETAIL = "kept another temple-bar version's shim";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isTempleBarShim(text: string): boolean {
  return text.split("\n", 2)[1]?.startsWith(SHIM_MARKER) === true;
}

/** The git folder every worktree of this repo shares, as an absolute path. */
async function findCommonGitDir(
  ctx: Context,
  repoRoot: string,
): Promise<string | undefined> {
  const result = await ctx.git.run(["rev-parse", "--git-common-dir"], repoRoot);
  if (result.code !== 0) {
    return undefined;
  }
  // Relative to repoRoot when it is the main worktree (".git"). Joined, not
  // resolved: path.resolve would put the current drive in front of an
  // already absolute path on Windows.
  const dir = result.stdout.trim();
  return path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
}

async function installShim(
  ctx: Context,
  repoRoot: string,
  hooksDir: string,
  shim: Shim,
): Promise<InstallItem> {
  const { name, content } = shim;
  const fullPath = path.join(hooksDir, name);
  const item = path.relative(repoRoot, fullPath).split(path.sep).join("/");
  const existing = await ctx.fs.readText(fullPath);

  if (existing === undefined) {
    await ctx.fs.mkdirp(hooksDir);
    await ctx.fs.writeText(fullPath, content);
    await ctx.fs.chmod(fullPath, EXECUTABLE_MODE);
    return { item, status: "written" };
  }

  if (existing === content) {
    // A second run still makes sure the shim is executable.
    await ctx.fs.chmod(fullPath, EXECUTABLE_MODE);
    return { item, status: "unchanged" };
  }

  if (shim.earlierReleases.includes(sha256(existing))) {
    await ctx.fs.writeText(fullPath, content);
    await ctx.fs.chmod(fullPath, EXECUTABLE_MODE);
    return {
      item,
      status: "written",
      detail: "replaced an earlier temple-bar version",
    };
  }

  if (isTempleBarShim(existing)) {
    return {
      item,
      status: "unchanged",
      detail: KEPT_DETAIL,
    };
  }

  return {
    item,
    status: "conflict",
    detail: "an existing file's content differs from the temple-bar shim",
  };
}

/** Names this checkout as the one whose temple-bar the shims run first.
 * Machine state, not a setting, so it isn't reported as an item. Written
 * with forward slashes, which sh reads on every OS. */
async function recordInstalledCheckout(
  ctx: Context,
  repoRoot: string,
  hooksDir: string,
): Promise<void> {
  const file = path.join(hooksDir, INSTALLED_CHECKOUT_FILE);
  const content = `${repoRoot.split(path.sep).join("/")}\n`;
  if ((await ctx.fs.readText(file)) !== content) {
    await ctx.fs.writeText(file, content);
  }
}

async function readLocalConfig(
  ctx: Context,
  repoRoot: string,
  key: string,
): Promise<string | undefined> {
  const current = await ctx.git.run(
    ["config", "--local", "--get", key],
    repoRoot,
  );
  return current.code === 0 ? current.stdout.trim() : undefined;
}

async function installConfig(
  ctx: Context,
  repoRoot: string,
  key: string,
  value: string,
): Promise<InstallItem> {
  const currentValue = await readLocalConfig(ctx, repoRoot, key);

  if (currentValue === value) {
    return { item: key, status: "unchanged" };
  }

  if (currentValue !== undefined) {
    return {
      item: key,
      status: "conflict",
      detail: `already set to "${currentValue}"`,
    };
  }

  const result = await ctx.git.run(["config", "--local", key, value], repoRoot);
  if (result.code !== 0) {
    return {
      item: key,
      status: "conflict",
      detail: result.stderr.trim() || "git config failed",
    };
  }
  return { item: key, status: "written" };
}

/** git runs hooks from `core.hooksPath` instead of the shared folder
 * whenever it is set, so it must not be. */
async function clearHooksPath(
  ctx: Context,
  repoRoot: string,
): Promise<InstallItem> {
  const key = "core.hooksPath";
  const currentValue = await readLocalConfig(ctx, repoRoot, key);

  if (currentValue === undefined) {
    return { item: key, status: "unchanged" };
  }

  if (currentValue !== EARLIER_HOOKS_PATH) {
    return {
      item: key,
      status: "conflict",
      detail: `set to "${currentValue}", so git would not run temple-bar's hooks`,
    };
  }

  const result = await ctx.git.run(
    ["config", "--local", "--unset", key],
    repoRoot,
  );
  if (result.code !== 0) {
    return {
      item: key,
      status: "conflict",
      detail: result.stderr.trim() || "git config failed",
    };
  }
  return {
    item: key,
    status: "written",
    detail: `removed "${EARLIER_HOOKS_PATH}", which earlier temple-bar releases set; the tracked ${EARLIER_HOOKS_PATH}/ folder is no longer used`,
  };
}

export async function installHooks(
  ctx: Context,
  repoRoot: string,
): Promise<InstallReport> {
  const items: InstallItem[] = [];

  const commonGitDir = await findCommonGitDir(ctx, repoRoot);
  if (commonGitDir === undefined) {
    items.push({
      item: "hooks",
      status: "conflict",
      detail: "git could not say where this repo's git folder is",
    });
  } else {
    const hooksDir = path.join(commonGitDir, "hooks");
    const shimItems: InstallItem[] = [];
    for (const shim of SHIMS) {
      shimItems.push(await installShim(ctx, repoRoot, hooksDir, shim));
    }
    items.push(...shimItems);
    if (
      shimItems.every(
        (item) => item.status !== "conflict" && item.detail !== KEPT_DETAIL,
      )
    ) {
      await recordInstalledCheckout(ctx, repoRoot, hooksDir);
    }
  }
  items.push(await clearHooksPath(ctx, repoRoot));
  items.push(await installConfig(ctx, repoRoot, "pull.ff", "only"));

  return {
    items,
    hasConflicts: items.some((item) => item.status === "conflict"),
  };
}
