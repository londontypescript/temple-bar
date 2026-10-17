// The packed judge in a pnpm workspace: temple-bar packed and installed the
// way a release is, judging pull requests that the fake GitHub API serves as
// two whole trees, the base branch's tip and the pull request's head. Each
// pull request the judge must stop (the judge's rows of the failure table in
// docs/adr/0015-every-package-checked-and-guarded.md) sits next to a control:
// the same workspace with only code inside a package changed, which passes.
// The judge reads GitHub and never the project on disk, so one installed
// project serves every test.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  judgePullRequest,
  PASSED,
  PR,
  type Files,
  type Serving,
} from "./support/judge.ts";
import {
  launch,
  makeProject,
  startPackedLauncher,
  type PackedLauncher,
} from "./support/launcher.ts";
import { describe, type RunOptions, type RunResult } from "./support/run.ts";
import {
  checkedWorkspace,
  packageManifest,
  PASSING_COMMAND,
  PASSING_SCRIPTS,
} from "./support/workspace.ts";

let launcher: PackedLauncher | undefined;
let project: RunOptions | undefined;

before(async () => {
  launcher = await startPackedLauncher("temple-bar-judge-workspace-");
  const options = await makeProject(launcher, "workspace", checkedWorkspace());
  const setup = await launch(launcher, options);
  assert.equal(setup.code, 0, describe(setup));
  project = options;
});

after(async () => {
  await launcher?.close();
});

/** Package a's `test` hands its work to `test:unit`, the delegation the
 * judge used to miss. */
const DELEGATING_SCRIPTS: Readonly<Record<string, string>> = {
  ...PASSING_SCRIPTS,
  test: "pnpm run test:unit",
  "test:unit": PASSING_COMMAND,
};

const B_TEXT = packageManifest("pkg-b", PASSING_SCRIPTS);

/** The base branch: a root and two packages with real scripts, code in each
 * package, and a workflow and an install setting that no pull request here
 * touches unless it means to. */
const BASE: Files = {
  ".gitignore": "node_modules/\n",
  ".npmrc": "engine-strict=true\n",
  ".github/workflows/ci.yml": "name: CI\non: pull_request\n",
  "package.json": packageManifest("workspace-root", PASSING_SCRIPTS),
  "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
  "packages/a/package.json": packageManifest("pkg-a", DELEGATING_SCRIPTS),
  "packages/a/src/index.ts": "export const a = 1;\n",
  "packages/b/package.json": B_TEXT,
  "packages/b/src/index.ts": "export const b = 1;\n",
};

/** `files` with only code inside a package changed: what every control
 * pull request does. */
function withCodeChange(files: Files): Files {
  return { ...files, "packages/a/src/index.ts": "export const a = 2;\n" };
}

/** `files` without the given paths. */
function without(files: Files, ...paths: readonly string[]): Files {
  return Object.fromEntries(
    Object.entries(files).filter(([at]) => !paths.includes(at)),
  );
}

/** Runs the installed judge on a pull request from `base` to `head`. */
async function judge(
  base: Files,
  head: Files,
  serving: Serving = {},
): Promise<RunResult> {
  assert.ok(project, "the workspace was not set up");
  return judgePullRequest(project, base, head, serving);
}

function assertPasses(result: RunResult): void {
  assert.equal(result.code, 0, describe(result));
  assert.match(result.stdout, PASSED);
}

/** Refused for changing the checks, with each finding on a line of its own:
 * a string is the whole line, a pattern its start. */
function assertRefuses(
  result: RunResult,
  ...findings: readonly (string | RegExp)[]
): void {
  assert.equal(result.code, 1, describe(result));
  assert.doesNotMatch(result.stdout, PASSED);
  assert.match(result.stderr, /changes the checks that judge it/);
  const lines = result.stderr.split(/\r?\n/);
  for (const finding of findings) {
    const found =
      typeof finding === "string"
        ? lines.includes(`  ${finding}`)
        : lines.some((line) => finding.test(line));
    assert.ok(found, `no finding ${String(finding)}\n${describe(result)}`);
  }
}

/** Refused because GitHub couldn't be read, never passed unseen. */
function assertCantRead(result: RunResult, reason?: RegExp): void {
  assert.equal(result.code, 1, describe(result));
  assert.doesNotMatch(result.stdout, PASSED);
  assert.match(
    result.stderr,
    new RegExp(`could not read pull request #${String(PR)} from GitHub`),
  );
  if (reason !== undefined) {
    assert.match(result.stderr, reason);
  }
}

const TIMEOUT = { timeout: 600_000 };

/** The pull request from BASE to `head` is refused with `findings`, and the
 * control beside it, only code changed, passes. */
async function assertRefusedBesideControl(
  head: Files,
  ...findings: readonly (string | RegExp)[]
): Promise<void> {
  assertRefuses(await judge(BASE, head), ...findings);
  assertPasses(await judge(BASE, withCodeChange(BASE)));
}

const B_MANIFEST = "packages/b/package.json";

/** BASE with package b's scripts replaced. */
function withPackageBScripts(scripts: Readonly<Record<string, string>>): Files {
  return { ...BASE, [B_MANIFEST]: packageManifest("pkg-b", scripts) };
}

void test(
  "judge in a workspace: a pull request changing only code inside packages passes",
  TIMEOUT,
  async () => {
    assertPasses(await judge(BASE, withCodeChange(BASE)));
  },
);

void test(
  "judge in a workspace: removing a package's typecheck is refused",
  TIMEOUT,
  async () => {
    const { typecheck, ...rest } = PASSING_SCRIPTS;
    assert.equal(typecheck, PASSING_COMMAND);
    await assertRefusedBesideControl(
      withPackageBScripts(rest),
      `${B_MANIFEST}: the "typecheck" script`,
    );
  },
);

void test(
  "judge in a workspace: replacing a package's typecheck with node --version is refused",
  TIMEOUT,
  async () => {
    await assertRefusedBesideControl(
      withPackageBScripts({ ...PASSING_SCRIPTS, typecheck: "node --version" }),
      `${B_MANIFEST}: the "typecheck" script`,
    );
  },
);

void test(
  "judge in a workspace: changing the test:unit a package's test calls is refused",
  TIMEOUT,
  async () => {
    const scripts = { ...DELEGATING_SCRIPTS, "test:unit": "node --version" };
    await assertRefusedBesideControl(
      { ...BASE, "packages/a/package.json": packageManifest("pkg-a", scripts) },
      'packages/a/package.json: the "test:unit" script',
    );
  },
);

void test(
  "judge in a workspace: adding a postinstall to a package is refused",
  TIMEOUT,
  async () => {
    await assertRefusedBesideControl(
      withPackageBScripts({ ...PASSING_SCRIPTS, postinstall: PASSING_COMMAND }),
      `${B_MANIFEST}: the "postinstall" script`,
    );
  },
);

void test(
  "judge in a workspace: adding a package whose scripts are real but weak is refused",
  TIMEOUT,
  async () => {
    const weak = Object.fromEntries(
      Object.keys(PASSING_SCRIPTS).map((name) => [name, "node --version"]),
    );
    await assertRefusedBesideControl(
      {
        ...BASE,
        "packages/c/package.json": packageManifest("pkg-c", weak),
        "packages/c/src/index.ts": "export const c = 1;\n",
      },
      "packages/c/package.json (added, with scripts)",
    );
    // A package added with no scripts at all is the gate's to fail, not the
    // judge's.
    const bare = {
      ...BASE,
      "packages/c/package.json": packageManifest("pkg-c"),
    };
    assertPasses(await judge(BASE, bare));
  },
);

void test(
  "judge in a workspace: deleting a package is refused",
  TIMEOUT,
  async () => {
    await assertRefusedBesideControl(
      without(BASE, B_MANIFEST, "packages/b/src/index.ts"),
      `${B_MANIFEST} (removed)`,
    );
  },
);

void test(
  "judge in a workspace: renaming a package away is refused as the old path removed and the new one added",
  TIMEOUT,
  async () => {
    await assertRefusedBesideControl(
      {
        ...without(BASE, B_MANIFEST, "packages/b/src/index.ts"),
        "packages/z/package.json": B_TEXT,
        "packages/z/src/index.ts": "export const b = 1;\n",
      },
      `${B_MANIFEST} (removed)`,
      "packages/z/package.json (added, with scripts)",
    );
  },
);

void test(
  "judge in a workspace: adding a negation to pnpm-workspace.yaml's package list is refused",
  TIMEOUT,
  async () => {
    await assertRefusedBesideControl(
      {
        ...BASE,
        "pnpm-workspace.yaml":
          'packages:\n  - "packages/*"\n  - "!packages/b"\n',
      },
      /^ {2}pnpm-workspace\.yaml \(/,
    );
  },
);

for (const side of ["base", "head"] as const) {
  void test(
    `judge in a workspace: a ${side} tree GitHub can't list whole is refused`,
    TIMEOUT,
    async () => {
      const head = withCodeChange(BASE);
      assertCantRead(await judge(BASE, head, { truncated: side }));
      assertPasses(await judge(BASE, head));
    },
  );
}

void test(
  "judge in a workspace: a package.json made a symlink with the same text is refused",
  TIMEOUT,
  async () => {
    await assertRefusedBesideControl(
      {
        ...BASE,
        "shared/b.json": B_TEXT,
        [B_MANIFEST]: { symlink: "../../shared/b.json" },
      },
      `${B_MANIFEST} (not a regular file)`,
    );
  },
);

void test(
  "judge in a workspace: a head that moves while the judge reads it is refused",
  TIMEOUT,
  async () => {
    const head = withCodeChange(BASE);
    assertCantRead(
      await judge(BASE, head, { headMoves: true }),
      /changed while the judge read it/,
    );
    assertPasses(await judge(BASE, head));
  },
);
