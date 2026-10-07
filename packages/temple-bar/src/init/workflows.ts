// The gate and pull request title workflows setup writes into a repo. Kept
// as text in the package, so the copy setup writes is always the one this
// version of temple-bar was tested with, and the gate checks each file is
// still exactly that copy: a pull request runs its own copy of a workflow,
// so an edited one could quietly stop checking anything.
//
// Neither names a pnpm version: pnpm/action-setup installs the one
// package.json names, and fails when a workflow names a different one, so
// package.json stays the only place it is set (setup adds it when nothing
// names one; see package-json.ts).

import {
  CHECKOUT,
  NODE_VERSION,
  SETUP_NODE,
  SETUP_PNPM,
  yamlComment,
} from "../judge/workflow-text.ts";
import { RERUN_INIT } from "./requirements.ts";

/** Where setup writes the gate workflow. */
export const GATE_WORKFLOW_PATH = ".github/workflows/temple-bar-gate.yml";

/** The gate job's name, which is the check name a ruleset requires. */
export const GATE_CHECK = "temple-bar gate";

/** Where setup writes the pull request title workflow. */
export const PR_TITLE_WORKFLOW_PATH =
  ".github/workflows/temple-bar-pr-title.yml";

/** The title job's name, which is the check name a ruleset requires. */
export const PR_TITLE_CHECK = "temple-bar pr-title";

/** The opening comment both workflows share: who wrote the file, that the
 * gate holds it to an exact copy, and where the project's own jobs go. */
function openingComment(check: string): string {
  return yamlComment(
    "Written by temple-bar. The gate checks this file is an exact copy of " +
      "the one temple-bar writes, so any edit fails it. The project's own " +
      "jobs go in a workflow of their own. The job name " +
      `"${check}" is reserved for temple-bar: a project's own jobs use ` +
      "other names.",
  );
}

/** The steps both workflows start with: the code, pnpm, Node and the
 * project's dependencies. `checkoutWith` is extra `with:` lines for the
 * checkout. */
function installSteps(checkoutWith: string): string {
  return `      - name: Checkout
        uses: ${CHECKOUT}
        with:
          persist-credentials: false
${checkoutWith}
      # No version here: pnpm/action-setup installs the one package.json
      # names, and fails if this named a different one.
      - name: Install pnpm
        uses: ${SETUP_PNPM}

      - name: Install Node
        uses: ${SETUP_NODE}
        with:
          node-version: ${String(NODE_VERSION)}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile
`;
}

/** The gate workflow file's full text. */
export function gateWorkflow(): string {
  return `${openingComment(GATE_CHECK)}
name: ${GATE_CHECK}

# Not on "edited": GitHub sends it for a description change too, and the
# gate gains nothing from rerunning on the same commit. The title is checked
# by temple-bar-pr-title.yml, which does run on "edited".
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

# A newer push cancels the run for the commit it replaced.
concurrency:
  group: temple-bar-gate-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  gate:
    # A ruleset requires a check with exactly this name.
    name: ${GATE_CHECK}
    runs-on: ubuntu-latest
    steps:
${installSteps(`          # The pull request size check measures from the base branch.
          fetch-depth: 0
`)}
      - name: Gate
        run: pnpm gate
        env:
          # The gate's ruleset check reads GitHub, and fails in Actions
          # without a token rather than hit the anonymous rate limit.
          GH_TOKEN: \${{ github.token }}

      # Warns about a large pull request and still passes. It fails only
      # when it can't measure the pull request: a check that quietly does
      # nothing is worse than a red one.
      - name: Pull request size
        run: pnpm exec temple-bar pr-size
`;
}

/** The pull request title workflow file's full text. */
export function prTitleWorkflow(): string {
  return `${openingComment(PR_TITLE_CHECK)}
name: ${PR_TITLE_CHECK}

# Its own workflow, so a changed title is checked again without rerunning
# the whole gate. It runs on every edit, even one that left the title alone:
# a skipped check counts as passed, so skipping would let a description edit
# clear a failed title.
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]

permissions:
  contents: read

# Its own group: a title edit never cancels a gate run. A newer run
# cancelling an older one is safe, since both check the title as it is now.
concurrency:
  group: temple-bar-pr-title-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  title:
    # A ruleset requires a check with exactly this name.
    name: ${PR_TITLE_CHECK}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
${installSteps("")}
      # Reads the title from the event payload, never from the command line,
      # so a title can't run code.
      - name: Pull request title
        run: pnpm exec temple-bar pr-title
`;
}

/** A workflow setup writes and the gate holds to an exact copy. */
export interface CheckedWorkflow {
  /** Where it goes, relative to the repo root, with `/` separators. */
  readonly path: string;
  /** What setup's report calls it. */
  readonly label: string;
  /** The exact text this version of temple-bar writes. */
  readonly content: string;
}

/** Both workflows, in the order setup writes and the gate checks them. */
export const CHECKED_WORKFLOWS: readonly CheckedWorkflow[] = [
  { path: GATE_WORKFLOW_PATH, label: "gate workflow", content: gateWorkflow() },
  {
    path: PR_TITLE_WORKFLOW_PATH,
    label: "pull request title workflow",
    content: prTitleWorkflow(),
  },
];

/** How to put a changed copy right: setup never overwrites a file, so the
 * changed one has to go before setup can write it again. */
export const RESTORE_WORKFLOW =
  "move the project's own changes into a workflow of their own, delete " +
  `this file, and run ${RERUN_INIT} again (setup never overwrites an ` +
  "existing file)";
