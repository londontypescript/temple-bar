// What counts as an exact SemVer version, shared by the steps that read a
// project's pnpm version: setup (init/package-json.ts) and the check before
// installing a new worktree (hooks/pnpm-pin.ts).

/** One SemVer identifier in a prerelease: a number without leading zeros,
 * or letters, digits and hyphens with at least one non-digit. */
const PRERELEASE_ID = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;

/** An exact SemVer version, as regular-expression source: no leading zeros
 * in the three numbers or in a numeric prerelease identifier; build
 * metadata allowed. */
export const EXACT_SEMVER =
  String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)` +
  String.raw`(?:-${PRERELEASE_ID}(?:\.${PRERELEASE_ID})*)?` +
  String.raw`(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;

const EXACT = new RegExp(`^${EXACT_SEMVER}$`);

export function isExactSemver(value: string): boolean {
  return EXACT.test(value);
}
