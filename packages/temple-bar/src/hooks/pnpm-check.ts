// The check that runs before a new worktree installs: is the pnpm that will
// do the install the one package.json says the project uses? A tool that
// runs `git worktree add` can give git a PATH where an old pnpm comes first,
// and pnpm 8 can neither switch itself to the pinned version nor read a
// newer lockfile. Asking pnpm itself (`pnpm --version`, through the same
// seam, command name and environment as the install) is the only answer that
// is right on every platform and version manager; pnpm 9.7 and newer switch
// to the pinned version while answering, which is allowed.
//
// Nothing is installed or switched by temple-bar. A mismatch, or a pnpm that
// can't even answer, stops the install with what was found and the fix.

import path from "node:path";

import type { Context } from "../context.ts";
import { declaredPnpm } from "./pnpm-pin.ts";

/** What the install command is, for the hand-run fix. */
const INSTALL_COMMAND = "pnpm install --frozen-lockfile";

interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs pnpm through the seam, collecting what it prints instead of
 * streaming it. */
async function capturePnpm(
  ctx: Context,
  args: readonly string[],
  cwd: string,
): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const code = await ctx.proc.run("pnpm", args, {
    cwd,
    env: ctx.env,
    stdout: {
      write: (text) => {
        stdout += text;
      },
    },
    stderr: {
      write: (text) => {
        stderr += text;
      },
    },
  });
  return { code, stdout, stderr };
}

function pathEntries(env: Readonly<NodeJS.ProcessEnv>): string[] {
  // Windows spells the variable `Path`.
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const value = key === undefined ? undefined : env[key];
  return (value ?? "").split(path.delimiter).filter((entry) => entry !== "");
}

/** The first `pnpm` on PATH, which is what a plain `pnpm` finds. */
async function firstPnpmOnPath(
  ctx: Context,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const names =
    platform === "win32" ? ["pnpm.cmd", "pnpm.exe", "pnpm.bat"] : ["pnpm"];
  for (const entry of pathEntries(ctx.env)) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (await ctx.fs.exists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** Where the pnpm that answered lives. pnpm tells scripts its own script
 * path in `npm_execpath`, so that is asked for first; not every pnpm sets it
 * for `exec`, so the first match on PATH is the labelled fallback. */
async function whereIsPnpm(
  ctx: Context,
  worktree: string,
  platform: NodeJS.Platform,
): Promise<string> {
  const reported = await capturePnpm(
    ctx,
    ["exec", "node", "-p", "process.env.npm_execpath"],
    worktree,
  );
  const line = reported.stdout.trim();
  if (reported.code === 0 && line !== "" && line !== "undefined") {
    return line;
  }
  const first = await firstPnpmOnPath(ctx, platform);
  return first === undefined
    ? "not found (no pnpm on PATH)"
    : `${first} (probably: the first pnpm on PATH)`;
}

function handRunSteps(worktree: string): string[] {
  return [
    "The worktree already exists; only the install remains. In this folder:",
    `  ${worktree}`,
    "run:",
    `  ${INSTALL_COMMAND}`,
  ];
}

const FIX =
  "Fix: give the tool that ran `git worktree add` (your terminal, editor or desktop app) a pnpm 9.7 or newer, which switches itself to the pinned version, or the pinned version itself. A desktop app has to be restarted to pick up a new PATH.";

function refuse(ctx: Context, lines: readonly string[]): false {
  ctx.stderr.write(
    `${lines.map((line) => `temple-bar: ${line}`).join("\n")}\n`,
  );
  return false;
}

/**
 * True when the install may go ahead; false after printing why not. A
 * project that names no pnpm version, or only a range, installs anyway with
 * a line saying the version wasn't checked.
 */
export async function pnpmMatchesPin(
  ctx: Context,
  worktree: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const manifest = await ctx.fs.readText(path.join(worktree, "package.json"));
  const declared = declaredPnpm(manifest ?? "");

  if (declared.kind === "none") {
    ctx.stdout.write(
      "temple-bar: package.json names no pnpm version, so which pnpm installs wasn't checked\n",
    );
    return true;
  }
  if (declared.kind === "range") {
    ctx.stdout.write(
      `temple-bar: package.json asks for pnpm ${declared.declared}, not an exact version, so which pnpm installs wasn't checked\n`,
    );
    return true;
  }
  if (declared.kind === "conflict") {
    return refuse(ctx, [
      "package.json contradicts itself, so nothing was installed:",
      `  "packageManager" pins pnpm ${declared.packageManager}`,
      `  "devEngines.packageManager" pins pnpm ${declared.devEngines}`,
      "Fix: make the two name the same pnpm version, or remove one.",
      ...handRunSteps(worktree),
    ]);
  }

  const answer = await capturePnpm(ctx, ["--version"], worktree);
  const found = answer.stdout.trim();
  if (answer.code === 0 && found === declared.version) {
    return true;
  }

  const where = await whereIsPnpm(ctx, worktree, platform);
  const wrong =
    answer.code === 0
      ? [
          "the pnpm that would install here is not the one this project pins, so nothing was installed.",
          `  package.json pins: pnpm ${declared.version}`,
          `  \`pnpm --version\` found: ${found}`,
        ]
      : [
          "the pnpm that would install here could not say its version, so nothing was installed.",
          `  package.json pins: pnpm ${declared.version}`,
          `  \`pnpm --version\` failed (exit ${String(answer.code)}):`,
          ...answer.stderr
            .trim()
            .split(/\r?\n/)
            .filter((line) => line !== "")
            .map((line) => `    ${line}`),
        ];
  return refuse(ctx, [
    ...wrong,
    `  that pnpm is at: ${where}`,
    FIX,
    ...handRunSteps(worktree),
  ]);
}
