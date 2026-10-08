import assert from "node:assert/strict";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { INSTALLED_SHIMS } from "../../packages/temple-bar/src/gate/core.ts";
import { BLOCK_BEGIN } from "../../packages/temple-bar/src/init/agents-template.ts";
import { shippedFiles } from "./expectation.ts";
import { validateFiles } from "./validate-files.ts";
import { install, minimalFiles, tempProject } from "./testing.ts";

const edits: {
  name: string;
  files?: Record<string, string>;
  links?: Record<string, string>;
  edit: (dir: string) => void;
  finding: RegExp;
}[] = [
  {
    name: "fresh AGENTS",
    edit: (dir) => {
      writeFileSync(path.join(dir, "AGENTS.md"), "broken");
    },
    finding: /AGENTS.md: expected shipped content/,
  },
  {
    name: "AGENTS shipped block",
    files: { "AGENTS.md": "scaffold rules\n" },
    edit: (dir) => {
      const file = path.join(dir, "AGENTS.md");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(BLOCK_BEGIN, "wrong marker"),
      );
    },
    finding: /expected one complete shipped temple-bar block/,
  },
  {
    name: "AGENTS prefix",
    files: { "AGENTS.md": "scaffold rules\n" },
    edit: (dir) => {
      const file = path.join(dir, "AGENTS.md");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace("scaffold rules", "changed rules"),
      );
    },
    finding: /scaffold content changed before the block/,
  },
  {
    name: "AGENTS suffix",
    files: { "AGENTS.md": "rules without newline" },
    edit: (dir) => {
      const file = path.join(dir, "AGENTS.md");
      writeFileSync(file, `${readFileSync(file, "utf8")}extra\n`);
    },
    finding: /content found after the block/,
  },
  {
    name: "fresh CLAUDE",
    edit: (dir) => {
      writeFileSync(path.join(dir, "CLAUDE.md"), "bad");
    },
    finding: /CLAUDE.md: expected shipped content/,
  },
  {
    name: "CLAUDE prefix",
    files: { "CLAUDE.md": "instructions\n" },
    edit: (dir) => {
      writeFileSync(
        path.join(dir, "CLAUDE.md"),
        "# Claude Code\n\nchanged\n@AGENTS.md\n",
      );
    },
    finding: /scaffold content was not kept whole at the start/,
  },
  {
    name: "CLAUDE import",
    files: { "CLAUDE.md": "# Original\n\nKeep\n" },
    edit: (dir) => {
      writeFileSync(path.join(dir, "CLAUDE.md"), "# Original\n\nKeep\n");
    },
    finding: /missing AGENTS.md import line/,
  },
  {
    name: "CLAUDE link",
    files: { "AGENTS.md": "rules\n" },
    links: { "CLAUDE.md": "./AGENTS.md" },
    edit: (dir) => {
      rmSync(path.join(dir, "CLAUDE.md"));
      symlinkSync("AGENTS.md", path.join(dir, "CLAUDE.md"));
    },
    finding: /stored AGENTS.md link changed/,
  },
  {
    name: "CLAUDE write through",
    files: { "AGENTS.md": "rules\n" },
    links: { "CLAUDE.md": "AGENTS.md" },
    edit: (dir) => {
      const file = path.join(dir, "AGENTS.md");
      writeFileSync(
        file,
        `# Claude Code\n@AGENTS.md\n${readFileSync(file, "utf8")}`,
      );
    },
    finding: /Claude heading or self import written through link/,
  },
  {
    name: "framework bytes",
    files: { "pnpm-workspace.yaml": "original\n" },
    edit: (dir) => {
      writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "changed\n");
    },
    finding: /pnpm-workspace.yaml: scaffold bytes changed/,
  },
  {
    name: "framework file replaced by link",
    edit: (dir) => {
      rmSync(path.join(dir, ".npmrc"));
      symlinkSync(".gitignore", path.join(dir, ".npmrc"));
    },
    finding: /.npmrc: scaffold bytes changed/,
  },
  {
    name: "gitignore prefix",
    edit: (dir) => {
      writeFileSync(path.join(dir, ".gitignore"), "different prefix\n");
    },
    finding: /.gitignore: scaffold bytes changed at the start/,
  },
];

for (const scenario of edits) {
  void test(`file validator catches ${scenario.name} with its own finding`, () => {
    const project = tempProject(
      { ...minimalFiles, ...scenario.files },
      scenario.links,
    );
    try {
      install(project.dir);
      assert.deepEqual(
        validateFiles(project.dir, project.snapshot),
        [],
        "valid installed files accepted before mutation",
      );
      scenario.edit(project.dir);
      assert.ok(
        validateFiles(project.dir, project.snapshot).some((finding) =>
          scenario.finding.test(finding),
        ),
        `${scenario.name}: missing its own finding ${String(scenario.finding)}`,
      );
    } finally {
      project.close();
    }
  });
}

for (const file of shippedFiles) {
  void test(`file validator catches changed shipped ${file.path}`, () => {
    const project = tempProject(minimalFiles);
    try {
      install(project.dir);
      writeFileSync(path.join(project.dir, file.path), "changed\n");
      assert.ok(
        validateFiles(project.dir, project.snapshot).includes(
          `${file.path}: expected shipped content`,
        ),
        "changed companion or workflow gets its own finding",
      );
    } finally {
      project.close();
    }
  });
}

for (const name of Object.keys(INSTALLED_SHIMS)) {
  void test(`file validator catches missing ${name} shim`, () => {
    const project = tempProject(minimalFiles);
    try {
      install(project.dir);
      rmSync(path.join(project.dir, ".git/hooks", name));
      assert.ok(
        validateFiles(project.dir, project.snapshot).includes(
          `.git/hooks/${name}: expected shipped content`,
        ),
        "missing shim gets its own finding",
      );
    } finally {
      project.close();
    }
  });
}

void test("ordinary CLAUDE preserves heading and plain content; pnpm lock changes and ignore additions are allowed", () => {
  for (const claude of [
    "# My heading\n\nRules\n",
    "@AGENTS.md\n",
    "plain instructions",
    "#not a heading\n",
  ]) {
    const project = tempProject({
      ...minimalFiles,
      "CLAUDE.md": claude,
      "pnpm-lock.yaml": "before\n",
    });
    try {
      install(project.dir);
      const file = path.join(project.dir, "CLAUDE.md");
      if (claude === "#not a heading\n")
        writeFileSync(file, `# Claude Code\n\n${claude}\n@./AGENTS.md\n`);
      writeFileSync(
        path.join(project.dir, "pnpm-lock.yaml"),
        "install rewrites the lock\n",
      );
      writeFileSync(
        path.join(project.dir, ".gitignore"),
        `${minimalFiles[".gitignore"]}.temple-bar/\n`,
      );
      assert.deepEqual(
        validateFiles(project.dir, project.snapshot),
        [],
        `valid preservation accepted for ${JSON.stringify(claude)}`,
      );
    } finally {
      project.close();
    }
  }
});
