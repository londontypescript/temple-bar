import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import { templeBarBlock } from "./agents-template.ts";
import { SETUP_PATHS, setupWriteTargets } from "./write-target.ts";
import { writeTargetRepo, realLink } from "./testing/write-target-repo.ts";

for (const relative of SETUP_PATHS) {
  for (const dangling of [true, false]) {
    void test(`write safety: ${relative} leaves ${dangling ? "dangling" : "outside-file"} link and target untouched`, async () => {
      const repo = writeTargetRepo();
      try {
        const target = path.join(repo.outside, "target");
        const original =
          relative === "package.json"
            ? '{"private":true}'
            : "outside content\n";
        if (!dangling) writeFileSync(target, original, { mode: 0o600 });
        const file = path.join(repo.root, relative);
        realLink(target, file);
        const linkBefore = lstatSync(file);
        const code = await repo.run();
        assert.equal(
          code,
          1,
          `${relative}: symlink refusal ends setup non-zero`,
        );
        assert.equal(
          readlinkSync(file),
          target,
          `${relative}: stored target unchanged`,
        );
        assert.equal(
          lstatSync(file).ino,
          linkBefore.ino,
          `${relative}: link never replaced`,
        );
        assert.equal(
          existsSync(target),
          !dangling,
          `${relative}: dangling target never created`,
        );
        if (!dangling)
          assert.equal(
            readFileSync(target, "utf8"),
            original,
            `${relative}: outside target bytes unchanged`,
          );
        const lines = repo.stderr.lines.filter((line) =>
          line.startsWith(`${relative} `),
        );
        assert.equal(
          lines.length,
          1,
          `${relative}: refused path reported exactly once`,
        );
        assert.match(
          lines[0] ?? "",
          /symlink.*Fix: replace it with an ordinary file, or remove it, then run setup again/,
        );
        if (relative === "AGENTS.md")
          assert.doesNotMatch(lines[0] ?? "", /block|marker/);
        assert.ok(
          existsSync(path.join(repo.root, ".git/hooks/pre-commit")),
          "remaining hooks still installed",
        );
        assert.ok(
          existsSync(
            path.join(
              repo.root,
              relative === "package.json" ? "AGENTS.md" : "package.json",
            ),
          ),
          "other setup files still written",
        );
      } finally {
        repo.cleanup();
      }
    });
  }
}

for (const folder of ["docs", ".github"]) {
  void test(`write safety: linked folder ${folder} reports every child without writing outside`, async () => {
    const repo = writeTargetRepo();
    try {
      realLink(repo.outside, path.join(repo.root, folder), true);
      assert.equal(await repo.run(), 1);
      assert.deepEqual(
        readdirSync(repo.outside),
        [],
        `${folder}: outside folder remains empty`,
      );
      for (const relative of SETUP_PATHS.filter((file) =>
        file.startsWith(`${folder}/`),
      )) {
        const line = repo.stderr.lines.find((line) =>
          line.startsWith(`${relative} `),
        );
        assert.ok(line !== undefined, `${relative}: refused child named`);
        assert.ok(line.includes(`linked folder ${folder}`));
        assert.match(line, /Fix: replace .*ordinary folder.*run setup again/);
      }
    } finally {
      repo.cleanup();
    }
  });
  void test(`write safety: ordinary file at folder ${folder} refuses children without ENOTDIR`, async () => {
    const repo = writeTargetRepo();
    try {
      writeFileSync(path.join(repo.root, folder), "ordinary file");
      assert.equal(await repo.run(), 1);
      assert.equal(
        readFileSync(path.join(repo.root, folder), "utf8"),
        "ordinary file",
      );
      for (const relative of SETUP_PATHS.filter((file) =>
        file.startsWith(`${folder}/`),
      )) {
        assert.ok(
          repo.stderr.lines.some(
            (line) =>
              line.startsWith(`${relative} `) && line.includes("ordinary file"),
          ),
        );
      }
    } finally {
      repo.cleanup();
    }
  });
}

for (const stored of ["AGENTS.md", "./AGENTS.md", ".\\AGENTS.md"]) {
  void test(`write safety: CLAUDE.md direct link ${stored} is left alone`, async () => {
    const repo = writeTargetRepo();
    try {
      const original = "# Framework rules\n";
      writeFileSync(path.join(repo.root, "AGENTS.md"), original);
      realLink(stored, path.join(repo.root, "CLAUDE.md"));
      const originalTarget = readlinkSync(path.join(repo.root, "CLAUDE.md"));
      // This also proves a real disk link with index mode 120000 gets the exception.
      const oid = repo.git(["hash-object", "-w", "--stdin"], stored).trim();
      repo.git([
        "update-index",
        "--add",
        "--cacheinfo",
        `120000,${oid},CLAUDE.md`,
      ]);
      assert.equal(await repo.run(), 0, repo.stderr.lines.join(""));
      assert.equal(
        readlinkSync(path.join(repo.root, "CLAUDE.md")),
        originalTarget,
      );
      const agents = readFileSync(path.join(repo.root, "AGENTS.md"), "utf8");
      assert.equal(agents, `${original}\n${templeBarBlock()}`);
      assert.doesNotMatch(agents, /^# Claude Code$|^@AGENTS\.md$/m);
      assert.equal(
        repo.stdout.lines.filter((line) =>
          line.includes("CLAUDE.md links to AGENTS.md"),
        ).length,
        1,
      );
    } finally {
      repo.cleanup();
    }
  });
}

for (const stored of [
  "absolute",
  "docs/../AGENTS.md",
  "../x/AGENTS.md",
  "AGENTS.md/",
  "agents.md",
  "X",
]) {
  void test(`write safety: CLAUDE.md rejects target ${stored}`, async () => {
    const repo = writeTargetRepo();
    try {
      writeFileSync(path.join(repo.root, "AGENTS.md"), "rules\n");
      realLink("AGENTS.md", path.join(repo.root, "X"));
      const target =
        stored === "absolute" ? path.join(repo.root, "AGENTS.md") : stored;
      realLink(target, path.join(repo.root, "CLAUDE.md"));
      const originalTarget = readlinkSync(path.join(repo.root, "CLAUDE.md"));
      const targets = setupWriteTargets(repo.ctx, repo.root);
      assert.equal(
        (await targets.inspect("CLAUDE.md")).kind,
        "refused",
        `${stored}: no widened Claude exception`,
      );
      assert.equal(
        readlinkSync(path.join(repo.root, "CLAUDE.md")),
        originalTarget,
      );
      assert.equal(
        readFileSync(path.join(repo.root, "AGENTS.md"), "utf8"),
        "rules\n",
      );
    } finally {
      repo.cleanup();
    }
  });
}

for (const agents of ["missing", "folder", "symlink", "tracked"]) {
  void test(`write safety: CLAUDE.md exception refuses ${agents} AGENTS.md`, async () => {
    const repo = writeTargetRepo();
    try {
      const file = path.join(repo.root, "AGENTS.md");
      if (agents === "folder") mkdirSync(file);
      if (agents === "symlink")
        realLink(path.join(repo.outside, "target"), file);
      if (agents === "tracked") repo.stageLink("AGENTS.md", "elsewhere");
      realLink("AGENTS.md", path.join(repo.root, "CLAUDE.md"));
      const state = await setupWriteTargets(repo.ctx, repo.root).inspect(
        "CLAUDE.md",
      );
      assert.equal(state.kind, "refused");
      if (agents === "missing") {
        // Setup writes AGENTS.md before it reaches CLAUDE.md, so this is
        // only seen when CLAUDE.md is checked on its own.
        assert.equal(state.reason, "is a symlink");
      } else {
        // The link is fine; the fix belongs to what it points at.
        assert.match(state.reason, /^links to AGENTS\.md, which /);
        assert.match(state.fix, /^fix AGENTS\.md first \(/);
      }
    } finally {
      repo.cleanup();
    }
  });
}

for (const relative of SETUP_PATHS) {
  void test(`write safety: unborn index tracked plain-file ${relative} is never edited`, async () => {
    const repo = writeTargetRepo();
    try {
      const target = relative === "CLAUDE.md" ? "AGENTS.md" : "outside-target";
      const oid = repo.stageLink(relative, target);
      const index = repo.git(["ls-files", "-s", "-z", "--", relative]);
      assert.ok(index.startsWith(`120000 ${oid} 0\t`));
      assert.equal(await repo.run(), 1);
      assert.equal(
        readFileSync(path.join(repo.root, relative), "utf8"),
        target,
        `${relative}: tracked plain-file bytes unchanged`,
      );
      assert.equal(repo.git(["ls-files", "-s", "-z", "--", relative]), index);
      const report = repo.stderr.lines.find((line) =>
        line.startsWith(`${relative} `),
      );
      assert.match(report ?? "", /tracked symlink.*Fix:/);
      if (relative === "CLAUDE.md")
        assert.match(report ?? "", /core\.symlinks=true.*@AGENTS\.md/);
    } finally {
      repo.cleanup();
    }
  });
}

void test("write safety: repo root itself may be a linked folder", async () => {
  const repo = writeTargetRepo();
  try {
    const linkedRoot = path.join(repo.base, "linked-root");
    realLink(repo.root, linkedRoot, true);
    const targets = setupWriteTargets(repo.ctx, linkedRoot);
    assert.equal(await targets.writeText("docs/example.md", "allowed\n"), true);
    assert.equal(
      readFileSync(path.join(repo.root, "docs/example.md"), "utf8"),
      "allowed\n",
    );
  } finally {
    repo.cleanup();
  }
});
