// A Windows clone of a project set up by the packed package. Git for Windows
// installs with core.autocrlf=true, which checks every text file out with
// CRLF unless the project's attributes say otherwise, and Prettier (the
// project's format check) wants LF. Setup writes .gitattributes, so an
// autocrlf clone checks files out with LF and format:check passes. The same
// clone of the project without the file is the control: CRLF, and the check
// fails. This simulates Windows on any machine; it doesn't replace a run on
// real Windows.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { devNull } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  launch,
  makeProject,
  startPackedLauncher,
  type PackedLauncher,
} from "./support/launcher.ts";
import {
  describe,
  run,
  type RunOptions,
  type RunResult,
} from "./support/run.ts";
import { PASSING_SCRIPTS } from "./support/workspace.ts";

/** Prettier, pinned, from the public registry through the local registry's
 * pass-through. */
const PRETTIER = "3.9.9";

const TIMEOUT = { timeout: 600_000 };

let launcher: PackedLauncher | undefined;
let project: RunOptions | undefined;
/** What setup printed. */
let setupOutput = "";

async function ok(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> {
  const result = await run(command, args, options);
  assert.equal(result.code, 0, describe(result));
  return result;
}

before(async () => {
  launcher = await startPackedLauncher("temple-bar-gitattributes-");
  const options = await makeProject(launcher, "lf", {
    ".gitignore": "node_modules/\n",
    "package.json": `${JSON.stringify(
      {
        name: "lf",
        version: "1.0.0",
        private: true,
        scripts: { ...PASSING_SCRIPTS, "format:check": "prettier --check ." },
        devDependencies: { prettier: PRETTIER },
      },
      null,
      2,
    )}\n`,
    "src/index.js": "export const answer = 42;\n",
  });
  const setup = await launch(launcher, options);
  assert.equal(setup.code, 0, describe(setup));
  setupOutput = setup.stdout;
  // Hooks refuse commits to main, so the finished setup goes on a branch.
  await ok("git", ["switch", "-q", "-c", "setup"], options);
  await ok("git", ["add", "-A"], options);
  await ok(
    "git",
    ["-c", `core.hooksPath=${devNull}`, "commit", "-q", "-m", "chore: setup"],
    options,
  );
  // The control: the same project without the attributes file.
  await ok("git", ["switch", "-q", "-c", "no-attributes"], options);
  await ok("git", ["rm", "-q", ".gitattributes"], options);
  await ok(
    "git",
    ["-c", `core.hooksPath=${devNull}`, "commit", "-q", "-m", "chore: drop"],
    options,
  );
  project = options;
});

after(async () => {
  await launcher?.close();
});

/** Clones `branch` as Git for Windows would by default, installs it, and
 * runs its format check. */
async function windowsClone(branch: string): Promise<{
  readonly dir: string;
  readonly formatCheck: RunResult;
}> {
  assert.ok(launcher && project, "the project was not set up");
  const dir = path.join(launcher.folder, `clone-${branch}`);
  await ok(
    "git",
    [
      "-c",
      "core.autocrlf=true",
      "clone",
      "-q",
      "--branch",
      branch,
      project.cwd,
      dir,
    ],
    project,
  );
  const inClone = { cwd: dir, env: project.env };
  await ok("git", ["config", "core.autocrlf", "true"], inClone);
  await ok("pnpm", ["install", "--frozen-lockfile"], inClone);
  return {
    dir,
    formatCheck: await run("pnpm", ["run", "format:check"], inClone),
  };
}

/** The tracked files of the clone at `dir` holding a CRLF. */
async function crlfFiles(dir: string, env: NodeJS.ProcessEnv) {
  const listed = await ok("git", ["ls-files", "-z"], { cwd: dir, env });
  return listed.stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) =>
      readFileSync(path.join(dir, file), "utf8").includes("\r\n"),
    );
}

void test(
  "gitattributes: setup writes the file, and an autocrlf clone checks every text file out with LF and passes format:check",
  TIMEOUT,
  async (t) => {
    assert.ok(project);
    assert.ok(
      setupOutput.includes(
        "Wrote .gitattributes (* text=auto eol=lf), so every clone, Windows included, checks text files out with LF.\n",
      ),
      setupOutput,
    );
    // The project's checkout is on the control branch by now.
    const committed = await ok(
      "git",
      ["show", "setup:.gitattributes"],
      project,
    );
    assert.equal(committed.stdout, "* text=auto eol=lf\n");
    const clone = await windowsClone("setup");
    assert.deepEqual(await crlfFiles(clone.dir, project.env), []);
    assert.equal(clone.formatCheck.code, 0, describe(clone.formatCheck));
    t.diagnostic(clone.formatCheck.stdout.trim());
  },
);

void test(
  "gitattributes: the control, the same clone without the file, has CRLF and fails format:check",
  TIMEOUT,
  async (t) => {
    assert.ok(project);
    const clone = await windowsClone("no-attributes");
    const crlf = await crlfFiles(clone.dir, project.env);
    assert.ok(crlf.includes("AGENTS.md"), crlf.join(", "));
    assert.ok(crlf.includes("src/index.js"), crlf.join(", "));
    assert.notEqual(clone.formatCheck.code, 0, describe(clone.formatCheck));
    t.diagnostic(`${String(crlf.length)} files checked out with CRLF`);
  },
);
