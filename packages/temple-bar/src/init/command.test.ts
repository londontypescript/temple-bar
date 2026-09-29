import assert from "node:assert/strict";
import test from "node:test";

import { createInitCommand } from "./command.ts";
import { GATE_SCRIPT, PREPARE_SCRIPT } from "./files.ts";
import type { InstallReport } from "../hooks/install.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGh,
  createFakeGit,
  createFakePrompt,
  createFakeWriter,
  type FakeWriter,
} from "../testing/fakes.ts";
import type { Context } from "../context.ts";
import type { GhResult } from "../seams/gh.ts";
import type { GitResult } from "../seams/git.ts";
import type { ConfirmResult } from "../seams/prompt.ts";

function defaultGitScript(args: readonly string[]): GitResult {
  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
    return { code: 0, stdout: "/repo\n", stderr: "" };
  }
  if (args[0] === "rev-parse" && args[1] === "HEAD") {
    return { code: 0, stdout: "abc123\n", stderr: "" };
  }
  if (args[0] === "remote") {
    return { code: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" };
  }
  return { code: 0, stdout: "", stderr: "" };
}

function defaultGhScript(args: readonly string[]): GhResult {
  if (args[0] === "--version") {
    return { code: 0, stdout: "gh 2.0.0", stderr: "", notFound: false };
  }
  if (args[0] === "auth") {
    return { code: 0, stdout: "", stderr: "", notFound: false };
  }
  if (args.includes("POST")) {
    return { code: 0, stdout: "", stderr: "", notFound: false };
  }
  // The usual state: main is already protected (a real second run, or a
  // repo set up by hand), so most tests aren't about the ruleset at all.
  if (args.some((a) => a.endsWith("/rulesets"))) {
    return {
      code: 0,
      stdout: '[{"target":"branch"}]',
      stderr: "",
      notFound: false,
    };
  }
  return { code: 0, stdout: "", stderr: "", notFound: false };
}

/** Like defaultGhScript, but GitHub has no ruleset yet. */
function noRulesetGhScript(args: readonly string[]): GhResult {
  if (args.some((a) => a.endsWith("/rulesets")) && !args.includes("POST")) {
    return { code: 0, stdout: "[]", stderr: "", notFound: false };
  }
  return defaultGhScript(args);
}

const installedReport: InstallReport = {
  items: [{ item: ".githooks/pre-commit", status: "written" }],
  hasConflicts: false,
};

const unchangedReport: InstallReport = {
  items: [{ item: ".githooks/pre-commit", status: "unchanged" }],
  hasConflicts: false,
};

const fakeInstallHooks =
  (installed: { calls: number }) => (): Promise<InstallReport> => {
    installed.calls += 1;
    return Promise.resolve(installedReport);
  };

interface Fixture {
  readonly ctx: Context;
  readonly hookCalls: { calls: number };
  readonly stdout: FakeWriter;
  readonly stderr: FakeWriter;
}

function makeFixture(
  overrides: Partial<Context> = {},
  promptAnswer: ConfirmResult = "no-terminal",
): Fixture {
  const hookCalls = { calls: 0 };
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const ctx = createFakeContext({
    git: createFakeGit(defaultGitScript),
    gh: createFakeGh(defaultGhScript),
    prompt: createFakePrompt({
      interactive: promptAnswer !== "no-terminal",
      answer: promptAnswer,
    }),
    fs: createFakeFs(),
    stdout,
    stderr,
    ...overrides,
  });
  return { ctx, hookCalls, stdout, stderr };
}

async function runInitFor(fixture: Fixture): Promise<number> {
  const command = createInitCommand({
    installHooks: fakeInstallHooks(fixture.hookCalls),
  });
  return command.run([], fixture.ctx);
}

void test("init: name is 'init'", () => {
  const command = createInitCommand({
    installHooks: () => Promise.resolve(unchangedReport),
  });
  assert.equal(command.name, "init");
});

void test("init: a new empty repo with no commits stops safely, writing nothing", async () => {
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote") {
      return { code: 1, stdout: "", stderr: "no such remote" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 128, stdout: "", stderr: "unknown revision" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs }, "yes");
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.equal(fixture.hookCalls.calls, 0);
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
  const fs = createFakeFs({
    "/repo/AGENTS.md": "# already set up\n",
    "/repo/package.json": JSON.stringify({
      name: "widgets",
      scripts: { prepare: PREPARE_SCRIPT, gate: GATE_SCRIPT },
    }),
  });
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

void test("init: not a git repo stops with the exact fix, writing nothing", async () => {
  const git = createFakeGit(() => ({
    code: 128,
    stdout: "",
    stderr: "not a repo",
  }));
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.match(fixture.stderr.lines.join(""), /git init/);
});

void test("init: gh not installed stops with the exact fix, writing nothing", async () => {
  const gh = createFakeGh((args) =>
    args[0] === "--version"
      ? { code: null, stdout: "", stderr: "", notFound: true }
      : { code: 0, stdout: "", stderr: "", notFound: false },
  );
  const fs = createFakeFs();
  const fixture = makeFixture({ gh, fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.match(fixture.stderr.lines.join(""), /cli\.github\.com/);
});

void test("init: gh not signed in stops with the exact fix, writing nothing", async () => {
  const gh = createFakeGh((args) => {
    if (args[0] === "--version")
      return { code: 0, stdout: "", stderr: "", notFound: false };
    if (args[0] === "auth")
      return { code: 1, stdout: "", stderr: "not logged in", notFound: false };
    return { code: 0, stdout: "", stderr: "", notFound: false };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ gh, fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.match(fixture.stderr.lines.join(""), /gh auth login/);
});

void test("init: origin pointing at a non-GitHub host stops with the exact fix, writing nothing", async () => {
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote") {
      return {
        code: 0,
        stdout: "https://gitlab.com/acme/widgets\n",
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
  assert.match(fixture.stderr.lines.join(""), /doesn't point at GitHub/);
});

void test("init: repo creation declined with 'no' stops, writing nothing", async () => {
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote") {
      return { code: 1, stdout: "", stderr: "no such remote" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs }, "no");
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
});

void test("init: repo creation declined because there's no terminal stops, writing nothing", async () => {
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "remote") {
      return { code: 1, stdout: "", stderr: "no such remote" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ git, fs }, "no-terminal");
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  assert.equal(fs.writes.length, 0);
});

void test("init: repo creation accepted with 'yes' and commits present proceeds to write files", async () => {
  let getUrlCalls = 0;
  const gitWithCreation = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 0, stdout: "abc123\n", stderr: "" };
    }
    if (args[0] === "remote") {
      getUrlCalls += 1;
      if (getUrlCalls === 1) {
        return { code: 1, stdout: "", stderr: "no such remote" };
      }
      return {
        code: 0,
        stdout: "git@github.com:acme/widgets.git\n",
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const fs = createFakeFs();
  const fixture = makeFixture({ git: gitWithCreation, fs }, "yes");
  const code = await runInitFor(fixture);
  assert.equal(code, 0);
  assert.ok(fs.files.get("/repo/AGENTS.md"));
});

void test("init: an existing different `prepare` script is left alone and the run ends non-zero", async () => {
  const fs = createFakeFs({
    "/repo/package.json": JSON.stringify({
      name: "widgets",
      scripts: { prepare: "husky install" },
    }),
  });
  const fixture = makeFixture({ fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 1);
  const pkg = JSON.parse(fs.files.get("/repo/package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts.prepare, "husky install");
  assert.equal(pkg.scripts.gate, GATE_SCRIPT);
  assert.match(
    fixture.stderr.lines.join(""),
    new RegExp(PREPARE_SCRIPT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

void test("init: an existing AGENTS.md is left untouched", async () => {
  const fs = createFakeFs({ "/repo/AGENTS.md": "# custom rules\n" });
  const fixture = makeFixture({ fs });
  const code = await runInitFor(fixture);
  assert.equal(code, 0);
  assert.equal(fs.files.get("/repo/AGENTS.md"), "# custom rules\n");
  assert.equal(
    fs.writes.some((w) => w.path === "/repo/AGENTS.md"),
    false,
  );
});

void test("init: a ruleset offer of 'yes' creates the ruleset", async () => {
  const fixture = makeFixture({ gh: createFakeGh(noRulesetGhScript) }, "yes");
  const code = await runInitFor(fixture);
  assert.equal(code, 0);
  assert.match(fixture.stdout.lines.join(""), /Created the `main` ruleset/);
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
            item: ".githooks/pre-commit",
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
  assert.match(fixture.stderr.lines.join(""), /\.githooks\/pre-commit/);
});
