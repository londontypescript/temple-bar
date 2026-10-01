// `installHooks`: writes the shims into <repoRoot>/.githooks/ and sets the
// local git config that makes them active. Used by `temple-bar hook install`
// (command.ts) and by `init`. Idempotent: a second run changes nothing. Never
// overwrites a file or config value that already differs from what
// temple-bar would write; that's reported as a conflict instead, and the
// caller (command.ts) turns a report with conflicts into a non-zero exit.
//
// The one exception is a shim exactly as an earlier temple-bar release wrote
// it: that is replaced, because the install runs from `prepare` on every
// `pnpm install`, and a conflict there would fail the very install that
// upgrades temple-bar. It's known by its hash, so a hand-edited shim is
// still a conflict.

import { createHash } from "node:crypto";
import path from "node:path";

import type { Context } from "../context.ts";
import {
  COMMIT_MSG_SHIM,
  PRE_COMMIT_SHIM,
  REFERENCE_TRANSACTION_SHIM,
} from "./shims.ts";

export type InstallItemStatus = "written" | "unchanged" | "conflict";

export interface InstallItem {
  /** What this item is: a `.githooks/<name>` path or a `<section>.<key>` git config key. */
  readonly item: string;
  readonly status: InstallItemStatus;
  /** Present for "conflict", explaining what was already there. */
  readonly detail?: string;
}

export interface InstallReport {
  readonly items: readonly InstallItem[];
  readonly hasConflicts: boolean;
}

const HOOKS_DIR = ".githooks";

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
    name: "reference-transaction",
    content: REFERENCE_TRANSACTION_SHIM,
    // 0.0.1 to 0.0.3
    earlierReleases: [
      "75971844b8a72064af9970d8bd01f61fc4b094315b4f847542860ba8e7de2590",
    ],
  },
];

const CONFIG_VALUES: readonly {
  readonly key: string;
  readonly value: string;
}[] = [
  { key: "core.hooksPath", value: HOOKS_DIR },
  { key: "pull.ff", value: "only" },
];

const EXECUTABLE_MODE = 0o755;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function installShim(
  ctx: Context,
  repoRoot: string,
  shim: Shim,
): Promise<InstallItem> {
  const { name, content } = shim;
  const relPath = path.posix.join(HOOKS_DIR, name);
  const fullPath = path.join(repoRoot, HOOKS_DIR, name);
  const existing = await ctx.fs.readText(fullPath);

  if (existing === undefined) {
    await ctx.fs.mkdirp(path.join(repoRoot, HOOKS_DIR));
    await ctx.fs.writeText(fullPath, content);
    await ctx.fs.chmod(fullPath, EXECUTABLE_MODE);
    return { item: relPath, status: "written" };
  }

  if (existing === content) {
    // A second run still makes sure the shim is executable.
    await ctx.fs.chmod(fullPath, EXECUTABLE_MODE);
    return { item: relPath, status: "unchanged" };
  }

  if (shim.earlierReleases.includes(sha256(existing))) {
    await ctx.fs.writeText(fullPath, content);
    await ctx.fs.chmod(fullPath, EXECUTABLE_MODE);
    return {
      item: relPath,
      status: "written",
      detail: "replaced an earlier temple-bar version",
    };
  }

  return {
    item: relPath,
    status: "conflict",
    detail: "an existing file's content differs from the temple-bar shim",
  };
}

async function installConfig(
  ctx: Context,
  repoRoot: string,
  key: string,
  value: string,
): Promise<InstallItem> {
  const current = await ctx.git.run(
    ["config", "--local", "--get", key],
    repoRoot,
  );
  const currentValue = current.code === 0 ? current.stdout.trim() : undefined;

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

export async function installHooks(
  ctx: Context,
  repoRoot: string,
): Promise<InstallReport> {
  const items: InstallItem[] = [];

  for (const shim of SHIMS) {
    items.push(await installShim(ctx, repoRoot, shim));
  }
  for (const config of CONFIG_VALUES) {
    items.push(await installConfig(ctx, repoRoot, config.key, config.value));
  }

  return {
    items,
    hasConflicts: items.some((item) => item.status === "conflict"),
  };
}
