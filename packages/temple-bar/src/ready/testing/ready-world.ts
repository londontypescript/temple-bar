// A `ready` run against fake git and fs, with a gate whose result each test
// chooses. Shared by the unit tests of ready's command and of its size
// warning; the real-git version is ready.integration.test.ts.

import type { GitResult } from "../../seams/git.ts";
import type { PromptSeam } from "../../seams/prompt.ts";
import {
  createFakeContext,
  createFakeFs,
  createFakeGh,
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
  /** temple-bar.config.json in the branch's worktree, when there is one. */
  config?: object;
  /** temple-bar.config.json in the primary checkout, when there is one. */
  primaryConfig?: object;
  /** Files the branch's own .gitattributes marks linguist-generated; the
   * primary checkout marks none. */
  generatedInBranch?: string[];
  /** `git worktree list` fails, so the primary checkout can't be found. */
  worktreeListFails?: boolean;
  /** A pull request `gh pr view` would return for this branch. */
  pullRequestBody?: string;
}

/** The primary checkout, which stays on the default branch. */
export const PRIMARY = "/primary";

const WORKTREE_LIST =
  `worktree ${PRIMARY}\nHEAD ${"e".repeat(40)}\nbranch refs/heads/main\n\n` +
  `worktree /repo\nHEAD ${HEAD}\nbranch refs/heads/feat\n`;

// `git check-attr -z linguist-generated`: "path\0attribute\0value\0" each.
function checkAttr(
  scenario: Scenario,
  args: readonly string[],
  cwd: string,
): GitResult {
  const generated = cwd === PRIMARY ? [] : (scenario.generatedInBranch ?? []);
  const paths = args.slice(args.indexOf("--") + 1);
  const stdout = paths
    .map(
      (file) =>
        `${file}\0linguist-generated\0${generated.includes(file) ? "set" : "unspecified"}\0`,
    )
    .join("");
  return { code: 0, stdout, stderr: "" };
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
  const git = createFakeGit((args, cwd) => {
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
      return checkAttr(scenario, args, cwd);
    }
    if (joined === "worktree list --porcelain") {
      return scenario.worktreeListFails === true
        ? { code: 128, stdout: "", stderr: "fatal: not a git repository\n" }
        : ok(WORKTREE_LIST);
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
    ...(scenario.primaryConfig === undefined
      ? {}
      : {
          [`${PRIMARY}/temple-bar.config.json`]: JSON.stringify(
            scenario.primaryConfig,
          ),
        }),
  });
  const gh = createFakeGh(() =>
    scenario.pullRequestBody === undefined
      ? { code: 1, stdout: "", stderr: "no pull request", notFound: false }
      : {
          code: 0,
          stdout: JSON.stringify({
            title: "feat: a change",
            body: scenario.pullRequestBody,
            url: "https://github.com/o/r/pull/1",
          }),
          stderr: "",
          notFound: false,
        },
  );
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
  const ctx = createFakeContext({ git, gh, fs, prompt, stdout, stderr });
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
    /** Every git call, with the folder it ran in. */
    gitLog: () => git.calls,
    ghCalls: () => gh.calls,
    promptUses: () => promptUses,
    stdout,
    stderr,
  };
}
