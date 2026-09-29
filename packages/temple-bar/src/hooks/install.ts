// `installHooks`: writes the shims into <repoRoot>/.githooks/ and sets the
// local git config that makes them active. Used by `temple-bar hook install`
// (command.ts) and, per the plan, by 1.7's `init`. Idempotent: a second run
// changes nothing. Never overwrites a file or config value that already
// differs from what temple-bar would write; that's reported as a conflict
// instead, and the caller (command.ts) turns a report with conflicts into a
// non-zero exit.

import path from "node:path";

import type { Context } from "../context.ts";
import { PRE_COMMIT_SHIM, REFERENCE_TRANSACTION_SHIM } from "./shims.ts";

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

const SHIMS: readonly { readonly name: string; readonly content: string }[] = [
  { name: "pre-commit", content: PRE_COMMIT_SHIM },
  { name: "reference-transaction", content: REFERENCE_TRANSACTION_SHIM },
];

const CONFIG_VALUES: readonly {
  readonly key: string;
  readonly value: string;
}[] = [
  { key: "core.hooksPath", value: HOOKS_DIR },
  { key: "pull.ff", value: "only" },
];

const EXECUTABLE_MODE = 0o755;

async function installShim(
  ctx: Context,
  repoRoot: string,
  name: string,
  content: string,
): Promise<InstallItem> {
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
    items.push(await installShim(ctx, repoRoot, shim.name, shim.content));
  }
  for (const config of CONFIG_VALUES) {
    items.push(await installConfig(ctx, repoRoot, config.key, config.value));
  }

  return {
    items,
    hasConflicts: items.some((item) => item.status === "conflict"),
  };
}
