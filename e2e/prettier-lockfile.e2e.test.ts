// A project that formats everything with Prettier, set up by the packed
// launcher. The judge reads pnpm-lock.yaml as text and refuses YAML pnpm
// never writes, such as a flow mapping wrapped over several lines, which is
// what Prettier makes of the lockfile's long `resolution: {integrity: ...}`
// lines at its default width. Setup lists the lockfile in .prettierignore,
// so after `prettier --write .` the judge still reads it: an ordinary
// dependency update passes, and a change to temple-bar's own entry is
// refused. The pull requests are served by the fake GitHub API as two whole
// trees, read from the project on disk.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import type { FakeFile } from "./support/fake-git-objects.ts";
import { serveFakeGithubApi } from "./support/fake-github-api.ts";
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

type Files = Readonly<Record<string, FakeFile>>;

const PR = 7;
const BASE_SHA = "b".repeat(40);
const HEAD_SHA = "c".repeat(40);
const LOCKFILE = "pnpm-lock.yaml";

/** Prettier, pinned, and the version the ordinary update moves it to. Both
 * come from the public registry through the local registry's pass-through. */
const PRETTIER = "3.9.9";
const PRETTIER_UPDATE = "3.9.8";

/** Prettier's default print width, which this project doesn't override. */
const PRINT_WIDTH = 80;

let launcher: PackedLauncher | undefined;
let project: RunOptions | undefined;
/** The project as committed after setup and `prettier --write .`. */
let base: Files = {};
/** The same project after `pnpm add` moved Prettier and it ran again. */
let updated: Files = {};
/** The lockfile at `base`, before Prettier ran. */
let lockfileBeforeFormatting = "";
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

/** Every file git would commit in the project, read from disk. */
async function snapshot(options: RunOptions): Promise<Files> {
  const listed = await ok(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    options,
  );
  return Object.fromEntries(
    listed.stdout
      .split("\0")
      .filter(Boolean)
      .map((file) => [
        file,
        readFileSync(path.join(options.cwd, file), "utf8"),
      ]),
  );
}

before(async () => {
  launcher = await startPackedLauncher("temple-bar-prettier-lockfile-");
  // No .prettierignore and no Prettier config: the project's own settings
  // are Prettier's defaults.
  const options = await makeProject(launcher, "formatted", {
    ".gitignore": "node_modules/\n",
    "package.json": `${JSON.stringify(
      {
        name: "formatted",
        version: "1.0.0",
        private: true,
        scripts: PASSING_SCRIPTS,
        devDependencies: { prettier: PRETTIER },
      },
      null,
      2,
    )}\n`,
  });
  const setup = await launch(launcher, options);
  assert.equal(setup.code, 0, describe(setup));
  setupOutput = setup.stdout;
  project = options;

  lockfileBeforeFormatting = readFileSync(
    path.join(options.cwd, LOCKFILE),
    "utf8",
  );
  await ok("pnpm", ["exec", "prettier", "--write", "."], options);
  base = await snapshot(options);

  await ok(
    "pnpm",
    ["add", "--save-dev", "--save-exact", `prettier@${PRETTIER_UPDATE}`],
    options,
  );
  await ok("pnpm", ["exec", "prettier", "--write", "."], options);
  updated = await snapshot(options);
});

after(async () => {
  await launcher?.close();
});

function text(files: Files, file: string): string {
  const content = files[file];
  assert.equal(typeof content, "string", `${file} is not in the tree`);
  return content as string;
}

/** Runs the installed judge on a pull request from `from` to `to`. */
async function judge(from: Files, to: Files): Promise<RunResult> {
  assert.ok(project, "the project was not set up");
  const api = await serveFakeGithubApi(
    "acme",
    "widgets",
    [
      {
        number: PR,
        headShas: [HEAD_SHA],
        baseRef: "main",
        baseShas: [BASE_SHA],
      },
    ],
    {
      trees: { [BASE_SHA]: from, [HEAD_SHA]: to },
      branches: { main: [BASE_SHA] },
      truncated: [],
    },
  );
  try {
    // Not a GitHub Actions job, whatever runs this suite, and no real token
    // is ever sent to the fake API.
    const env: NodeJS.ProcessEnv = {
      ...Object.fromEntries(
        Object.entries(project.env).filter(
          ([name]) => !/^(GITHUB_ACTIONS|GH_TOKEN|GITHUB_TOKEN)$/.test(name),
        ),
      ),
      GITHUB_API_URL: api.url,
      GITHUB_REPOSITORY: "acme/widgets",
    };
    return await run(
      "pnpm",
      ["exec", "temple-bar", "judge", "--pr", String(PR)],
      { cwd: project.cwd, env },
    );
  } finally {
    await api.close();
  }
}

const PASSED = new RegExp(
  `pull request #${String(PR)} leaves the checks alone`,
);
const TIMEOUT = { timeout: 600_000 };

void test(
  "prettier and the lockfile: the lockfile holds a flow mapping Prettier would wrap, and setup keeps Prettier off it",
  TIMEOUT,
  async (t) => {
    assert.ok(project);
    // A one-line flow mapping wider than Prettier's default width.
    const wide = lockfileBeforeFormatting
      .split(/\r?\n/)
      .find((line) => /\{.*\}/.test(line) && line.length > PRINT_WIDTH);
    assert.ok(wide, `no flow mapping over ${String(PRINT_WIDTH)} columns`);
    t.diagnostic(`${String(wide.length)} columns: ${wide.trim()}`);

    // Formatted with nothing ignored, it is wrapped: a line opens the
    // mapping and doesn't close it.
    const noIgnore = path.join(project.cwd, "..", "empty-ignore");
    writeFileSync(noIgnore, "");
    const formatted = await ok(
      "pnpm",
      ["exec", "prettier", "--ignore-path", noIgnore, LOCKFILE],
      project,
    );
    const lines = formatted.stdout.split(/\r?\n/);
    const opened = lines.findIndex((line) => /\{\s*$/.test(line));
    assert.ok(opened >= 0, "Prettier didn't wrap any flow mapping");
    t.diagnostic(
      `Prettier would write:\n${lines.slice(opened - 1, opened + 4).join("\n")}`,
    );

    // Setup's ignore line kept `prettier --write .` off it.
    assert.match(setupOutput, /Updated \.prettierignore/);
    assert.match(text(base, ".prettierignore"), /^pnpm-lock\.yaml$/m);
    assert.equal(text(base, LOCKFILE), lockfileBeforeFormatting);
  },
);

void test(
  "prettier and the lockfile: an ordinary dependency update passes the judge",
  TIMEOUT,
  async () => {
    assert.notEqual(text(updated, LOCKFILE), text(base, LOCKFILE));
    assert.match(
      text(updated, LOCKFILE),
      new RegExp(`prettier@${PRETTIER_UPDATE.replaceAll(".", "\\.")}`),
    );
    const result = await judge(base, updated);
    assert.equal(result.code, 0, describe(result));
    assert.match(result.stdout, PASSED);
  },
);

void test(
  "prettier and the lockfile: changing temple-bar's lockfile entry is refused",
  TIMEOUT,
  async () => {
    // temple-bar's integrity, found in the lockfile as pnpm wrote it, and
    // swapped for another tarball's wherever it appears in the committed
    // one, whatever shape that has.
    const integrity =
      /\n {2}'@londontypescript\/temple-bar@[^']+':\n {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)/.exec(
        lockfileBeforeFormatting,
      )?.[1];
    assert.ok(integrity, "no integrity for temple-bar in the lockfile");
    const lockfile = text(base, LOCKFILE);
    assert.ok(lockfile.includes(integrity));
    const tampered = lockfile.replaceAll(
      integrity,
      `sha512-${"A".repeat(86)}==`,
    );
    const result = await judge(base, { ...base, [LOCKFILE]: tampered });
    assert.equal(result.code, 1, describe(result));
    assert.doesNotMatch(result.stdout, PASSED);
    assert.match(result.stderr, /changes the checks that judge it/);
    assert.match(
      result.stderr,
      /^ {2}pnpm-lock\.yaml: temple-bar's entries: /m,
      describe(result),
    );
  },
);
