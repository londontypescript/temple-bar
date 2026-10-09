import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { ScaffoldFixture } from "../../packages/temple-bar/src/init/testing/scaffolds/index.ts";
import { londonDate, writeRecordings } from "./record.ts";
import { recipes } from "./recipes.ts";
import { capture, compare } from "./snapshot.ts";
import { fixture, tempProject } from "./testing.ts";

void test("snapshot reads the agreed paths once, records all root names and never follows links", () => {
  const project = tempProject(
    {
      "package.json": "{}",
      ".github/deep/action.yml": "workflow\n",
      "docs/agents-rationale.md": "rationale\n",
      "docs/other.md": "authentic document\n",
      "src/source.ts": "not read\n",
      "src/notes.MD": "full nested document\n",
      "src/guide.markdown": "full long-extension document\n",
      "README.md": "authentic README without final newline",
      "node_modules/vendor/README.md": "excluded vendor\n",
      "pnpm-workspace.yaml": "settings\n",
      ".oxlintrc.json": "lint\n",
      ".prettierrc": "format\n",
      "bun.lockb": "binary-ish\n",
    },
    { "CLAUDE.md": "missing.md", "root-link": "src" },
  );
  try {
    const snapshot = project.snapshot;
    assert.deepEqual(
      Object.keys(snapshot.files).sort(),
      [
        "package.json",
        ".github/deep/action.yml",
        "docs/agents-rationale.md",
        "docs/other.md",
        "src/notes.MD",
        "src/guide.markdown",
        "README.md",
        "pnpm-workspace.yaml",
        ".oxlintrc.json",
        ".prettierrc",
        "bun.lockb",
      ].sort(),
      "snapshot captures the agreed content without excluded root names",
    );
    assert.deepEqual(
      snapshot.rootEntries,
      [
        ".github",
        ".oxlintrc.json",
        ".prettierrc",
        "CLAUDE.md",
        "bun.lockb",
        "docs",
        "package.json",
        "pnpm-workspace.yaml",
        "root-link",
        "src",
        "README.md",
        "node_modules",
      ].sort(),
      "every root file, folder and link is named",
    );
    assert.equal(
      snapshot.symlinks["CLAUDE.md"],
      "missing.md",
      "dangling links are read without following them",
    );
    assert.ok(
      Object.isFrozen(snapshot) &&
        Object.isFrozen(snapshot.files) &&
        Object.isFrozen(snapshot.bytes) &&
        Object.isFrozen(snapshot.symlinks) &&
        Object.isFrozen(snapshot.rootEntries),
      "snapshot and every child are immutable",
    );
    writeFileSync(
      path.join(project.dir, "package.json"),
      "changed after capture",
    );
    assert.equal(
      snapshot.files["package.json"],
      "{}",
      "snapshot does not reread the project",
    );
    const legacy = { ...fixture("vite", snapshot.files, snapshot.symlinks) };
    Reflect.deleteProperty(legacy, "rootEntries");
    const initial = compare(snapshot, legacy, "1.0.0");
    assert.equal(
      initial.differences.filter((line) => line.startsWith("root entry added:"))
        .length,
      snapshot.rootEntries.length,
      "first recording names every root entry as new",
    );
  } finally {
    project.close();
  }
});

void test("comparison names link addition and removal and the first differing line", () => {
  const project = tempProject(
    { "package.json": "{}\n", ".npmrc": "first\nsecond\n" },
    { "new-link": "new-target" },
  );
  try {
    const result = compare(
      project.snapshot,
      fixture(
        "vite",
        { "package.json": "{}\n", ".npmrc": "first\nold\n" },
        { "old-link": "target" },
      ),
      "1.0.0",
    );
    assert.ok(
      result.differences.includes('link added: new-link -> "new-target"'),
      "added link named",
    );
    assert.ok(
      result.differences.includes("link removed: old-link"),
      "removed link named",
    );
    assert.ok(
      result.differences.includes(
        'file changed: .npmrc, line 2: "old\\n" -> "second\\n"',
      ),
      "first differing line is shown",
    );
  } finally {
    project.close();
  }
});

void test("recording round trip preserves tabs, EOF, template syntax, slashes, Unicode and links", async () => {
  const files = {
    "package.json": '{\n\t"name": "— ${keep} `tick` \\\\path"\n}',
    ".npmrc": "tabs\tstay\n",
    "AGENTS.md": "rules —\n",
    ".github/workflows/custom.yml": "a: ${notCode}\n",
    "prettier.config.js": "export default {value: `a\\b`};",
  };
  const project = tempProject(files, { "CLAUDE.md": "./AGENTS.md" });
  try {
    const directory = path.join(project.dir, "fixtures");
    mkdirSync(directory);
    const data = fixture("vite", files, project.snapshot.symlinks);
    const recipe = recipes.vite;
    assert.ok(recipe);
    const written = writeRecordings(
      [
        {
          fixture: data,
          recipe,
          snapshot: project.snapshot,
          version: "9.9.9",
          command: "pnpm create vite@9.9.9 vite-app",
        },
      ],
      directory,
      "2026-10-08",
      "10.34.5",
      "24.21.0",
    );
    const file = written[0];
    assert.ok(file);
    const imported = (await import(pathToFileURL(file).href)) as {
      vite: ScaffoldFixture;
    };
    assert.deepEqual(
      imported.vite.files,
      files,
      "all text bytes survive module text -> import",
    );
    assert.deepEqual(
      imported.vite.symlinks,
      project.snapshot.symlinks,
      "all stored link targets survive module text -> import",
    );
    assert.deepEqual(
      imported.vite.rootEntries,
      project.snapshot.rootEntries,
      "root names survive module text -> import",
    );
    assert.equal(
      imported.vite.version,
      "9.9.9",
      "exact resolved version recorded",
    );
    assert.deepEqual(
      compare(project.snapshot, imported.vite, "9.9.9").differences,
      [],
      "imported recording compares cleanly",
    );
    assert.match(
      readFileSync(file, "utf8"),
      /pnpm 10\.34\.5 and Node 24\.21\.0/,
    );
    assert.equal(
      londonDate(new Date("2026-10-08T23:30:00Z")),
      "2026-10-09",
      "London date rather than UTC",
    );
    rmSync(file);
  } finally {
    project.close();
  }
});

void test("binary bytes remain in the snapshot and cannot be silently corrupted by recording", () => {
  const project = tempProject({ "package.json": "{}", "bun.lockb": "" });
  try {
    const binary = Buffer.from([0, 255, 128, 10]);
    writeFileSync(path.join(project.dir, "bun.lockb"), binary);
    const snapshot = capture(project.dir);
    assert.equal(
      snapshot.bytes["bun.lockb"],
      binary.toString("base64"),
      "binary lockfile bytes retained",
    );
    const recipe = recipes.vite;
    assert.ok(recipe);
    assert.throws(
      () =>
        writeRecordings(
          [
            {
              fixture: fixture(),
              recipe,
              snapshot,
              version: "1.0.0",
              command: "pnpm create vite@1.0.0 vite-app",
            },
          ],
          project.dir,
          "2026-10-08",
          "10.34.5",
          "24.21.0",
        ),
      /cannot record non-UTF-8 bytes in bun\.lockb/,
      "binary data must never be silently rewritten as UTF-8",
    );
  } finally {
    project.close();
  }
});
