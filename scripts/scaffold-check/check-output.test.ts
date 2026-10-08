// What the first live run (#299) showed the faked runs had missed: npm's
// warnings mixed into a version lookup, a run that says nothing for minutes,
// and an install that could have come from npm instead of this checkout.

import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "./check.ts";
import { install, ok, world } from "./testing.ts";

const NPM_WARNING =
  'npm warn Unknown env config "store-dir". This will stop working in the next major version of npm.\n';

void test("a version lookup reads only standard output, so npm's warnings don't make it fail", async () => {
  const fake = world();
  fake.override = (call) =>
    call.args[0] === "view"
      ? {
          code: 0,
          output: `${NPM_WARNING}2.0.0\n`,
          stdout: "2.0.0\n",
          timedOut: false,
        }
      : undefined;
  try {
    const result = await check({
      update: false,
      runner: fake.runner,
      resources: fake.resources,
      fixtures: fake.fixtures,
      tempRoot: fake.root,
    });
    assert.equal(result.code, 0, result.report);
    assert.deepEqual(result.results[0]?.statuses, ["same"], result.report);
    assert.match(result.report, /version moved: 1\.0\.0 -> 2\.0\.0/);
    const scaffold = fake.calls.find((call) => call.args[0] === "create");
    assert.ok(
      scaffold?.args.includes("vite@2.0.0"),
      "the scaffolder runs at the version from standard output",
    );
  } finally {
    fake.close();
  }
});

void test("progress names each stage before the stage's command runs", async () => {
  const fake = world();
  const lines: string[] = [];
  const latest: string[] = [];
  let atPacking = "";
  fake.override = () => {
    latest.push(lines.at(-1) ?? "");
    return undefined;
  };
  try {
    await check({
      update: false,
      runner: fake.runner,
      resources: (folder) => {
        atPacking = lines.at(-1) ?? "";
        return fake.resources(folder);
      },
      fixtures: fake.fixtures,
      tempRoot: fake.root,
      progress: (line) => lines.push(line),
    });
    assert.deepEqual(lines, [
      "scaffold-check: building and packing temple-bar from this checkout",
      "vite: pnpm view create-vite version",
      "vite: pnpm create vite@1.0.0 vite-app --template react-ts --no-interactive",
      "vite: installing the packed temple-bar and checking setup",
    ]);
    assert.equal(
      atPacking,
      "scaffold-check: building and packing temple-bar from this checkout",
      "packing is announced before it starts",
    );
    const at = (match: (args: readonly string[]) => boolean) =>
      latest[fake.calls.findIndex((call) => match(call.args))];
    assert.equal(
      at((args) => args[0] === "view"),
      "vite: pnpm view create-vite version",
      "the lookup is announced before it runs",
    );
    assert.equal(
      at((args) => args[0] === "create"),
      "vite: pnpm create vite@1.0.0 vite-app --template react-ts --no-interactive",
      "the scaffolder is announced before it runs",
    );
    assert.equal(
      at((args) => args[0] === "init"),
      "vite: installing the packed temple-bar and checking setup",
      "setup is announced before its first command runs",
    );
  } finally {
    fake.close();
  }
});

void test("an install that didn't use the packed tarball fails setup", async () => {
  const fake = world();
  fake.override = (call) => {
    if (!call.args.includes("create-temple-bar")) return undefined;
    install(call.cwd, "https://registry.npmjs.org/@londontypescript/");
    return ok("setup passed\n");
  };
  try {
    const result = await check({
      update: false,
      runner: fake.runner,
      resources: fake.resources,
      fixtures: fake.fixtures,
      tempRoot: fake.root,
    });
    assert.equal(result.code, 1, result.report);
    assert.deepEqual(result.results[0]?.statuses, ["setup failed"]);
    assert.match(
      result.report,
      /finding: install: temple-bar 0\.0\.9 didn't come from the packed tarball at http:\/\/registry\.invalid\//,
    );
  } finally {
    fake.close();
  }
});
