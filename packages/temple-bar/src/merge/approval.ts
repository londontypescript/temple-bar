// Changes that need the maintainer's yes before they merge: the rules every
// agent follows (AGENTS.md), and the version of temple-bar that judges this
// repository (its pin in the root package.json). An agent can't give that
// yes itself, so merge refuses unless told the maintainer said yes in chat.

import type { Context } from "../context.ts";
import { changedFiles, fileAt } from "./local.ts";

const PACKAGE_NAME = "@londontypescript/temple-bar";

function pinnedVersion(packageJson: string | undefined): string | undefined {
  if (packageJson === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(packageJson) as Record<string, unknown>;
    for (const field of ["devDependencies", "dependencies"]) {
      const deps = parsed[field];
      if (typeof deps === "object" && deps !== null) {
        const version = (deps as Record<string, unknown>)[PACKAGE_NAME];
        if (typeof version === "string") {
          return version;
        }
      }
    }
  } catch {
    // A package.json that doesn't parse has no readable pin.
  }
  return undefined;
}

/** One reason per change that needs the maintainer's yes; empty if none.
 * `base` is where the pull request branched off, `head` its tip. */
export async function reasonsForMaintainerApproval(
  ctx: Context,
  base: string,
  head: string,
  cwd: string,
): Promise<string[]> {
  const reasons: string[] = [];
  const files = await changedFiles(ctx, base, head, cwd);
  // Any AGENTS.md, not just the root one: a nested one binds agents too.
  const agentsFiles = files.filter(
    (file) => file === "AGENTS.md" || file.endsWith("/AGENTS.md"),
  );
  if (agentsFiles.length > 0) {
    reasons.push(`it changes ${agentsFiles.join(", ")}`);
  }
  if (files.includes("package.json")) {
    const before = pinnedVersion(await fileAt(ctx, base, "package.json", cwd));
    const after = pinnedVersion(await fileAt(ctx, head, "package.json", cwd));
    if (before !== after) {
      reasons.push(
        `it changes the pinned ${PACKAGE_NAME} from ${before ?? "none"} to ${after ?? "none"}`,
      );
    }
  }
  return reasons;
}
