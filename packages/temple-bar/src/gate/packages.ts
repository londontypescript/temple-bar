// The gate's workspace inventory: which packages it checks besides the
// root, and whether git holds a package.json that none of them owns (see
// docs/adr/0015-every-package-checked-and-guarded.md).
//
// In a pnpm workspace the list comes from the pnpm that started the gate,
// named by npm_execpath (see launcher.ts), never from a `pnpm` on PATH: a project could put
// one there that lists fewer packages. The list is then compared with
// git's: every tracked package.json must be the root's or a listed
// package's own, so a package left outside pnpm-workspace.yaml's patterns
// fails, on evidence pnpm doesn't control.
//
// Every way this can go wrong becomes this check's failure, never a thrown
// error, so the root's scripts, the other checks and the closing report all
// still happen.

import path from "node:path";

import type { Context } from "../context.ts";
import type { Writer } from "../seams/io.ts";
import {
  launch,
  launcherName,
  refusalMessage,
  type Launcher,
  type Startable,
} from "./launcher.ts";
import type { CheckOutcome } from "./report.ts";

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const MANIFEST = "package.json";
export const INVENTORY_CHECK = "workspace packages";

/** The commands that start the gate through pnpm, so it can list packages. */
const START_WITH_PNPM =
  "run `pnpm gate`, `pnpm ready` to mark the commit ready to push, " +
  "or `pnpm merge <N>` from the default-branch checkout to merge";

interface WorkspacePackage {
  /** The package's folder relative to the root, "/"-separated. */
  readonly relative: string;
  /** Its real folder, where its scripts run. */
  readonly folder: string;
}

export interface Inventory {
  /** Packages besides the root, in path order; empty when pnpm's list
   * couldn't be read. */
  readonly packages: readonly WorkspacePackage[];
  readonly outcome: CheckOutcome;
  /** The failure in full, to write after the scripts' output. */
  readonly message?: string;
}

/** A reason the inventory failed, said in one line. */
class InventoryFailure extends Error {
  override readonly name = "InventoryFailure";
}

function fail(reason: string): never {
  throw new InventoryFailure(reason);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for a folder named by git's "/"-separated path whose last part is
 * package.json, in any letter case: on a case-insensitive disk (Windows, a
 * default macOS volume) git may track `Package.json` while every tool opens
 * it as `package.json`, so an odd spelling is a manifest to check, never a
 * way past the list. A directory entry (a nested worktree) ends in "/" and
 * never matches. */
function isManifest(relative: string): boolean {
  return relative.split("/").pop()?.toLowerCase() === MANIFEST;
}

/** The pnpm that started the gate, when it was a pnpm the gate can start
 * again. */
function startingPnpm(launcher: Launcher): Startable {
  if (launcher.kind === "absent") {
    fail(
      `this is a pnpm workspace, but the gate wasn't started through pnpm, so it can't ask pnpm for the packages: ${START_WITH_PNPM}`,
    );
  }
  if (launcher.kind === "refused") {
    fail(refusalMessage(launcher));
  }
  const name = launcherName(launcher);
  if (!name.toLowerCase().startsWith("pnpm")) {
    fail(
      `this is a pnpm workspace, which needs pnpm, but the gate was started by ${name}: ${START_WITH_PNPM}`,
    );
  }
  return launcher;
}

function collect(): Writer & { text: () => string } {
  let text = "";
  return {
    write(chunk) {
      text += chunk;
    },
    text: () => text,
  };
}

/** The absolute folder of every entry `pnpm list --json` printed. */
function parseListing(output: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    fail("pnpm's package list isn't JSON");
  }
  if (!Array.isArray(parsed)) {
    fail("pnpm's package list isn't a list");
  }
  return (parsed as unknown[]).map((entry) => {
    const folder: unknown =
      typeof entry === "object" && entry !== null && "path" in entry
        ? entry.path
        : undefined;
    if (typeof folder !== "string" || !path.isAbsolute(folder)) {
      fail(
        `pnpm listed an entry without an absolute path: ${JSON.stringify(entry)}`,
      );
    }
    return folder;
  });
}

/** `folder` with every link resolved; a folder that is missing, or isn't
 * a folder, fails the inventory. */
async function realFolder(ctx: Context, folder: string): Promise<string> {
  let real: string;
  try {
    real = await ctx.fs.realpath(folder);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    fail(
      code === "ENOENT"
        ? `${folder} doesn't exist`
        : `could not resolve ${folder}: ${describe(error)}`,
    );
  }
  if ((await ctx.fs.classify(real)) !== "directory") {
    fail(`${folder} isn't a folder`);
  }
  return real;
}

/** "/"-separated, relative to `root`; undefined when outside it. */
function inside(root: string, folder: string): string | undefined {
  const relative = path.relative(root, folder);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** The packages pnpm lists, besides the root, checked and in path order. */
async function listPackages(
  ctx: Context,
  realRoot: string,
  launcher: Launcher,
): Promise<WorkspacePackage[]> {
  const listing = launch(startingPnpm(launcher), [
    "list",
    "--recursive",
    "--depth",
    "-1",
    "--json",
  ]);
  const stdout = collect();
  const stderr = collect();
  const code = await ctx.proc.run(listing.command, listing.args, {
    cwd: ctx.cwd,
    env: ctx.env,
    stdout,
    stderr,
  });
  if (code !== 0) {
    // pnpm on Windows may end its lines with CRLF.
    const said = stderr.text().trim().split(/\r?\n/)[0] ?? "";
    fail(
      `pnpm list exited with ${String(code)}${said === "" ? "" : `: ${said}`}`,
    );
  }

  const seen = new Set<string>();
  const packages: WorkspacePackage[] = [];
  for (const listed of parseListing(stdout.text())) {
    const real = await realFolder(ctx, listed);
    const relative = inside(realRoot, real);
    if (relative === undefined) {
      fail(`pnpm listed a folder outside the root: ${listed}`);
    }
    if (seen.has(real)) {
      fail(`pnpm listed ${relative === "" ? "the root" : relative} twice`);
    }
    seen.add(real);
    if (relative !== "") {
      packages.push({ relative, folder: real });
    }
  }
  return packages.sort((a, b) => byteOrder(a.relative, b.relative));
}

/** Every tracked package.json that is neither the root's nor a listed
 * package's own, relative to the root. */
async function unlistedManifests(
  ctx: Context,
  tracked: readonly string[],
  realRoot: string,
  packages: readonly WorkspacePackage[],
): Promise<string[]> {
  const owners = new Set([
    realRoot,
    ...packages.map((member) => member.folder),
  ]);
  const unlisted: string[] = [];
  for (const relative of tracked.filter(isManifest)) {
    const parts = relative.split("/").slice(0, -1);
    if (parts.length === 0) {
      continue;
    }
    const folder = await realFolder(ctx, path.join(ctx.cwd, ...parts));
    if (!owners.has(folder)) {
      unlisted.push(relative);
    }
  }
  return unlisted;
}

function failed(
  reason: string,
  packages: readonly WorkspacePackage[],
  message: string,
): Inventory {
  return {
    packages,
    outcome: { name: INVENTORY_CHECK, status: "failed", detail: reason },
    message,
  };
}

function unlistedFailure(
  unlisted: readonly string[],
  workspace: boolean,
  packages: readonly WorkspacePackage[],
): Inventory {
  const where = workspace
    ? `add each one's folder to the packages in ${WORKSPACE_FILE}, so the gate checks its scripts`
    : `there is no ${WORKSPACE_FILE}, so the root is the only package: list each one's folder in a ${WORKSPACE_FILE}, so the gate checks its scripts`;
  return failed(
    `${String(unlisted.length)} package.json file(s) outside the workspace's packages`,
    packages,
    [
      `gate: git holds package.json file(s) that belong to no package the gate checks:`,
      ...unlisted.map((relative) => `  ${relative}`),
      `  ${where}`,
      "",
    ].join("\n"),
  );
}

/**
 * Which packages besides the root the gate runs scripts in, judged from
 * `tracked`, git's file list, listed through `launcher`. Never throws:
 * every failure is the outcome. A launcher the gate can't start fails it
 * in any project, since then none of its scripts run either.
 */
export async function takeInventory(
  ctx: Context,
  tracked: readonly string[],
  launcher: Launcher,
): Promise<Inventory> {
  if (launcher.kind === "refused") {
    const reason = refusalMessage(launcher);
    return failed(
      `${reason}; no script was run`,
      [],
      `gate: no script was run: ${reason}\n`,
    );
  }
  const workspace = tracked.includes(WORKSPACE_FILE);
  if (!workspace) {
    // The root's own manifest is the one at the top, whatever its letter
    // case; only a nested one belongs to no package.
    const unlisted = tracked.filter(
      (relative) => isManifest(relative) && relative.includes("/"),
    );
    return unlisted.length > 0
      ? unlistedFailure(unlisted, false, [])
      : {
          packages: [],
          outcome: {
            name: INVENTORY_CHECK,
            status: "passed",
            detail: `the root alone: no ${WORKSPACE_FILE}`,
          },
        };
  }

  let realRoot: string;
  let packages: WorkspacePackage[];
  try {
    realRoot = await realFolder(ctx, ctx.cwd);
    packages = await listPackages(ctx, realRoot, launcher);
  } catch (error) {
    const reason = describe(error);
    return failed(
      `${reason}; no package's scripts were run`,
      [],
      `gate: could not list the workspace's packages, so only the root's scripts were run: ${reason}\n`,
    );
  }

  try {
    const unlisted = await unlistedManifests(ctx, tracked, realRoot, packages);
    if (unlisted.length > 0) {
      return unlistedFailure(unlisted, true, packages);
    }
  } catch (error) {
    const reason = describe(error);
    return failed(
      reason,
      packages,
      `gate: could not compare git's package.json files with pnpm's packages: ${reason}\n`,
    );
  }
  return {
    packages,
    outcome: {
      name: INVENTORY_CHECK,
      status: "passed",
      detail: `the root and ${String(packages.length)} package(s)`,
    },
  };
}
