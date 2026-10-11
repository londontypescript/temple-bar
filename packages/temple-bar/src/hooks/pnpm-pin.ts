// Reads which pnpm a project says it uses, for the check that runs before a
// new worktree installs (pnpm-check.ts). Pure: it only looks at package.json
// text. pnpm 9.7 and newer switch themselves to the version package.json
// pins, but older ones don't, so what a pin means is only known once the
// pnpm that will really run has been asked.

import { isExactSemver } from "../exact-semver.ts";

export type DeclaredPnpm =
  /** Nothing in package.json names a pnpm version. */
  | { readonly kind: "none" }
  /** One exact version, or two that agree. */
  | { readonly kind: "exact"; readonly version: string }
  /** A pnpm is named, but not as an exact version (a range, `latest`...),
   * so a comparison would be a guess. */
  | { readonly kind: "range"; readonly declared: string }
  /** `packageManager` and `devEngines.packageManager` name different exact
   * versions. */
  | {
      readonly kind: "conflict";
      readonly packageManager: string;
      readonly devEngines: string;
    };

/** Drops a `+sha512.…` integrity suffix, which Corepack-style pins carry. */
function withoutSuffix(version: string): string {
  const plus = version.indexOf("+");
  return plus === -1 ? version : version.slice(0, plus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The version `packageManager` names when it names pnpm, else undefined. */
function fromPackageManager(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("pnpm@")) {
    return undefined;
  }
  return withoutSuffix(value.slice("pnpm@".length));
}

/** The version `devEngines.packageManager` asks of pnpm. That field may be
 * one object or a list of them. */
function fromDevEngines(devEngines: unknown): string | undefined {
  if (!isRecord(devEngines)) {
    return undefined;
  }
  const field = devEngines.packageManager;
  const entries: unknown[] = Array.isArray(field) ? field : [field];
  for (const entry of entries) {
    if (
      isRecord(entry) &&
      entry.name === "pnpm" &&
      typeof entry.version === "string" &&
      entry.version.trim() !== ""
    ) {
      return withoutSuffix(entry.version.trim());
    }
  }
  return undefined;
}

/** What package.json declares for pnpm. An unreadable file declares
 * nothing: installing reports that itself. */
export function declaredPnpm(packageJson: string): DeclaredPnpm {
  let manifest: unknown;
  try {
    manifest = JSON.parse(packageJson);
  } catch {
    return { kind: "none" };
  }
  if (!isRecord(manifest)) {
    return { kind: "none" };
  }
  const fromField = fromPackageManager(manifest.packageManager);
  const fromEngines = fromDevEngines(manifest.devEngines);

  const exactField =
    fromField !== undefined && isExactSemver(fromField) ? fromField : undefined;
  const exactEngines =
    fromEngines !== undefined && isExactSemver(fromEngines)
      ? fromEngines
      : undefined;
  if (
    exactField !== undefined &&
    exactEngines !== undefined &&
    exactField !== exactEngines
  ) {
    return {
      kind: "conflict",
      packageManager: exactField,
      devEngines: exactEngines,
    };
  }
  const exact = exactField ?? exactEngines;
  if (exact !== undefined) {
    return { kind: "exact", version: exact };
  }
  const declared = fromEngines ?? fromField;
  return declared === undefined
    ? { kind: "none" }
    : { kind: "range", declared };
}
