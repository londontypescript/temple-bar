// The two approval flags an agent passes after the user said yes in chat:
// each answers only its own question, with no terminal needed.

import assert from "node:assert/strict";
import test from "node:test";

import { createInitCommand } from "./command.ts";
import {
  fakeInstallHooks,
  makeFixture,
  noRulesetGhScript,
  worldFixture,
} from "./testing/command-fixture.ts";
import { newWorld } from "./testing/creation-world.ts";
import { createFakeGh } from "../testing/fakes.ts";

function run(fixture: ReturnType<typeof makeFixture>, args: string[]) {
  return createInitCommand({
    installHooks: fakeInstallHooks(fixture.hookCalls),
  }).run(args, fixture.ctx);
}

const posts = (gh: ReturnType<typeof createFakeGh>) =>
  gh.calls.filter((c) => c.args.includes("POST"));

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

void test("init --create-ruleset alone does not answer the repo question", async () => {
  const world = newWorld();
  const fixture = worldFixture(world, "no-terminal", {}, noRulesetGhScript);
  const code = await run(fixture, ["--create-ruleset"]);
  assert.equal(code, 1);
  assert.ok(!world.calls.some((c) => c.startsWith("gh repo create")));
  assert.ok(!world.calls.some((c) => c.includes("POST")));
  assert.match(fixture.stderr.lines.join(""), /--create-repo --owner/);
});

void test("init --create-repo with its owner and code creates the repo but does not answer the ruleset question", async () => {
  const world = newWorld();
  // The code for this world, read from the stop that shows it.
  const shown = worldFixture(newWorld(), "no-terminal", {}, noRulesetGhScript);
  await run(shown, ["--owner", "acme"]);
  const code = /--identities ([0-9a-f]{12})/.exec(
    shown.stderr.lines.join(""),
  )?.[1];
  assert.ok(code);
  const fixture = worldFixture(world, "no-terminal", {}, noRulesetGhScript);
  const exit = await run(fixture, [
    "--create-repo",
    "--owner",
    "acme",
    "--identities",
    code,
  ]);
  assert.equal(
    world.calls.filter((c) => c.startsWith("gh repo create")).length,
    1,
  );
  assert.ok(!world.calls.some((c) => c.includes("POST")));
  assert.equal(exit, 1);
  assert.match(fixture.stderr.lines.join(""), /--create-ruleset/);
});
