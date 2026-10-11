// The packed launcher at the root of a pnpm workspace and outside one, from
// the tarballs a release would publish.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  launch,
  makeProject,
  startPackedLauncher,
  type PackedLauncher,
} from "./support/launcher.ts";
import { describe, run } from "./support/run.ts";
import {
  onePatternWorkspace,
  standaloneProject,
  twoPatternWorkspace,
} from "./support/workspace.ts";

let launcher: PackedLauncher | undefined;

before(async () => {
  launcher = await startPackedLauncher("temple-bar-workspace-");
});

after(async () => {
  await launcher?.close();
});

function packed(): PackedLauncher {
  assert.ok(launcher, "the packed launcher was not started");
  return launcher;
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
      const options = await makeProject(
        packed(),
        label.replaceAll(" ", "-"),
        files(),
      );
      const result = await launch(packed(), options);
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
        packed().version,
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
    const options = await makeProject(packed(), "nested-lockfile", files);
    const before = Object.fromEntries(
      Object.keys(files).map((relative) => [
        relative,
        readFileSync(path.join(options.cwd, relative), "utf8"),
      ]),
    );
    const result = await launch(packed(), options);
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
