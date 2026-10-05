// The warning `ready` and the pre-push hook print for a branch that needs
// the maintainer's yes before it is pushed (see ../merge/approval.ts for
// which changes those are). It is a warning, never a prompt: a yes typed in
// a terminal proves only that a terminal exists, which an agent can fake,
// and a cloud agent with no terminal could go no further. The agent's job
// is to ask the maintainer in chat, where a person answers.

import type { Context } from "../context.ts";
import {
  findProtectedBranch,
  upstreamRefFor,
} from "../hooks/protected-branch.ts";
import {
  ASK_THE_MAINTAINER,
  reasonsForMaintainersYes,
} from "../merge/approval.ts";
import { readChanges } from "../merge/manifests.ts";

/** Each change between where `head` left origin's default branch and
 * `head` that needs the maintainer's yes; empty if none. Throws, with a
 * message saying what to do, when there is nothing to compare with. */
export async function changesNeedingMaintainer(
  ctx: Context,
  cwd: string,
  head: string,
): Promise<string[]> {
  const defaultBranch = await findProtectedBranch(ctx, cwd);
  const upstream = upstreamRefFor(defaultBranch);
  const known = await ctx.git.run(
    ["rev-parse", "--verify", "--quiet", `${upstream}^{commit}`],
    cwd,
  );
  if (known.code !== 0) {
    throw new Error(
      `there is no origin/${defaultBranch} here to compare this branch with. ` +
        "Run git fetch origin, then try again.",
    );
  }
  // Compared from where the branch left the default branch, as merge does,
  // so changes that landed on the default branch since don't count as this
  // branch's.
  const base = await ctx.git.run(["merge-base", upstream, head], cwd);
  const baseSha = base.stdout.trim();
  if (base.code !== 0 || baseSha === "") {
    throw new Error(
      `could not find where this branch left origin/${defaultBranch}: ${base.stderr.trim()}`,
    );
  }
  return reasonsForMaintainersYes(await readChanges(ctx, baseSha, head, cwd));
}

/** The warning's text, for the change named by `what` (a commit or a
 * branch). */
export function maintainerWarning(
  what: string,
  reasons: readonly string[],
): string {
  return (
    `warning: ${what} needs the maintainer's yes before it is pushed: ${reasons.join("; ")}.\n` +
    `${ASK_THE_MAINTAINER}, and push only once they say yes.\n`
  );
}
