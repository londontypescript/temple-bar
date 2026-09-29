// Reads this package's own package.json to pin the dev dependency it adds.
// Deliberately not shared with @londontypescript/temple-bar's own copy
// (packages/temple-bar/src/package-info.ts): this package can't import
// temple-bar's source, and the two versions are the same anyway because
// 1.9's release workflow publishes both packages in lockstep.

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
