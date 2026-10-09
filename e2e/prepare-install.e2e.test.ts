// sv 1.1.1's authentic no-install scaffold was captured during the isolated
// diagnosis on 2026-10-09. Real framework dependencies and the packed launcher
// prove preparation happens through normal installation before setup writes.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { initTestRepo } from "../packages/temple-bar/src/testing/git-repo.ts";
import { environments } from "../scripts/scaffold-check/environment.ts";
import { packBoth, type Tarballs } from "./support/pack.ts";
import { serveTarball, type LocalRegistry } from "./support/registry.ts";
import { probeUnusedFiles } from "./support/unused-probes.ts";
import { describe, run, type RunOptions } from "./support/run.ts";

let folder = "";
let tarballs: Tarballs;
let registry: LocalRegistry | undefined;
let env: NodeJS.ProcessEnv;

before(async () => {
  // pnpm records absolute paths: use the same spelling throughout each fixture.
  folder = realpathSync(
    mkdtempSync(path.join(tmpdir(), "temple-bar-prepare-")),
  );
  tarballs = await packBoth(folder);
  const manifest = JSON.parse(
    readFileSync(
      path.join(folder, "stage", "temple-bar", "package.json"),
      "utf8",
    ),
  ) as { name: string; version: string };
  registry = await serveTarball(manifest, tarballs.templeBar);
  env = environments(folder, process.env, registry.url).setup;
  // Exclude inherited project tools, but keep pnpm's own install directory:
  // CI's package-manager setup also puts its executable in node_modules/.bin.
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = (env[pathKey] ?? "")
    .split(path.delimiter)
    .filter(
      (entry) =>
        !/[\\/]node_modules[\\/]\.bin(?:[\\/]|$)/.test(entry) ||
        ["pnpm", "pnpm.cmd", "pnpm.exe"].some((name) =>
          existsSync(path.join(entry, name)),
        ),
    )
    .join(path.delimiter);
});

after(async () => {
  await registry?.close();
  if (folder !== "") rmSync(folder, { recursive: true, force: true });
});

async function project(
  name: string,
  files: Readonly<Record<string, string>>,
): Promise<RunOptions> {
  const cwd = path.join(folder, name);
  mkdirSync(cwd);
  initTestRepo(cwd);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(cwd, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  const options = { cwd, env };
  for (const args of [
    ["add", "-A"],
    ["commit", "-q", "-m", "Initial commit"],
    ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
  ]) {
    const result = await run("git", args, options);
    assert.equal(result.code, 0, describe(result));
  }
  return options;
}

function launch(options: RunOptions) {
  return run(
    "pnpm",
    [`--package=${tarballs.createTempleBar}`, "dlx", "create-temple-bar"],
    options,
  );
}

void test(
  "packed launcher generates authentic SvelteKit configuration without changing framework source",
  { timeout: 600_000 },
  async () => {
    const files = JSON.parse(
      readFileSync(
        new URL("./fixtures/sveltekit.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>;
    const options = await project("sveltekit", files);
    assert.ok(
      !existsSync(
        path.join(options.cwd, "node_modules", "$app", "tsconfig.json"),
      ),
    );
    const result = await launch(options);
    assert.equal(result.code, 0, describe(result));
    assert.ok(
      existsSync(
        path.join(options.cwd, "node_modules", "$app", "tsconfig.json"),
      ),
      describe(result),
    );
    const prepareAt = result.stdout.indexOf("svelte-kit sync");
    const setupAt = result.stdout.indexOf(
      "Wrote temple-bar's rules into AGENTS.md",
    );
    assert.ok(prepareAt >= 0 && setupAt > prepareAt, describe(result));
    for (const [relative, contents] of Object.entries(files)) {
      if (["package.json", ".gitignore"].includes(relative)) continue;
      assert.equal(
        readFileSync(path.join(options.cwd, relative), "utf8"),
        contents,
        relative,
      );
    }
    const manifest = JSON.parse(
      readFileSync(path.join(options.cwd, "package.json"), "utf8"),
    ) as { scripts: Record<string, string>; imports: Record<string, string> };
    assert.equal(
      manifest.scripts.prepare,
      "svelte-kit sync || echo '' && temple-bar hook install",
    );
    const original = JSON.parse(files["package.json"] ?? "{}") as {
      scripts: Record<string, string>;
      imports: Record<string, string>;
    };
    assert.deepEqual(manifest.imports, original.imports);
    for (const [name, command] of Object.entries(original.scripts)) {
      if (name !== "prepare") assert.equal(manifest.scripts[name], command);
    }
    assert.ok(
      readFileSync(path.join(options.cwd, ".gitignore"), "utf8").startsWith(
        files[".gitignore"] ?? "",
      ),
    );
    const framework = await run("pnpm", ["run", "check"], options);
    assert.equal(framework.code, 0, describe(framework));
    // Avoid real GitHub: the fixture origin is deliberately fictitious.
    const remote = await run(
      "git",
      [
        "remote",
        "set-url",
        "origin",
        "https://git.example.invalid/acme/widgets.git",
      ],
      options,
    );
    assert.equal(remote.code, 0, describe(remote));
    const gate = await run("pnpm", ["run", "gate"], options);
    assert.equal(gate.code, 2, describe(gate));
    assert.match(
      gate.stderr,
      /missing script\(s\): typecheck, lint, format:check, test/,
    );
    assert.doesNotMatch(
      gate.stdout + gate.stderr,
      /Error loading|could not run|File '\$app\/tsconfig' not found/,
    );
    // Native findings remain visible; the gate explains the accepted exception.
    assert.match(
      gate.stdout + gate.stderr,
      /Unused files[\s\S]*src\/lib\/index\.ts/,
    );
    assert.match(gate.stdout, /accepted 1 comment-only unused file/);
    assert.match(gate.stdout, /passed +unused code \(knip\)/);
    await probeUnusedFiles(options);
  },
);

void test(
  "packed launcher stops before init when normal project installation fails",
  { timeout: 300_000 },
  async () => {
    const options = await project("failed-install", {
      ".gitignore": "node_modules/\n",
      "package.json": JSON.stringify({
        private: true,
        scripts: { prepare: "node fail.cjs" },
      }),
      "fail.cjs": "process.exit(7);\n",
    });
    const result = await launch(options);
    assert.equal(result.code, 7, describe(result));
    assert.match(
      result.stderr,
      /Failed to install the project \(ran: pnpm install --frozen-lockfile\)/,
    );
    assert.ok(!existsSync(path.join(options.cwd, "AGENTS.md")));
    assert.ok(!existsSync(path.join(options.cwd, ".github")));
  },
);

void test(
  "packed member installation prepares the workspace but exposes the existing root setup limitation",
  { timeout: 300_000 },
  async () => {
    const options = await project("workspace", {
      ".gitignore": "node_modules/\nprepared\n",
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "package.json": JSON.stringify({
        private: true,
        scripts: { prepare: "node prepare.cjs" },
      }),
      "prepare.cjs":
        "require('node:fs').writeFileSync('prepared', String(require('node:fs').existsSync('AGENTS.md')));\n",
      "packages/app/package.json": '{"name":"app","private":true}\n',
      "packages/sibling/package.json": JSON.stringify({
        name: "sibling",
        private: true,
        scripts: { prepare: "node prepare.cjs" },
      }),
      "packages/sibling/prepare.cjs":
        "require('node:fs').writeFileSync('prepared', 'sibling');\n",
    });
    const member = {
      ...options,
      cwd: path.join(options.cwd, "packages", "app"),
    };
    const result = await launch(member);
    assert.equal(result.code, 0, describe(result));
    assert.equal(
      readFileSync(path.join(options.cwd, "prepared"), "utf8"),
      "false",
      "workspace prepare ran before repository init",
    );
    assert.equal(
      readFileSync(
        path.join(options.cwd, "packages", "sibling", "prepared"),
        "utf8",
      ),
      "sibling",
    );
    assert.ok(existsSync(path.join(options.cwd, "AGENTS.md")));
    assert.ok(!existsSync(path.join(member.cwd, "AGENTS.md")));
    // init resolves the Git root, while add installs in the member. Workspace
    // member setup is separate planned work, not support this repair claims.
    const prepare = await run("pnpm", ["run", "prepare"], options);
    assert.notEqual(prepare.code, 0, describe(prepare));
    assert.match(
      prepare.stdout + prepare.stderr,
      /temple-bar.*(?:not found|not recognized)|(?:not found|not recognized).*temple-bar/s,
    );
  },
);

void test(
  "packed launcher leaves explicitly disabled project lifecycle scripts disabled",
  { timeout: 300_000 },
  async () => {
    const options = await project("disabled-scripts", {
      ".gitignore": "node_modules/\n",
      ".npmrc": "ignore-scripts=true\n",
      "package.json": JSON.stringify({
        private: true,
        scripts: { prepare: "node prepare.cjs" },
      }),
      "prepare.cjs": "require('node:fs').writeFileSync('prepared', 'ran');\n",
    });
    const result = await launch(options);
    assert.equal(result.code, 0, describe(result));
    assert.ok(!existsSync(path.join(options.cwd, "prepared")));
    assert.ok(existsSync(path.join(options.cwd, "AGENTS.md")));
    assert.equal(
      readFileSync(path.join(options.cwd, ".npmrc"), "utf8"),
      "ignore-scripts=true\n",
    );
  },
);
