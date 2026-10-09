// Mandatory Markdown integrity through a fresh pack:local artifact installed
// normally in a documentation project. Framework instructions remain intact.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { next } from "../packages/temple-bar/src/init/testing/scaffolds/next.ts";
import { initTestRepo } from "../packages/temple-bar/src/testing/git-repo.ts";
import { createFakeGh } from "./support/fake-gh.ts";
import { describe, run } from "./support/run.ts";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const README = [
  "## Documentation!",
  "",
  "#### Framework styles are project-owned",
  "",
  "<!-- markdownlint-disable -->",
  "Optional generated paths: `src/lib/index.js`, `docs/optional.md`.",
  "[guide][guide] ![image][] [shortcut] [unicode][SS]",
  "",
  "[guide]: docs/a(b).md",
  "[GUIDE]: docs/unused-duplicate.md",
  "[image]: images/a.png",
  "[shortcut]: docs/shortcut.md",
  "[unused]: docs/unused.md",
  "[ß]: docs/shortcut.md",
  "",
  "> [multiline][multi",
  "> label]",
  ">",
  "> [multi",
  "> label]: docs/shortcut.md",
  "",
  '<a href="docs/a(b).md">HTML guide</a> <img src="images/a.png">',
  "",
  "<div>",
  "[literal][missing]",
  "</div>",
  "",
  "Text <script>[literal][missing]</script>",
  "",
  "```md",
  "[literal][missing] ![literal](missing.png)",
  "```",
  "",
].join("\n");

void test(
  "packed Markdown integrity preserves framework docs and catches actual targets and explicit labels",
  { timeout: 300_000 },
  async () => {
    const workDir = mkdtempSync(
      path.join(tmpdir(), "temple-bar-markdown-delivery-"),
    );
    const dir = path.join(workDir, "project");
    const env = createFakeGh(
      workDir,
      Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^(npm|pnpm)_/i.test(key),
        ),
      ),
    );
    env.GIT_SSH_COMMAND = "false";
    const options = { cwd: dir, env };
    const write = (name: string, content: string) => {
      const file = path.join(dir, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    };
    const gate = () => run("pnpm", ["run", "gate"], options);
    try {
      const pack = await run(
        "pnpm",
        ["run", "pack:local", path.join(workDir, "pack")],
        { cwd: repoRoot, env },
      );
      assert.equal(pack.code, 0, describe(pack));
      const manifest = JSON.parse(
        readFileSync(
          path.join(workDir, "pack", "stage", "temple-bar", "package.json"),
          "utf8",
        ),
      ) as { version: string };
      mkdirSync(dir);
      initTestRepo(dir);
      write(".gitignore", "node_modules/\n");
      write(
        "package.json",
        JSON.stringify({
          name: "markdown-delivery",
          private: true,
        }),
      );
      write("README.md", README);
      write("AGENTS.md", next.files["AGENTS.md"]);
      write("CLAUDE.md", "@AGENTS.md\n");
      write(".markdownlint.json", '{"default":false}');
      write(
        ".markdownlint.jsonc",
        "malformed configuration belongs to project scripts",
      );
      write(".markdownlint.yaml", "MD052: false\nMD041: true\n");
      write("docs/a(b).md", "guide\n");
      write("docs/shortcut.md", "shortcut\n");
      write("images/a.png", "fixture\n");
      for (const args of [
        ["add", "-A"],
        ["commit", "-q", "-m", "Initial commit"],
        ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
      ]) {
        const result = await run("git", args, options);
        assert.equal(result.code, 0, describe(result));
      }
      const tarball = path.join(
        workDir,
        "pack",
        "tarballs",
        `londontypescript-temple-bar-${manifest.version}.tgz`,
      );
      const install = await run(
        "pnpm",
        ["add", "-D", "--save-exact", tarball],
        options,
      );
      assert.equal(install.code, 0, describe(install));
      const setup = await run("pnpm", ["exec", "temple-bar", "init"], options);
      assert.equal(setup.code, 0, describe(setup));
      assert.ok(
        readFileSync(path.join(dir, "AGENTS.md"), "utf8").startsWith(
          next.files["AGENTS.md"],
        ),
      );
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
      // Next can regenerate the one-line import after setup adds a heading.
      write("CLAUDE.md", "@AGENTS.md\n");
      const positive = await gate();
      assert.equal(positive.code, 2, describe(positive));
      assert.match(
        positive.stderr,
        /missing script\(s\): typecheck, lint, format:check, test/,
      );
      assert.deepEqual(
        [
          ...positive.stderr.matchAll(
            /^ {2}missing\s+(\S+) \(not in package.json\)$/gm,
          ),
        ].map((match) => match[1]),
        ["typecheck", "lint", "format:check", "test"],
      );
      assert.doesNotMatch(positive.stderr, /^ {2}failed /m);
      assert.match(positive.stderr, /passed +core setup/);
      assert.match(positive.stderr, /passed +markdown lint/);
      assert.match(positive.stderr, /passed +local links/);

      for (const [example, diagnostic] of [
        [
          "[full][missing]",
          /Missing link or image reference definition: "missing"/,
        ],
        [
          "![collapsed][]",
          /Missing link or image reference definition: "collapsed"/,
        ],
        ["[x][x]", /Missing link or image reference definition: "x"/],
      ] as const) {
        write("README.md", `${README}\n${example}\n`);
        const result = await gate();
        assert.equal(result.code, 2, describe(result));
        assert.match(result.stderr, diagnostic);
        assert.match(result.stderr, /temple-bar-reference-labels/);
        assert.match(result.stderr, /failed +markdown lint/);
        assert.match(result.stderr, /passed +local links/);
      }
      for (const example of [
        "[inline](docs/gone.md)",
        "![image](docs/gone.md)",
        '<a href="docs/gone.md">HTML link</a>',
        '<img src="docs/gone.md">',
        "[reference][gone]\n\n[gone]: docs/gone.md",
        "[outer ![nested][image]][gone]\n\n[gone]: docs/gone.md",
      ]) {
        write("README.md", `${README}\n${example}\n`);
        const result = await gate();
        assert.equal(result.code, 2, describe(result));
        assert.match(result.stderr, /link docs\/gone\.md/);
        assert.match(result.stderr, /failed +local links/);
        assert.match(result.stderr, /passed +markdown lint/);
      }
      write("README.md", README);
      const restored = await gate();
      assert.equal(restored.code, 2, describe(restored));
      assert.match(restored.stderr, /passed +markdown lint/);
      assert.match(restored.stderr, /passed +local links/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  },
);
