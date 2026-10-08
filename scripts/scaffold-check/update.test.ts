import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { check } from "./check.ts";
import { recipes } from "./recipes.ts";
import { fixture, install, ok, world, writeProject } from "./testing.ts";

void test("version moving alone stays same and --update does not rewrite its module", async () => {
  const fake = world();
  fake.override = (call) =>
    call.args[0] === "view" ? ok("2.0.0\n") : undefined;
  try {
    const result = await check({
      update: true,
      runner: fake.runner,
      resources: fake.resources,
      fixtures: fake.fixtures,
      fixtureDirectory: fake.root,
      tempRoot: fake.root,
    });
    assert.equal(result.code, 0, result.report);
    assert.match(result.report, /version moved: 1\.0\.0 -> 2\.0\.0/);
    assert.equal(
      existsSync(path.join(fake.root, "vite.ts")),
      false,
      "version-only run never records",
    );
  } finally {
    fake.close();
  }
});

void test("--update uses the pre-setup snapshot even when setup fails and writes after all scaffolds", async () => {
  const fake = world([fixture("vite"), fixture("next"), fixture("astro")]);
  const directory = path.join(fake.root, "fixtures");
  mkdirSync(directory);
  for (const data of fake.fixtures)
    writeFileSync(path.join(directory, `${data.name}.ts`), "old\n");
  let launches = 0;
  fake.override = (call) => {
    if (call.args[0] === "view" && path.basename(call.cwd) === "astro")
      return {
        code: 1,
        output: "cannot run astro",
        stdout: "",
        timedOut: false,
      };
    if (call.args[0] === "create") {
      const name = path.basename(call.cwd);
      writeProject(path.join(call.cwd, recipes[name]?.project ?? ""), {
        "package.json": '{"name":"app"}\n',
        ".gitignore": "node_modules/\n",
        ".npmrc": "original\n",
      });
      return ok();
    }
    if (call.args.includes("create-temple-bar")) {
      launches++;
      assert.equal(
        readFileSync(path.join(directory, "vite.ts"), "utf8"),
        "old\n",
        "no fixture is written while scaffolds are running",
      );
      install(call.cwd);
      writeFileSync(path.join(call.cwd, ".npmrc"), "changed by setup\n");
      return { code: 1, output: "install failed", stdout: "", timedOut: false };
    }
    if (call.args[1] === "prettier") {
      assert.equal(launches, 2, "formatter runs only after every scaffold");
      assert.deepEqual(
        call.args.slice(3).sort(),
        [path.join(directory, "next.ts"), path.join(directory, "vite.ts")],
        "format only written fixtures",
      );
      return ok();
    }
    return undefined;
  };
  try {
    const result = await check({
      update: true,
      runner: fake.runner,
      resources: fake.resources,
      fixtures: fake.fixtures,
      fixtureDirectory: directory,
      tempRoot: fake.root,
      now: () => new Date("2026-10-08T23:30:00Z"),
    });
    assert.equal(result.code, 1);
    assert.deepEqual(
      result.results[0]?.statuses,
      ["differs", "setup failed"],
      result.report,
    );
    const recorded = readFileSync(path.join(directory, "vite.ts"), "utf8");
    assert.match(recorded, /original\\n/, "recorded bytes precede setup");
    assert.doesNotMatch(
      recorded,
      /changed by setup|temple-bar hook install/,
      "setup output is never recorded",
    );
    assert.match(
      recorded,
      /Recorded on 2026-10-09/,
      "recording date is London",
    );
    assert.match(recorded, /pnpm 10\.34\.5 and Node/);
    assert.match(recorded, /pnpm create vite@1\.0\.0/);
    assert.equal(
      readFileSync(path.join(directory, "astro.ts"), "utf8"),
      "old\n",
      "failed scaffold never records",
    );
    assert.ok(
      readdirSync(directory).every((name) => name.endsWith(".ts")),
      "temporary recording files are removed",
    );
  } finally {
    fake.close();
  }
});
