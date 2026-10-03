// The gate's core-setup check: everything setup installs must still be in
// place. Without it, the rules could be trimmed quietly, one file or one
// hook at a time, and nothing would notice, because a missing hook simply
// doesn't run. The gate is the only place this is checked (there is no
// separate health command), so it runs on every gate run.
//
// What setup installs, and how each piece is checked:
// - the hook shims in git's shared hooks folder: present, and byte for byte
//   the shims this temple-bar ships (compared by SHA-256), so an edited shim
//   fails as surely as a deleted one;
// - git config: no `core.hooksPath` anywhere (while it is set, git runs no
//   hook from the shared folder) and `pull.ff` set to `only`;
// - .gitignore with every line setup keeps there, and the `prepare` and
//   `gate` scripts in package.json, exactly as setup writes them.
//
// AGENTS.md is setup's too, but a repo without one must still be able to
// pass the gate (the AGENTS.md size check skips it, see
// docs/adr/0007-what-the-gate-checks.md), so its absence isn't failed here.
// What a project writes itself after setup (its other scripts and
// .gitignore lines) is its own: only setup's exact lines count.

import { createHash } from "node:crypto";
import path from "node:path";

import type { Context } from "../context.ts";
import {
  COMMIT_MSG_SHIM,
  POST_CHECKOUT_SHIM,
  PRE_COMMIT_SHIM,
  PRE_PUSH_SHIM,
  REFERENCE_TRANSACTION_SHIM,
} from "../hooks/shims.ts";
import { GATE_SCRIPT, GITIGNORE_LINES, PREPARE_SCRIPT } from "../init/files.ts";
import type { CheckOutcome } from "./report.ts";

const CORE_CHECK = "core setup";

const HOOK_INSTALL = "pnpm exec temple-bar hook install";

/** Every hook setup installs, by the name git runs it under. */
export const INSTALLED_SHIMS: Readonly<Record<string, string>> = {
  "pre-commit": PRE_COMMIT_SHIM,
  "commit-msg": COMMIT_MSG_SHIM,
  "pre-push": PRE_PUSH_SHIM,
  "reference-transaction": REFERENCE_TRANSACTION_SHIM,
  "post-checkout": POST_CHECKOUT_SHIM,
};

/** The package.json scripts setup writes, with their exact commands. */
export const INSTALLED_SCRIPTS: Readonly<Record<string, string>> = {
  prepare: PREPARE_SCRIPT,
  gate: GATE_SCRIPT,
};

export interface CoreProblem {
  /** What is wrong, naming the file, hook or setting. */
  readonly problem: string;
  /** What to do to put it back. */
  readonly fix: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function readGitConfig(
  ctx: Context,
  key: string,
): Promise<string | undefined> {
  const result = await ctx.git.run(["config", "--get", key], ctx.cwd);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

async function checkHooks(ctx: Context): Promise<CoreProblem[]> {
  const result = await ctx.git.run(["rev-parse", "--git-common-dir"], ctx.cwd);
  if (result.code !== 0) {
    return [
      {
        problem: "git could not say where this repo's hooks folder is",
        fix: "run the gate from inside the repo's checkout",
      },
    ];
  }
  // Relative (".git") in the main worktree, absolute in any other.
  const dir = result.stdout.trim();
  const hooksDir = path.join(
    path.isAbsolute(dir) ? dir : path.join(ctx.cwd, dir),
    "hooks",
  );

  const problems: CoreProblem[] = [];
  for (const [name, content] of Object.entries(INSTALLED_SHIMS)) {
    const installed = await ctx.fs.readText(path.join(hooksDir, name));
    if (installed === undefined) {
      problems.push({
        problem: `the ${name} hook is missing`,
        fix: `run \`${HOOK_INSTALL}\` to put it back`,
      });
    } else if (sha256(installed) !== sha256(content)) {
      problems.push({
        problem: `the ${name} hook differs from the one temple-bar installs`,
        fix: `delete ${path.join(hooksDir, name)}, then run \`${HOOK_INSTALL}\` to write it again`,
      });
    }
  }
  return problems;
}

async function checkGitConfig(ctx: Context): Promise<CoreProblem[]> {
  const problems: CoreProblem[] = [];
  const hooksPath = await readGitConfig(ctx, "core.hooksPath");
  if (hooksPath !== undefined) {
    problems.push({
      problem: `core.hooksPath is set to "${hooksPath}", so git runs none of temple-bar's hooks`,
      fix: "remove core.hooksPath from your git config (`git config --show-origin --get core.hooksPath` shows which file sets it)",
    });
  }
  const pullFf = await readGitConfig(ctx, "pull.ff");
  if (pullFf !== "only") {
    problems.push({
      problem:
        pullFf === undefined
          ? "pull.ff is not set, so a pull can make a merge commit"
          : `pull.ff is "${pullFf}", so a pull can make a merge commit`,
      fix: "run `git config pull.ff only`",
    });
  }
  return problems;
}

async function checkGitignore(ctx: Context): Promise<CoreProblem[]> {
  const content = await ctx.fs.readText(path.join(ctx.cwd, ".gitignore"));
  const present = new Set(
    (content ?? "").split(/\r?\n/).map((line) => line.trim()),
  );
  const missing = GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) {
    return [];
  }
  return [
    {
      problem:
        content === undefined
          ? ".gitignore is missing"
          : `.gitignore lacks line(s) setup keeps there: ${missing.join(", ")}`,
      fix: `add these lines to .gitignore: ${missing.join(" ")}`,
    },
  ];
}

async function checkScripts(ctx: Context): Promise<CoreProblem[]> {
  const raw = await ctx.fs.readText(path.join(ctx.cwd, "package.json"));
  let scripts: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === undefined ? undefined : JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "scripts" in parsed) {
      const value: unknown = parsed.scripts;
      if (typeof value === "object" && value !== null) {
        scripts = { ...value };
      }
    }
  } catch {
    // Unparseable package.json: every script below is reported missing,
    // which says what must be there once it is fixed.
  }

  const problems: CoreProblem[] = [];
  for (const [name, command] of Object.entries(INSTALLED_SCRIPTS)) {
    const current = scripts[name];
    if (current !== command) {
      problems.push({
        problem:
          current === undefined
            ? `package.json has no "${name}" script`
            : `package.json's "${name}" script is ${JSON.stringify(current)}`,
        fix: `set "${name}" in package.json's "scripts" to "${command}"`,
      });
    }
  }
  return problems;
}

/** Every way the installed core differs from what setup installs. */
export async function findCoreProblems(ctx: Context): Promise<CoreProblem[]> {
  return [
    ...(await checkHooks(ctx)),
    ...(await checkGitConfig(ctx)),
    ...(await checkGitignore(ctx)),
    ...(await checkScripts(ctx)),
  ];
}

function formatCoreFailure(problems: readonly CoreProblem[]): string {
  const lines = [
    `gate: ${String(problems.length)} part(s) of temple-bar's setup are missing or changed:`,
  ];
  for (const { problem, fix } of problems) {
    lines.push(`  ${problem}`, `    fix: ${fix}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runCoreCheck(ctx: Context): Promise<CheckOutcome> {
  const problems = await findCoreProblems(ctx);
  if (problems.length > 0) {
    ctx.stderr.write(formatCoreFailure(problems));
    return {
      name: CORE_CHECK,
      status: "failed",
      detail: `${String(problems.length)} problem(s)`,
    };
  }
  return {
    name: CORE_CHECK,
    status: "passed",
    detail: `${String(Object.keys(INSTALLED_SHIMS).length)} hooks unchanged, git config, .gitignore, package.json scripts`,
  };
}
