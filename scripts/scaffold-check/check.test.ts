import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseArgs, USAGE } from "../scaffold-check.ts";
import { scaffolds } from "../../packages/temple-bar/src/init/testing/scaffolds/index.ts";
import { check } from "./check.ts";
import { recipes, scaffoldArgs } from "./recipes.ts";
import { DEADLINES } from "./setup.ts";
import { fixture, ok, world, writeProject } from "./testing.ts";

void test("recipes cover exactly the recorded scaffolders and resolve Astro's version", () => {
  assert.deepEqual(
    Object.keys(recipes).sort(),
    scaffolds.map((entry) => entry.name).sort(),
    "recipes and fixtures must match one to one",
  );
  for (const data of scaffolds) {
    const recipe = recipes[data.name];
    assert.ok(recipe, `${data.name}: recipe exists`);
    assert.equal(
      recipe.package,
      data.scaffolder,
      `${data.name}: version lookup package`,
    );
    const resolved = scaffoldArgs(recipe, "99.0.1");
    assert.equal(
      ["pnpm", ...resolved].join(" "),
      // A recording names the exact version that ran; older ones said latest.
      data.command.replace(/@(?:latest|\d+\.\d+\.\d+)(?= )/, "@99.0.1"),
      `${data.name}: recorded flags with resolved version`,
    );
  }
});

void test("usage accepts only the documented modes, without running anything", () => {
  assert.equal(parseArgs([]), "check");
  assert.equal(parseArgs(["--update"]), "update");
  assert.equal(parseArgs(["--help"]), "help");
  assert.equal(parseArgs(["-h"]), "help");
  for (const args of [["--wat"], ["--update", "--update"], ["--help", "extra"]])
    assert.equal(parseArgs(args), "error", "invalid options are a usage error");
  assert.match(
    USAGE,
    /public registry only \(registry\.npmjs\.org\)/,
    "usage names the registry contract",
  );
});

void test("real orchestration passes an identical scaffold, isolates both environments and deletes clean runs", async () => {
  const fake = world();
  try {
    const result = await check({
      update: false,
      runner: fake.runner,
      resources: fake.resources,
      fixtures: fake.fixtures,
      tempRoot: fake.root,
      inherited: {
        PATH: process.env.PATH,
        npm_bad: "inherited",
        PNPM_BAD: "inherited",
        GIT_DIR: "inherited",
        NODE_OPTIONS: "inherited",
        HOME: "inherited",
      },
    });
    assert.equal(result.code, 0, result.report);
    assert.deepEqual(
      result.results[0]?.statuses,
      ["same"],
      "same means setup also passed",
    );
    assert.equal(
      existsSync(result.folder),
      false,
      "clean run folder was deleted",
    );
    assert.equal(fake.packed, 1, "pack once");
    assert.equal(fake.closed, 1, "close registry once");
    const scaffold = fake.calls.find((call) => call.args[0] === "create");
    const launch = fake.calls.find((call) =>
      call.args.includes("create-temple-bar"),
    );
    assert.ok(scaffold && launch, "scaffolder and packed launcher both run");
    assert.equal(scaffold.deadline, DEADLINES.scaffold);
    assert.equal(launch.deadline, DEADLINES.install);
    assert.match(launch.args[0] ?? "", /^--package=.*create-temple-bar\.tgz$/);
    for (const call of fake.calls) {
      assert.equal(call.env.npm_bad, undefined, "npm inheritance removed");
      assert.equal(call.env.PNPM_BAD, undefined, "pnpm inheritance removed");
      assert.equal(call.env.GIT_DIR, undefined, "git redirects removed");
      for (const key of [
        "HOME",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME",
        "TMPDIR",
        "npm_config_cache",
        "npm_config_store_dir",
        "npm_config_cache_dir",
        "pnpm_config_cache",
        "pnpm_config_store_dir",
        "pnpm_config_cache_dir",
        ...(process.platform === "win32"
          ? ["USERPROFILE", "APPDATA", "LOCALAPPDATA"]
          : []),
      ])
        assert.ok(
          call.env[key]?.startsWith(`${result.folder}${path.sep}`),
          `${key} stays in run folder`,
        );
      assert.equal(
        call.env.npm_config_verify_deps_before_run,
        undefined,
        "real dependency verification remains enabled",
      );
      assert.equal(
        call.env.pnpm_config_verify_deps_before_run,
        undefined,
        "new pnpm dependency verification remains enabled",
      );
      assert.equal(
        call.env.GIT_CONFIG_NOSYSTEM,
        "1",
        "git system config is isolated",
      );
      assert.equal(
        call.env.GIT_CONFIG_GLOBAL,
        path.join(result.folder, "gitconfig"),
        "git gets the isolated config explicitly",
      );
      assert.equal(call.env.GIT_AUTHOR_NAME, "Scaffold check");
      if (call.command === "git")
        assert.equal(
          call.env,
          launch.env,
          "each git call gets setup's environment",
        );
    }
    assert.equal(
      scaffold.env.NODE_OPTIONS,
      undefined,
      "fake gh is absent from scaffolding",
    );
    assert.doesNotMatch(scaffold.env.PATH ?? "", /fake-gh-bin/);
    assert.equal(
      scaffold.env.npm_config_registry,
      "https://registry.npmjs.org/",
    );
    assert.equal(
      scaffold.env.pnpm_config_registry,
      "https://registry.npmjs.org/",
    );
    assert.match(launch.env.NODE_OPTIONS ?? "", /fake-gh-preload\.cjs/);
    assert.match(launch.env.PATH ?? "", /fake-gh-bin/);
    assert.equal(launch.env.GIT_SSH_COMMAND, "false");
    assert.equal(launch.env.npm_config_registry, "http://registry.invalid/");
    assert.equal(launch.env.pnpm_config_registry, "http://registry.invalid/");
    assert.match(
      result.report,
      /framework's own lint failed/,
      "framework script failures remain informational",
    );
  } finally {
    fake.close();
  }
});

void test("real orchestration names byte, file, root and link differences visibly", async () => {
  const data = fixture(
    "astro",
    {
      "package.json": '{"name":"app"}\n',
      "AGENTS.md": "rules\n",
      ".npmrc": "a b\n",
      ".gitignore": "node_modules/\n",
      "eslint.config.js": "config\n",
    },
    { "CLAUDE.md": "AGENTS.md" },
  );
  const fake = world([data]);
  fake.override = (call) => {
    if (call.args[0] !== "create") return undefined;
    const project = path.join(call.cwd, "astro-app");
    writeProject(
      project,
      {
        "package.json": data.files["package.json"] ?? "",
        "AGENTS.md": "rules",
        ".npmrc": "a\tb\n",
        ".gitignore": "node_modules/\n",
        "prettier.config.js": "new\n",
        "new.txt": "name only\n",
      },
      { "CLAUDE.md": "./AGENTS.md" },
    );
    return ok();
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
    for (const message of [
      /file changed: \.npmrc, line 1: "a b\\n" -> "a\\tb\\n"/,
      /file changed: AGENTS\.md, line 1: "rules\\n" -> "rules" \(no final newline\)/,
      /file added: prettier\.config\.js/,
      /file removed: eslint\.config\.js/,
      /link retargeted: CLAUDE\.md/,
      /root entry added: new\.txt/,
      /root entry removed: eslint\.config\.js/,
    ])
      assert.match(
        result.report,
        message,
        `visible difference ${String(message)}`,
      );
    assert.equal(existsSync(result.folder), true, "dirty run folder retained");
  } finally {
    fake.close();
  }
});

for (const stage of ["version", "scaffold", "missing folder"] as const) {
  for (const timeout of stage === "missing folder" ? [false] : [false, true]) {
    void test(`${stage} ${timeout ? "deadline" : "failure"} is couldn't run and later scaffolds continue`, async () => {
      const fake = world([fixture("vite"), fixture("next")]);
      fake.override = (call) => {
        if (path.basename(call.cwd) !== "vite") return undefined;
        if (
          (stage === "version" && call.args[0] === "view") ||
          (stage !== "version" && call.args[0] === "create")
        ) {
          if (stage === "scaffold")
            writeProject(path.join(call.cwd, "vite-app"), fixture().files);
          return {
            code: stage === "missing folder" ? 0 : 7,
            output: Array.from(
              { length: 50 },
              (_, i) => `output-${String(i)}`,
            ).join("\n"),
            stdout: "",
            timedOut: timeout,
          };
        }
        return undefined;
      };
      try {
        const result = await check({
          update: false,
          runner: fake.runner,
          resources: fake.resources,
          fixtures: fake.fixtures,
          tempRoot: fake.root,
        });
        assert.equal(result.code, 1);
        assert.deepEqual(
          result.results.map((entry) => entry.statuses),
          [["couldn't run"], ["same"]],
          result.report,
        );
        assert.match(
          result.report,
          /output-49/,
          "failure includes output tail",
        );
        assert.doesNotMatch(
          result.report,
          /output-0\n/,
          "failure prints only last 40 lines",
        );
        if (timeout)
          assert.match(
            result.report,
            /deadline reached/,
            "deadline is recorded",
          );
        if (stage === "missing folder")
          assert.match(result.report, /no project folder vite-app/);
      } finally {
        fake.close();
      }
    });
  }
}

void test("packing failure stops before any runner call, and Ctrl-C stops before later scaffolds", async () => {
  const fake = world([fixture("vite"), fixture("next")]);
  try {
    const failed = await check({
      update: false,
      runner: fake.runner,
      resources: () => Promise.reject(new Error("pack diagnostic")),
      fixtures: fake.fixtures,
      tempRoot: fake.root,
    });
    assert.equal(failed.code, 1);
    assert.match(
      failed.report,
      /Packing failed before scaffolding: Error: pack diagnostic/,
    );
    assert.equal(
      fake.calls.length,
      0,
      "packing failure never starts a scaffolder",
    );
    const controller = new AbortController();
    fake.override = (call) => {
      if (call.args[0] === "view") controller.abort();
      return undefined;
    };
    const interrupted = await check({
      update: false,
      runner: fake.runner,
      resources: fake.resources,
      fixtures: fake.fixtures,
      tempRoot: fake.root,
      signal: controller.signal,
    });
    assert.equal(interrupted.code, 1);
    assert.match(interrupted.report, /Interrupted/);
    assert.equal(
      fake.calls.some((call) => path.basename(call.cwd) === "next"),
      false,
      "Ctrl-C never starts the next scaffold",
    );
    assert.equal(fake.closed, 1, "Ctrl-C closes registry");
    assert.equal(
      existsSync(interrupted.folder),
      true,
      "Ctrl-C keeps diagnosis folder",
    );
    rmSync(failed.folder, { recursive: true });
  } finally {
    fake.close();
  }
});
