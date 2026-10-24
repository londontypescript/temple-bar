// Whether a pull request moves the pinned temple-bar version, and what it
// changes besides. A pin bump belongs in a pull request of its own, never
// as a side effect of other work. The judge already refuses every pin bump,
// so each one is merged by the maintainer on GitHub, where nothing else
// stops a bump carrying other changes along unseen. So the judge's refusal
// names every other path the pull request changes, and the maintainer sees
// what rides along. See docs/adr/0016-agent-rules-and-the-merge-loop.md.
//
// Pure: it is handed the same changes the findings come from, and the names
// of every changed path, and reads nothing itself.

import { textOf, type FileState, type PathChange } from "./file-state.ts";
import {
  isManifest,
  isRootLockfile,
  isWholeFileGuarded,
} from "./guarded-paths.ts";
import { lockfileFindings } from "./lockfile.ts";
import {
  parseManifest,
  pinChanges,
  TEMPLE_BAR_PACKAGE,
  type Manifest,
} from "./manifests.ts";

/** A side that can't be read as text: unreadable, or a symlink, a
 * submodule or a folder. What it holds is unknown, and unknown is never
 * "unchanged" here. */
const unknown = (state: FileState): boolean =>
  state.kind === "unreadable" || state.kind === "special";

/** A manifest side's contents, nothing for an absent side, or undefined
 * when it can't be read as a manifest at all. */
function manifestOf(file: string, state: FileState): Manifest | undefined {
  if (state.kind === "absent") {
    return {};
  }
  if (state.kind !== "regular") {
    return undefined;
  }
  const parsed = parseManifest(textOf(file, state));
  return parsed.kind === "valid" ? parsed.value : undefined;
}

function textOrNothing(file: string, state: FileState): string | undefined {
  return state.kind === "regular" ? textOf(file, state) : undefined;
}

/** A package.json the findings read as a manifest. One that is guarded as
 * a whole file, such as `.github/workflows/package.json`, is judged as that
 * file alone and its text is never read, so it isn't one here either. No
 * pin bump is missed: a temple-bar pin in such a package changes the root
 * lockfile's entries too, and those are compared. */
const readAsManifest = (file: string): boolean =>
  isManifest(file) && !isWholeFileGuarded(file);

function movesPin({ path: file, base, head }: PathChange): boolean {
  if (readAsManifest(file)) {
    const before = manifestOf(file, base);
    const after = manifestOf(file, head);
    return (
      before === undefined ||
      after === undefined ||
      pinChanges(before, after).length > 0
    );
  }
  if (isRootLockfile(file)) {
    return (
      unknown(base) ||
      unknown(head) ||
      lockfileFindings(
        TEMPLE_BAR_PACKAGE,
        textOrNothing(file, base),
        textOrNothing(file, head),
      ).length > 0
    );
  }
  return false;
}

/**
 * The paths that move the pinned temple-bar version: each package.json
 * whose temple-bar entries differ, and the root lockfile when its
 * temple-bar entries do. A manifest or lockfile the judge can't read on
 * either side counts too, since it might. Empty when the pin stayed.
 */
export function pinBumpPaths(changes: readonly PathChange[]): string[] {
  return changes.filter(movesPin).map((change) => change.path);
}

/**
 * The lines that go with a refusal when the pin moves: every changed path
 * other than the ones moving the pin, guarded or not and with no cap,
 * since a cap would hide exactly what this is for. Empty when the pin
 * stayed, so every other refusal reads as before.
 */
export function pinBumpDisclosure(
  changes: readonly PathChange[],
  paths: readonly string[],
): string {
  const carriers = new Set(pinBumpPaths(changes));
  if (carriers.size === 0) {
    return "";
  }
  const others = paths.filter((file) => !carriers.has(file));
  return others.length === 0
    ? "This pull request changes nothing else.\n"
    : "This pull request also changes:\n" +
        others.map((file) => `  ${file}\n`).join("");
}
