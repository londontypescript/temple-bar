// The launcher's refusals: each one says why and what to do next, and
// leaves the folder exactly as it was.

import assert from "node:assert/strict";
import { normalize } from "node:path";
import test from "node:test";

import { main } from "./main.ts";
import { refusalFixture, userAgents } from "./testing/fakes.ts";

for (const manager of ["npm", "yarn", "bun"] as const) {
  void test(`main: \`${manager} create\` is refused with a helpful message and changes nothing`, async () => {
    const { deps, runner, writes, stderr } = refusalFixture(
      userAgents[manager],
      { "/app/package.json": '{"packageManager":"npm@10.9.2"}' },
    );
    const code = await main(deps);
    assert.equal(code, 1);
    assert.equal(runner.calls.length, 0, "nothing may be spawned");
    assert.deepEqual(writes, [], "nothing may be written");
    const text = stderr.lines.join("");
    assert.match(text, /temple-bar needs pnpm/);
    assert.match(text, /this wasn't started with pnpm/);
    assert.match(text, /npm install -g pnpm/);
    assert.match(text, /https:\/\/pnpm\.io\/installation/);
    assert.match(text, /pnpm create @londontypescript\/temple-bar@0\.3\.0\n/);
  });
}

void test("main: a launch with no package manager at all is refused", async () => {
  const { deps, runner, writes } = refusalFixture(undefined);
  assert.equal(await main(deps), 1);
  assert.equal(runner.calls.length, 0);
  assert.deepEqual(writes, []);
});

for (const lockfile of [
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
]) {
  void test(`main: a ${lockfile} in the repo is refused even under pnpm, changing nothing`, async () => {
    const { deps, runner, writes, stderr } = refusalFixture(userAgents.pnpm, {
      "/app/package.json": "{}",
      [`/app/${lockfile}`]: "",
    });
    const code = await main(deps);
    assert.equal(code, 1);
    assert.equal(runner.calls.length, 0);
    assert.deepEqual(writes, []);
    const text = stderr.lines.join("");
    assert.ok(text.includes(lockfile), "names the lockfile it found");
    assert.match(text, /Switch the project to pnpm first/);
    assert.doesNotMatch(text, /npm install -g pnpm|pnpm\.io\/installation/);
    assert.match(text, /pnpm create @londontypescript\/temple-bar@0\.3\.0\n/);
  });
}

void test("main: an npm project under pnpm gets one refusal covering its lockfiles and packageManager", async () => {
  const { deps, runner, writes, stderr } = refusalFixture(userAgents.pnpm, {
    "/app/package.json": '{"packageManager":"npm@10.9.2"}',
    "/app/package-lock.json": "",
    "/app/npm-shrinkwrap.json": "",
  });
  assert.equal(await main(deps), 1);
  assert.equal(runner.calls.length, 0);
  assert.deepEqual(writes, []);
  const text = stderr.lines.join("");
  assert.match(text, /Delete package-lock\.json and npm-shrinkwrap\.json\./);
  assert.match(text, /change "packageManager": "npm@10\.9\.2" to pnpm/);
});

void test("main: a refused launch does not create package.json", async () => {
  const { deps, writes } = refusalFixture(userAgents.npm, {});
  await main(deps);
  assert.deepEqual(writes, []);
});

void test("main: packageManager refuses foreign strings before writes or runs and leaves other manifests to installation", async () => {
  const cases: readonly [string | undefined, string | undefined][] = [
    ['{"packageManager":"npm@10.9.2"}', "npm@10.9.2"],
    ['{"packageManager":"yarn@4.1.0"}', "yarn@4.1.0"],
    ['{"packageManager":"bun@1.1.0"}', "bun@1.1.0"],
    ['{"packageManager":"pnpm@9.1.0"}', undefined],
    ['{"packageManager":"pnpm@9.1.0+sha512.abcdef"}', undefined],
    ["{}", undefined],
    ['{"packageManager":""}', undefined],
    [undefined, undefined],
    ["{", undefined],
    ['{"packageManager":42}', undefined],
    ['{"packageManager":null}', undefined],
    ['{"packageManager":false}', undefined],
    ['{"packageManager":{}}', undefined],
    ['{"packageManager":[]}', undefined],
    ["null", undefined],
  ];
  for (const [contents, foreign] of cases) {
    const { deps, runner, writes, stderr, stdout } = refusalFixture(
      userAgents.pnpm,
      contents === undefined ? {} : { "/app/package.json": contents },
    );
    assert.equal(await main(deps), foreign === undefined ? 0 : 1, contents);
    assert.deepEqual(stdout.lines, []);
    if (foreign !== undefined) {
      assert.equal(runner.calls.length, 0, "nothing may be spawned");
      assert.deepEqual(writes, [], "nothing may be written");
      const message = stderr.lines.join("");
      assert.ok(message.includes(foreign));
      assert.match(message, /temple-bar needs pnpm/);
      assert.match(message, /"packageManager": "pnpm@[^"\n]+"/);
      assert.match(message, /framework's pnpm option/);
      assert.match(
        message,
        /pnpm create @londontypescript\/temple-bar@0\.3\.0\n/,
      );
      assert.doesNotMatch(message, /install/i);
    } else {
      assert.deepEqual(stderr.lines, []);
      assert.deepEqual(
        runner.calls.map((call) => call.args[0]),
        ["add", "install", "exec"],
      );
      assert.deepEqual(
        writes,
        contents === undefined ? [normalize("/app/package.json")] : [],
      );
    }
  }
});
