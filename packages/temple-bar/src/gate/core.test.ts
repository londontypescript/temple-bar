import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { GitResult } from "../seams/git.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeWriter,
} from "../testing/fakes.ts";
import {
  BLOCK_BEGIN,
  freshAgentsMd,
  templeBarBlock,
} from "../init/agents-template.ts";
import { findCoreProblems, runCoreCheck } from "./core.ts";
import {
  CORE_SCRIPTS,
  coreFiles,
  withCoreGit,
} from "./testing/core-fixture.ts";

const NOTHING: GitResult = { code: 0, stdout: "", stderr: "" };

function setUpRepo(
  change: (files: Map<string, string>) => void = () => undefined,
  git: (args: readonly string[]) => GitResult | undefined = () => undefined,
) {
  const files = new Map(
    Object.entries({
      ...coreFiles(),
      "/repo/package.json": JSON.stringify({
        scripts: { ...CORE_SCRIPTS, test: "node --test" },
      }),
    }),
  );
  change(files);
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit((args, cwd) => {
      const answer = git(args);
      return answer ?? withCoreGit(() => NOTHING)(args, cwd);
    }),
    fs: createFakeFs(Object.fromEntries(files)),
    stderr,
  });
  return { ctx, stderr };
}

void test("a repo with everything setup installs has no core problems", async () => {
  assert.deepEqual(await findCoreProblems(setUpRepo().ctx), []);
});

void test("a deleted hook is reported, with the install command that puts it back", async () => {
  const { ctx } = setUpRepo((files) => {
    files.delete(path.join("/repo", ".git", "hooks", "pre-push"));
  });
  const problems = await findCoreProblems(ctx);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.problem, "the pre-push hook is missing");
  assert.match(
    problems.map((p) => p.fix).join(""),
    /pnpm exec temple-bar hook install/,
  );
});

void test("an edited hook is caught by its hash, not only a deleted one", async () => {
  const shim = path.join("/repo", ".git", "hooks", "pre-commit");
  const { ctx } = setUpRepo((files) => {
    // Still has temple-bar's marker line: an edit, not someone else's hook.
    files.set(shim, `${files.get(shim) ?? ""}exit 0\n`);
  });
  const problems = await findCoreProblems(ctx);
  assert.deepEqual(
    problems.map((p) => p.problem),
    ["the pre-commit hook differs from the one temple-bar installs"],
  );
  assert.match(problems[0]?.fix ?? "", /^delete .*pre-commit, then run/);
});

void test("hooks are read from git's shared folder, which a worktree names absolutely", async () => {
  const common = path.join("/elsewhere", "main", ".git");
  const { ctx } = setUpRepo(
    (files) => {
      for (const [name, content] of [...files]) {
        if (name.includes(`${path.sep}hooks${path.sep}`)) {
          files.set(path.join(common, "hooks", path.basename(name)), content);
          files.delete(name);
        }
      }
    },
    (args) =>
      args[0] === "rev-parse"
        ? { code: 0, stdout: `${common}\n`, stderr: "" }
        : undefined,
  );
  assert.deepEqual(await findCoreProblems(ctx), []);
});

void test("core.hooksPath set anywhere fails: git would run none of the hooks", async () => {
  const { ctx } = setUpRepo(undefined, (args) =>
    args.join(" ") === "config --get core.hooksPath"
      ? { code: 0, stdout: "/tmp/no-hooks\n", stderr: "" }
      : undefined,
  );
  const problems = await findCoreProblems(ctx);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0]?.problem ?? "",
    /core\.hooksPath is set to "\/tmp\/no-hooks"/,
  );
});

void test("pull.ff unset or loosened fails, with the command that sets it", async () => {
  for (const answer of [
    { code: 1, stdout: "", stderr: "" },
    { code: 0, stdout: "true\n", stderr: "" },
  ]) {
    const { ctx } = setUpRepo(undefined, (args) =>
      args.join(" ") === "config --get pull.ff" ? answer : undefined,
    );
    const problems = await findCoreProblems(ctx);
    assert.equal(problems.length, 1);
    assert.equal(problems[0]?.fix, "run `git config pull.ff only`");
  }
});

void test("a .gitignore missing setup's lines names each missing line", async () => {
  const { ctx } = setUpRepo((files) => {
    files.set(path.join("/repo", ".gitignore"), "node_modules/\ndist/\n");
  });
  const problems = await findCoreProblems(ctx);
  assert.equal(problems.length, 1);
  assert.match(
    problems[0]?.problem ?? "",
    /lacks line\(s\) setup keeps there: .*\.env, \.env\.\*/,
  );
  assert.doesNotMatch(problems[0]?.problem ?? "", /node_modules\//);
});

void test("a changed or missing setup script fails; the project's other scripts are its own", async () => {
  const { ctx } = setUpRepo((files) => {
    files.set(
      path.join("/repo", "package.json"),
      JSON.stringify({
        scripts: { gate: "echo skipped", lint: "anything" },
      }),
    );
  });
  const problems = (await findCoreProblems(ctx)).map((p) => p.problem);
  assert.deepEqual(problems, [
    'package.json has no "prepare" script',
    'package.json\'s "gate" script is "echo skipped"',
  ]);
});

async function prepareProblems(prepare: unknown) {
  const { ctx } = setUpRepo((files) => {
    files.set(
      path.join("/repo", "package.json"),
      JSON.stringify({ scripts: { prepare, gate: CORE_SCRIPTS.gate } }),
    );
  });
  return findCoreProblems(ctx);
}

void test("the gate accepts a `prepare` script chained after the project's own command", async () => {
  for (const ok of [
    "svelte-kit sync || echo '' && temple-bar hook install",
    "husky install && temple-bar hook install",
  ]) {
    assert.deepEqual(await prepareProblems(ok), [], ok);
  }
});

void test("the gate rejects a chained `prepare` that the rule refuses, and says both ways to fix it", async () => {
  for (const bad of [
    "foo # x && temple-bar hook install",
    "foo; && temple-bar hook install",
    "foo | && temple-bar hook install",
    "foo\n && temple-bar hook install",
    "cat <<'EOF'\nprepared\nEOF && temple-bar hook install",
    "foo && temple-bar hook install --other",
    "temple-bar hook install && foo",
    42,
  ]) {
    const problems = await prepareProblems(bad);
    assert.equal(problems.length, 1, JSON.stringify(bad));
    assert.equal(
      problems[0]?.fix,
      'set "prepare" in package.json\'s "scripts" to "temple-bar hook install", ' +
        'or end the existing command with " && temple-bar hook install"',
    );
  }
});

void test("runCoreCheck reports a failure with each problem and its fix", async () => {
  const { ctx, stderr } = setUpRepo((files) => {
    files.delete(path.join("/repo", ".git", "hooks", "commit-msg"));
  });
  const outcome = await runCoreCheck(ctx);
  assert.deepEqual(outcome, {
    name: "core setup",
    status: "failed",
    detail: "1 problem(s)",
  });
  assert.match(
    stderr.lines.join(""),
    /part\(s\) of temple-bar's setup are missing or changed:\n {2}the commit-msg hook is missing\n {4}fix: run `pnpm exec temple-bar hook install`/,
  );
});

const AGENTS = path.join("/repo", "AGENTS.md");

void test("AGENTS.md with this release's block, or with no block at all, passes", async () => {
  for (const content of [
    freshAgentsMd(),
    `# Framework rules\n\n${templeBarBlock()}`,
    "# Our own rules, set up before the block existed\n",
  ]) {
    const { ctx } = setUpRepo((files) => files.set(AGENTS, content));
    assert.deepEqual(await findCoreProblems(ctx), [], content);
  }
});

void test("an edited temple-bar block in AGENTS.md fails, saying how to move the change out or rerun setup", async () => {
  const { ctx, stderr } = setUpRepo((files) =>
    files.set(
      AGENTS,
      freshAgentsMd().replace("## Plans", "## Plans\n\nOur extra rule."),
    ),
  );
  assert.equal((await runCoreCheck(ctx)).status, "failed");
  const text = stderr.lines.join("");
  assert.match(
    text,
    /AGENTS\.md's temple-bar block differs from the one this temple-bar version writes/,
  );
  assert.match(
    text,
    /if temple-bar was upgraded, run `pnpm exec temple-bar init`; if the block was edited, move any change of your own above or below the block/,
  );
});

void test("temple-bar markers in AGENTS.md that don't pair up fail", async () => {
  const { ctx } = setUpRepo((files) =>
    files.set(AGENTS, `# Rules\n\n${BLOCK_BEGIN}\n\nNo end.\n`),
  );
  const problems = await findCoreProblems(ctx);
  assert.equal(problems.length, 1);
  assert.match(problems[0]?.problem ?? "", /1 BEGIN and 0 END lines/);
});
