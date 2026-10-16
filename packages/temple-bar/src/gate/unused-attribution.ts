// Where knip's findings are. knip runs once, at the root, over the whole
// workspace: a package whose exports only its siblings import would look
// unused if each package were checked on its own. So one run's findings
// are put down afterwards to the package whose folder holds each file, and
// the report can say which packages need work.
//
// Only paths decide it, and only through path.relative: knip's paths are
// absolute, use the platform's separator, and on Windows may differ from
// the root's in letter case, which a string prefix would get wrong.

import path from "node:path";

/** How the report names findings that belong to no listed package. */
export const ROOT_OWNER = "the root";

/** A package, the root or a path outside the repo, with its findings'
 * files. */
export interface FindingOwner {
  readonly name: string;
  readonly files: readonly string[];
}

/** `file` relative to `folder`, "/"-separated; undefined when outside it. */
function inside(folder: string, file: string): string | undefined {
  const relative = path.relative(folder, file);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

/** Who owns `file`: the deepest package whose folder holds it, the root,
 * or, outside every root, the path itself. */
function ownerOf(
  roots: readonly string[],
  packages: readonly string[],
  file: string,
): { name: string; shown: string } {
  for (const root of roots) {
    const shown = inside(root, file);
    if (shown === undefined) continue;
    let name = ROOT_OWNER;
    let depth = 0;
    for (const relative of packages) {
      const parts = relative.split("/");
      if (
        parts.length > depth &&
        inside(path.join(root, ...parts), file) !== undefined
      ) {
        name = relative;
        depth = parts.length;
      }
    }
    return { name, shown };
  }
  // Never dropped: a finding the gate can't place is still a finding.
  return { name: file, shown: file };
}

/**
 * Puts each of `files` (knip's absolute paths) down to its owner. `roots`
 * are the repo's root as the gate was given it and as it resolves, since
 * knip may name files either way; `packages` are the listed packages'
 * folders, relative to the root and "/"-separated, in the inventory's
 * order. Owners come back in that order: the root first, then each
 * package, then any path outside the repo. Each file is listed once.
 */
export function attributeFindings(
  roots: readonly string[],
  packages: readonly string[],
  files: readonly string[],
): FindingOwner[] {
  const owned = new Map<string, Set<string>>();
  for (const file of files) {
    const { name, shown } = ownerOf(roots, packages, file);
    const list = owned.get(name) ?? new Set<string>();
    list.add(shown);
    owned.set(name, list);
  }
  const order = [ROOT_OWNER, ...packages];
  const names = [
    ...order.filter((name) => owned.has(name)),
    ...[...owned.keys()].filter((name) => !order.includes(name)),
  ];
  return names.map((name) => ({ name, files: [...(owned.get(name) ?? [])] }));
}
