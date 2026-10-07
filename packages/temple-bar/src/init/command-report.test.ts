// What setup says about AGENTS.md and the files beside it: a refused block
// ends the run non-zero, an oversized file is a warning, and every file
// written or added to is named, and counted as something to commit.

import assert from "node:assert/strict";
import test from "node:test";

import { BLOCK_BEGIN } from "./agents-template.ts";
import { COMPANION_FILES } from "./companion-docs.ts";
import { createFakeFs, createFakeGit } from "../testing/fakes.ts";
import {
  defaultGitScript,
  makeFixture,
  runInitFor,
  setUpFiles,
  unchangedReport,
} from "./testing/command-fixture.ts";
import { createInitCommand } from "./command.ts";

async function runWithHooksUnchanged(fs: ReturnType<typeof createFakeFs>) {
  const fixture = makeFixture({ fs });
  const command = createInitCommand({
    installHooks: () => Promise.resolve(unchangedReport),
  });
  const code = await command.run([], fixture.ctx);
  return {
    code,
    stdout: fixture.stdout.lines.join(""),
    stderr: fixture.stderr.lines.join(""),
  };
}

void test("init report: a fresh repo names the companion files it wrote, and the next steps add them", async () => {
  const fixture = makeFixture({ fs: createFakeFs() });
  const code = await runInitFor(fixture);
  assert.equal(code, 0, fixture.stderr.lines.join(""));
  const out = fixture.stdout.lines.join("");
  assert.match(out, /Wrote temple-bar's rules into AGENTS\.md\./);
  assert.match(
    out,
    new RegExp(
      `Wrote the files AGENTS\\.md links to, where missing: ${COMPANION_FILES.map((file) => file.path.replaceAll(".", "\\.")).join(", ")}\\.`,
    ),
  );
  assert.match(
    out,
    new RegExp(
      `git add AGENTS\\.md ${COMPANION_FILES.map((file) => file.path.replaceAll(".", "\\.")).join(" ")} package\\.json`,
    ),
  );
});

void test("init report: the next steps add only the files setup wrote, never a whole folder with the project's own work in it", async () => {
  const fixture = makeFixture({
    fs: createFakeFs({ "/repo/docs/conventions.md": "# Ours\n" }),
  });
  assert.equal(await runInitFor(fixture), 0);
  const out = fixture.stdout.lines.join("");
  const addLine = /^ {2}git add .*$/m.exec(out)?.[0] ?? "";
  assert.match(addLine, /docs\/agents-rationale\.md/);
  assert.doesNotMatch(addLine, /docs\/conventions\.md|docs\/ /);
});

void test("init report: an AGENTS.md block setup can't update goes to stderr and ends the run non-zero, after the rest of setup", async () => {
  const broken = `# Rules\n\n${BLOCK_BEGIN}\n\nNo end marker.\n`;
  const fs = setUpFiles({ "/repo/AGENTS.md": broken });
  const { code, stdout, stderr } = await runWithHooksUnchanged(fs);
  assert.equal(code, 1);
  assert.match(stderr, /1 BEGIN and 0 END lines/);
  assert.doesNotMatch(stdout, /AGENTS\.md/);
  assert.doesNotMatch(stdout, /temple-bar is set up/);
  assert.match(stdout, /Git hooks already installed/);
  assert.equal(fs.files.get("/repo/AGENTS.md"), broken);
});

void test("init report: an AGENTS.md over its size limit is a warning, and the run still succeeds", async () => {
  const own = `# Framework rules\n\n${"Use the router.\n".repeat(98)}`;
  const fs = setUpFiles({ "/repo/AGENTS.md": own });
  const { code, stdout, stderr } = await runWithHooksUnchanged(fs);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Warning: AGENTS\.md is over its size limit/);
  assert.match(stdout, /temple-bar is set up/);
});

void test("init report: what was added to an existing CLAUDE.md is named, and counts as a change to land", async () => {
  const fs = setUpFiles({ "/repo/CLAUDE.md": "@AGENTS.md\n" });
  const { code, stdout } = await runWithHooksUnchanged(fs);
  assert.equal(code, 0);
  assert.match(stdout, /Added to CLAUDE\.md: a heading\./);
  assert.match(stdout, /Next: /);
});

void test("init report: a companion file written alone counts as a change to land", async () => {
  const fs = setUpFiles();
  fs.files.delete("/repo/docs/conventions.md");
  const { code, stdout } = await runWithHooksUnchanged(fs);
  assert.equal(code, 0);
  assert.match(
    stdout,
    /Wrote the files AGENTS\.md links to, where missing: docs\/conventions\.md\./,
  );
  assert.match(stdout, /Next: /);
});

/** A fresh repo whose git answers the two branch questions as given. */
function fixtureOnBranch(
  current: { code: number; stdout: string },
  originHead = "",
) {
  return makeFixture({
    fs: createFakeFs(),
    git: createFakeGit((args) => {
      if (args[0] === "symbolic-ref" && args.includes("HEAD")) {
        return { ...current, stderr: "" };
      }
      if (args[0] === "symbolic-ref") {
        return {
          code: originHead === "" ? 1 : 0,
          stdout: originHead,
          stderr: "",
        };
      }
      return defaultGitScript(args);
    }),
  });
}

async function nextStepsOn(
  current: { code: number; stdout: string },
  originHead = "",
): Promise<string> {
  const fixture = fixtureOnBranch(current, originHead);
  assert.equal(await runInitFor(fixture), 0, fixture.stderr.lines.join(""));
  return fixture.stdout.lines.join("");
}

void test("init report: on the protected branch the next steps start a new branch and push it", async () => {
  const out = await nextStepsOn({ code: 0, stdout: "refs/heads/main\n" });
  assert.match(out, /Next: main now refuses direct commits/);
  assert.match(out, /git switch -c temple-bar-setup/);
  assert.match(out, /git push -u origin temple-bar-setup/);
});

void test("init report: the next steps name the protected branch when it isn't main", async () => {
  const out = await nextStepsOn(
    { code: 0, stdout: "refs/heads/trunk\n" },
    "refs/remotes/origin/trunk\n",
  );
  assert.match(out, /Next: trunk now refuses direct commits/);
  assert.match(out, /git switch -c temple-bar-setup/);
});

void test("init report: on another branch the next steps skip the switch and push that branch", async () => {
  const out = await nextStepsOn({
    code: 0,
    stdout: "refs/heads/chore/set-up-temple-bar\n",
  });
  assert.doesNotMatch(out, /git switch/);
  assert.match(out, /setup ran on chore\/set-up-temple-bar/);
  assert.match(out, /git push -u origin chore\/set-up-temple-bar\n/);
  assert.doesNotMatch(out, /origin temple-bar-setup/);
  assert.match(out, /git commit -m "chore: set up temple-bar"/);
  assert.match(out, /gh pr create --fill/);
});

void test("init report: on a detached HEAD the next steps are the new-branch ones", async () => {
  const out = await nextStepsOn({ code: 1, stdout: "" });
  assert.match(out, /git switch -c temple-bar-setup/);
  assert.match(out, /git push -u origin temple-bar-setup/);
});

void test("init report: when git can't tell the branch, the next steps are the new-branch ones and setup still succeeds", async () => {
  const out = await nextStepsOn({ code: 0, stdout: "" });
  assert.match(out, /git switch -c temple-bar-setup/);
  assert.match(out, /temple-bar is set up/);
});

void test("init report: on the protected branch the switch step stays even when a tag shares its name", async () => {
  // git's short form says `heads/main` when a tag is also called `main`.
  const fixture = makeFixture({
    fs: createFakeFs(),
    git: createFakeGit((args) => {
      if (args[0] === "symbolic-ref" && args.includes("HEAD")) {
        return args.includes("--short")
          ? { code: 0, stdout: "heads/main\n", stderr: "" }
          : { code: 0, stdout: "refs/heads/main\n", stderr: "" };
      }
      return defaultGitScript(args);
    }),
  });
  assert.equal(await runInitFor(fixture), 0, fixture.stderr.lines.join(""));
  assert.match(fixture.stdout.lines.join(""), /git switch -c temple-bar-setup/);
});

void test("init report: a branch name the shell would act on is quoted in the push step", async () => {
  const out = await nextStepsOn({
    code: 0,
    stdout: "refs/heads/chore/$USER's-setup\n",
  });
  assert.match(out, /git push -u origin 'chore\/\$USER'\\''s-setup'\n/);
});

void test("init report: a branch name ending in other whitespace is pushed as it is", async () => {
  const out = await nextStepsOn({
    code: 0,
    stdout: "refs/heads/chore/topic\u00a0\n",
  });
  assert.match(out, /git push -u origin 'chore\/topic\u00a0'\n/);
});
