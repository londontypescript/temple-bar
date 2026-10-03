// Unit tests for `temple-bar ready` with fake git, fs and prompt, and a gate
// whose result each test chooses. The real-git version, with the real gate
// and the real pre-push hook, is ready.integration.test.ts.

import assert from "node:assert/strict";
import test from "node:test";

import type { GitResult } from "../seams/git.ts";
import type { ConfirmResult } from "../seams/prompt.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakePrompt,
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
  /** A terminal is attached, and what the user answers. */
  terminal?: ConfirmResult;
  /** HEAD after the gate has run, when it moved meanwhile. */
  headAfterGate?: string;
  /** origin/main isn't known in this clone. */
  noUpstream?: boolean;
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
    if (args[0] === "status") {
      return ok(scenario.status ?? "");
    }
    if (args[0] === "symbolic-ref") {
      return ok("refs/remotes/origin/main\n");
    }
    if (args[0] === "diff") {
      return ok((scenario.changed ?? ["src/a.ts"]).join("\n"));
    }
    return { code: 1, stdout: "", stderr: "" };
  });
  const fs = createFakeFs({ [MARK_FILE]: `${"0".repeat(39)}1\n` });
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const prompt =
    scenario.terminal === undefined
      ? createFakePrompt()
      : createFakePrompt({ interactive: true, answer: scenario.terminal });
  const ctx = createFakeContext({ git, fs, prompt, stdout, stderr });
  const command = createReadyCommand(() => {
    gateRan += 1;
    return Promise.resolve(scenario.gate ?? 0);
  });
  return {
    run: () => command.run([], ctx),
    mark: () => fs.files.get(MARK_FILE),
    gateRuns: () => gateRan,
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

void test("ready: an AGENTS.md change with no terminal says to ask the user, before running the gate", async () => {
  const t = setup({ changed: ["AGENTS.md", "src/a.ts"] });
  assert.equal(await t.run(), 1);
  assert.equal(t.gateRuns(), 0);
  assert.equal(t.mark(), "");
  const out = t.stderr.lines.join("");
  assert.match(
    out,
    /needs the user's yes before it is pushed: it changes AGENTS\.md/,
  );
  assert.match(
    out,
    /Ask the user to run `temple-bar ready` themselves, in a terminal, in \/repo\./,
  );
});

void test("ready: an AGENTS.md change is marked once the user types yes", async () => {
  const t = setup({ changed: ["AGENTS.md"], terminal: "yes" });
  assert.equal(await t.run(), 0);
  assert.equal(t.mark(), `${HEAD}\n`);
});

void test("ready: an AGENTS.md change the user says no to is not marked", async () => {
  const t = setup({ changed: ["docs/AGENTS.md"], terminal: "no" });
  assert.equal(await t.run(), 1);
  assert.equal(t.mark(), "");
  assert.match(t.stderr.lines.join(""), /the user did not agree/);
});

void test("ready: an ordinary change never asks, even with a terminal", async () => {
  // "no" would refuse if it were asked, so a pass shows it wasn't.
  const t = setup({ terminal: "no" });
  assert.equal(await t.run(), 0);
  assert.equal(t.mark(), `${HEAD}\n`);
});

void test("ready: with no origin default branch to compare with, says to fetch", async () => {
  const t = setup({ noUpstream: true });
  assert.equal(await t.run(), 1);
  assert.equal(t.gateRuns(), 0);
  assert.match(t.stderr.lines.join(""), /Run git fetch origin/);
});
