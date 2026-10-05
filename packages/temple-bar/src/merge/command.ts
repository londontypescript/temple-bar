// `temple-bar merge <pr-number>`: the whole merge of one pull request.
// Exit codes: 0 merged and tidied up; 1 refused, or merged with something
// left to deal with (printed); 2 called wrongly.

import { setTimeout as delay } from "node:timers/promises";

import type { Context } from "../context.ts";
import type { CommandEntry } from "../registry.ts";
import { gateCommand } from "../gate/command.ts";
import { GUARDED_CHECKS } from "../judge/guarded-checks.ts";
import { runMerge, type MergeDeps } from "./run.ts";

interface ParsedArgs {
  readonly prNumber: number;
  readonly maintainerApproved: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs | string {
  let prNumber: number | undefined;
  let maintainerApproved = false;
  for (const arg of args) {
    if (arg === "--maintainer-approved") {
      maintainerApproved = true;
    } else if (/^#?\d+$/.test(arg) && prNumber === undefined) {
      prNumber = Number.parseInt(arg.replace("#", ""), 10);
    } else {
      return `unknown argument: ${arg}`;
    }
  }
  if (prNumber === undefined || prNumber <= 0) {
    return "give the pull request's number: temple-bar merge <pr-number>";
  }
  return { prNumber, maintainerApproved };
}

export const realMergeDeps: MergeDeps = {
  sleep: async (ms) => {
    await delay(ms);
  },
  runGate: (ctx) => gateCommand.run([], ctx),
};

export function createMergeCommand(deps: MergeDeps): CommandEntry {
  return {
    name: "merge",
    summary: "Wait for checks, then squash-merge a pull request and tidy up.",
    args: "<pr-number> [--maintainer-approved]",
    details: [
      "Blocks until done. Refuses a draft, closed or fork pull request, or",
      "one that doesn't target the default branch. When the branch is behind,",
      "merges the default branch into it in its worktree, runs the full gate",
      "there and marks the commit ready (as `temple-bar ready` does), then",
      "pushes (never a force push). A failing gate stops it before the push.",
      "Waits until GitHub shows the pushed commit as the head.",
      "",
      "Then prints what you are approving: each change that needs the",
      "maintainer's yes (such as a change to AGENTS.md), changes to the checking machinery",
      "(CI workflows, lint, format and TypeScript config, the gate's scripts,",
      "the hook install, the pinned temple-bar), dependencies added, removed",
      "or changed in major version, and the number of open incident issues.",
      "",
      "Then waits until the newest run of every check on the head commit has",
      "passed. Refuses while code-scanning alerts are open on the pull",
      "request or the default branch. Repeats the pull request size warning.",
      "If GitHub refuses the merge because it started new check runs (after",
      "a title or description edit), waits for those and tries again.",
      "",
      "The squash commit's subject is the title with (#N); its body is the",
      'description\'s top-level "- " bullets, if it has any, then each',
      "co-author once. Without bullets the title stands alone. A change",
      "merged with --maintainer-approved gets a `Maintainer-Approved:` line",
      "naming it, so `git log` shows the claim.",
      "Afterwards removes the worktree and the local branch, confirms the",
      "remote branch is gone, fast-forwards the default branch, and reports",
      "alerts on the default branch and leftovers.",
      "",
      "Refuses a change to the checks that judge the repository",
      `(${GUARDED_CHECKS}):`,
      "the judge fails it on purpose, and only the maintainer merges it, as",
      "a repository admin. No option changes that.",
      "",
      "Refuses a pull request that closes two or more issues unless its",
      "description has a line starting `One concern:` that says why they",
      "are one concern.",
      "",
      "Options:",
      "  --maintainer-approved  The maintainer already said yes in chat to a",
      "                         change to AGENTS.md. An agent passes it only",
      "                         after that yes. Without it, such a change is",
      "                         refused with the instruction to ask first.",
      "                         It is the agent's claim, recorded in the",
      "                         squash message; merge can't check it.",
    ].join("\n"),
    run: async (args: readonly string[], ctx: Context) => {
      const parsed = parseArgs(args);
      if (typeof parsed === "string") {
        ctx.stderr.write(`merge: ${parsed}\n`);
        return 2;
      }
      return runMerge(ctx, deps, parsed);
    },
  };
}
