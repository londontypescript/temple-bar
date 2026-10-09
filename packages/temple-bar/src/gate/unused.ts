// The gate's unused-code check: knip reports files nothing imports and
// exports nothing uses. Dead code is code every reader and every agent has
// to read and keep working for no reason, and an unused export hides
// whether a module's interface is really what its callers need.
//
// Only those issue types are reported. knip's dependency checks are left
// out: a project's package manager and its own scripts already own its
// dependency list.

import path from "node:path";

import type { Context } from "../context.ts";
import type { CheckOutcome } from "./report.ts";
import type { GateTools } from "./tools.ts";

const UNUSED_CHECK = "unused code (knip)";

/** files: files nothing imports. exports, types: exported values and types
 * nothing imports. Progress output is off so the gate's log stays readable. */
export const KNIP_ARGS: readonly string[] = [
  "--include",
  "files,exports,types",
  "--no-progress",
];

export async function runUnusedCheck(
  ctx: Context,
  tools: GateTools,
): Promise<CheckOutcome> {
  // knip reads package.json to find a project's entry files; without one
  // there is no JavaScript or TypeScript project for it to look at.
  if (!(await ctx.fs.isRegularFile(path.join(ctx.cwd, "package.json")))) {
    return { name: UNUSED_CHECK, status: "skipped", detail: "no package.json" };
  }
  const result = await tools.knip(ctx, KNIP_ARGS);
  const { code } = result;
  if (
    code === 1 &&
    result.commentOnlyFiles !== undefined &&
    result.commentOnlyFiles.length > 0
  ) {
    ctx.stdout.write(
      `gate: accepted ${String(result.commentOnlyFiles.length)} comment-only unused file(s); no code, exports or types were exempted\n`,
    );
    return {
      name: UNUSED_CHECK,
      status: "passed",
      detail: "only comment-only unused files",
    };
  }
  if (code === 0) {
    return { name: UNUSED_CHECK, status: "passed" };
  }
  ctx.stderr.write(
    code === 1
      ? "gate: knip found unused files or exports (listed above): delete each one, or use it\n"
      : "gate: knip could not run (see the error above)\n",
  );
  return {
    name: UNUSED_CHECK,
    status: "failed",
    detail:
      code === 1
        ? "unused files or exports"
        : `could not run (exit ${String(code)})`,
  };
}
