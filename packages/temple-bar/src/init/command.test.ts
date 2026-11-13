import assert from "node:assert/strict";
import { normalize } from "node:path";
import test from "node:test";

import { isConventionalSubject } from "../conventional/subject.ts";
import { createInitCommand, SETUP_COMMIT_MESSAGE } from "./command.ts";
import { templeBarBlock } from "./agents-template.ts";
import { GATE_SCRIPT, PREPARE_SCRIPT } from "./package-json.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGh,
  createFakeGit,
  createFakePrompt,
} from "../testing/fakes.ts";
import {
  defaultGhScript,
  defaultGitScript,
  makeFixture,
  noRulesetGhScript,
  runInitFor,
  setUpFiles,
  unchangedReport,
  worldFixture,
} from "./testing/command-fixture.ts";
import { newWorld } from "./testing/creation-world.ts";

void test("init: name is 'init'", () => {
  const command = createInitCommand({
    installHooks: () => Promise.resolve(unchangedReport),
  });
  assert.equal(command.name, "init");
});
void test("init: an existing project with other scripts gets AGENTS.md and the two scripts added", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "widgets",
      scripts: { test: "node --test" },
    }),
  });
  const fixture = makeFixture({ fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 0);
  assert.ok(fs.files.get("/repo/AGENTS.md"));
  const pkg = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts.test, "node --test");
  assert.equal(pkg.scripts.prepare, PREPARE_SCRIPT);
  assert.equal(pkg.scripts.gate, GATE_SCRIPT);
  assert.equal(fixture.hookCalls.calls, 1);
});

void test("init: a second run changes nothing", async () => {
  const fs = setUpFiles();
  const installHooks = () => Promise.resolve(unchangedReport);
  const ctx = createFakeContext({
    git: createFakeGit(defaultGitScript),
    gh: createFakeGh(defaultGhScript),
    prompt: createFakePrompt({ interactive: false, answer: "no-terminal" }),
    fs,
  });
  const command = createInitCommand({ installHooks });
  const code = await command.run([], ctx);
  assert.equal(code, 0);
  assert.equal(fs.writes.length, 0, "a second run must write nothing");
});
void test("init: repo creation accepted with 'yes' and commits present proceeds to write files", async () => {
  const world = newWorld();
  const fs = createFakeFs();
  const fixture = worldFixture(world, "yes", { fs });
  const code = await runInitFor(fixture, ["--owner", "acme"]);
  assert.equal(code, 0);
  assert.ok(fs.files.get("/repo/AGENTS.md"));
  assert.ok(
    world.calls.includes(
      "gh repo create acme/widgets --public --source . --remote origin",
    ),
  );
});

void test("init: an existing `prepare` script gets temple-bar's command chained after it", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "widgets",
      scripts: { prepare: "husky install" },
    }),
  });
  const fixture = makeFixture({ fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 0);
  const pkg = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts.prepare, `husky install && ${PREPARE_SCRIPT}`);
  assert.equal(pkg.scripts.gate, GATE_SCRIPT);
  assert.match(fixture.stdout.lines.join(""), /Updated package\.json\./);
});

void test("init: a `prepare` script that `&&` can't follow is left alone and the run ends non-zero", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "widgets",
      scripts: { prepare: "husky install # hooks" },
    }),
  });
  const fixture = makeFixture({ fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  const pkg = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts.prepare, "husky install # hooks");
  const stderr = fixture.stderr.lines.join("");
  assert.match(stderr, /can't safely have temple-bar's command chained/);
  assert.match(stderr, / && temple-bar hook install/);
  assert.doesNotMatch(
    stderr,
    /Add this yourself/,
    "must not tell the project to throw away its own prepare command",
  );
});

void test("init: a `gate` script that isn't temple-bar's still gets the add-this-yourself message", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "widgets",
      scripts: { prepare: PREPARE_SCRIPT, gate: "vitest" },
    }),
  });
  const fixture = makeFixture({ fs });
  assert.equal(await runInitFor(fixture), 1);
  assert.match(
    fixture.stderr.lines.join(""),
    new RegExp(`Add this yourself: "gate": "${RegExp.escape(GATE_SCRIPT)}"`),
  );
});

void test("init: an existing AGENTS.md keeps its text and gains temple-bar's block", async () => {
  const fs = createFakeFs({ "/repo/AGENTS.md": "# custom rules\n" });
  const fixture = makeFixture({ fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 0);
  assert.equal(
    fs.files.get("/repo/AGENTS.md"),
    `# custom rules\n\n${templeBarBlock()}`,
  );
  assert.equal(
    fs.writes.filter((w) => w.path === normalize("/repo/AGENTS.md")).length,
    1,
  );
});

void test("init: a ruleset offer of 'yes' creates the ruleset", async () => {
  const fixture = makeFixture({ gh: createFakeGh(noRulesetGhScript) }, "yes");
  const code = await runInitFor(fixture);
  assert.equal(code, 0);
  assert.match(
    fixture.stdout.lines.join(""),
    /Created the "main: pull requests only" and "main: the judge" rulesets/,
  );
});

void test("init: a ruleset offer of 'no' prints the manual settings and continues", async () => {
  const fixture = makeFixture({ gh: createFakeGh(noRulesetGhScript) }, "no");
  const code = await runInitFor(fixture);
  assert.equal(code, 0);
  assert.match(fixture.stdout.lines.join(""), /Settings > Rules > Rulesets/);
});

void test("init: no terminal and no ruleset finishes the local setup but ends non-zero", async () => {
  const fs = createFakeFs();
  const fixture = makeFixture({ gh: createFakeGh(noRulesetGhScript), fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.match(fixture.stderr.lines.join(""), /Settings > Rules > Rulesets/);
  assert.doesNotMatch(fixture.stdout.lines.join(""), /temple-bar is set up/);
  assert.ok(fs.files.get("/repo/AGENTS.md"), "local setup still runs");
  assert.equal(fixture.hookCalls.calls, 1);
});

void test("init: an invalid package.json is left alone and the run ends non-zero with the fix", async () => {
  const fs = createFakeFs({ "/repo/package.json": "{ not json" });
  const fixture = makeFixture({ fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.files.get("/repo/package.json"), "{ not json");
  assert.match(fixture.stderr.lines.join(""), /isn't a valid JSON object/);
});

void test("init: hook install conflicts make the final exit code non-zero", async () => {
  const command = createInitCommand({
    installHooks: () =>
      Promise.resolve({
        items: [
          {
            item: ".git/hooks/pre-commit",
            status: "conflict",
            detail: "an existing file's content differs",
          },
        ],
        hasConflicts: true,
      }),
  });
  const fixture = makeFixture();
  const code = await command.run([], fixture.ctx);
  assert.equal(code, 1);
  assert.match(fixture.stderr.lines.join(""), /\.git\/hooks\/pre-commit/);
});

const emptyRepo = () => newWorld({ commit: undefined, history: [] });

void test("init: in an empty repo, yes puts .gitignore in the first commit and installs hooks only afterwards", async () => {
  const world = emptyRepo();
  const fs = createFakeFs();
  const fixture = worldFixture(world, "yes", { fs });
  const commitSawGitignore: boolean[] = [];
  const base = fixture.ctx.git;
  const ctx = {
    ...fixture.ctx,
    git: {
      run: (args: readonly string[], cwd: string) => {
        if (args[0] === "commit") {
          commitSawGitignore.push(
            (fs.files.get("/repo/.gitignore") ?? "").includes("node_modules/"),
          );
          assert.equal(fixture.hookCalls.calls, 0, "hooks would refuse it");
        }
        return base.run(args, cwd);
      },
    },
  };
  const code = await runInitFor({ ...fixture, ctx }, ["--owner", "acme"]);
  assert.equal(code, 0);
  assert.deepEqual(commitSawGitignore, [true]);
  assert.equal(fixture.hookCalls.calls, 1);
  assert.ok(world.calls.includes("git add -A"));
});

void test("init: in an empty repo, a commit that can't be made stops before the hooks and names the command", async () => {
  const world = emptyRepo();
  world.commitAnswer = { code: 1, stdout: "", stderr: "gpg failed to sign" };
  const fixture = worldFixture(world, "yes", { fs: createFakeFs() });
  const code = await runInitFor(fixture, ["--owner", "acme"]);
  assert.equal(code, 1);
  assert.equal(fixture.hookCalls.calls, 0);
  const stderr = fixture.stderr.lines.join("");
  assert.match(stderr, /git commit -m "Initial commit"/);
  assert.match(stderr, /--create-repo --owner acme --identities [0-9a-f]{12}/);
});

void test("init: in an empty repo, no changes nothing on GitHub and writes only .gitignore", async () => {
  const world = emptyRepo();
  const fs = createFakeFs();
  const fixture = worldFixture(world, "no", { fs });
  const code = await runInitFor(fixture, ["--owner", "acme"]);
  assert.equal(code, 1);
  // Only .gitignore: node_modules/ is already there by now, so it must
  // be ignored even when setup stops here.
  assert.deepEqual(
    fs.writes.map((w) => w.path),
    [normalize("/repo/.gitignore")],
  );
  assert.ok(!world.calls.some((c) => c.startsWith("gh repo")));
  assert.ok(!world.calls.some((c) => c.startsWith("git commit")));
});

void test("init: records origin's default branch so the hooks protect it", async () => {
  const git = createFakeGit(defaultGitScript);
  const ctx = createFakeContext({
    git,
    gh: createFakeGh(defaultGhScript),
    prompt: createFakePrompt({ interactive: false, answer: "no-terminal" }),
    fs: createFakeFs({}),
  });
  await createInitCommand({
    installHooks: () => Promise.resolve(unchangedReport),
  }).run([], ctx);
  assert.ok(
    git.calls.some(
      (call) => call.args.join(" ") === "remote set-head origin --auto",
    ),
    "init must record origin/HEAD",
  );
});

void test("init: the commit setup's next steps suggest passes the commit-msg hook setup installs", () => {
  assert.equal(isConventionalSubject(SETUP_COMMIT_MESSAGE), true);
});
