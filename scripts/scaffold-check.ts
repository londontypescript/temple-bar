// Checks the recorded scaffold fixtures against what the latest framework
// scaffolders write today, for developing temple-bar (never shipped):
//
//   pnpm scaffold-check [--update]
//
// The pull-request suite tests setup on recorded copies of scaffolder output
// (packages/temple-bar/src/init/testing/scaffolds/), which go stale when a
// framework changes. This runs each scaffolder for real, then the packed
// launcher's real install, and reports every difference, so updating a
// fixture is a deliberate pull request. Run it before every release.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./scaffold-check/check.ts";

export const USAGE = `Usage: pnpm scaffold-check [--update]

Runs the latest scaffolders and a real packed temple-bar install against the
public registry only (registry.npmjs.org). Run on demand and before a release.
--update records differing snapshots after all scaffolders have run.
Clean runs delete their temporary folder; other runs print the retained path.
HOME and caches are isolated; scaffolders are not sandboxed.
`;

export function parseArgs(
  args: readonly string[],
): "help" | "check" | "update" | "error" {
  if (args.length === 0) return "check";
  if (args.length !== 1) return "error";
  if (args[0] === "--help" || args[0] === "-h") return "help";
  return args[0] === "--update" ? "update" : "error";
}

async function main(args: readonly string[]): Promise<void> {
  const mode = parseArgs(args);
  if (mode === "help" || mode === "error") {
    (mode === "help" ? process.stdout : process.stderr).write(USAGE);
    process.exitCode = mode === "help" ? 0 : 2;
    return;
  }
  const controller = new AbortController();
  const interrupt = () => {
    controller.abort();
  };
  process.on("SIGINT", interrupt);
  try {
    const result = await check({
      update: mode === "update",
      signal: controller.signal,
      progress: (line) => process.stderr.write(`${line}\n`),
    });
    process.stdout.write(result.report);
    process.exitCode = result.code;
  } finally {
    process.off("SIGINT", interrupt);
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv.slice(2));
