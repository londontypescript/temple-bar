// Gives a fixture repo a real tsc without installing anything: links this
// repo's own node_modules/typescript and node_modules/.bin into the
// fixture's node_modules, so `pnpm run typecheck` and `pnpm exec tsc` there
// find the TypeScript this repo pins, with no network. A junction on
// Windows needs no admin rights and an absolute target; elsewhere the type
// is ignored and it is a plain folder link. node_modules is gitignored in
// every fixture, so git, the gate and knip leave the links out. Not
// shipped: the build tsconfig excludes every `testing/` folder.

import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** This repo's root node_modules, five folders up from this file. */
const REPO_MODULES = fileURLToPath(
  new URL("../../../../../node_modules/", import.meta.url),
);

/** Links TypeScript and its bin into `dir`'s node_modules. */
export function linkTypeScript(dir: string): void {
  const modules = path.join(dir, "node_modules");
  mkdirSync(modules, { recursive: true });
  for (const name of ["typescript", ".bin"]) {
    symlinkSync(
      path.join(REPO_MODULES, name),
      path.join(modules, name),
      "junction",
    );
  }
}

/** A tsconfig.json for a fixture whose frameworks aren't installed: it
 * includes `include` and checks nothing (`noCheck`), so `tsc -p` passes
 * with imports it can't resolve and JSX it has no types for, while its
 * file list still names every file. */
export function uncheckedTsconfig(include: readonly string[]): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        noCheck: true,
        noEmit: true,
        jsx: "preserve",
        allowImportingTsExtensions: true,
        types: [],
      },
      include,
    },
    null,
    2,
  )}\n`;
}
