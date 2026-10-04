// Changes that need the maintainer before they merge, in two kinds:
//
// - The rules every agent follows (AGENTS.md). An agent can't give that yes
//   itself, so merge refuses unless told the maintainer said yes in chat.
// - The checks that judge the repository: the files the judge guards (see
//   ../judge/changes.ts). The judge fails such a pull request on purpose,
//   and only the maintainer can merge it, past the judge. Merge never does.
//
// `ready` asks the user about both kinds before a push, from these same two
// lists, so what it asks about and what merge refuses can't drift apart.

import { findCheckChangesInDiff } from "../judge/changes.ts";
import { rootManifest, type PullRequestChanges } from "./manifests.ts";

/** One reason per change that needs the maintainer's yes in chat; empty if
 * none. */
export function reasonsForMaintainerApproval(
  changes: PullRequestChanges,
): string[] {
  // Any AGENTS.md, not just the root one: a nested one binds agents too.
  const agentsFiles = changes.files.filter(
    (file) => file === "AGENTS.md" || file.endsWith("/AGENTS.md"),
  );
  return agentsFiles.length > 0 ? [`it changes ${agentsFiles.join(", ")}`] : [];
}

/** Each change to the checks that judge the repository, as the judge words
 * it; empty when the pull request leaves them alone. */
export function checkChanges(changes: PullRequestChanges): string[] {
  const root = rootManifest(changes);
  return findCheckChangesInDiff(
    changes.files,
    root === undefined ? undefined : { before: root.before, after: root.after },
  );
}

/** Everything the user is asked about before a push: both kinds above. */
export function reasonsForUsersYes(changes: PullRequestChanges): string[] {
  const checks = checkChanges(changes);
  return [
    ...reasonsForMaintainerApproval(changes),
    ...(checks.length > 0
      ? [`it changes the checks that judge it (${checks.join(", ")})`]
      : []),
  ];
}
