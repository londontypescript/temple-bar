// Projects and preservation assertions for packed setup on recorded scaffolds.
// All commands share an environment that keeps the toolbox, caches and fake
// GitHub answers separate from the machine running the suite.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  lstatSync,
  readlinkSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  BLOCK_BEGIN,
  freshAgentsMd,
  locateTempleBarBlock,
  templeBarBlock,
} from "../../packages/temple-bar/src/init/agents-template.ts";
import { COMPANION_FILES } from "../../packages/temple-bar/src/init/companion-docs.ts";
import {
  GATE_SCRIPT,
  PREPARE_SCRIPT,
} from "../../packages/temple-bar/src/init/package-json.ts";
import type { ScaffoldFixture } from "../../packages/temple-bar/src/init/testing/scaffolds/index.ts";
import { CHECKED_WORKFLOWS } from "../../packages/temple-bar/src/init/workflows.ts";
import {
  JUDGE_WORKFLOW_PATH,
  judgeWorkflow,
} from "../../packages/temple-bar/src/judge/workflow.ts";
import { initTestRepo } from "../../packages/temple-bar/src/testing/git-repo.ts";
import { createFakeGh } from "./fake-gh.ts";
import { describe, run, type RunOptions, type RunResult } from "./run.ts";

export function scaffoldEnv(
  workDir: string,
  registryUrl: string,
): NodeJS.ProcessEnv {
  const env = createFakeGh(
    workDir,
    Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^(npm|pnpm)_/i.test(key)),
    ),
  );
  for (const prefix of ["npm_config_", "pnpm_config_"]) {
    env[`${prefix}registry`] = registryUrl;
    env[`${prefix}cache`] = path.join(workDir, "npm-cache");
    env[`${prefix}store_dir`] = path.join(workDir, "pnpm-store");
    env[`${prefix}cache_dir`] = path.join(workDir, "pnpm-cache");
    // Harness accommodation: the linked dependencies belong to the toolbox's
    // manifest. Checking or installing the framework's before exec or run
    // would replace them, and affect the later fixtures too.
    env[`${prefix}verify_deps_before_run`] = "false";
  }
  // Setup also asks real git about origin/HEAD; fake gh cannot answer it.
  // Fail immediately even on a machine with working GitHub SSH credentials.
  env.GIT_SSH_COMMAND = "false";
  return env;
}

export async function git(
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> {
  const result = await run("git", args, options);
  assert.equal(result.code, 0, `git ${args.join(" ")}\n${describe(result)}`);
  return result;
}

export async function makeScaffoldProject(
  workDir: string,
  fixture: ScaffoldFixture,
  env: NodeJS.ProcessEnv,
): Promise<RunOptions> {
  const cwd = path.join(workDir, fixture.name);
  mkdirSync(cwd);
  initTestRepo(cwd);
  for (const [relative, content] of Object.entries(fixture.files)) {
    const file = path.join(cwd, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const options = { cwd, env };
  await git(["add", "-A"], options);
  for (const [relative, target] of Object.entries(fixture.symlinks)) {
    const file = path.join(cwd, relative);
    try {
      symlinkSync(target, file, "file");
    } catch (error) {
      // The test proves setup leaves a real link alone, so a plain-file
      // stand-in would prove something else: fail, never fall back.
      throw new Error(
        `${fixture.name}: this machine refused to create the ${relative} link; the test needs real links`,
        { cause: error },
      );
    }
    const oid = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      ...options,
      input: target,
      encoding: "utf8",
    }).trim();
    await git(
      ["update-index", "--add", "--cacheinfo", `120000,${oid},${relative}`],
      options,
    );
  }
  // Do not add broadly after the link entries: with core.symlinks=false
  // (Git for Windows' usual setting) git may stage the link as an ordinary
  // file.
  await git(["commit", "-q", "-m", "Initial commit"], options);
  for (const relative of Object.keys(fixture.symlinks)) {
    for (const args of [
      ["ls-files", "-s", "--", relative],
      ["ls-tree", "HEAD", "--", relative],
    ]) {
      const entry = await git(args, options);
      assert.match(
        entry.stdout,
        /^120000 /,
        `${fixture.name}: ${relative} is committed and indexed as a symlink`,
      );
    }
  }
  await git(
    ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
    options,
  );
  return options;
}

/** Called only after the scaffold's initial commit; the manifest and recorded
 * ignore file stay untouched. Directory ignore patterns don't cover symlinks. */
export function linkToolbox(projectDir: string, toolboxDir: string): void {
  symlinkSync(
    path.join(toolboxDir, "node_modules"),
    path.join(projectDir, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  appendFileSync(
    path.join(projectDir, ".git", "info", "exclude"),
    "\n/node_modules\n",
  );
}

interface Manifest {
  readonly scripts: Readonly<Record<string, string>>;
  readonly packageManager?: string;
  readonly [key: string]: unknown;
}

/** Compare the installed result to shipped text and recorded data, without
 * asking setup's transformation functions to predict their own output. */
export function assertScaffoldSetup(
  dir: string,
  fixture: ScaffoldFixture,
  pnpmVersion: string,
): void {
  const label = fixture.name;
  const read = (relative: string) => {
    const file = path.join(dir, relative);
    assert.ok(existsSync(file), `${label}: ${relative} exists after setup`);
    return readFileSync(file, "utf8");
  };
  const agents = read("AGENTS.md");
  assert.ok(
    agents.includes(BLOCK_BEGIN),
    `${label}: temple-bar's begin marker`,
  );
  const block = locateTempleBarBlock(agents);
  assert.equal(block.kind, "found", `${label}: one complete temple-bar block`);
  assert.equal(
    `${block.block}\n`,
    templeBarBlock(),
    `${label}: shipped agent rules`,
  );
  const originalAgents = fixture.files["AGENTS.md"];
  if (originalAgents === undefined) {
    assert.equal(agents, freshAgentsMd(), `${label}: shipped AGENTS.md`);
  } else {
    assert.equal(
      block.before,
      `${originalAgents}\n`,
      `${label}: framework agent rules are unchanged outside the block`,
    );
    assert.equal(block.after, "", `${label}: no framework agent rules moved`);
  }

  for (const file of COMPANION_FILES) {
    const target = fixture.symlinks[file.path];
    if (target !== undefined) {
      const full = path.join(dir, file.path);
      assert.ok(
        lstatSync(full).isSymbolicLink(),
        `${label}: ${file.path} is still a link`,
      );
      assert.equal(
        readlinkSync(full),
        target,
        `${label}: ${file.path} retains its stored link target`,
      );
      assert.doesNotMatch(
        agents,
        /^# Claude Code$/m,
        `${label}: no Claude heading written through the link`,
      );
      assert.doesNotMatch(
        agents,
        /^@AGENTS\.md$/m,
        `${label}: no self import written through the link`,
      );
      continue;
    }
    // Setup adds to an existing CLAUDE.md, so a scaffold that ships one
    // needs assertions written for it; none of these recordings does.
    assert.equal(
      fixture.files[file.path],
      undefined,
      `${label}: recorded ${file.path} needs its own assertions`,
    );
    assert.equal(
      read(file.path),
      file.content,
      `${label}: shipped ${file.path}`,
    );
  }
  assert.equal(
    read(JUDGE_WORKFLOW_PATH),
    judgeWorkflow(),
    `${label}: shipped judge workflow`,
  );
  for (const workflow of CHECKED_WORKFLOWS) {
    assert.equal(
      read(workflow.path),
      workflow.content,
      `${label}: shipped ${workflow.label}`,
    );
  }

  for (const [relative, original] of Object.entries(fixture.files)) {
    if (
      ["package.json", "AGENTS.md", "CLAUDE.md", ".gitignore"].includes(
        relative,
      )
    )
      continue;
    assert.equal(
      read(relative),
      original,
      `${label}: framework ${relative} is unchanged`,
    );
  }
  assert.ok(
    read(".gitignore").startsWith(fixture.files[".gitignore"] ?? ""),
    `${label}: recorded .gitignore is unchanged at the start`,
  );

  const originalText = fixture.files["package.json"];
  assert.ok(originalText !== undefined, `${label}: recorded package.json`);
  const original = JSON.parse(originalText) as Manifest;
  const writtenText = read("package.json");
  const written = JSON.parse(writtenText) as Manifest;
  const prepare =
    fixture.name === "sveltekit"
      ? `svelte-kit sync || echo '' && ${PREPARE_SCRIPT}`
      : PREPARE_SCRIPT;
  assert.equal(
    written.scripts.prepare,
    prepare,
    `${label}: prepare preserves the scaffold command and installs hooks`,
  );
  const expected = {
    ...original,
    scripts: { ...original.scripts, prepare, gate: GATE_SCRIPT },
    packageManager: original.packageManager ?? `pnpm@${pnpmVersion}`,
  };
  assert.deepEqual(
    written,
    expected,
    `${label}: all recorded fields and scripts survive, with only setup's additions`,
  );
  const indent = /^[ \t]+(?=")/m.exec(originalText)?.[0];
  assert.ok(indent !== undefined, `${label}: recorded indentation`);
  assert.equal(
    writtenText,
    `${JSON.stringify(written, null, indent)}${originalText.endsWith("\n") ? "\n" : ""}`,
    `${label}: package.json keeps its indentation and final newline`,
  );
}
