// Packed setup on recorded scaffolds: init, hooks and gate use the installed
// tarball, with fake gh answers. A shared toolbox avoids installing framework
// dependencies. This does not prove the launcher's add works in these projects;
// the live scaffolder check covers that separately.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { INSTALLED_SHIMS } from "../packages/temple-bar/src/gate/core.ts";
import { scaffolds } from "../packages/temple-bar/src/init/testing/scaffolds/index.ts";
import { packBoth, type Tarballs } from "./support/pack.ts";
import { serveTarball, type LocalRegistry } from "./support/registry.ts";
import { describe, run } from "./support/run.ts";
import {
  assertScaffoldSetup,
  git,
  linkToolbox,
  makeScaffoldProject,
  scaffoldEnv,
} from "./support/scaffolds.ts";

const MISSING_SCRIPTS: Readonly<Record<string, readonly string[]>> = {
  vite: ["typecheck", "format:check", "test"],
  next: ["typecheck", "format:check", "test"],
  sveltekit: ["typecheck", "lint", "format:check", "test"],
  "react-router": ["lint", "format:check", "test"],
  nuxt: ["typecheck", "lint", "format:check", "test"],
};

let workDir = "";
let toolboxDir = "";
let tarballs: Tarballs;
let registry: LocalRegistry | undefined;
let env: NodeJS.ProcessEnv;
let pnpmVersion = "";

before(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), "temple-bar-scaffolds-"));
  tarballs = await packBoth(workDir);
  const manifest = JSON.parse(
    readFileSync(
      path.join(workDir, "stage", "temple-bar", "package.json"),
      "utf8",
    ),
  ) as { name: string; version: string };
  registry = await serveTarball(manifest, tarballs.templeBar);
  env = scaffoldEnv(workDir, registry.url);
  toolboxDir = path.join(workDir, "toolbox");
  mkdirSync(toolboxDir);
  writeFileSync(path.join(toolboxDir, "package.json"), '{"private":true}\n');
  const options = { cwd: toolboxDir, env };
  const version = await run("pnpm", ["--version"], options);
  assert.equal(version.code, 0, describe(version));
  pnpmVersion = version.stdout.trim();
  const install = await run(
    "pnpm",
    ["add", "-D", "--save-exact", `${manifest.name}@${manifest.version}`],
    options,
  );
  assert.equal(
    install.code,
    0,
    `the packed toolbox installs\n${describe(install)}`,
  );
  assert.ok(
    registry.requested.includes(manifest.name),
    "temple-bar came from the tarball registry",
  );
});

after(async () => {
  await registry?.close();
  if (workDir !== "") rmSync(workDir, { recursive: true, force: true });
});

for (const fixture of scaffolds) {
  void test(
    `${fixture.name}: packed setup on recorded scaffolds${fixture.name === "angular" ? " refuses the foreign packageManager" : " preserves framework files, restores hooks and reports missing scripts"}`,
    { timeout: 300_000 },
    async () => {
      const options = await makeScaffoldProject(workDir, fixture, env);
      const dir = options.cwd;
      const hooksDir = path.join(dir, ".git", "hooks");

      if (fixture.name === "angular") {
        const config = readFileSync(path.join(dir, ".git", "config"));
        const hooks = readdirSync(hooksDir).sort();
        // pnpm dlx runs in a project naming npm even though add, exec and run
        // do not. The launcher must explain the field before attempting add.
        const launch = await run(
          "pnpm",
          [`--package=${tarballs.createTempleBar}`, "dlx", "create-temple-bar"],
          options,
        );
        assert.notEqual(launch.code, 0, describe(launch));
        assert.match(
          launch.stderr,
          /^temple-bar needs pnpm, but package\.json has "packageManager": "npm@11\.19\.0"\. Nothing was changed\.$/m,
          "angular: the packed launcher's own refusal explains npm@11.19.0",
        );
        assert.match(launch.stderr, /Set packageManager to pnpm/);
        assert.doesNotMatch(
          launch.stderr,
          /This project is configured to use npm/,
        );
        const status = await git(
          ["status", "--porcelain", "--ignored"],
          options,
        );
        assert.equal(
          status.stdout,
          "",
          "angular: no tracked, untracked or ignored files changed",
        );
        assert.ok(
          !existsSync(path.join(dir, "node_modules")),
          "angular: no node_modules",
        );
        assert.deepEqual(
          readFileSync(path.join(dir, ".git", "config")),
          config,
          "angular: git config is unchanged byte for byte",
        );
        assert.deepEqual(
          readdirSync(hooksDir).sort(),
          hooks,
          "angular: the set of hook files is unchanged",
        );
        return;
      }

      linkToolbox(dir, toolboxDir);
      const setup = await run("pnpm", ["exec", "temple-bar", "init"], options);
      assert.equal(setup.code, 0, describe(setup));
      assert.match(
        setup.stderr,
        /Couldn't read the default branch from GitHub, so the hooks protect main until `git remote set-head origin --auto` succeeds\./,
        `${fixture.name}: SSH is blocked and setup reports protection of main`,
      );
      assertScaffoldSetup(dir, fixture, pnpmVersion);

      for (const [name, content] of Object.entries(INSTALLED_SHIMS)) {
        const hook = path.join(hooksDir, name);
        assert.ok(
          existsSync(hook),
          `${fixture.name}: ${name} exists after setup`,
        );
        assert.equal(
          readFileSync(hook, "utf8"),
          content,
          `${fixture.name}: ${name} is installed`,
        );
        rmSync(hook);
      }
      // Install runs prepare; running it directly exercises the chain without
      // fetching the framework. SvelteKit's missing sync must still reach hooks.
      const prepare = await run("pnpm", ["run", "prepare"], options);
      assert.equal(prepare.code, 0, describe(prepare));
      for (const [name, content] of Object.entries(INSTALLED_SHIMS)) {
        const hook = path.join(hooksDir, name);
        assert.ok(
          existsSync(hook),
          `${fixture.name}: prepare restores ${name}`,
        );
        assert.equal(
          readFileSync(hook, "utf8"),
          content,
          `${fixture.name}: prepare restores ${name}`,
        );
      }
      const commit = await run(
        "git",
        ["commit", "--allow-empty", "-m", "direct"],
        options,
      );
      assert.notEqual(commit.code, 0, describe(commit));
      assert.match(commit.stderr, /refusing to commit directly to main/);

      writeFileSync(path.join(dir, "index.js"), "export {};\n");
      // The gate's ruleset check must not call GitHub for this made-up repo.
      await git(
        [
          "remote",
          "set-url",
          "origin",
          "https://git.example.invalid/acme/widgets.git",
        ],
        options,
      );
      const gate = await run("pnpm", ["run", "gate"], options);
      assert.equal(gate.code, 2, describe(gate));
      const missing = MISSING_SCRIPTS[fixture.name];
      assert.ok(
        missing !== undefined,
        `${fixture.name}: expected missing scripts`,
      );
      const reported = [
        ...gate.stderr.matchAll(
          /^gate: .*missing script\(s\): ([^\r\n]+)\r?$/gm,
        ),
      ].map((match) => match[1]);
      assert.deepEqual(
        reported,
        [missing.join(", ")],
        `${fixture.name}: gate reports exactly the missing scripts, in gate order`,
      );
      // A failing report goes to stderr (gate/report.ts).
      assert.match(gate.stderr, /passed +core setup/);
      assert.match(gate.stderr, /passed +gate and title workflows/);
      // Existing framework scripts cannot run without their dependencies;
      // framework agent markdown also has its own lint findings. Neither is
      // part of the result this recorded setup test promises.
    },
  );
}
