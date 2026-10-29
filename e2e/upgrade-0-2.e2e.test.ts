// A real upgrade from the published 0.2.1 to the packed package: the AGENTS.md
// block 0.2.0 and 0.2.1 wrote is recognised and replaced, and the project's
// own text around it survives byte for byte.

import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { templeBarBlock } from "../packages/temple-bar/src/init/agents-template.ts";
import { AGENTS_BLOCK_0_2_1 } from "../packages/temple-bar/src/init/testing/agents-block-0-2-1.ts";
import { describe, run } from "./support/run.ts";
import {
  installUpgradePackage,
  packedTarball,
  publishedTarball,
  upgradeEnv,
  upgradeProject,
} from "./support/upgrade.ts";

let workDir = "";
let env: NodeJS.ProcessEnv;
let packed = "";
let published = "";

before(async () => {
  // Git expands Windows short temp paths before the post-checkout install.
  // Later pnpm commands and their caches must use the same canonical spelling.
  workDir = realpathSync.native(
    mkdtempSync(path.join(tmpdir(), "temple-bar-upgrade-0-2-")),
  );
  env = upgradeEnv(workDir);
  packed = await packedTarball(workDir, env);
  published = await publishedTarball(workDir, "0.2.1");
});

after(() => {
  if (workDir !== "") rmSync(workDir, { recursive: true, force: true });
});

async function setup(dir: string) {
  return run("pnpm", ["exec", "temple-bar", "init"], { cwd: dir, env });
}

void test(
  "packed upgrade: a 0.2.1 block with the project's text above and below is replaced, the text kept, and a rerun changes nothing",
  { timeout: 300_000 },
  async () => {
    const dir = await upgradeProject(workDir, "from-0-2-1", env);
    await installUpgradePackage(dir, published, env);
    const original = await setup(dir);
    assert.equal(original.code, 0, describe(original));
    const agentsPath = path.join(dir, "AGENTS.md");
    assert.ok(
      readFileSync(agentsPath, "utf8").endsWith(AGENTS_BLOCK_0_2_1),
      "the published 0.2.1 writes the block the fixture holds",
    );
    const above = "# Agent directives\n\nOur own rule, first.\n\n";
    const below = "\n## Our own section\n\nKept, with a trailing space. \n";
    writeFileSync(agentsPath, `${above}${AGENTS_BLOCK_0_2_1}${below}`);

    await installUpgradePackage(dir, packed, env);
    const upgraded = await setup(dir);
    assert.equal(upgraded.code, 0, describe(upgraded));
    const content = readFileSync(agentsPath, "utf8");
    assert.notEqual(templeBarBlock(), AGENTS_BLOCK_0_2_1);
    assert.equal(
      content,
      `${above}${templeBarBlock()}${below}`,
      "the block is replaced and the project's text kept byte for byte",
    );

    const again = await setup(dir);
    assert.equal(again.code, 0, describe(again));
    assert.doesNotMatch(again.stdout, /Wrote |Updated |written:/);
    assert.equal(readFileSync(agentsPath, "utf8"), content);
  },
);
