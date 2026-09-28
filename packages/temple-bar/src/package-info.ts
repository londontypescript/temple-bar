// Reads this package's own package.json to answer `temple-bar --version`.
// The published package ships `package.json` next to `dist/` (npm always
// includes it), and this file's own directory sits at the same depth under
// the package root whether it's running as src/package-info.ts (type
// stripping, source checkout) or as dist/package-info.js (built): one
// directory below the package root either way. So "../package.json" resolves
// correctly from both.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJsonShape {
  readonly version?: string;
}

export function readOwnVersion(): string {
  const here = fileURLToPath(import.meta.url);
  const packageJsonPath = path.join(path.dirname(here), "..", "package.json");
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as PackageJsonShape;

  if (!parsed.version) {
    throw new Error(`no "version" field in ${packageJsonPath}`);
  }

  return parsed.version;
}
