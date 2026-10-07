// Packs both packages for a hand trial, exactly as the packed-package test
// and a release do:
//
//   pnpm pack:local <folder>
//
// A plain `pnpm pack` doesn't compile: it packs whatever dist/ an earlier
// build left behind, so a trial can run code from before the latest change.
// This builds each package fresh from its source into <folder>/stage and
// packs that, writing the tarballs to <folder>/tarballs.
// The folder is resolved from where the command was run, not the repo root.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { packBoth } from "../e2e/support/pack.ts";

const USAGE = "Usage: pnpm pack:local <folder>";

async function main(args: readonly string[]): Promise<void> {
  const [folder, ...rest] = args;
  if (folder === undefined || rest.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  // pnpm runs a root script from the repo root and records where it was
  // started in INIT_CWD, so a relative folder means what the user typed.
  const workDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), folder);
  const tarballs = await packBoth(workDir);
  process.stdout.write(
    `Packed, built fresh from source:\n  ${tarballs.templeBar}\n  ${tarballs.createTempleBar}\n`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main(process.argv.slice(2));
}
