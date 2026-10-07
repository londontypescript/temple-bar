// The judge workflow setup writes into a repo, and the names the ruleset
// needs to require its check. Kept as text in the package, so the copy setup
// writes is always the one this version of temple-bar was tested with.

import { GUARDED_CHECKS } from "./guarded-checks.ts";
import {
  CHECKOUT,
  NODE_VERSION,
  SETUP_NODE,
  yamlComment,
} from "./workflow-text.ts";

/** Where setup writes the workflow. */
export const JUDGE_WORKFLOW_PATH = ".github/workflows/temple-bar-judge.yml";

/** The job's name, which is the check name the ruleset requires. */
export const JUDGE_CHECK = "temple-bar judge";

/** GitHub Actions' app id. Requiring the check from this app means a status
 * posted through the API by anything else can't stand in for it. */
export const GITHUB_ACTIONS_APP_ID = 15368;

// Reads the exact temple-bar version package.json pins. Only an exact
// version is accepted: a range would let the judge's code change without a
// change to package.json, which is the one place the judge watches.
const READ_PIN = `const { readFileSync, appendFileSync } = require("node:fs");
            const pkg = JSON.parse(readFileSync("package.json", "utf8"));
            const name = "@londontypescript/temple-bar";
            const pin = (pkg.devDependencies || {})[name] || (pkg.dependencies || {})[name];
            if (typeof pin !== "string" || !/^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$/.test(pin)) {
              console.error("judge: package.json must pin " + name + " to an exact version, such as \\"0.0.7\\". It has " + JSON.stringify(pin) + ".");
              process.exit(1);
            }
            appendFileSync(process.env.GITHUB_OUTPUT, "version=" + pin + "\\n");`;

/** The workflow file's full text. */
export function judgeWorkflow(): string {
  return `${yamlComment(
    "Written by temple-bar. The judge fails a pull request that changes " +
      `the checks which judge it: ${GUARDED_CHECKS}. A pull request runs ` +
      "its own copy of those, so its own CI can't vouch for a change to " +
      "them. Such a change is the maintainer's to review and merge.",
  )}
name: ${JUDGE_CHECK}

# pull_request_target, not pull_request: GitHub runs this file as it is on
# the base branch, so a pull request that edits or deletes it doesn't change
# what judges it. "edited" covers a pull request moved to another base.
on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited]

# Read only. This trigger hands the job the base repository's token, so it
# gets the least the judge needs: reading the pull request and the code.
permissions:
  contents: read
  pull-requests: read

jobs:
  judge:
    # The ruleset requires a check with exactly this name.
    name: ${JUDGE_CHECK}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      # Never the pull request's code. This job runs with the base branch's
      # trust and token, so checking out or running anything from the pull
      # request would let it take them over. The checkout below is the base
      # branch, and only its package.json, to read the pinned version. The
      # judge reads the pull request itself through the API, as data.
      - name: Read package.json from the base branch
        uses: ${CHECKOUT}
        with:
          persist-credentials: false
          sparse-checkout: package.json
          sparse-checkout-cone-mode: false

      # No dependency cache: a cache saved here would be shared with the
      # base branch's own runs.
      - name: Install Node
        uses: ${SETUP_NODE}
        with:
          node-version: ${String(NODE_VERSION)}

      - name: Read the pinned temple-bar version
        id: pin
        run: |
          node -e '
            ${READ_PIN}
          '

      # Exactly the pinned version, from the npm registry. Nothing from the
      # base branch is installed. npm does install temple-bar's own
      # dependencies, without a lockfile, while the token is in reach, so
      # no install script may run: one could tamper with the judge before
      # it judges. temple-bar has none of its own.
      - name: Judge the pull request
        run: npm exec --yes --ignore-scripts --package="@londontypescript/temple-bar@$PIN" -- temple-bar judge
        env:
          PIN: \${{ steps.pin.outputs.version }}
          GH_TOKEN: \${{ github.token }}
`;
}
