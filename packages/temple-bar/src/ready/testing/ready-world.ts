// A `ready` run against fake git and fs, with a gate whose result each test
// chooses. Shared by the unit tests of ready's command and of its size
// warning; the real-git version is ready.integration.test.ts.

import type { GitResult } from "../../seams/git.ts";
import type { PromptSeam } from "../../seams/prompt.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeWriter,
} from "../../testing/fakes.ts";
import { fakeTreeReads } from "../../testing/git-trees.ts";
import { createReadyCommand } from "../command.ts";

export const HEAD = "c".repeat(40);
export const LATER = "d".repeat(40);
const MARK_FILE = "/repo/.git/temple-bar-ready";

export interface Scenario {
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
  /** Lines changed per file, as `git diff --numstat` measures the branch;
   * one line for each of `changed` by default. */
  lines?: Record<string, number>;
  /** git's stderr when measuring the branch's size fails. */
  measureError?: string;
  /** temple-bar.config.json at the worktree's root, when there is one. */
  config?: object;
}

// `git diff --numstat -z`, as pr/diff.ts reads it to size the branch.
function measure(scenario: Scenario, changed: readonly string[]): GitResult {
  if (scenario.measureError !== undefined) {
    return { code: 128, stdout: "", stderr: `${scenario.measureError}\n` };
  }
  const lines =
    scenario.lines ?? Object.fromEntries(changed.map((file) => [file, 1]));
  const stdout = Object.entries(lines)
    .map(([file, count]) => `${String(count)}\t0\t${file}\0`)
    .join("");
  return { code: 0, stdout, stderr: "" };
}

export function setup(scenario: Scenario = {}) {
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
    if (args[0] === "diff" && args.includes("--numstat")) {
      return measure(scenario, changed);
    }
    if (args[0] === "check-attr") {
      return ok();
    }
    if (args[0] === "diff") {
      return ok(changed.map((file) => `${file}\0`).join(""));
    }
    return { code: 1, stdout: "", stderr: "" };
  });
  const fs = createFakeFs({
    [MARK_FILE]: `${"0".repeat(39)}1\n`,
    ...(scenario.config === undefined
      ? {}
      : { "/repo/temple-bar.config.json": JSON.stringify(scenario.config) }),
  });
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
