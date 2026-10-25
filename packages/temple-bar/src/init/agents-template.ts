// The AGENTS.md rules setup writes for a project, and how they go into the
// file. temple-bar's rules sit between two marker comments, so setup can add
// them to an AGENTS.md a framework already wrote (Next.js and Astro ship
// their own), and bring them up to date on a later run, without touching
// anything the project wrote outside the markers.
//
// The rules are written for any project, not for temple-bar itself. Every
// agent loads AGENTS.md in every session, so the block keeps each rule to a
// line or two: the reasons behind them, and the procedure for following
// them, live in the docs setup writes beside it (companion-docs.ts), each
// linked from the block with when to read it.
//
// The block is setup's, as the hook shims are: the gate fails when it
// differs from what this release writes, and setup replaces it only when it
// is a block temple-bar wrote, never one edited by hand.

import { createHash } from "node:crypto";

import { RERUN_INIT } from "./requirements.ts";

/** The marker lines. The opening one says what the block is, so a person
 * reading the file knows where their own rules go; it stays within 80
 * characters for projects that lint line length. Matching is on the prefix,
 * so a later release can reword the note after it. */
const BEGIN_PREFIX = "<!-- BEGIN:temple-bar";
export const BLOCK_BEGIN = `${BEGIN_PREFIX}: setup rewrites this block; edit outside it -->`;
export const BLOCK_END = "<!-- END:temple-bar -->";

/** The top of a new AGENTS.md, outside the block: the project's own. */
const HEADER = `# Agent directives

These rules bind every agent and person working in this repo. This
project's own rules go here, outside temple-bar's block below.
`;

const RULES = `## Start here

For a new project, or a request whose goal isn't clear: ask the user what
we're building and who it is for, before anything else. Then plan. Before
writing code, read [docs/conventions.md](docs/conventions.md). The reasons
behind these rules are in [docs/agents-rationale.md](docs/agents-rationale.md).

## Plans

Before planning or filing an issue, read [docs/planning.md](docs/planning.md).

- **Plan first.** Work bigger than a one-line fix starts with a written
  plan the user has approved: verifiable phases, which can run in parallel,
  each rated **routine**, **involved** or **delicate**. Never pick or
  switch models yourself.
- **Scope is the user's,** set by placing issues in a milestone. Its plan,
  \`docs/plans/<milestone>.md\`, groups the issues into phases by the files
  they touch, gives each phase closing several its \`One concern:\` reason,
  and is approved through a pull request. Progress goes on the issues,
  never in the plan.
- **Settle questions early.** An issue has **Decided** and **Open
  questions** sections from filing. A plan is approved only when none of its
  issues' questions remain or each is marked "agent decides". A new
  question mid-build is asked with its background restated.
- **Decisions become ADRs** in \`docs/adr/\`, approved by the user. Check
  every premise against the ADRs and git history, not memory; a new issue
  cites what set the current state.

## Tracking and sessions

- **The issue is the tracker:** update it at every subtask, not at phase
  end. Drafts go in \`.temple-bar/\`, this checkout's gitignored folder.
- **One GitHub reference per line** in anything posted to GitHub, nested
  under its bullet in a pull request description.
- **Before work stops** (a compact, a pause, a usage limit, a change of
  tool), and on resume, read
  [docs/phase-boundaries.md](docs/phase-boundaries.md). Write the state on
  the issue in its fields, and post it only after the user has seen the
  exact text and said yes.
- **Clear or compact only at a phase boundary,** and ask first. On resume,
  read git, pull requests and the issue; never ask the user to remember.
- **Name the session,** where the tool allows, after the project and the
  work once both are known, and rename it when the work moves on.

## Branches and commits

- **The default branch changes only through merged pull requests,** each
  squashed: one branch, one pull request, one commit. Never commit to it
  directly, even a one-line fix.
- **Every branch gets its own worktree,** created by your harness and
  prepared there. Never run \`git worktree add\` or choose a location
  yourself; if the harness can't, ask the user once per session.
- **Commit at every point where the checks pass,** and a clean baseline
  before debugging. Never hold a large uncommitted change.
- **Read history before changing code** (\`git log -S\`, \`git blame\`).
- **Commit messages and pull request titles** take a conventional prefix
  (\`feat\`, \`fix\`, \`docs\`, \`chore\`) and name the change, in proportion to
  it, never the trigger.

## Pull requests and merges

Before opening a pull request or preparing an admin merge, read
[docs/pull-requests.md](docs/pull-requests.md).

- **Push once, when finished,** and for anything that needs the user's
  yes, once they have agreed it. \`pnpm ready\` runs the gate and marks the
  commit; the \`pre-push\` hook refuses an unmarked one.
- **One concern per pull request.** One closing two or more issues, or over
  the size limits, needs a \`One concern:\` line giving a reason that counts.
- **One bullet per distinct change** in the description, as a top-level
  list; it becomes the squash commit.
- **Merge with \`pnpm merge <N>\`** once CI and code scanning are green, from
  the default-branch checkout, never inside a pull request's worktree.
- **The user's yes first** for a change to AGENTS.md or to the checks, or
  one that tags or publishes. Never rewrite a pushed branch.
- **A change to the checks the judge guards** is merged by the user as
  admin: its description is exactly the squash body, its checklist a
  comment. Any other refusal is a failure to diagnose, not a bypass.

## Checks and verification

CI runs \`pnpm gate\`: the project's checks and temple-bar's own. The full
suite runs whatever changed.

- **The gate's scripts are real:** \`typecheck\`, \`lint\`, \`format:check\` and
  \`test\` run the right commands for this stack, never no-ops.
- **Never weaken a check,** suppress a rule or skip a test to make it
  pass: fix the cause, or change the check in its own reviewed change.
- **With no clean fix, stop and report.**
- **A refusal is a stop, not a detour.** When a sandbox, permission check
  or hook refuses something, stop and report. Never install globally.
- **Break-it evidence for every new check:** disable the fix, show the
  check fail with its own message, then restore it.
- **Diagnose before working around.** "Flaky" is not a diagnosis.
- **Two strikes, then stop:** after two failed attempts at one fix, or the
  user saying twice it's still broken, go back to the last clean commit,
  search upstream issues and changelogs, and report.
- **Verified means exercised through the real delivery path** (the built
  app, the packed package). Until a CI run is green, say "passes locally;
  CI not yet seen".
- **Tests assert behaviour worth protecting.** Don't pad the count.

## Security

- **Review every change that touches authentication,** user input,
  secrets, file or network access, or dependencies before its pull request,
  and say what you checked: injection, secrets in code or logs, unsafe
  defaults, where a new dependency comes from.
- **Never commit secrets or private details** (customer data, internal
  hostnames) in code, issues or commit messages.

## Delegation

Before delegating, or reporting back as a subagent, read
[docs/delegation.md](docs/delegation.md).

- **Delegate to keep the reviewer's context clean.** Justify parallel work,
  never split it across overlapping files, and don't edit a delegated file
  until its subagent reports.
- **Subagents commit only.** Shared files (root \`package.json\`, the
  lockfile, tsconfig, lint config) and every merge and push are the
  orchestrator's.
- **A handoff report** says what is resolved, deliberately deferred and
  needs a decision, gives break-it evidence for each new check, and says
  whether anything ran outside the sandbox.
- **Review every line** of a subagent's change: list what it must defend
  against, and check each item. Rerunning the checks is not a review.

## Code

- **File length** is capped by the gate. Split along seams; never raise the
  cap to fit.
- **Deep modules**, and **seams** around the filesystem, network, clock and
  prompts so tests can fake them.
- **Comments explain why, in plain words.** No task IDs; history belongs in
  git and ADRs.
- **Wide changes:** when a change touches many files, ask out loud whether
  they duplicate each other. If they do, fix that instead, and record the
  replaced choice as an ADR.

## Incidents

When something goes wrong (rework, confusion, a rule that made things
harder or was broken, the user saying twice it's still broken), read
[docs/incidents.md](docs/incidents.md). Search temple-bar's issues first:
name a match as the known gap; propose an incident only if none matches.
File or comment only on the user's yes, never in this repo.

Keep this file within 200 lines and 32 KiB (the gate checks). When it grows
past them, move this project's own text to docs, never this block.
`;

/** temple-bar's block: the markers and the rules between them. Blank lines
 * around the rules keep the markers from running into a heading or list. */
export function templeBarBlock(): string {
  return `${BLOCK_BEGIN}\n\n${RULES}\n${BLOCK_END}\n`;
}

/** A new AGENTS.md: a short header, then temple-bar's block. */
export function freshAgentsMd(): string {
  return `${HEADER}\n${templeBarBlock()}`;
}

/** SHA-256 of the block each earlier temple-bar release wrote, as
 * blockHash computes it. Setup replaces a block matching one of these (an
 * upgrade); any other block that differs from today's was edited by hand,
 * and setup leaves it alone rather than lose the edit. When a release
 * changes the block, add the hash of the block it replaces here. */
export const EARLIER_BLOCK_SHA256: readonly string[] = [
  // 0.0.9 and 0.0.10 (the same block)
  "c02fbddb1a10a85fc5e1a756cc497ec1a45415df026ef1564c6ad4b642d0f474",
  // 0.1.0
  "dd9862b6e13b50bf8f9f7feab056d72b10cae447b88ff82676ad8b15e076f425",
];

/** The block's text compared without its final newline and with Windows
 * line endings made plain, so a checkout that turns LF into CRLF (git's
 * autocrlf) or a file ending right after the END line still matches. */
function comparable(block: string): string {
  // The END line's own "\r" survives splitting the file on "\n", so a lone
  // final "\r" is a line ending too.
  return block.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

export function blockHash(block: string): string {
  return createHash("sha256").update(comparable(block), "utf8").digest("hex");
}

/** Where temple-bar's block sits in an AGENTS.md, if it has one. */
export type BlockLocation =
  | { readonly kind: "absent" }
  | { readonly kind: "malformed"; readonly detail: string }
  | {
      readonly kind: "found";
      /** Everything before the BEGIN line, each line with its newline. */
      readonly before: string;
      /** From the BEGIN line to the END line, as the file has it. */
      readonly block: string;
      /** Everything after the END line's own newline (which the block
       * text leaves out), as the file has it. */
      readonly after: string;
    };

function lineIndexes(
  lines: readonly string[],
  matches: (line: string) => boolean,
): number[] {
  return lines.flatMap((line, index) => (matches(line.trim()) ? [index] : []));
}

/** Finds the block. Markers that don't pair up (one without the other, two
 * of either, or END first) are malformed: guessing where the block ends
 * could take the project's own rules for setup's. */
export function locateTempleBarBlock(content: string): BlockLocation {
  const lines = content.split("\n");
  const begins = lineIndexes(lines, (line) => line.startsWith(BEGIN_PREFIX));
  const ends = lineIndexes(lines, (line) => line === BLOCK_END);
  if (begins.length === 0 && ends.length === 0) {
    return { kind: "absent" };
  }
  const begin = begins[0];
  const end = ends[0];
  if (
    begins.length !== 1 ||
    ends.length !== 1 ||
    begin === undefined ||
    end === undefined ||
    end < begin
  ) {
    const found =
      begins.length === 1 && ends.length === 1
        ? "its END line comes first"
        : `it has ${String(begins.length)} BEGIN and ${String(ends.length)} END lines`;
    return {
      kind: "malformed",
      detail:
        `AGENTS.md needs one "${BEGIN_PREFIX} ... -->" line and one ` +
        `"${BLOCK_END}" line after it, but ${found}.`,
    };
  }
  return {
    kind: "found",
    before: lines
      .slice(0, begin)
      .map((line) => `${line}\n`)
      .join(""),
    block: lines.slice(begin, end + 1).join("\n"),
    after: lines.slice(end + 1).join("\n"),
  };
}

/** Whether a block found in AGENTS.md is exactly the one this release
 * writes. */
export function isCurrentBlock(block: string): boolean {
  return comparable(block) === comparable(templeBarBlock());
}

/** How to put an edited or broken block right, said the same way by setup
 * and the gate. Deleting the block is the way back because setup adds a
 * missing block, but never rewrites one it didn't write. */
export const RESTORE_BLOCK =
  "move any change of your own above or below the block, delete the " +
  `block (both marker lines and everything between), then run ${RERUN_INIT} ` +
  "to write it again";

export type BlockUpdate =
  | { readonly kind: "unchanged" }
  | { readonly kind: "updated"; readonly content: string }
  | { readonly kind: "refused"; readonly detail: string };

/**
 * What an existing AGENTS.md becomes with temple-bar's current block in it.
 * With no block yet, the block goes at the end, after whatever the file
 * holds. A block an earlier release wrote is replaced in place, and only
 * the block. Malformed markers, or a block edited by hand, are refused:
 * the file is left alone and `detail` says why.
 */
export function withTempleBarBlock(
  existing: string,
  earlierHashes: readonly string[] = EARLIER_BLOCK_SHA256,
): BlockUpdate {
  if (existing.trim() === "") {
    return { kind: "updated", content: freshAgentsMd() };
  }
  const location = locateTempleBarBlock(existing);
  if (location.kind === "absent") {
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    return {
      kind: "updated",
      content: `${existing}${separator}${templeBarBlock()}`,
    };
  }
  if (location.kind === "malformed") {
    return { kind: "refused", detail: location.detail };
  }
  if (isCurrentBlock(location.block)) {
    return { kind: "unchanged" };
  }
  if (!earlierHashes.includes(blockHash(location.block))) {
    return {
      kind: "refused",
      detail:
        "AGENTS.md's temple-bar block has been edited: it matches no block " +
        "temple-bar has written, and rewriting it would lose the edit.",
    };
  }
  return {
    kind: "updated",
    content: `${location.before}${templeBarBlock()}${location.after}`,
  };
}
