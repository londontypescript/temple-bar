// Reads which pnpm a project says it uses, for the check that runs before a
// new worktree installs (pnpm-check.ts). Pure: it only looks at package.json
// text. pnpm 9.7 and newer switch themselves to the version package.json
// pins, but older ones don't, so what a pin means is only known once the
// pnpm that will really run has been asked.

import { isExactSemver } from "../exact-semver.ts";

export type DeclaredPnpm =
  /** Nothing in package.json names a pnpm version. */
  | { readonly kind: "none" }
  /** One exact version, or several that agree. */
  | { readonly kind: "exact"; readonly version: string }
  /** A pnpm is named, but not as an exact version (a range, `latest`...),
   * so a comparison would be a guess. */
  | { readonly kind: "range"; readonly declared: string }
  /** Exact pins that name different versions, each with the field it is in. */
  | { readonly kind: "conflict"; readonly pins: readonly PnpmPin[] };

interface PnpmPin {
  readonly field: "packageManager" | "devEngines.packageManager";
  readonly version: string;
}

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

/** Every version `devEngines.packageManager` asks of pnpm. That field may
 * be one object or a list of them, and each pnpm entry counts. */
function fromDevEngines(devEngines: unknown): string[] {
  if (!isRecord(devEngines)) {
    return [];
  }
  const field = devEngines.packageManager;
  const entries: unknown[] = Array.isArray(field) ? field : [field];
  const versions: string[] = [];
  for (const entry of entries) {
    if (
      isRecord(entry) &&
      entry.name === "pnpm" &&
      typeof entry.version === "string" &&
      entry.version.trim() !== ""
    ) {
      versions.push(withoutSuffix(entry.version.trim()));
    }
  }
  return versions;
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
  const named: PnpmPin[] = [
    ...fromDevEngines(manifest.devEngines).map((version): PnpmPin => ({
      field: "devEngines.packageManager",
      version,
    })),
    ...(fromField === undefined
      ? []
      : [{ field: "packageManager", version: fromField } as const]),
  ];
  const exact = named.filter((pin) => isExactSemver(pin.version));
  if (new Set(exact.map((pin) => pin.version)).size > 1) {
    return { kind: "conflict", pins: exact };
  }
  const [first] = exact;
  if (first !== undefined) {
    return { kind: "exact", version: first.version };
  }
  const [declared] = named;
  return declared === undefined
    ? { kind: "none" }
    : { kind: "range", declared: declared.version };
}
