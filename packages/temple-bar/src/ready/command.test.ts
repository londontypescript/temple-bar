// Unit tests for `temple-bar ready` with fake git and fs, and a gate whose
// result each test chooses. The real-git version, with the real gate and
// the real pre-push hook, is ready.integration.test.ts.

import assert from "node:assert/strict";
import test from "node:test";

import type { GitResult } from "../seams/git.ts";
import type { PromptSeam } from "../seams/prompt.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeWriter,
} from "../testing/fakes.ts";
import { fakeTreeReads } from "../testing/git-trees.ts";
import { createReadyCommand } from "./command.ts";

const HEAD = "c".repeat(40);
const LATER = "d".repeat(40);
const MARK_FILE = "/repo/.git/temple-bar-ready";

interface Scenario {
  /** `git status --porcelain` output; clean by default. */
  status?: string;
  /** Files the branch changes compared with origin/main. */
  changed?: string[];
  /** Exit code the gate returns; 0 by default. */
  gate?: number;
  /** HEAD after the gate has run, when it moved meanwhile. */
  headAfterGate?: string;
  /** `git status --porcelain` once the gate has run, when it changed files. */
  statusAfterGate?: string;
  /** origin/main isn't known in this clone. */
  noUpstream?: boolean;
  /** package.json where the branch left origin/main, and at HEAD. */
  manifests?: { readonly base: object; readonly head: object };
  /** Commits on origin's default branch that HEAD lacks; 0 by default. */
  behind?: number;
  /** git's stderr when fetching the default branch fails. */
  fetchError?: string;
  /** Counting how far HEAD is behind fails. */
  countFails?: boolean;
  /** Where origin/HEAD points; main by default. */
  defaultBranch?: string;
}

function setup(scenario: Scenario = {}) {
  const ok = (out = ""): GitResult => ({ code: 0, stdout: out, stderr: "" });
  let gateRan = 0;
  // Each changed file has different text on each side; package.json is the
  // scenario's own where it gives one.
  const changed = scenario.changed ?? ["src/a.ts"];
  const treeReads = fakeTreeReads((commit) => {
    const atHead = commit === HEAD;
    const files = new Map(
      changed.map((file) => [file, atHead ? "after" : "before"]),
    );
    if (scenario.manifests !== undefined) {
      const manifest = atHead
        ? scenario.manifests.head
        : scenario.manifests.base;
      files.set("package.json", JSON.stringify(manifest));
    }
    return Object.fromEntries(files);
  });
  const git = createFakeGit((args) => {
    const read = treeReads(args);
    if (read !== undefined) {
      return read;
    }
    const joined = args.join(" ");
    if (joined === "rev-parse --show-toplevel") {
      return ok("/repo\n");
    }
    if (joined === "rev-parse --git-path temple-bar-ready") {
      return ok(".git/temple-bar-ready\n");
    }
    if (joined === "rev-parse --verify --quiet HEAD^{commit}") {
      return ok(
        `${gateRan > 0 && scenario.headAfterGate !== undefined ? scenario.headAfterGate : HEAD}\n`,
      );
    }
    if (joined.startsWith("rev-parse --verify --quiet refs/remotes/origin/")) {
      return scenario.noUpstream === true
        ? { code: 1, stdout: "", stderr: "" }
        : ok("e".repeat(40));
    }
    if (args[0] === "merge-base") {
      return ok(`${"b".repeat(40)}\n`);
    }
    if (args[0] === "status") {
      return ok(
        (gateRan > 0 ? scenario.statusAfterGate : undefined) ??
          scenario.status ??
          "",
      );
    }
    if (args[0] === "symbolic-ref") {
      return ok(`refs/remotes/origin/${scenario.defaultBranch ?? "main"}\n`);
    }
    if (args[0] === "fetch") {
      return scenario.fetchError === undefined
        ? ok()
        : { code: 128, stdout: "", stderr: `${scenario.fetchError}\n` };
    }
    if (args[0] === "rev-list") {
      return scenario.countFails === true
        ? { code: 128, stdout: "", stderr: "fatal: bad revision\n" }
        : ok(`${String(scenario.behind ?? 0)}\n`);
    }
    if (args[0] === "diff") {
      return ok(changed.map((file) => `${file}\0`).join(""));
    }
    return { code: 1, stdout: "", stderr: "" };
  });
  const fs = createFakeFs({ [MARK_FILE]: `${"0".repeat(39)}1\n` });
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  // ready never asks anything in the terminal, so any use of the prompt is
  // counted, and each test checks the count stays at zero.
  let promptUses = 0;
  const prompt: PromptSeam = {
    isInteractive: () => {
      promptUses += 1;
      return true;
    },
    confirm: () => {
      promptUses += 1;
      return Promise.resolve("yes");
    },
  };
  const ctx = createFakeContext({ git, fs, prompt, stdout, stderr });
  const command = createReadyCommand(() => {
    gateRan += 1;
    return Promise.resolve(scenario.gate ?? 0);
  });
  return {
    run: () => command.run([], ctx),
    mark: () => fs.files.get(MARK_FILE),
    gateRuns: () => gateRan,
    gitCalls: (command: string) =>
      git.calls.filter((call) => call.args[0] === command).map((c) => c.args),
    promptUses: () => promptUses,
    stdout,
    stderr,
  };
}

void test("ready: a clean commit that passes the gate is marked", async () => {
  const t = setup();
  assert.equal(await t.run(), 0);
  assert.equal(t.mark(), `${HEAD}\n`);
  assert.match(
    t.stdout.lines.join(""),
    /ccccccc passed the gate and is marked/,
  );
});

void test("ready: a failing gate leaves nothing marked, not even an older mark", async () => {
  const t = setup({ gate: 1 });
  assert.equal(await t.run(), 1);
  assert.equal(t.mark(), "");
  assert.match(
    t.stderr.lines.join(""),
    /ready: the gate did not pass, so ccccccc is not marked ready to push\.\nFix what it reported, commit, and run ready again\./,
  );
});

void test("ready: uncommitted or untracked files are refused before the gate runs", async () => {
  const t = setup({ status: " M src/a.ts\n?? src/new.ts\n" });
  assert.equal(await t.run(), 1);
  assert.equal(t.gateRuns(), 0);
  assert.equal(t.mark(), "");
  const out = t.stderr.lines.join("");
  assert.match(out, /changes that aren't committed/);
  assert.match(out, /\?\? src\/new\.ts/);
  assert.match(out, /Commit them/);
});

void test("ready: a commit that moved while the gate ran is not marked", async () => {
  const t = setup({ headAfterGate: LATER });
  assert.equal(await t.run(), 1);
  assert.equal(t.mark(), "");
  assert.match(t.stderr.lines.join(""), /changed while the gate ran/);
});

void test("ready: files the gate changed while it ran leave the commit unmarked", async () => {
  const t = setup({ statusAfterGate: " M src/a.ts\n" });
  assert.equal(await t.run(), 1);
  assert.equal(t.gateRuns(), 1);
  assert.equal(t.mark(), "");
  assert.equal(
    t.stderr.lines.join(""),
    "ready: the worktree has changes that aren't committed, so the gate would judge files the push won't carry:\n" +
      "   M src/a.ts\n" +
      "Commit them (or remove what doesn't belong), then run ready again.\n",
  );
});

void test("ready: an AGENTS.md change is marked, with a warning to ask the maintainer in chat and no prompt", async () => {
  const t = setup({ changed: ["AGENTS.md", "src/a.ts"] });
  assert.equal(await t.run(), 0);
  assert.equal(t.gateRuns(), 1);
  assert.equal(t.mark(), `${HEAD}\n`);
  assert.equal(t.promptUses(), 0, "ready asks nothing in the terminal");
  assert.equal(
    t.stderr.lines.join(""),
    "ready: warning: ccccccc needs the maintainer's yes before it is pushed: changes AGENTS.md.\n" +
      "Ask the maintainer in chat, and push only once they say yes.\n",
  );
});

void test("ready: a nested AGENTS.md is warned about too", async () => {
  const t = setup({ changed: ["docs/AGENTS.md"] });
  assert.equal(await t.run(), 0);
  assert.match(t.stderr.lines.join(""), /changes docs\/AGENTS\.md\./);
});

void test("ready: a failing gate on an AGENTS.md change refuses, without the warning", async () => {
  const t = setup({ changed: ["AGENTS.md"], gate: 1 });
  assert.equal(await t.run(), 1);
  const out = t.stderr.lines.join("");
  assert.match(out, /the gate did not pass/);
  assert.doesNotMatch(out, /maintainer/);
});

// The same list the judge guards, from the judge's own code: a change
// that only the maintainer can merge is one they hear about before it's
// pushed.
void test("ready: a change to a CI workflow is warned about, naming it", async () => {
  const t = setup({ changed: [".github/workflows/ci.yml", "src/a.ts"] });
  assert.equal(await t.run(), 0);
  assert.equal(t.promptUses(), 0);
  assert.match(
    t.stderr.lines.join(""),
    /needs the maintainer's yes before it is pushed: changes the checks that judge it \(\.github\/workflows\/ci\.yml \(modified\)\)/,
  );
});

void test("ready: a changed pin or gate script is warned about, naming each", async () => {
  const pin = "@londontypescript/temple-bar";
  const t = setup({
    changed: ["package.json"],
    manifests: {
      base: {
        scripts: { lint: "eslint ." },
        devDependencies: { [pin]: "0.0.6" },
      },
      head: { scripts: { lint: "true" }, devDependencies: { [pin]: "0.0.7" } },
    },
  });
  assert.equal(await t.run(), 0);
  const out = t.stderr.lines.join("");
  assert.match(
    out,
    /the temple-bar version in devDependencies\["@londontypescript\/temple-bar"\] \("0\.0\.6" on the base branch, "0\.0\.7" here\)/,
  );
  assert.match(out, /package\.json: the "lint" script/);
});

void test("ready: any script is warned about, a nested package's too", async () => {
  const t = setup({
    changed: ["package.json", "packages/a/package.json"],
    manifests: {
      base: { scripts: { build: "tsc" } },
      head: { scripts: { build: "tsc -b" } },
    },
  });
  assert.equal(await t.run(), 0);
  const out = t.stderr.lines.join("");
  assert.match(out, /package\.json: the "build" script/);
  // The nested manifest is plain text on each side here, so invalid at
  // the head: named, never passed.
  assert.match(out, /packages\/a\/package\.json isn't valid JSON here/);
});

void test("ready: a package.json change outside the checks is not warned about", async () => {
  const t = setup({
    changed: ["package.json"],
    manifests: {
      base: { scripts: { build: "tsc" }, dependencies: { zod: "4.0.0" } },
      head: { scripts: { build: "tsc" }, dependencies: { zod: "4.1.0" } },
    },
  });
  assert.equal(await t.run(), 0);
  assert.equal(t.stderr.lines.length, 0);
});

void test("ready: an ordinary change prints no warning", async () => {
  const t = setup();
  assert.equal(await t.run(), 0);
  assert.equal(t.mark(), `${HEAD}\n`);
  assert.equal(t.stderr.lines.length, 0);
  assert.equal(t.promptUses(), 0);
});

void test("ready: with no origin default branch to compare with, says to fetch", async () => {
  const t = setup({ noUpstream: true });
  assert.equal(await t.run(), 1);
  assert.equal(t.gateRuns(), 0);
  assert.match(t.stderr.lines.join(""), /Run git fetch origin/);
});

void test("ready: a branch behind the default branch is refused before the gate, saying how far and how to catch up", async () => {
  for (const [behind, commits] of [
    [1, "1 commit"],
    [3, "3 commits"],
  ] as const) {
    const t = setup({ behind });
    assert.equal(await t.run(), 1);
    assert.equal(t.gateRuns(), 0, "the gate never runs");
    assert.equal(t.mark(), "", "an older mark is cleared, nothing new marked");
    assert.equal(
      t.stderr.lines.join(""),
      `ready: this branch is ${commits} behind origin/main: merge it in (git merge origin/main), then run ready again.\n`,
    );
  }
});

void test("ready: a failed fetch stops before the gate, with git's reason, rather than trusting an old ref", async () => {
  const t = setup({
    fetchError: "fatal: could not read from remote repository",
  });
  assert.equal(await t.run(), 1);
  assert.equal(t.gateRuns(), 0);
  assert.equal(t.mark(), "");
  const out = t.stderr.lines.join("");
  assert.match(
    out,
    /could not fetch main from origin, so ready can't tell whether this branch is behind it:\nfatal: could not read from remote repository\n/,
  );
  assert.match(out, /git remote set-head origin --auto/);
  assert.equal(t.gitCalls("rev-list").length, 0, "nothing counted after it");
});

void test("ready: fetches the default branch alone, without tags, into its remote-tracking ref", async () => {
  const t = setup();
  assert.equal(await t.run(), 0, t.stderr.lines.join(""));
  assert.deepEqual(t.gitCalls("fetch"), [
    [
      "fetch",
      "--quiet",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ],
  ]);
  assert.deepEqual(t.gitCalls("rev-list"), [
    ["rev-list", "--count", `${HEAD}..refs/remotes/origin/main`],
  ]);
});

void test("ready: with origin/HEAD at master, fetches and compares with master", async () => {
  const t = setup({ defaultBranch: "master", behind: 2 });
  assert.equal(await t.run(), 1);
  assert.deepEqual(t.gitCalls("fetch"), [
    [
      "fetch",
      "--quiet",
      "--no-tags",
      "origin",
      "+refs/heads/master:refs/remotes/origin/master",
    ],
  ]);
  assert.deepEqual(t.gitCalls("rev-list"), [
    ["rev-list", "--count", `${HEAD}..refs/remotes/origin/master`],
  ]);
  assert.match(
    t.stderr.lines.join(""),
    /2 commits behind origin\/master: merge it in \(git merge origin\/master\)/,
  );
});

void test("ready: a count that fails stops before the gate, nothing marked", async () => {
  const t = setup({ countFails: true });
  assert.equal(await t.run(), 1);
  assert.equal(t.gateRuns(), 0);
  assert.equal(t.mark(), "");
  assert.match(
    t.stderr.lines.join(""),
    /could not count how far this branch is behind origin\/main, so it is not marked: fatal: bad revision/,
  );
});
