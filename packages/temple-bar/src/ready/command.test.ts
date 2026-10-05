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
  /** origin/main isn't known in this clone. */
  noUpstream?: boolean;
  /** package.json where the branch left origin/main, and at HEAD. */
  manifests?: { readonly base: object; readonly head: object };
}

function setup(scenario: Scenario = {}) {
  const ok = (out = ""): GitResult => ({ code: 0, stdout: out, stderr: "" });
  let gateRan = 0;
  const git = createFakeGit((args) => {
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
      return ok(scenario.status ?? "");
    }
    if (args[0] === "symbolic-ref") {
      return ok("refs/remotes/origin/main\n");
    }
    if (args[0] === "show" && scenario.manifests !== undefined) {
      const side = args[1]?.startsWith(HEAD)
        ? scenario.manifests.head
        : scenario.manifests.base;
      return ok(JSON.stringify(side));
    }
    if (args[0] === "diff") {
      return ok((scenario.changed ?? ["src/a.ts"]).join("\n"));
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
    /needs the maintainer's yes before it is pushed: changes the checks that judge it \(\.github\/workflows\/ci\.yml \(changed\)\)/,
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

void test("ready: a package.json change outside the checks is not warned about", async () => {
  const t = setup({
    changed: ["package.json"],
    manifests: {
      base: { scripts: { build: "tsc" } },
      head: { scripts: { build: "tsc -b" } },
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
