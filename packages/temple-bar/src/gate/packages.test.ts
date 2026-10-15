// The workspace inventory on its own: what it reads from pnpm's list, how
// it fails when that list can't be trusted, and which tracked package.json
// files it names as belonging to no package.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { listGitPaths } from "./lengths.ts";
import { takeInventory } from "./packages.ts";
import {
  NPM_EXEC,
  PNPM_EXEC,
  pnpmListing,
  workspace,
  type WorkspaceOptions,
} from "./testing/workspace-fixture.ts";

async function inventory(options: WorkspaceOptions = {}) {
  const fixture = workspace(options);
  const result = await takeInventory(
    fixture.ctx,
    await listGitPaths(fixture.ctx),
  );
  return { ...fixture, result };
}

void test("inventory: pnpm's probed list gives each package besides the root, through the pnpm that started the gate", async () => {
  const { proc, result } = await inventory();

  assert.deepEqual(result.outcome, {
    name: "workspace packages",
    status: "passed",
    detail: "the root and 2 package(s)",
  });
  assert.deepEqual(
    result.packages.map((member) => member.relative),
    ["packages/a", "packages/b"],
  );
  assert.equal(result.packages[0]?.folder, path.normalize("/repo/packages/a"));
  const [listing, ...others] = proc.calls;
  assert.ok(listing !== undefined && others.length === 0);
  assert.equal(listing.command, process.execPath);
  assert.deepEqual(listing.args, [
    PNPM_EXEC,
    "list",
    "--recursive",
    "--depth",
    "-1",
    "--json",
  ]);
  assert.equal(listing.cwd, "/repo");
});

void test("inventory: a package with no name is still listed, by its path", async () => {
  const listing = JSON.stringify([
    { path: path.normalize("/repo") },
    { path: path.normalize("/repo/packages/a"), private: true },
  ]);
  const { result } = await inventory({
    packages: { "packages/a": {} },
    listing: { stdout: listing },
  });
  assert.equal(result.outcome.status, "passed");
  assert.deepEqual(
    result.packages.map((member) => member.relative),
    ["packages/a"],
  );
});

void test("inventory: packages come in byte order of their paths, whatever order pnpm prints", async () => {
  const folders = ["packages/z", "packages/a", "packages/B", "apps/web"];
  const { result } = await inventory({
    packages: Object.fromEntries(folders.map((folder) => [folder, {}])),
    listing: { stdout: pnpmListing(["", ...folders]) },
  });
  assert.deepEqual(
    result.packages.map((member) => member.relative),
    ["apps/web", "packages/B", "packages/a", "packages/z"],
  );
});

const UNTRUSTED_LISTINGS: readonly {
  readonly what: string;
  readonly stdout: string;
  readonly code?: number;
  readonly untracked?: Readonly<Record<string, string>>;
  readonly reason: RegExp;
}[] = [
  {
    what: "a path outside the root",
    stdout: JSON.stringify([{ path: path.normalize("/elsewhere/pkg") }]),
    untracked: { "/elsewhere/pkg/package.json": "{}" },
    reason: /^pnpm listed a folder outside the root: .*elsewhere.pkg/,
  },
  {
    what: "a path that is a file",
    stdout: JSON.stringify([{ path: path.normalize("/repo/notes.txt") }]),
    untracked: { "/repo/notes.txt": "notes\n" },
    reason: /^.*notes\.txt isn't a folder/,
  },
  {
    what: "a relative path",
    stdout: JSON.stringify([{ path: "packages/a" }]),
    reason: /^pnpm listed an entry without an absolute path: .*packages\/a/,
  },
  {
    what: "a duplicate",
    stdout: pnpmListing(["", "packages/a", "packages/b", "packages/a"]),
    reason: /^pnpm listed packages\/a twice/,
  },
  {
    what: "an entry that isn't an object",
    stdout: JSON.stringify(["/repo/packages/a"]),
    reason: /^pnpm listed an entry without an absolute path/,
  },
  {
    what: "output that isn't a list",
    stdout: JSON.stringify({ path: "/repo" }),
    reason: /^pnpm's package list isn't a list/,
  },
  {
    what: "output that isn't JSON",
    stdout: "Scope: all 3 workspace projects\n",
    reason: /^pnpm's package list isn't JSON/,
  },
  {
    what: "a non-zero exit",
    stdout: "",
    code: 1,
    reason: /^pnpm list exited with 1/,
  },
];

for (const listing of UNTRUSTED_LISTINGS) {
  void test(`inventory: ${listing.what} from pnpm fails the check, with its own reason and no package to run`, async () => {
    const { result } = await inventory({
      listing: {
        stdout: listing.stdout,
        ...(listing.code === undefined ? {} : { code: listing.code }),
      },
      ...(listing.untracked === undefined
        ? {}
        : { untracked: listing.untracked }),
    });
    assert.equal(result.outcome.status, "failed");
    assert.match(result.outcome.detail ?? "", listing.reason);
    assert.match(result.outcome.detail ?? "", /no package's scripts were run$/);
    assert.deepEqual(result.packages, []);
    assert.match(result.message ?? "", /only the root's scripts were run/);
  });
}

void test("inventory: pnpm's own error line is in the reason when it exits non-zero", async () => {
  const { result } = await inventory({
    listing: {
      stdout: "",
      code: 1,
      stderr:
        " ERR_PNPM_JSON_PARSE  Unexpected token in packages/a/package.json\n\nmore detail\n",
    },
  });
  assert.match(
    result.outcome.detail ?? "",
    /^pnpm list exited with 1: ERR_PNPM_JSON_PARSE {2}Unexpected token in packages\/a\/package\.json; no package's scripts were run$/,
  );
});

void test("inventory: a listed folder that doesn't exist fails the check, caught where it happens", async () => {
  const { result } = await inventory({
    listing: { stdout: pnpmListing(["", "packages/a", "packages/gone"]) },
  });
  assert.equal(result.outcome.status, "failed");
  assert.match(
    result.outcome.detail ?? "",
    /packages.gone doesn't exist; no package's scripts were run$/,
  );
});

void test("inventory: a realpath that fails fails the check, caught where it happens", async () => {
  const fixture = workspace();
  fixture.fs.realpathErrors.set(
    path.normalize("/repo/packages/b"),
    Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
  );
  const result = await takeInventory(
    fixture.ctx,
    await listGitPaths(fixture.ctx),
  );
  assert.equal(result.outcome.status, "failed");
  assert.match(
    result.outcome.detail ?? "",
    /^could not resolve .*packages.b: EACCES: permission denied/,
  );
});

void test("inventory: a checkout reached through a symlink keeps its packages", async () => {
  const fixture = workspace({
    listing: {
      stdout: JSON.stringify([
        { path: path.normalize("/real/repo") },
        { path: path.normalize("/real/repo/packages/a") },
        { path: path.normalize("/real/repo/packages/b") },
      ]),
    },
  });
  fixture.fs.realpaths.set("/repo", "/real/repo");
  for (const folder of ["a", "b"]) {
    fixture.fs.realpaths.set(
      `/repo/packages/${folder}`,
      `/real/repo/packages/${folder}`,
    );
    fixture.fs.files.set(`/real/repo/packages/${folder}/package.json`, "{}");
  }
  const result = await takeInventory(
    fixture.ctx,
    await listGitPaths(fixture.ctx),
  );
  assert.deepEqual(result.outcome.status, "passed", result.outcome.detail);
  assert.deepEqual(
    result.packages.map((member) => [member.relative, member.folder]),
    [
      ["packages/a", path.normalize("/real/repo/packages/a")],
      ["packages/b", path.normalize("/real/repo/packages/b")],
    ],
  );
});

void test("inventory: a tracked package.json outside pnpm's list is named relative to the root", async () => {
  const { result } = await inventory({
    extraTracked: ["tools/c/package.json"],
  });
  assert.equal(result.outcome.status, "failed");
  assert.equal(
    result.outcome.detail,
    "1 package.json file(s) outside the workspace's packages",
  );
  assert.match(result.message ?? "", /^ {2}tools\/c\/package\.json$/m);
  assert.match(
    result.message ?? "",
    /add each one's folder to the packages in pnpm-workspace\.yaml/,
  );
  assert.deepEqual(
    result.packages.map((member) => member.relative),
    ["packages/a", "packages/b"],
    "the listed packages still run",
  );
});

void test("inventory: a manifest tracked with odd letter case (Package.json) is named too, never read as some other file", async () => {
  const { result } = await inventory({
    extraTracked: ["tools/c/Package.json"],
  });
  assert.equal(result.outcome.status, "failed");
  assert.match(result.message ?? "", /^ {2}tools\/c\/Package\.json$/m);
});

void test("inventory: a package.json inside a listed package's folder, but not its own, is named", async () => {
  const { result } = await inventory({
    extraTracked: ["packages/a/fixtures/package.json"],
  });
  assert.equal(result.outcome.status, "failed");
  assert.match(
    result.message ?? "",
    /^ {2}packages\/a\/fixtures\/package\.json$/m,
  );
});

void test("inventory: with no pnpm-workspace.yaml, a nested package.json is named and nothing is spawned", async () => {
  const { proc, result } = await inventory({
    workspaceFile: false,
    packages: {},
    extraTracked: ["vendor/lib/package.json"],
    env: {},
  });
  assert.equal(proc.calls.length, 0);
  assert.equal(result.outcome.status, "failed");
  assert.match(result.message ?? "", /^ {2}vendor\/lib\/package\.json$/m);
  assert.match(
    result.message ?? "",
    /there is no pnpm-workspace\.yaml, so the root is the only package/,
  );
});

void test("inventory: with no pnpm-workspace.yaml and no other package.json, the root alone passes without spawning", async () => {
  const { proc, result } = await inventory({
    workspaceFile: false,
    packages: {},
    env: {},
  });
  assert.equal(proc.calls.length, 0);
  assert.deepEqual(result.outcome, {
    name: "workspace packages",
    status: "passed",
    detail: "the root alone: no pnpm-workspace.yaml",
  });
});

void test("inventory: a workspace gate started without npm_execpath names pnpm gate and pnpm ready, and spawns nothing", async () => {
  const { proc, result } = await inventory({ env: {} });
  assert.equal(proc.calls.length, 0);
  assert.equal(result.outcome.status, "failed");
  assert.match(result.outcome.detail ?? "", /wasn't started through pnpm/);
  assert.match(result.outcome.detail ?? "", /`pnpm gate`/);
  assert.match(result.outcome.detail ?? "", /`pnpm ready`/);
});

void test("inventory: a workspace gate started by npm says the workspace needs pnpm, and spawns nothing", async () => {
  const { proc, result } = await inventory({ env: { npm_execpath: NPM_EXEC } });
  assert.equal(proc.calls.length, 0);
  assert.equal(result.outcome.status, "failed");
  assert.match(
    result.outcome.detail ?? "",
    /this is a pnpm workspace, which needs pnpm, but the gate was started by npm-cli\.js/,
  );
});
