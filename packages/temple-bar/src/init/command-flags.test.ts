// The two approval flags an agent passes after the user said yes in chat:
// each answers only its own question, with no terminal needed.

import assert from "node:assert/strict";
import test from "node:test";

import { createInitCommand } from "./command.ts";
import {
  fakeInstallHooks,
  makeFixture,
  noRulesetGhScript,
} from "./testing/command-fixture.ts";
import { createFakeGh, createFakeGit } from "../testing/fakes.ts";

function run(fixture: ReturnType<typeof makeFixture>, args: string[]) {
  return createInitCommand({
    installHooks: fakeInstallHooks(fixture.hookCalls),
  }).run(args, fixture.ctx);
}

const posts = (gh: ReturnType<typeof createFakeGh>) =>
  gh.calls.filter((c) => c.args.includes("POST"));
const repoCreates = (gh: ReturnType<typeof createFakeGh>) =>
  gh.calls.filter((c) => c.args[0] === "repo" && c.args[1] === "create");

void test("init --create-ruleset: with no terminal, creates the ruleset and succeeds", async () => {
  const gh = createFakeGh(noRulesetGhScript);
  const fixture = makeFixture({ gh });
  const code = await run(fixture, ["--create-ruleset"]);
  assert.equal(code, 0);
  // The judge workflow is on the default branch here, so the one yes
  // creates both rulesets.
  assert.equal(posts(gh).length, 2);
});

void test("init without the flag and with no terminal: no ruleset, exit 1, names --create-ruleset", async () => {
  const gh = createFakeGh(noRulesetGhScript);
  const fixture = makeFixture({ gh });
  const code = await run(fixture, []);
  assert.equal(code, 1);
  assert.equal(posts(gh).length, 0);
  assert.match(fixture.stderr.lines.join(""), /--create-ruleset/);
});

/** No origin until `gh repo create` has run, then github. */
function noOriginGit() {
  return createFakeGit((args) => {
    if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote" && args[1] === "get-url") {
      return { code: 1, stdout: "", stderr: "no such remote" };
    }
    return { code: 0, stdout: "abc\n", stderr: "" };
  });
}

void test("init --create-ruleset alone does not answer the repo question", async () => {
  const gh = createFakeGh(noRulesetGhScript);
  const fixture = makeFixture({ gh, git: noOriginGit() });
  const code = await run(fixture, ["--create-ruleset"]);
  assert.equal(code, 1);
  assert.equal(repoCreates(gh).length, 0);
  assert.equal(posts(gh).length, 0);
  assert.match(fixture.stderr.lines.join(""), /--create-repo/);
});

void test("init --create-repo alone creates the repo but does not answer the ruleset question", async () => {
  let originCreated = false;
  const gh = createFakeGh((args) => {
    if (args[0] === "repo") {
      originCreated = true;
    }
    return noRulesetGhScript(args);
  });
  const git = createFakeGit((args) => {
    if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote" && args[1] === "get-url") {
      return originCreated
        ? { code: 0, stdout: "git@github.com:acme/repo.git\n", stderr: "" }
        : { code: 1, stdout: "", stderr: "no such remote" };
    }
    return { code: 0, stdout: "abc\n", stderr: "" };
  });
  const fixture = makeFixture({ gh, git });
  const code = await run(fixture, ["--create-repo"]);
  assert.equal(repoCreates(gh).length, 1);
  assert.equal(posts(gh).length, 0);
  assert.equal(code, 1);
  assert.match(fixture.stderr.lines.join(""), /--create-ruleset/);
});
