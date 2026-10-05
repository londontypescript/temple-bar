// The AGENTS.md rules setup writes for a project, and how they go into the
// file. temple-bar's rules sit between two marker comments, so setup can add
// them to an AGENTS.md a framework already wrote (Next.js and Astro ship
// their own), and bring them up to date on a later run, without touching
// anything the project wrote outside the markers.
//
// The rules are written for any project, not for temple-bar itself. Every
// agent loads AGENTS.md in every session, so the reasons behind the rules
// live in the rationale doc setup writes beside it (companion-docs.ts).

/** The marker lines. The opening one says what the block is, so a person
 * reading the file knows where their own rules go; it stays within 80
 * characters for projects that lint line length. Matching is on the prefix,
 * so a later release can reword the note after it. */
const BEGIN_PREFIX = "<!-- BEGIN:temple-bar";
export const BLOCK_BEGIN = `${BEGIN_PREFIX}: setup rewrites this block; edit outside it -->`;
export const BLOCK_END = "<!-- END:temple-bar -->";

/** The top of a new AGENTS.md, outside the block: the project's own. */
const HEADER = `# Agent directives

These rules bind every agent working in this repo (Claude Code, Codex,
Antigravity or any other) and the people working with them. This project's
own rules go here, outside temple-bar's block below.
`;

const RULES = `## Start here

For a new project, or a request whose goal isn't clear: ask the user what
we're building and who it is for, before anything else. Then plan.

Stack conventions live in [docs/conventions.md](docs/conventions.md): read
them before writing code. The reasons behind these rules are in
[docs/agents-rationale.md](docs/agents-rationale.md).

## Plans

Non-trivial work starts with a written plan the user has approved, scaled to
the change: a one-line fix needs a branch, not a plan. Break the work into
verifiable phases, say which can run in parallel, and rate each one
**routine**, **involved** or **delicate** so the user can choose models.
Never pick or switch models yourself. Ask questions before the work, not
during it.

Decisions agreed in discussion go into the plan's decisions list, which the
user approves. Briefs, summaries and every issue's premise are checked
against that list and git history, not memory; a new issue cites what set
the current state (a decision, commit or pull request).

The user sets scope by placing issues in a milestone. You group its issues
into phases by the files each touches, and give each phase that closes
several issues its \`One concern:\` reason, for the user to approve.

## Tracking and sessions

GitHub issues are the tracker: update the issue you work on **at every
subtask**, not at phase end. Drafts go in \`.temple-bar/\`, this checkout's
gitignored working folder.

**Before work stops** (a compact, a pause, a usage limit, a switch of tool;
judge it from what the user says), write the state on the issue: the base
commit (SHA) and the branch; the exact command that reproduces the problem
or proves the work is done; what has been ruled out, with the reason for
each; the next action. No private details. Show the user the exact text and
post it only after their yes (this update only, not routine ones).

Clear or compact only at a phase boundary, and ask first. On resume, read
git, open pull requests and the issue; don't ask the user to remember. How:
[docs/phase-boundaries.md](docs/phase-boundaries.md).

## Branches and commits

The default branch changes only through merged pull requests, each squashed:
one branch, one pull request, one commit. Never commit to it directly, even
a one-line fix. Every branch gets its own worktree, with dependencies
installed before its first commit.

- **Commit at every point where the checks pass.** Never hold a large
  uncommitted change; commit a clean baseline before debugging, so going
  back is safe.
- **Read history before changing code** (\`git log -S\`, \`git blame\`).
- **Commit messages** and pull request titles: a conventional prefix
  (\`feat\`, \`fix\`, \`docs\` or \`chore\`), proportional to the change, and a
  subject that names the change, never the trigger ("address feedback").

## Pull requests and merges

- **Push once, when finished.** Every push runs the full CI. Push when the
  work is final, and for anything that needs the user's yes, once they have
  agreed it. \`pnpm exec temple-bar ready\` runs the gate and marks the
  commit; the \`pre-push\` hook refuses an unmarked one.
- **One concern per pull request.** One closing two or more issues needs a
  \`One concern:\` line giving a reason that counts (see the rationale doc).
- **Merge with \`pnpm exec temple-bar merge <N>\`** once CI and code scanning
  are green. A change to AGENTS.md or to the checks, or one that tags or
  publishes, needs the user's yes first. Never rewrite a pushed branch.
- **Squash messages are written,** never GitHub's default. Subject: the pull
  request title with \`(#N)\`. Body: one bullet per distinct change, plain
  text. Each co-author once, at the end.

## Checks and verification

CI runs \`pnpm gate\`: the project's checks and temple-bar's own.

- **The gate's scripts are real.** \`typecheck\`, \`lint\`, \`format:check\` and
  \`test\` run the right commands for this stack, never no-ops.
- The full suite runs whatever changed. Never weaken a check, suppress a
  rule or skip a test to make it pass: fix the cause, or change the check
  deliberately in its own reviewed change. With no clean fix, stop and
  report.
- **A refusal is a stop, not a detour.** When a sandbox, permission check or
  hook refuses something, stop and report. Never install anything globally.
- **Break-it evidence for every new check:** disable the fix, show the check
  fail with its own message, then restore it.
- **Diagnose before working around.** "Flaky" is not a diagnosis.
- **Two strikes, then stop.** After two failed attempts at the same fix, or
  the user saying twice that it's still broken: go back to the last clean
  commit, search upstream issues and changelogs, and report. You may
  suggest a fresh subagent. The user saying it twice is also a moment to
  propose an incident.
- **Verified means exercised through the real delivery path** (the built
  app, the packed package), not only the source tree. Say "passes locally;
  CI not yet seen" until a CI run is green.
- Write tests that assert behaviour worth protecting. Do not pad the count.

## Security

Review every change that touches authentication, user input, secrets, file
or network access, or dependencies before its pull request: injection,
secrets in code or logs, unsafe defaults, where a new dependency comes from.
Say what you checked. Never commit secrets or private details (customer
data, internal hostnames) in code, issues or commit messages.

## Delegation

Delegate to keep the reviewer's context clean, not only to go faster.
Justify parallel work, and never split it across overlapping files. Don't
edit a file you delegated until its subagent reports back. Shared files
(root package.json, the lockfile, tsconfig, lint config) are the
orchestrator's. Subagents commit only; every merge and push is the
orchestrator's. A handoff report has three parts: _resolved_, _deliberately
deferred_, _needs a decision_, with break-it evidence for each new check, and
says whether anything ran outside the sandbox.

**Review bar.** The orchestrator reads every line of a subagent's change,
lists what it must defend against, and checks each item. Rerunning the
checks is not a review.

## Code

- **File length** is capped by the gate. Split along seams; never raise the
  cap to fit.
- **Deep modules**, and **seams** around the filesystem, network, clock and
  prompts so tests can fake them.
- **Comments explain why, in plain words.** No task IDs; history belongs in
  git and ADRs.
- **Wide changes:** when a change touches many files, ask out loud whether
  one change is spread across them or they duplicate each other. If they
  duplicate, fix that instead, and record the replaced choice as an ADR in
  \`docs/adr/\`, from [the template](docs/adr/0000-template.md).

## Incidents

When something goes wrong (rework, confusion, a rule that got in the way or
was broken), propose an incident to the user there and then. On a yes,
comment on a similar one in
[temple-bar's issues](https://github.com/londontypescript/temple-bar/issues)
or open one labelled \`incident\`; never in this repo, never with private
details. Curating incidents is the user's.

Keep this file within 200 lines and 32 KiB: reasons go in docs.
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

export type BlockUpdate =
  | { readonly kind: "unchanged" }
  | { readonly kind: "updated"; readonly content: string }
  | { readonly kind: "malformed"; readonly detail: string };

function lineIndexes(
  lines: readonly string[],
  matches: (line: string) => boolean,
): number[] {
  return lines.flatMap((line, index) => (matches(line.trim()) ? [index] : []));
}

/**
 * What an existing AGENTS.md becomes with temple-bar's current block in it.
 * With no block yet, the block goes at the end, after whatever the file
 * holds. With one, only the lines from its BEGIN to its END are replaced.
 * Markers that don't pair up (one without the other, two of either, or END
 * first) leave the file alone: guessing where the block ends could replace
 * the project's own rules.
 */
export function withTempleBarBlock(existing: string): BlockUpdate {
  if (existing.trim() === "") {
    return { kind: "updated", content: freshAgentsMd() };
  }
  const lines = existing.split("\n");
  const begins = lineIndexes(lines, (line) => line.startsWith(BEGIN_PREFIX));
  const ends = lineIndexes(lines, (line) => line === BLOCK_END);
  const block = templeBarBlock();

  if (begins.length === 0 && ends.length === 0) {
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    return { kind: "updated", content: `${existing}${separator}${block}` };
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

  // Lines before BEGIN keep their newline; whatever follows END's line
  // (including the file's final newline) is kept as it was.
  const before = lines
    .slice(0, begin)
    .map((line) => `${line}\n`)
    .join("");
  const after = lines.slice(end + 1).join("\n");
  const content = `${before}${block}${after}`;
  return content === existing
    ? { kind: "unchanged" }
    : { kind: "updated", content };
}
