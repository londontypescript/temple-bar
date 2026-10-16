// Which paths in a repository the judge guards, by name alone. Kept apart
// from the comparison (changes.ts) so the two readers that feed it, GitHub's
// trees for the judge and git for `ready` and `merge`, pick the same paths.
// See docs/adr/0015-every-package-checked-and-guarded.md.
//
// Repository paths always use "/", whatever the platform: never node:path's
// own separator.

import path from "node:path";

import { CONFIG_FILE_NAME } from "../config/project-config.ts";
import { LOCKFILE } from "./lockfile.ts";

/** Every file under here is a workflow GitHub runs. A pull request runs its
 * own copy of them, so editing one changes the checks that judge it. GitHub
 * reads this folder by its exact name, so the match is exact too. */
const WORKFLOWS_FOLDER = ".github/workflows/";

/** A name as a case-insensitive checkout compares it. On Windows and macOS
 * `Package.json` or `.NPMRC` is the file pnpm reads as `package.json` or
 * `.npmrc`. Upper-casing first folds letters such as the long s, which
 * Windows treats as "S"; NFKC folds look-alike forms such as full-width
 * letters. Folding too much only guards more, never less. */
function fold(name: string): string {
  return name.normalize("NFKC").toUpperCase().toLowerCase();
}

function foldedName(file: string): string {
  return fold(path.posix.basename(file));
}

const isWorkflow = (file: string): boolean => file.startsWith(WORKFLOWS_FOLDER);

/** temple-bar's own settings at the root. They set the limits its checks
 * enforce, such as the file-length cap, so raising one would let a pull
 * request pass by moving the bar it is measured against. Other tools'
 * configs (ESLint, TypeScript, Prettier) are not guarded: they differ by
 * stack, the judge can't tell a stricter change from a looser one, and
 * guarding them would make bypass merges routine (see
 * docs/adr/0011-which-checks-judge-a-pull-request.md). */
const isTempleBarConfig = (file: string): boolean => file === CONFIG_FILE_NAME;

/** Files pnpm reads when CI installs, at any depth, that can swap the
 * pinned temple-bar or run code without touching a package.json:
 * pnpm-workspace.yaml holds overrides and settings of its own, a pnpmfile
 * can rewrite any package as it installs, and .npmrc can point installs at
 * another registry. Never excluded, not even under node_modules: pnpm reads
 * an .npmrc wherever it sits on the way to a package. */
export function isInstallSetting(file: string): boolean {
  const name = foldedName(file);
  return (
    name === ".npmrc" ||
    name === "pnpm-workspace.yaml" ||
    name.startsWith(".pnpmfile.")
  );
}

/** A package.json pnpm could treat as a package's: any outside a folder
 * named exactly `node_modules`. That exclusion is matched exactly, not
 * folded: on Linux `NODE_MODULES/a` can be a real package, and folding it
 * would let one out of sight. */
export function isManifest(file: string): boolean {
  return (
    foldedName(file) === "package.json" &&
    !file.split("/").slice(0, -1).includes("node_modules")
  );
}

/** The workspace's root package.json: its `pnpm` field is the one pnpm
 * reads for the whole install. */
export const isRootManifest = (file: string): boolean =>
  !file.includes("/") && isManifest(file);

/** Only the root lockfile: it is the one CI's install reads. */
export const isRootLockfile = (file: string): boolean => file === LOCKFILE;

/** Guarded as a whole: any change to one is a finding. */
export function isWholeFileGuarded(file: string): boolean {
  return isWorkflow(file) || isInstallSetting(file) || isTempleBarConfig(file);
}

/** Any path whose change the judge looks at. */
export function isGuarded(file: string): boolean {
  return isWholeFileGuarded(file) || isManifest(file) || isRootLockfile(file);
}

/** Guarded paths whose text the comparison reads; for the rest, that they
 * changed is enough. */
export function readsText(file: string): boolean {
  return (
    !isWholeFileGuarded(file) && (isManifest(file) || isRootLockfile(file))
  );
}
