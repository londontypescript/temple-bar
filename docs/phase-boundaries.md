# Phase boundaries

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
2. Read git: the branch, `git log` since the base commit, and
   `git worktree list`.
3. Check open pull requests and their CI runs.
4. Run the command from the update, and confirm you see what it describes.
5. Carry on with the next action. If anything disagrees with the update,
   tell the user before acting on either.
