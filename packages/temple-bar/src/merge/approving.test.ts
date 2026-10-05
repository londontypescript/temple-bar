// The "what you are approving" section: changes that need the maintainer's
// yes, machinery changes, dependency changes and the open incident count,
// each shown even when there are none.

import assert from "node:assert/strict";
import test from "node:test";

import {
  approvingSection,
  breakingPart,
  dependencyChanges,
  machineryChanges,
} from "./approving.ts";
import { createMergeCommand } from "./command.ts";
import type { PullRequestChanges } from "./manifests.ts";
import { defaultWorld, harness } from "./testing/world.ts";

function changes(
  files: string[],
  manifests: PullRequestChanges["manifests"] = [],
): PullRequestChanges {
  return { files, manifests };
}

void test("a pull request touching neither machinery nor dependencies says none, and zero incidents", () => {
  assert.deepEqual(approvingSection(7, changes(["src/x.ts"]), 0), [
    "what you are approving in #7:",
    "  maintainer's yes: not needed",
    "  machinery: none",
    "  dependencies: none added, removed or changed in major version",
    "  incidents: 0 open issues labelled incident",
  ]);
});

void test("names each file that configures the checks", () => {
  assert.deepEqual(
    machineryChanges(
      changes([
        ".github/workflows/ci.yml",
        ".github/actions/setup/action.yml",
        "eslint.config.js",
        "packages/a/.eslintrc.json",
        ".prettierrc",
        ".prettierignore",
        "prettier.config.mjs",
        "tsconfig.json",
        "packages/a/tsconfig.build.json",
        "temple-bar.config.json",
        "src/x.ts",
        "docs/tsconfig-notes.md",
        ".github/ISSUE_TEMPLATE/bug.md",
      ]),
    ),
    [
      ".github/workflows/ci.yml (a CI workflow)",
      ".github/actions/setup/action.yml (an action CI uses)",
      "eslint.config.js (lint config)",
      "packages/a/.eslintrc.json (lint config)",
      ".prettierrc (format config)",
      ".prettierignore (format config)",
      "prettier.config.mjs (format config)",
      "tsconfig.json (TypeScript config)",
      "packages/a/tsconfig.build.json (TypeScript config)",
      "temple-bar.config.json (temple-bar's settings, such as the file-length cap)",
    ],
  );
});

void test("names the root scripts, config fields and pin that decide the checks", () => {
  const before = {
    scripts: {
      lint: "eslint .",
      build: "tsc",
      prepare: "temple-bar hook install",
    },
    prettier: { semi: true },
    devDependencies: { "@londontypescript/temple-bar": "0.0.6" },
  };
  const after = {
    scripts: { lint: "echo ok", build: "tsc -b", gate: "temple-bar gate" },
    prettier: { semi: false },
    devDependencies: { "@londontypescript/temple-bar": "0.0.7" },
  };
  assert.deepEqual(
    machineryChanges(
      changes(["package.json"], [{ path: "package.json", before, after }]),
    ),
    [
      'package.json script "lint" (the gate runs it)',
      'package.json script "gate" (it runs the gate)',
      'package.json script "prepare" (it installs the hooks)',
      'package.json "prettier" field (format config)',
      "the pinned @londontypescript/temple-bar, 0.0.6 -> 0.0.7 (it judges this repository)",
    ],
  );
});

void test("a workspace package's scripts are not the gate's", () => {
  const manifest = {
    path: "packages/a/package.json",
    before: { scripts: { lint: "eslint ." } },
    after: { scripts: { lint: "echo ok" } },
  };
  assert.deepEqual(machineryChanges(changes([manifest.path], [manifest])), []);
});

void test("the breaking part of a version is its major, or for 0.x its first non-zero part", () => {
  assert.equal(breakingPart("^10.0.1"), "10");
  assert.equal(breakingPart("~0.3.4"), "0.3");
  assert.equal(breakingPart("0.0.6"), "0.0.6");
  assert.equal(breakingPart(">=2 <3"), "2");
  assert.equal(breakingPart("npm:@scope/real@^4.1.0"), "4");
  assert.equal(breakingPart("workspace:*"), undefined);
  assert.equal(breakingPart("latest"), undefined);
});

void test("lists dependencies added, removed and moved to a new major version, and nothing else", () => {
  const root = {
    path: "package.json",
    before: {
      dependencies: { kept: "^1.0.0", bumped: "^1.2.0", minor: "^2.1.0" },
      devDependencies: { gone: "3.0.0", zero: "0.2.0", tag: "next" },
    },
    after: {
      // Moving between fields is neither adding nor removing.
      devDependencies: {
        kept: "^1.0.0",
        bumped: "^2.0.0",
        minor: "^2.9.0",
        zero: "0.3.0",
        tag: "latest",
      },
      dependencies: { fresh: "^5.0.0" },
    },
  };
  const nested = {
    path: "packages/a/package.json",
    before: undefined,
    after: { dependencies: { inner: "1.0.0" } },
  };
  assert.deepEqual(dependencyChanges(changes([], [root, nested])), [
    "added fresh ^5.0.0",
    "bumped ^1.2.0 -> ^2.0.0, a new major version",
    "zero 0.2.0 -> 0.3.0, a new major version",
    "changed tag next -> latest",
    "removed gone",
    "added inner 1.0.0 in packages/a",
  ]);
});

void test("a changed lockfile is mentioned, with what the list leaves out", () => {
  const lines = approvingSection(3, changes(["pnpm-lock.yaml"]), 1);
  assert.deepEqual(lines.slice(3), [
    "  dependencies: none added, removed or changed in major version",
    "    pnpm-lock.yaml changed too; versions within existing ranges and indirect dependencies aren't listed",
    "  incidents: 1 open issue labelled incident",
  ]);
});

void test("an incident count GitHub couldn't give is said so", () => {
  assert.equal(
    approvingSection(3, changes([]), undefined).at(-1),
    "  incidents: could not count the open issues labelled incident",
  );
});

void test("merge prints the section before waiting for checks, with its counts", async () => {
  const world = defaultWorld();
  // Lint config is machinery the judge leaves alone, so this merges.
  world.changedFiles = ["eslint.config.js", "package.json"];
  world.packageAfter = JSON.stringify({
    devDependencies: {
      "@londontypescript/temple-bar": "0.0.4",
      zod: "^4.0.0",
    },
  });
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  const out = h.out();
  assert.match(
    out,
    /merge: what you are approving in #7:\nmerge: {3}maintainer's yes: not needed\nmerge: {3}machinery: 1 change to how this repository is checked\nmerge: {5}eslint\.config\.js \(lint config\)\nmerge: {3}dependencies: 1 change\nmerge: {5}added zod \^4\.0\.0\nmerge: {3}incidents: 3 open issues labelled incident\n/,
  );
  assert.ok(
    out.indexOf("what you are approving") < out.indexOf("checks passed"),
    "shown before the checks are waited for",
  );
});

void test("the section comes with a refusal for the maintainer's yes, so the request can carry it", async () => {
  const world = defaultWorld();
  world.changedFiles = ["AGENTS.md"];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(h.err(), /needs the maintainer's yes/);
  assert.match(
    h.out(),
    /merge: {3}maintainer's yes: needed for 1 change\nmerge: {5}changes AGENTS\.md\nmerge: {3}machinery: none\n.*\n.*incidents: 3 open issues/,
  );
});

void test("the section lists each change that needs the maintainer, of both kinds", () => {
  assert.deepEqual(
    approvingSection(
      7,
      changes([
        "AGENTS.md",
        "packages/a/AGENTS.md",
        ".github/workflows/ci.yml",
      ]),
      0,
    ).slice(1, 4),
    [
      "  maintainer's yes: needed for 2 changes",
      "    changes AGENTS.md, packages/a/AGENTS.md",
      "    changes the checks that judge it (.github/workflows/ci.yml (changed))",
    ],
  );
});

void test("the section comes with the refusal of a change to the checks too", async () => {
  const world = defaultWorld();
  world.changedFiles = [".github/workflows/ci.yml"];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(h.err(), /changes the checks that judge it/);
  assert.match(h.out(), /\.github\/workflows\/ci\.yml \(a CI workflow\)/);
});
