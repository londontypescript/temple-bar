import assert from "node:assert/strict";
import test from "node:test";

import {
  ensurePackageJsonScripts,
  GATE_SCRIPT,
  PREPARE_SCRIPT,
} from "./package-json.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
} from "../testing/fakes.ts";

void test("ensurePackageJsonScripts creates a minimal package.json when none exists", async () => {
  const fs = createFakeFs();
  const ctx = createFakeContext({ fs, cwd: "/repo" });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo/my-app");
  assert.equal(outcome.wrote, true);
  assert.deepEqual(outcome.conflicts, []);
  const written = JSON.parse(
    fs.files.get("/repo/my-app/package.json") ?? "{}",
  ) as {
    name: string;
    private: boolean;
    scripts: Record<string, string>;
  };
  assert.equal(written.name, "my-app");
  assert.equal(written.private, true);
  assert.equal(written.scripts.prepare, PREPARE_SCRIPT);
  assert.equal(written.scripts.gate, GATE_SCRIPT);
});

void test("ensurePackageJsonScripts adds the scripts to an existing package.json", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "existing",
      scripts: { test: "vitest" },
    }),
  });
  const ctx = createFakeContext({
    fs,
    git: createFakeGit((args) => ({
      code: 0,
      stdout:
        args[0] === "ls-files" ? "" : "git@github.com:acme/different.git\n",
      stderr: "",
    })),
  });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  assert.equal(outcome.wrote, true);
  assert.deepEqual(outcome.conflicts, []);
  const written = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    name: string;
    scripts: Record<string, string>;
  };
  assert.equal(written.name, "existing");
  assert.equal(written.scripts.test, "vitest");
  assert.equal(written.scripts.prepare, PREPARE_SCRIPT);
  assert.equal(written.scripts.gate, GATE_SCRIPT);
});

void test("ensurePackageJsonScripts names a new package from GitHub origin", async () => {
  for (const origin of [
    "https://github.com/acme/widgets.git",
    "git@github.com:acme/widgets.git",
    "ssh://git@github.com/acme/widgets.git/",
  ]) {
    const fs = createFakeFs();
    const git = createFakeGit((args, cwd) => {
      if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
      assert.equal(cwd, "/repo/setup");
      assert.deepEqual(args, ["remote", "get-url", "origin"]);
      return { code: 0, stdout: `${origin}\n`, stderr: "" };
    });
    await ensurePackageJsonScripts(
      createFakeContext({ fs, git }),
      "/repo/setup",
    );
    assert.match(
      fs.files.get("/repo/setup/package.json") ?? "",
      /"name": "widgets"/,
    );
  }
});

void test("ensurePackageJsonScripts uses the main checkout folder without a GitHub origin", async () => {
  for (const [root, common, origin] of [
    ["/repo/widgets/.claude/worktrees/setup", "/repo/widgets/.git", ""],
    ["/repo/widgets/.claude/worktrees/setup", "../../../.git", ""],
    ["/repo/widgets", ".git", ""],
    [
      "/repo/widgets/.claude/worktrees/setup",
      "/repo/widgets/.git",
      "https://example.com/acme/other.git",
    ],
  ] as const) {
    const fs = createFakeFs();
    const git = createFakeGit((args, cwd) => {
      if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
      assert.equal(cwd, root);
      if (args[0] === "remote") {
        return { code: origin === "" ? 2 : 0, stdout: origin, stderr: "" };
      }
      return {
        code: 0,
        stdout: args[1] === "--git-common-dir" ? common : "false",
        stderr: "",
      };
    });
    await ensurePackageJsonScripts(createFakeContext({ fs, git }), root);
    assert.match(
      fs.files.get(`${root}/package.json`) ?? "",
      /"name": "widgets"/,
    );
  }
});

void test("ensurePackageJsonScripts falls back in a worktree of a bare repository", async () => {
  // Real git, asked from inside a worktree of a bare repo, says that folder
  // isn't bare; only the shared git folder knows the repo is.
  const fs = createFakeFs();
  const git = createFakeGit((args) => {
    if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "remote") {
      return { code: 2, stdout: "", stderr: "no origin" };
    }
    if (args[1] === "--git-common-dir") {
      return { code: 0, stdout: "/repos/widgets/.git", stderr: "" };
    }
    const askedOfCommonDir =
      args[0] === "--git-dir" && args[1] === "/repos/widgets/.git";
    return { code: 0, stdout: askedOfCommonDir ? "true" : "false", stderr: "" };
  });
  await ensurePackageJsonScripts(createFakeContext({ fs, git }), "/work/setup");
  assert.match(
    fs.files.get("/work/setup/package.json") ?? "",
    /"name": "setup"/,
  );
});

void test("ensurePackageJsonScripts falls back when git cannot identify a main checkout", async () => {
  for (const [common, code, bare] of [
    ["", 1, "false"],
    ["/repo/widgets.git", 0, "true"],
    ["/repo/widgets/shared", 0, "false"],
    ["/repo/widgets/.git", 0, "true"],
  ] as const) {
    const fs = createFakeFs();
    const git = createFakeGit((args) => {
      if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "remote") {
        return { code: 2, stdout: "", stderr: "no origin" };
      }
      return {
        code,
        stdout: args[1] === "--git-common-dir" ? common : bare,
        stderr: "",
      };
    });
    await ensurePackageJsonScripts(
      createFakeContext({ fs, git }),
      "/repo/setup",
    );
    assert.match(
      fs.files.get("/repo/setup/package.json") ?? "",
      /"name": "setup"/,
    );
  }
});

void test("ensurePackageJsonScripts adds a missing name first, preserving formatting even when scripts are complete", async () => {
  for (const [indent, newline] of [
    ["\t", "\n"],
    ["    ", "\n"],
    ["  ", ""],
  ] as const) {
    const pkg = {
      private: true,
      scripts: { prepare: PREPARE_SCRIPT, gate: GATE_SCRIPT },
    };
    const fs = createFakeFs({
      "/repo/package.json": `${JSON.stringify(pkg, null, indent)}${newline}`,
    });
    const git = createFakeGit((args) => ({
      code: 0,
      stdout: args[0] === "ls-files" ? "" : "git@github.com:acme/widgets.git",
      stderr: "",
    }));
    const ctx = createFakeContext({ fs, git });
    const outcome = await ensurePackageJsonScripts(ctx, "/repo");
    assert.equal(outcome.wrote, true);
    assert.equal(
      fs.files.get("/repo/package.json"),
      `${JSON.stringify({ name: "widgets", ...pkg }, null, indent)}${newline}`,
    );
    assert.equal((await ensurePackageJsonScripts(ctx, "/repo")).wrote, false);
  }
});

async function runWithPrepare(prepare: unknown) {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify(
      { name: "existing", scripts: { prepare } },
      null,
      2,
    ),
  });
  const outcome = await ensurePackageJsonScripts(
    createFakeContext({ fs }),
    "/repo",
  );
  const written = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, unknown>;
  };
  return { fs, outcome, written };
}

void test("ensurePackageJsonScripts chains onto an existing `prepare` script, project's command first", async () => {
  for (const existing of ["husky install", "svelte-kit sync || echo ''"]) {
    const { outcome, written } = await runWithPrepare(existing);
    assert.deepEqual(outcome.conflicts, []);
    assert.equal(outcome.wrote, true);
    assert.equal(written.scripts.prepare, `${existing} && ${PREPARE_SCRIPT}`);
    assert.equal(written.scripts.gate, GATE_SCRIPT, "gate still gets added");
  }
});

void test("ensurePackageJsonScripts trims a trailing line break before chaining", async () => {
  const { outcome, written } = await runWithPrepare("husky install\n");
  assert.deepEqual(outcome.conflicts, []);
  assert.equal(written.scripts.prepare, `husky install && ${PREPARE_SCRIPT}`);
});

void test("ensurePackageJsonScripts recognises its chained `prepare` with a trailing line break", async () => {
  const chained = `husky install && ${PREPARE_SCRIPT}\n`;
  const { outcome, written } = await runWithPrepare(chained);
  assert.deepEqual(outcome.conflicts, []);
  assert.equal(written.scripts.prepare, chained, "not chained a second time");
});

void test("ensurePackageJsonScripts does not chain a second time on a rerun", async () => {
  const { fs } = await runWithPrepare("svelte-kit sync || echo ''");
  const writesAfterFirstRun = fs.writes.length;
  const second = await ensurePackageJsonScripts(
    createFakeContext({ fs }),
    "/repo",
  );
  assert.equal(second.wrote, false);
  assert.deepEqual(second.conflicts, []);
  assert.equal(fs.writes.length, writesAfterFirstRun, "nothing is written");
  const written = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(
    written.scripts.prepare,
    `svelte-kit sync || echo '' && ${PREPARE_SCRIPT}`,
  );
});

void test("ensurePackageJsonScripts leaves a `prepare` script alone when `&&` can't safely follow it", async () => {
  for (const existing of [
    "foo # note",
    "foo &",
    "foo;",
    "foo &&",
    "foo ||",
    "foo |",
    "foo ;  ",
    "foo\nbar",
    "cat <<'EOF'\nprepared\nEOF\n",
    "foo # x && temple-bar hook install",
    "   ",
    42,
  ]) {
    const { outcome, written } = await runWithPrepare(existing);
    assert.deepEqual(
      outcome.conflicts,
      [{ name: "prepare", expected: PREPARE_SCRIPT }],
      JSON.stringify(existing),
    );
    assert.equal(written.scripts.prepare, existing, "must not overwrite");
    assert.equal(written.scripts.gate, GATE_SCRIPT, "gate still gets added");
  }
});

void test("ensurePackageJsonScripts is a no-op the second time (idempotent)", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify(
      {
        name: "existing",
        scripts: { prepare: PREPARE_SCRIPT, gate: GATE_SCRIPT },
      },
      null,
      2,
    ),
  });
  const ctx = createFakeContext({ fs });
  const outcome = await ensurePackageJsonScripts(ctx, "/repo");
  assert.equal(outcome.wrote, false);
  assert.deepEqual(outcome.conflicts, []);
  assert.equal(fs.writes.length, 0);
});

void test("ensurePackageJsonScripts keeps the file's indent and final newline", async () => {
  for (const [indent, newline] of [
    ["\t", "\n"],
    ["    ", "\n"],
    ["  ", ""],
  ] as const) {
    const original = `${JSON.stringify({ name: "x" }, null, indent)}${newline}`;
    const fs = createFakeFs({ "/repo/package.json": original });
    const ctx = createFakeContext({ fs });
    await ensurePackageJsonScripts(ctx, "/repo");
    const after = fs.files.get("/repo/package.json") ?? "";
    assert.ok(after.includes(`\n${indent}"scripts": {`), JSON.stringify(after));
    assert.equal(after.endsWith("\n"), newline === "\n");
  }
});
