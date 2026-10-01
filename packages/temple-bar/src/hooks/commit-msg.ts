// Logic behind `temple-bar hook commit-msg <file>`. Git passes the path of
// the file holding the message; a commit whose subject has no conventional
// prefix is refused. The rule lives in conventional/subject.ts so the pull
// request title check applies the same one.

import path from "node:path";

import {
  commitSubject,
  describeRefusal,
  isAcceptableCommitMessage,
} from "../conventional/subject.ts";
import type { Context } from "../context.ts";

/**
 * Exit 0 when the message is acceptable, 1 (with the refusal printed) when
 * not. A missing message file can't be judged, so it fails closed.
 */
export async function commitMsgCheck(
  file: string,
  ctx: Context,
): Promise<number> {
  // Git passes a path relative to the repo root, where the hook runs. Join
  // rather than resolve, like every other seam call, so the path doesn't
  // pick up a drive letter on Windows.
  const message = await ctx.fs.readText(
    path.isAbsolute(file) ? file : path.join(ctx.cwd, file),
  );
  if (message === undefined) {
    ctx.stderr.write(`temple-bar: cannot read the commit message: ${file}\n`);
    return 1;
  }
  if (isAcceptableCommitMessage(message)) {
    return 0;
  }
  ctx.stderr.write(
    describeRefusal(commitSubject(message) ?? "", "the commit subject"),
  );
  return 1;
}
