// Changes that need the maintainer before they merge, in two kinds:
//
// - The rules every agent follows (AGENTS.md). An agent can't give that yes
//   itself, so merge refuses unless told the maintainer said yes in chat.
// - The checks that judge the repository: the files the judge guards (see
//   ../judge/changes.ts). The judge fails such a pull request on purpose,
//   and only the maintainer can merge it, past the judge. Merge never does.
//
// `ready` and the pre-push hook warn about both kinds before a push, from
// these same two lists, so what they warn about and what merge refuses
// can't drift apart.
//
// None of this proves the maintainer said yes: an agent works under the
// maintainer's own GitHub account and can pass any flag. It makes the
// request visible instead, and merge records the claim on the default
// branch, so a change that skipped it shows up in `git log`.

import { findCheckChangesInDiff } from "../judge/changes.ts";
import { rootManifest, type PullRequestChanges } from "./manifests.ts";

/** What every warning and refusal about the maintainer's yes tells the
 * agent to do: ask a person, where a person answers. */
export const ASK_THE_MAINTAINER = "Ask the maintainer in chat";

/** One reason per change that needs the maintainer's yes in chat before
 * merge will land it; empty if none. */
export function reasonsForMaintainerApproval(
  changes: PullRequestChanges,
): string[] {
  // Any AGENTS.md, not just the root one: a nested one binds agents too.
  const agentsFiles = changes.files.filter(
    (file) => file === "AGENTS.md" || file.endsWith("/AGENTS.md"),
  );
  return agentsFiles.length > 0 ? [`changes ${agentsFiles.join(", ")}`] : [];
}

/** Each change to the checks that judge the repository, as the judge words
 * it; empty when the pull request leaves them alone. */
export function checkChanges(changes: PullRequestChanges): string[] {
  const root = rootManifest(changes);
  return findCheckChangesInDiff(
    changes.files,
    root === undefined ? undefined : { before: root.before, after: root.after },
    changes.lockfile,
  );
}

/** Every change that needs the maintainer, of both kinds above. */
export function reasonsForMaintainersYes(
  changes: PullRequestChanges,
): string[] {
  const checks = checkChanges(changes);
  return [
    ...reasonsForMaintainerApproval(changes),
    ...(checks.length > 0
      ? [`changes the checks that judge it (${checks.join(", ")})`]
      : []),
  ];
}
