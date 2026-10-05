// The files setup writes beside AGENTS.md, each only where the project has
// none: AGENTS.md links to them, so they have to exist, but once there they
// are the project's to edit. The exception is CLAUDE.md, which setup also
// adds to (see fixClaudeMd). Like AGENTS.md, they are written for any
// project, not for temple-bar itself.

/** Claude Code reads CLAUDE.md, and falls back to AGENTS.md only in recent
 * versions, with the fallback switched on, and not on every cloud provider.
 * An import works in all of them. The heading is there because the gate's
 * markdown lint wants every file to start with one. */
export const CLAUDE_MD_PATH = "CLAUDE.md";
const CLAUDE_HEADING = "# Claude Code";
const AGENTS_IMPORT = "@AGENTS.md";
const CLAUDE_MD = `${CLAUDE_HEADING}\n\n${AGENTS_IMPORT}\n`;

/** The reasons behind the AGENTS.md rules, kept out of AGENTS.md because
 * every agent loads that file in every session. */
const RATIONALE = `# Why the AGENTS.md rules exist

[AGENTS.md](../AGENTS.md) holds only the rules, because every agent loads it
in every session. The reasons behind them live here. temple-bar's setup
wrote this file; add your own project's reasons as you add rules.

- **AGENTS.md stays within 200 lines and 32 KiB.** Every agent loads all of
  it in every session. Anthropic's guidance is under 200 lines, and Codex
  stops reading past 32 KiB by default.
- **Ask what we're building first.** An agent that starts coding from a
  vague request builds its own guess, and the rework costs more than the
  question.
- **The user sets scope through milestones.** Placing an issue in a
  milestone is their judgement of what matters and when. Grouping a
  milestone's issues into phases follows the files each change touches,
  which an agent sees better, so the agent proposes it and the plan's
  approval covers it.
- **Every issue's premise is checked.** An issue records what someone
  believed when they wrote it. Checked against the decisions list and git
  history, a stale premise is caught before work starts on it, not after.
- **The tracker moves at every subtask.** A tracker that only moves at phase
  end tells the user nothing about where to spend the rest of a usage
  window.
- **The update before work stops has fixed fields, and the user sees it
  first.** The next session often runs in a different tool, whose memory is
  separate; the issue is the one record every tool and person can read.
  Without the base commit, the exact command and what has been ruled out, a
  resumed session repeats dead ends. It is the update carrying the most
  state, so the user reads it before it is posted.
- **Commit often inside a branch.** Commits are local and squashed at merge,
  so they cost nothing in history or CI. Work lost to a usage limit or a
  crashed session comes down to the uncommitted change.
- **Push once.** Every push to a pull request runs the full CI. Pushing
  while a change is still being discussed burns runs and buries the one
  that matters.
- **The gate's scripts are never no-ops.** The gate trusts \`typecheck\`,
  \`lint\`, \`format:check\` and \`test\` to run real checks; a script that only
  exits 0 makes a green gate mean nothing.
- **Two strikes, then stop.** A third attempt in the same session usually
  repeats the same wrong assumption, in a context now crowded with failed
  attempts. The cause is often upstream (a known bug, a changed default),
  which only a search finds. Going back to the last clean commit keeps the
  failed attempts out of the fix.
- **A pull request closing several issues says why it is one concern.** The
  merge tool checks only that a \`One concern:\` line is there; whether the
  reason holds is for review. What counts:
  - same cause: one fix closes both;
  - they can't be separated: either half alone leaves the default branch
    broken or inconsistent;
  - same lines: separate pull requests would conflict;
  - one is a duplicate or subset of the other;
  - a plan grouping counts only when the line states one of these reasons.

  What doesn't count: both small, same area, already in the file, quicker.

- **Wide changes are checked for duplication.** A decision that was right
  at prototype scale can quietly expire; editing four copies hides that it
  has.
- **Incidents are built in two halves.** Agents see what went wrong in the
  moment; the user sees which of those matter across projects. Neither has
  all of it.
`;

/** What a phase boundary is, what to write before work stops, and how to
 * resume: AGENTS.md points here in one line. */
const PHASE_BOUNDARIES = `# Phase boundaries

AGENTS.md says to clear or compact a session only at a phase boundary, and
to write the state on the issue before work stops. This guide says what
that means in practice, for any tool.

## What a phase boundary is

A point where nothing is half done:

- every change is committed, and the checks pass on the last commit;
- the issue says what was finished, with the commits or pull request;
- nothing is waiting on a subagent, a CI run or an answer from the user.

The end of a phase in the plan is the usual one. A finished subtask, with
its commit made and the issue updated, is a smaller one.

## What to write down

Before work stops, update the issue with:

- the base commit (SHA) and the branch;
- the exact command that reproduces the problem or proves the work is done;
- what has been ruled out, with the reason for each;
- the next action.

Leave out private details: credentials, local paths, internal hostnames.
Show the user the exact text and post it after their yes.

Notes kept by one tool (its memory, its own task list) don't count: the
next session may run in another tool. The issue and git are what every tool
and person can read.

## How to resume

1. Read the issue, latest comment first.
2. Read git: the branch, \`git log\` since the base commit, and
   \`git worktree list\`.
3. Check open pull requests and their CI runs.
4. Run the command from the update, and confirm you see what it describes.
5. Carry on with the next action. If anything disagrees with the update,
   tell the user before acting on either.
`;

/** A home for stack conventions that every tool reads, without growing
 * AGENTS.md past its limits. Setup can't know the stack, so it starts
 * empty. */
const CONVENTIONS = `# Conventions

This project's stack conventions: the framework and libraries it uses, and
the patterns to follow with them. Every agent reads this file before writing
code, whatever tool it runs in.

Add a convention when the user settles one, in a line or two, with the
reason where it isn't obvious. Keep rules about how work is done in
AGENTS.md; this file is about the code.

None yet.
`;

/** AGENTS.md asks for an ADR whenever a choice is replaced; this gives the
 * project the same three sections temple-bar's own ADRs use. */
const ADR_TEMPLATE = `# ADR 0000: Title of the decision

Date: YYYY-MM-DD. Status: proposed, accepted, or superseded by a later ADR.

Copy this file to the next free number, with a short name after it, and
replace each section. An ADR records a choice that shapes the project, and
why, so nobody has to rediscover the reason. When a choice is replaced,
write a new ADR and say there what ended the old one.

## Context

What made a decision necessary: the problem, the constraints, and the
options weighed.

## Decision

What was decided, in plain words, and why this option over the others.

## What would end it

The condition that would make this decision wrong: what would have to
change for someone to replace it.
`;

export interface CompanionFile {
  /** Relative to the repo root, with forward slashes. */
  readonly path: string;
  readonly content: string;
}

/** Every file setup writes beside AGENTS.md, if missing. */
export const COMPANION_FILES: readonly CompanionFile[] = [
  { path: CLAUDE_MD_PATH, content: CLAUDE_MD },
  { path: "docs/agents-rationale.md", content: RATIONALE },
  { path: "docs/phase-boundaries.md", content: PHASE_BOUNDARIES },
  { path: "docs/conventions.md", content: CONVENTIONS },
  { path: "docs/adr/0000-template.md", content: ADR_TEMPLATE },
];

export interface ClaudeMdFix {
  readonly content: string;
  /** What was added, in words for the user. */
  readonly added: readonly string[];
}

/**
 * What an existing CLAUDE.md, written by the project or a framework (Next.js
 * ships a one-line `@AGENTS.md`), needs added: a heading at the top, which
 * the gate's markdown lint asks of every file, and the AGENTS.md import,
 * without which Claude Code may never read the rules. Nothing is removed or
 * reordered. Returns undefined when nothing is missing, so a second run
 * changes nothing.
 */
export function fixClaudeMd(existing: string): ClaudeMdFix | undefined {
  if (existing.trim() === "") {
    return { content: CLAUDE_MD, added: ["a heading", "the AGENTS.md import"] };
  }
  const lines = existing.split(/\r?\n/);
  const hasHeading = /^#\s/.test(lines[0] ?? "");
  const importsAgents = lines.some((line) =>
    [AGENTS_IMPORT, "@./AGENTS.md"].includes(line.trim()),
  );
  if (hasHeading && importsAgents) {
    return undefined;
  }
  let content = existing;
  const added: string[] = [];
  if (!hasHeading) {
    content = `${CLAUDE_HEADING}\n\n${content}`;
    added.push("a heading");
  }
  if (!importsAgents) {
    const separator = content.endsWith("\n") ? "\n" : "\n\n";
    content = `${content}${separator}${AGENTS_IMPORT}\n`;
    added.push("the AGENTS.md import");
  }
  return { content, added };
}
