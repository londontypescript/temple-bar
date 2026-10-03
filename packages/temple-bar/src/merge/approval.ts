// Changes that need the maintainer's yes before they merge: the rules every
// agent follows (AGENTS.md), and the version of temple-bar that judges this
// repository (its pin in the root package.json). An agent can't give that
// yes itself, so merge refuses unless told the maintainer said yes in chat.

import {
  pinnedTempleBar,
  rootManifest,
  TEMPLE_BAR_PACKAGE,
  type PullRequestChanges,
} from "./manifests.ts";

/** One reason per change that needs the maintainer's yes; empty if none. */
export function reasonsForMaintainerApproval(
  changes: PullRequestChanges,
): string[] {
  const reasons: string[] = [];
  // Any AGENTS.md, not just the root one: a nested one binds agents too.
  const agentsFiles = changes.files.filter(
    (file) => file === "AGENTS.md" || file.endsWith("/AGENTS.md"),
  );
  if (agentsFiles.length > 0) {
    reasons.push(`it changes ${agentsFiles.join(", ")}`);
  }
  const root = rootManifest(changes);
  const before = pinnedTempleBar(root?.before);
  const after = pinnedTempleBar(root?.after);
  if (before !== after) {
    reasons.push(
      `it changes the pinned ${TEMPLE_BAR_PACKAGE} from ${before ?? "none"} to ${after ?? "none"}`,
    );
  }
  return reasons;
}
