// The data side of merge's fake world: what the scripted repository and
// GitHub start out as, before a test changes the one thing it is about.
// Plain data with no state of its own, so each test gets a fresh copy from
// defaultWorld(); world.ts turns it into git and gh answers.

export const HEAD = "a".repeat(40);
export const MERGED_IN = "b".repeat(40);
/** Where the branch left main, and main's tip in the primary checkout. */
export const BASE = "c".repeat(40);
/** What a push made after GitHub accepted the merge moved origin's branch to. */
export const REMOTE_NEWER = "9".repeat(40);
/** A commit made on the local branch after GitHub accepted the merge. */
export const LOCAL_NEWER = "8".repeat(40);
/** A commit the gate made in the branch's worktree while it ran. */
export const GATE_COMMIT = "7".repeat(40);

/** A check run as GitHub's API returns it. `id` and `started_at` tell
 * which of several runs with one name is the newest. */
export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  id?: number;
  started_at?: string | null;
  /** The check suite (one per workflow run) the run belongs to. */
  suite?: number;
}

export interface World {
  pr: {
    number: number;
    title: string;
    body: string;
    state: string;
    isDraft: boolean;
    baseRefName: string;
    headRefName: string;
    isCrossRepository: boolean;
  };
  /** headRefOid on each read of the pull request; the last one repeats. */
  heads: string[];
  /** Local branch tip, or undefined for no local branch. */
  localTip: string | undefined;
  behind: boolean;
  /** Exit code of the gate merge runs after bringing a branch up to date. */
  gateExit: number;
  /** What the gate leaves behind in the worktree once it has run: nothing,
   * a new commit (GATE_COMMIT), or a changed tracked file. */
  gateEffect: "none" | "commits" | "dirties";
  dirty: boolean;
  /** Extra worktree entries after the primary one, in porcelain form. */
  worktrees: string;
  /** Check runs on each read; the last one repeats. */
  checkRuns: CheckRun[][];
  /** Which workflow each check suite belongs to. */
  workflowRuns: { suite: number; workflow: number }[];
  statuses: { context: string; state: string }[];
  required: string[];
  alertsForPr: { number: number; rule: string; path: string }[] | "not-set-up";
  alertsOnDefault: { number: number; rule: string; path: string }[];
  changedFiles: string[];
  packageBefore: string;
  packageAfter: string;
  /** Other files' contents where the branched-off commit and the head have
   * them; a missing side doesn't exist there. A changed file not named here
   * is on both sides, with different text. */
  otherFiles: Record<string, { before?: string; after?: string }>;
  coAuthors: string;
  /** How many merge requests GitHub refuses before it accepts one. */
  mergeRefusals: number;
  /** origin's branch once GitHub has merged: deleted with the merge, still
   * at the head GitHub accepted, or moved on to REMOTE_NEWER by a push. */
  remoteAfterMerge: "deleted" | "accepted" | "moved";
  /** The local branch gains LOCAL_NEWER once GitHub has merged. */
  localCommitAfterMerge: boolean;
  /** stderr of a deletion push that fails for a reason other than its lease
   * (a rule or a permission, say); undefined when origin applies the lease. */
  deletionError: string | undefined;
  incidents: number;
  /** Bypassed rule suites on the default branch, one JSON object a line, as
   * the listing's --jq prints them. Each one went past the judge. */
  bypasses: string;
}

export function defaultWorld(): World {
  return {
    pr: {
      number: 7,
      title: "feat(x): add x",
      body: "Adds x.\n\n- add the x command\n- document x\n",
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      headRefName: "feat/x",
      isCrossRepository: false,
    },
    heads: [HEAD],
    localTip: HEAD,
    behind: false,
    gateExit: 0,
    gateEffect: "none",
    dirty: false,
    worktrees: `worktree /wt/x\nHEAD ${HEAD}\nbranch refs/heads/feat/x\n`,
    checkRuns: [[{ name: "gate", status: "completed", conclusion: "success" }]],
    workflowRuns: [],
    statuses: [],
    required: [],
    alertsForPr: [],
    alertsOnDefault: [],
    changedFiles: ["src/x.ts"],
    packageBefore:
      '{"devDependencies":{"@londontypescript/temple-bar":"0.0.4"}}',
    packageAfter:
      '{"devDependencies":{"@londontypescript/temple-bar":"0.0.4"}}',
    otherFiles: {},
    coAuthors:
      "Co-authored-by: Ada <ada@example.com>\n\nCo-Authored-By: ada <ADA@example.com>\nCo-authored-by: Bob <bob@example.com>\n",
    mergeRefusals: 0,
    remoteAfterMerge: "deleted",
    localCommitAfterMerge: false,
    deletionError: undefined,
    incidents: 3,
    bypasses: "",
  };
}
