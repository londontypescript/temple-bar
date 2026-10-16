// The gate's unused-code check: knip reports files nothing imports and
// exports nothing uses. Dead code is code every reader and every agent has
// to read and keep working for no reason, and an unused export hides
// whether a module's interface is really what its callers need.
//
// Only those issue types are reported. knip's dependency checks are left
// out: a project's package manager and its own scripts already own its
// dependency list.
//
// knip runs once, at the root, over every package of a workspace; its
// findings are then put down to the package that holds each one (see
// unused-attribution.ts), so the report says which packages need work.

import path from "node:path";

import type { Context } from "../context.ts";
import type { Inventory } from "./packages.ts";
import type { CheckOutcome } from "./report.ts";
import type { GateTools } from "./tools.ts";
import { attributeFindings, ROOT_OWNER } from "./unused-attribution.ts";

const UNUSED_CHECK = "unused code (knip)";

/** files: files nothing imports. exports, types: exported values and types
 * nothing imports. Progress output is off so the gate's log stays readable. */
export const KNIP_ARGS: readonly string[] = [
  "--include",
  "files,exports,types",
  "--no-progress",
];

const FOUND =
  "gate: knip found unused files or exports (listed above): delete each one, or use it\n";

/** The root as given and as it resolves: knip may name files either way. */
async function rootSpellings(ctx: Context): Promise<string[]> {
  try {
    return [ctx.cwd, await ctx.fs.realpath(ctx.cwd)];
  } catch {
    return [ctx.cwd];
  }
}

/** Fails the check for knip's findings, saying which packages hold them
 * when knip's evidence says where they are. Only the wording depends on
 * that evidence: the check fails either way. */
async function unusedFailure(
  ctx: Context,
  inventory: Pick<Inventory, "packages" | "outcome">,
  files: readonly string[] | undefined,
): Promise<CheckOutcome> {
  const failure = {
    name: UNUSED_CHECK,
    status: "failed",
    detail: "unused files or exports",
  } as const;
  if (files === undefined || files.length === 0) {
    ctx.stderr.write(FOUND);
    return failure;
  }
  // Without the inventory the gate doesn't know the packages' folders.
  const known = inventory.outcome.status !== "failed";
  const owners = attributeFindings(
    await rootSpellings(ctx),
    known ? inventory.packages.map((member) => member.relative) : [],
    files,
  );
  const names = owners.map((owner) => owner.name).join(", ");
  ctx.stderr.write(
    [
      FOUND.trimEnd(),
      ...(known
        ? []
        : [
            `  the workspace's packages couldn't be listed, so every finding is put down to ${ROOT_OWNER}`,
          ]),
      ...owners.flatMap((owner) => [
        `  ${owner.name}:`,
        ...owner.files.map((file) => `    ${file}`),
      ]),
      "",
    ].join("\n"),
  );
  return {
    ...failure,
    detail: known
      ? `${failure.detail} in ${names}`
      : `${failure.detail} in ${names}; packages unknown, as the workspace inventory failed`,
  };
}

export async function runUnusedCheck(
  ctx: Context,
  tools: GateTools,
  inventory: Pick<Inventory, "packages" | "outcome">,
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
  if (code === 1) {
    return unusedFailure(ctx, inventory, result.findingFiles);
  }
  ctx.stderr.write("gate: knip could not run (see the error above)\n");
  return {
    name: UNUSED_CHECK,
    status: "failed",
    detail: `could not run (exit ${String(code)})`,
  };
}
