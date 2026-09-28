// `temple-bar gate`: the merge gate (subtask 1.6). Runs the project's stack
// checks (typecheck/lint/test, D2/P3.3) and the file-length cap (always,
// P3.1), and combines them into one exit code:
//
//   0  everything passes
//   1  a check failed (stack script(s), the length cap, or both)
//   2  code exists but a required script is missing from package.json (D2)
//
// Exit 2 takes priority over 1: a repo that can't even run the suite is a
// stack problem to fix first, not a body of failures to summarise. The
// length cap still runs and is still reported in that case (P1.6: a
// docs-only/mid-setup repo must be able to pass on the base check alone,
// which only works if the base check always runs and is judged on its own).

import type { CommandEntry } from "../registry.ts";
import type { Context } from "../context.ts";
import { checkFileLengths, formatLengthFailure } from "./lengths.ts";
import {
  codeExists,
  detectPackageManager,
  missingRequiredScripts,
  readPackageManifest,
  runRequiredScripts,
  REQUIRED_SCRIPTS,
} from "./stack.ts";

function formatMissingScripts(missing: readonly string[]): string {
  const lines = [
    `gate: code exists but package.json is missing script(s): ${missing.join(", ")}`,
  ];
  for (const name of missing) {
    lines.push(`  add "${name}" to "scripts" in package.json`);
  }
  return `${lines.join("\n")}\n`;
}

async function runStackChecks(ctx: Context): Promise<number | undefined> {
  const manifest = await readPackageManifest(ctx);
  const missing = missingRequiredScripts(manifest);

  if (missing.length > 0) {
    if (await codeExists(ctx)) {
      ctx.stderr.write(formatMissingScripts(missing));
      return 2;
    }
    // No code and no scripts: nothing to run, nothing to fail (P1.6).
    return undefined;
  }

  // missingRequiredScripts only returns [] when every required script is
  // present, which requires a manifest to have been found.
  const manager = await detectPackageManager(ctx, manifest);
  const results = await runRequiredScripts(ctx, manager, REQUIRED_SCRIPTS);
  const failed = results.filter((result) => result.exitCode !== 0);

  if (failed.length === 0) {
    return undefined;
  }
  ctx.stderr.write(
    `gate: failed: ${failed.map((result) => result.script).join(", ")}\n`,
  );
  return 1;
}

async function runGate(ctx: Context): Promise<number> {
  const stackExitCode = await runStackChecks(ctx);

  const lengthResult = await checkFileLengths(ctx);
  if (lengthResult.offenders.length > 0) {
    ctx.stderr.write(formatLengthFailure(lengthResult));
  } else {
    ctx.stdout.write(
      `gate: all ${String(lengthResult.totalChecked)} tracked text file(s) are within the ${String(lengthResult.maxLines)}-line cap\n`,
    );
  }
  const lengthFailed = lengthResult.offenders.length > 0;

  if (stackExitCode === 2) {
    return 2;
  }
  if (stackExitCode === 1 || lengthFailed) {
    return 1;
  }
  return 0;
}

// Anything the gate can't determine (git failing, an unreadable config) is
// a failure with a message, never a pass.
async function runGateSafely(ctx: Context): Promise<number> {
  try {
    return await runGate(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`gate: ${message}\n`);
    return 1;
  }
}

export const gateCommand: CommandEntry = {
  name: "gate",
  summary: "Run the merge gate: stack checks and the file-length cap.",
  run: (_args, ctx) => runGateSafely(ctx),
};
