// The packed launcher at the root of a pnpm workspace and outside one, from
// the tarballs a release would publish.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { initTestRepo } from "../packages/temple-bar/src/testing/git-repo.ts";
import { environments } from "../scripts/scaffold-check/environment.ts";
import { packBoth, type Tarballs } from "./support/pack.ts";
import { serveTarball, type LocalRegistry } from "./support/registry.ts";
import { describe, run, type RunOptions } from "./support/run.ts";
import {
  onePatternWorkspace,
  standaloneProject,
  twoPatternWorkspace,
} from "./support/workspace.ts";

let folder = "";
let tarballs: Tarballs;
let registry: LocalRegistry | undefined;
let env: NodeJS.ProcessEnv;
let version = "";

before(async () => {
  folder = realpathSync.native(
    mkdtempSync(path.join(tmpdir(), "temple-bar-workspace-")),
  );
  tarballs = await packBoth(folder);
  const manifest = JSON.parse(
    readFileSync(
      path.join(folder, "stage", "temple-bar", "package.json"),
      "utf8",
    ),
  ) as { name: string; version: string };
  version = manifest.version;
  registry = await serveTarball(manifest, tarballs.templeBar);
  env = environments(folder, process.env, registry.url).setup;
});

after(async () => {
  await registry?.close();
  if (folder !== "") rmSync(folder, { recursive: true, force: true });
});

async function project(
  name: string,
  files: Readonly<Record<string, string>>,
): Promise<RunOptions> {
  const cwd = path.join(folder, name);
  mkdirSync(cwd);
  initTestRepo(cwd);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(cwd, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  const options = { cwd, env };
  for (const args of [
    ["add", "-A"],
    ["commit", "-q", "-m", "Initial commit"],
    ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
  ]) {
    const result = await run("git", args, options);
    assert.equal(result.code, 0, describe(result));
  }
  return options;
}

function launch(options: RunOptions) {
  return run(
    "pnpm",
    [`--package=${tarballs.createTempleBar}`, "dlx", "create-temple-bar"],
    options,
  );
}

function readManifest(cwd: string, relative = "package.json") {
  return JSON.parse(readFileSync(path.join(cwd, relative), "utf8")) as {
    devDependencies?: Record<string, string>;
  };
}

const cases = [
  ["a one-pattern workspace root", onePatternWorkspace],
  ["a two-pattern workspace root", twoPatternWorkspace],
  ["a standalone project", standaloneProject],
] as const;

for (const [label, files] of cases) {
  void test(
    `packed launcher installs temple-bar at the root of ${label} and runs init`,
    { timeout: 600_000 },
    async () => {
      const options = await project(label.replaceAll(" ", "-"), files());
      const result = await launch(options);
      assert.equal(result.code, 0, describe(result));
      assert.match(
        result.stdout,
        /Wrote temple-bar's rules into AGENTS.md/,
        describe(result),
      );
      assert.equal(
        readManifest(options.cwd).devDependencies?.[
          "@londontypescript/temple-bar"
        ],
        version,
      );
      assert.ok(
        existsSync(
          path.join(
            options.cwd,
            "node_modules",
            "@londontypescript",
            "temple-bar",
            "package.json",
          ),
        ),
      );
      // The packages never receive the dependency.
      for (const member of ["packages/a", "packages/b", "tools/b"]) {
        if (existsSync(path.join(options.cwd, member, "package.json"))) {
          assert.equal(
            readManifest(options.cwd, `${member}/package.json`).devDependencies,
            undefined,
            member,
          );
        }
      }
    },
  );
}

void test(
  "packed launcher refuses a workspace whose package holds its own lockfile and changes nothing",
  { timeout: 600_000 },
  async () => {
    const files = {
      ...twoPatternWorkspace(),
      "packages/a/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    };
    const options = await project("nested-lockfile", files);
    const before = Object.fromEntries(
      Object.keys(files).map((relative) => [
        relative,
        readFileSync(path.join(options.cwd, relative), "utf8"),
      ]),
    );
    const result = await launch(options);
    assert.equal(result.code, 1, describe(result));
    assert.match(result.stderr, /Nothing was changed/, describe(result));
    assert.match(
      result.stderr,
      /packages[/\\]a[/\\]pnpm-lock\.yaml/,
      describe(result),
    );
    for (const [relative, contents] of Object.entries(before)) {
      assert.equal(
        readFileSync(path.join(options.cwd, relative), "utf8"),
        contents,
        relative,
      );
    }
    assert.ok(!existsSync(path.join(options.cwd, "node_modules")));
    assert.ok(!existsSync(path.join(options.cwd, "pnpm-lock.yaml")));
    assert.ok(!existsSync(path.join(options.cwd, "AGENTS.md")));
    const status = await run("git", ["status", "--porcelain"], options);
    assert.equal(status.stdout, "", describe(status));
  },
);
